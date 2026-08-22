import { defineConfig, devices } from '@playwright/test';

const requireEnvironment = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required E2E environment variable: ${name}`);
  return value;
};

if (process.env.E2E_CONFIRM_ISOLATED_DB !== '1') {
  throw new Error(
    'E2E tests are disabled until E2E_CONFIRM_ISOLATED_DB=1 confirms that the API uses an isolated database.',
  );
}

const baseURL = requireEnvironment('E2E_BASE_URL');
const e2eURL = new URL(baseURL);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

if (!loopbackHosts.has(e2eURL.hostname) && process.env.E2E_ALLOW_REMOTE !== '1') {
  throw new Error(
    'E2E_BASE_URL must target localhost. Set E2E_ALLOW_REMOTE=1 only for an explicitly isolated remote environment.',
  );
}

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
