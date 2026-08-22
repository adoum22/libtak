import { expect, test, type Page } from '@playwright/test';

const adminUsername = process.env.E2E_ADMIN_USERNAME!;
const sellerUsername = process.env.E2E_SELLER_USERNAME!;
const password = process.env.E2E_PASSWORD!;

for (const [name, value] of Object.entries({ adminUsername, sellerUsername, password })) {
  if (!value?.trim()) throw new Error(`Missing required E2E credential: ${name}`);
}

const login = async (page: Page, username: string) => {
  await page.addInitScript(() => localStorage.setItem('language', 'en'));
  await page.goto('/login');
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const loginResponse = page.waitForResponse(response => (
      response.url().includes('/api/auth/login/') && response.request().method() === 'POST'
    ));
    await page.locator('button[type="submit"]').click();
    const response = await loginResponse;
    if (response.status() !== 429) {
      if (!response.ok()) throw new Error(`Login failed with HTTP ${response.status()}.`);
      await expect(page).not.toHaveURL(/\/login$/);
      return;
    }
    const retryAfter = Number(response.headers()['retry-after'] || 1);
    await page.waitForTimeout((Number.isFinite(retryAfter) ? retryAfter : 1) * 1_000 + 150);
  }
  throw new Error('Login remained rate-limited after four safe retries.');
};

const expectHealthyLayout = async (page: Page) => {
  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page.getByText(/Something went wrong|Une erreur est survenue|حدث خطأ/)).toHaveCount(0);
  expect(await page.evaluate(() => (
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ))).toBe(0);
  expect(await page.locator('button').evaluateAll(buttons => buttons.filter(button => !(
    button.getAttribute('aria-label')
    || button.getAttribute('title')
    || button.textContent?.trim()
  )).length)).toBe(0);
};

const e2eProduct = {
  id: 900001,
  name: 'Isolated E2E product',
  barcode: 'E2E-900001',
  sale_price_ht: 10,
  price_ttc: 12,
  stock: 5,
  active: true,
};

const mockSellableProduct = async (page: Page) => {
  await page.route('**/api/inventory/products/pos/**', async route => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        count: 1,
        next: null,
        previous: null,
        results: [e2eProduct],
      },
    });
  });
};

const addMockProductToCart = async (page: Page) => {
  await page.goto('/pos');
  await page.getByRole('textbox', { name: 'Scan or search for product...' }).fill('Isolated E2E');
  const productButton = page.locator('button[aria-label^="Add "]:not([disabled])').first();
  await expect(productButton).toBeVisible();
  await productButton.click();
  await expect(page.getByText('Cart is empty')).toHaveCount(0);
};

interface MockCreditPayment {
  id: number;
  amount: number;
  note: string;
  operation_id: string;
  status: 'ACTIVE' | 'REVERSED';
  status_display: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
  reversed_by: number | null;
  reversed_by_name: string | null;
  reversed_at: string | null;
  reversal_reason: string;
  reversal_operation_id: string;
}

interface CapturedReversal {
  reason?: string;
  operation_id?: string;
  idempotencyHeader?: string;
}

const mockCreditWithActivePayment = async (page: Page) => {
  const creditId = 900101;
  const paymentId = 900102;
  let payment: MockCreditPayment = {
    id: paymentId,
    amount: 40,
    note: 'E2E deposit',
    operation_id: 'e2e-original-payment-900102',
    status: 'ACTIVE',
    status_display: 'Active',
    created_by: 1,
    created_by_name: 'E2E cashier',
    created_at: '2026-08-20T10:00:00Z',
    reversed_by: null,
    reversed_by_name: null,
    reversed_at: null,
    reversal_reason: '',
    reversal_operation_id: '',
  };
  let capturedReversal: CapturedReversal | null = null;

  const credit = () => ({
    id: creditId,
    sale: 900100,
    sale_date: '2026-08-20T09:00:00Z',
    sale_total: 100,
    adjusted_total: 100,
    sale_discount: 0,
    customer: 900103,
    customer_name: 'Isolated Credit Customer',
    customer_phone: '0612345678',
    status: payment.status === 'ACTIVE' ? 'PARTIAL' : 'UNPAID',
    status_display: payment.status === 'ACTIVE' ? 'Partial' : 'Unpaid',
    paid_amount: payment.status === 'ACTIVE' ? 40 : 0,
    remaining_amount: payment.status === 'ACTIVE' ? 60 : 100,
    created_at: '2026-08-20T09:00:00Z',
    items: [{
      id: 900104,
      product_name: 'Isolated E2E product',
      quantity: 1,
      unit_price_ht: 100,
    }],
    payments: [payment],
  });

  await page.route('**/api/credit/credits/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === 'POST'
      && pathname.endsWith(`/credits/${creditId}/payments/${paymentId}/reverse/`)
    ) {
      const body = request.postDataJSON() as { reason?: string; operation_id?: string };
      capturedReversal = {
        ...body,
        idempotencyHeader: request.headers()['idempotency-key'],
      };
      payment = {
        ...payment,
        status: 'REVERSED',
        status_display: 'Reversed',
        reversed_by: 1,
        reversed_by_name: 'E2E admin',
        reversed_at: '2026-08-21T10:00:00Z',
        reversal_reason: body.reason || '',
        reversal_operation_id: body.operation_id || '',
      };
      await route.fulfill({ status: 200, contentType: 'application/json', json: payment });
      return;
    }
    if (request.method() === 'GET' && pathname.endsWith(`/credits/${creditId}/`)) {
      await route.fulfill({ contentType: 'application/json', json: credit() });
      return;
    }
    if (request.method() === 'GET' && pathname.endsWith('/credits/')) {
      await route.fulfill({
        contentType: 'application/json',
        json: { count: 1, next: null, previous: null, results: [credit()] },
      });
      return;
    }
    await route.fallback();
  });

  return {
    creditId,
    paymentId,
    getCapturedReversal: () => capturedReversal,
  };
};

test('protected modules redirect an unauthenticated browser to login', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('language', 'en'));
  for (const route of ['/pos', '/credit', '/users', '/settings']) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  }
});

test('administrator can open every application route without layout regressions', async ({ page }) => {
  await login(page, adminUsername);

  const routes = [
    '/', '/pos', '/cash-register', '/accounting', '/reports', '/inventory',
    '/credit', '/discounts', '/purchase-orders', '/suppliers', '/returns',
    '/stock-count', '/zakat', '/users', '/activity', '/settings', '/not-a-real-page',
  ];

  for (const route of routes) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${route === '/' ? '/$' : route.replaceAll('/', '\\/')}$`));
    await expectHealthyLayout(page);
  }
});

test('administrator can configure multiple administrators and sellers', async ({ page }) => {
  await login(page, adminUsername);
  const users = [
    {
      id: 900201,
      username: adminUsername,
      email: 'admin-one@e2e.invalid',
      first_name: 'Admin',
      last_name: 'One',
      role: 'ADMIN',
      phone: '',
      avatar: null,
      is_active: true,
      can_view_stock: true,
      can_manage_stock: true,
      effective_can_view_stock: true,
      effective_can_manage_stock: true,
    },
    {
      id: 900202,
      username: 'e2e-second-admin',
      email: 'admin-two@e2e.invalid',
      first_name: 'Admin',
      last_name: 'Two',
      role: 'ADMIN',
      phone: '',
      avatar: null,
      is_active: true,
      can_view_stock: true,
      can_manage_stock: true,
      effective_can_view_stock: true,
      effective_can_manage_stock: true,
    },
    {
      id: 900203,
      username: sellerUsername,
      email: 'seller-one@e2e.invalid',
      first_name: 'Seller',
      last_name: 'One',
      role: 'CASHIER',
      phone: '',
      avatar: null,
      is_active: true,
      can_view_stock: true,
      can_manage_stock: false,
      effective_can_view_stock: true,
      effective_can_manage_stock: false,
    },
    {
      id: 900204,
      username: 'e2e-second-seller',
      email: 'seller-two@e2e.invalid',
      first_name: 'Seller',
      last_name: 'Two',
      role: 'CASHIER',
      phone: '',
      avatar: null,
      is_active: true,
      can_view_stock: false,
      can_manage_stock: false,
      effective_can_view_stock: false,
      effective_can_manage_stock: false,
    },
  ];
  let createBody: string | null = null;
  await page.route('**/api/auth/users/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname !== '/api/auth/users/') {
      await route.fallback();
      return;
    }
    if (request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: { count: users.length, next: null, previous: null, results: users },
      });
      return;
    }
    if (request.method() === 'POST') {
      createBody = request.postData();
      const created = {
        ...users[0],
        id: 900205,
        username: 'e2e-third-admin',
        email: 'admin-three@e2e.invalid',
        first_name: 'Admin',
        last_name: 'Three',
      };
      users.push(created);
      await route.fulfill({ status: 201, contentType: 'application/json', json: created });
      return;
    }
    await route.fallback();
  });
  await page.goto('/users');

  await expect(page.getByText('@e2e-second-admin', { exact: true })).toBeVisible();
  await expect(page.getByText('@e2e-second-seller', { exact: true })).toBeVisible();
  const addUser = page.getByRole('button', { name: 'Add User' });
  await expect(addUser).toBeEnabled();
  await expect(page.getByText(`@${adminUsername}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`@${sellerUsername}`, { exact: true })).toBeVisible();

  await addUser.click();
  const userDialog = page.getByRole('dialog', { name: 'New user' });
  await expect(userDialog).toBeVisible();
  await expect(userDialog.locator('#user-role option[value="ADMIN"]')).toBeEnabled();
  await expect(userDialog.locator('#user-role option[value="CASHIER"]')).toBeEnabled();
  await userDialog.getByLabel('First name').fill('Admin');
  await userDialog.getByLabel('Last name').fill('Three');
  await userDialog.getByLabel('Username').fill('e2e-third-admin');
  await userDialog.getByLabel('Role').selectOption('ADMIN');
  await userDialog.getByLabel('Email').fill('admin-three@e2e.invalid');
  await userDialog.getByLabel('Password', { exact: true }).fill('E2e-isolated-password-3');
  await userDialog.getByLabel('Confirm password').fill('E2e-isolated-password-3');
  await userDialog.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.getByText('@e2e-third-admin', { exact: true })).toBeVisible();
  expect(createBody).toContain('name="role"');
  expect(createBody).toContain('ADMIN');
});

test('confirmation dialogs trap focus and cancel safely', async ({ page }) => {
  await login(page, adminUsername);
  await page.goto('/users');

  await page.getByRole('button', { name: `Disable ${sellerUsername}` }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('POS cart survives reload but starts empty in a new authenticated context', async ({ page }, testInfo) => {
  await login(page, adminUsername);
  await mockSellableProduct(page);
  await addMockProductToCart(page);

  await page.keyboard.press('F8');
  await expect(page.getByText('Cart is empty')).toBeVisible();
  await page.keyboard.press('F9');
  const heldCartsDialog = page.getByRole('dialog', { name: 'Held carts' });
  await expect(heldCartsDialog).toBeVisible();
  await heldCartsDialog.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Cart is empty')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('Cart is empty')).toHaveCount(0);

  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.locator('.sidebar')).toHaveClass(/open/);
  }
  await page.getByRole('button', { name: 'Logout' }).click();
  await login(page, sellerUsername);
  await expect(page.getByText('Cart is empty')).toBeVisible();
});

test('POS blocks duplicate validation and reuses its idempotency key on retry', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Checkout concurrency is covered once on desktop');
  await login(page, adminUsername);
  await mockSellableProduct(page);

  const salePayloads: Array<{ idempotency_key?: string }> = [];
  let releaseFirstResponse!: () => void;
  const firstResponseGate = new Promise<void>(resolve => {
    releaseFirstResponse = resolve;
  });
  await page.route('**/api/sales/sales/', async route => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }
    salePayloads.push(request.postDataJSON() as { idempotency_key?: string });
    if (salePayloads.length === 1) {
      await firstResponseGate;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        json: { detail: 'Synthetic E2E retry' },
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      json: {
        id: 900301,
        total_ttc: 12,
        discount_amount: 0,
        discount_code: '',
        payment_method: 'CASH',
        amount_received: 12,
        change_amount: 0,
        items: [{
          product_id: e2eProduct.id,
          product_name: e2eProduct.name,
          quantity: 1,
          unit_price_ht: 10,
          total_price_ht: 10,
          tva_rate: 20,
        }],
      },
    });
  });

  await addMockProductToCart(page);
  await page.getByRole('button', { name: 'Checkout', exact: true }).click();
  const paymentDialog = page.getByRole('dialog', { name: 'Checkout' });
  await paymentDialog.getByRole('button', { name: 'Exact amount' }).click();
  const validateSale = paymentDialog.locator('button[aria-busy]');
  await validateSale.click();
  await expect.poll(() => salePayloads.length).toBe(1);
  await expect(validateSale).toHaveAttribute('aria-busy', 'true');
  await validateSale.dispatchEvent('click');
  await page.waitForTimeout(100);
  expect(salePayloads).toHaveLength(1);

  releaseFirstResponse();
  await expect(validateSale).toBeEnabled();
  await validateSale.click();
  await expect(page.getByRole('dialog', { name: 'Sale completed successfully' })).toBeVisible();

  expect(salePayloads).toHaveLength(2);
  expect(salePayloads[0]?.idempotency_key).toBeTruthy();
  expect(salePayloads[0]?.idempotency_key?.length).toBeGreaterThanOrEqual(16);
  expect(salePayloads[1]?.idempotency_key).toBe(salePayloads[0]?.idempotency_key);
  await expect.poll(() => page.evaluate(() => ({
    cart: sessionStorage.getItem('libtak.posCart'),
    attempt: sessionStorage.getItem('libtak.posCheckoutAttempt'),
  }))).toEqual({ cart: null, attempt: null });
});

test('seller sees only allowed modules and protected routes deny access', async ({ page }) => {
  await login(page, sellerUsername);
  await expect(page).toHaveURL(/\/pos$/);

  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);

  for (const route of ['/pos', '/accounting', '/credit']) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${route.replaceAll('/', '\\/')}$`));
    await expectHealthyLayout(page);
  }

  const stockIsVisible = await page.locator('a[href="/inventory"]').count() > 0;
  await page.goto('/inventory');
  if (stockIsVisible) {
    await expect(page).toHaveURL(/\/inventory$/);
    await expectHealthyLayout(page);
  } else {
    await expect(page).toHaveURL(/\/forbidden$/);
  }

  for (const route of [
    '/users', '/settings', '/suppliers', '/reports', '/cash-register', '/returns',
    '/purchase-orders', '/stock-count', '/zakat', '/activity', '/discounts',
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.locator('#access-denied-title')).toBeVisible();
  }
});

test('administrator sees active credit payments and can reverse one with an idempotency key', async ({ page }) => {
  await login(page, adminUsername);
  const creditMock = await mockCreditWithActivePayment(page);
  await page.goto('/credit');

  await expect(page.locator('p.font-semibold:visible, td .font-medium:visible').filter({ hasText: 'Isolated Credit Customer' })).toBeVisible();
  await page.getByRole('button', { name: 'Details' }).click();
  const detailDialog = page.getByRole('dialog', { name: /Credit #900101/ });
  await expect(detailDialog.locator('dd:visible, td span:visible').filter({ hasText: 'E2E deposit' })).toBeVisible();
  await expect(detailDialog.locator('.badge:visible').filter({ hasText: 'Active' })).toBeVisible();
  await detailDialog.getByRole('button', { name: 'Reverse' }).click();

  const reversalDialog = page.getByRole('dialog', { name: 'Reverse' });
  await reversalDialog.getByLabel('Reason (required)').fill('Administrative correction');
  await reversalDialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(reversalDialog).toHaveCount(0);
  await expect(detailDialog.locator('.badge:visible').filter({ hasText: 'Reversed' })).toBeVisible();
  await expect(detailDialog.locator('.text-danger:visible').filter({ hasText: 'Administrative correction' })).toBeVisible();
  await expect(detailDialog.getByRole('button', { name: 'Reverse' })).toHaveCount(0);

  const reversal = creditMock.getCapturedReversal();
  expect(reversal).not.toBeNull();
  expect(reversal?.reason).toBe('Administrative correction');
  expect(reversal?.operation_id).toBeTruthy();
  expect(reversal?.idempotencyHeader).toBe(reversal?.operation_id);
});

test('seller sees credit payment history but no reversal control', async ({ page }) => {
  await login(page, sellerUsername);
  await mockCreditWithActivePayment(page);
  await page.goto('/credit');

  await page.getByRole('button', { name: 'Details' }).click();
  const detailDialog = page.getByRole('dialog', { name: /Credit #900101/ });
  await expect(detailDialog.locator('dd:visible, td span:visible').filter({ hasText: 'E2E deposit' })).toBeVisible();
  await expect(detailDialog.locator('.badge:visible').filter({ hasText: 'Active' })).toBeVisible();
  await expect(detailDialog.getByRole('button', { name: 'Record payment' })).toBeVisible();
  await expect(detailDialog.getByRole('button', { name: 'Reverse' })).toHaveCount(0);
});

test('mobile navigation is labelled, focus-contained, overflow-free and clears the session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only navigation regression');
  await login(page, sellerUsername);
  await page.goto('/pos');

  await expectHealthyLayout(page);
  const mobileNavigation = page.locator('.mobile-bottom-nav');
  await expect(mobileNavigation).toBeVisible();
  const undersizedTargets = await mobileNavigation.locator('a, button').evaluateAll(elements => (
    elements
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width < 24 || rect.height < 24;
      })
      .map(element => element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName)
  ));
  expect(undersizedTargets).toEqual([]);

  const openMenu = page.getByRole('button', { name: 'Open menu' });
  await expect(openMenu).toHaveAttribute('aria-expanded', 'false');
  await openMenu.click();
  const sidebar = page.locator('.sidebar');
  await expect(sidebar).toHaveClass(/open/);
  await expect(sidebar).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.main-content')).toHaveAttribute('aria-hidden', 'true');
  await expect(mobileNavigation).toHaveAttribute('aria-hidden', 'true');
  await expect(sidebar.locator('[data-sidebar-initial-focus]')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(sidebar).not.toHaveClass(/open/);
  await expect(openMenu).toBeFocused();
  await expect(page.locator('.main-content')).not.toHaveAttribute('aria-hidden', 'true');

  await openMenu.click();
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
});
