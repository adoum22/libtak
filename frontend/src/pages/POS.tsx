import {
    useState,
    useRef,
    useEffect,
    useCallback,
    useDeferredValue,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import client, { getApiErrorMessage } from '../api/client';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { useToast } from '../components/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';
import { printReceipt, type PrintReceiptItem } from '../utils/printService';
import { calculateLineTotal } from '../utils/pricing';
import {
    POS_CART_STORAGE_KEY,
    POS_HELD_CARTS_STORAGE_KEY,
    POS_LAST_RECEIPT_STORAGE_KEY,
} from '../utils/privateSessionStorage';
import {
    clearCheckoutAttempt,
    getOrCreateCheckoutAttempt,
    loadCheckoutAttempt,
    persistCheckoutAttempt,
    type POSCheckoutAttempt,
} from '../utils/posCheckoutAttempt';
import {
    Search,
    Plus,
    Minus,
    Trash2,
    Banknote,
    ShoppingCart,
    Package,
    X,
    Check,
    ScanLine,
    CreditCard,
    Printer,
    TicketPercent,
    User,
    UserPlus,
    CirclePause,
    CirclePlay,
    Keyboard,
    History,
} from 'lucide-react';

interface Product {
    id: number;
    name: string;
    barcode: string;
    sale_price_ht: number;
    price_ttc: number;
    stock: number;
    image_url?: string;
    active?: boolean;
}

interface CartItem {
    product: Product;
    quantity: number;
}

interface Customer {
    id: number;
    name: string;
    phone?: string;
}

type POSMode = 'SALE' | 'PRICE_CHECK';
type PaymentMethod = 'CASH' | 'CARD' | 'CREDIT' | 'OTHER';
const PAYMENT_METHOD_VALUES: PaymentMethod[] = ['CASH', 'CARD', 'CREDIT', 'OTHER'];

interface SaleResult {
    id: number;
    total_ttc: number;
    discount_amount: number;
    discount_code: string;
    payment_method: PaymentMethod;
    amount_received: number;
    change_amount: number;
    items: Array<{
        product_id: number;
        product_name: string;
        quantity: number;
        unit_price_ht: number;
        total_price_ht: number;
        tva_rate: number;
    }>;
}

interface AppliedDiscount {
    code: string;
    amount: number;
    total: number;
}

interface HeldCart {
    id: string;
    label: string;
    createdAt: string;
    items: CartItem[];
}

interface StoredReceipt {
    sale: SaleResult;
    items: PrintReceiptItem[];
}

const readSessionValue = <T,>(key: string, fallback: T): T => {
    try {
        const stored = sessionStorage.getItem(key);
        return stored ? JSON.parse(stored) as T : fallback;
    } catch {
        return fallback;
    }
};

const loadCartDraft = (): CartItem[] => {
    try {
        const value = JSON.parse(sessionStorage.getItem(POS_CART_STORAGE_KEY) || '[]');
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
};

const loadHeldCarts = () => {
    const value = readSessionValue<unknown>(POS_HELD_CARTS_STORAGE_KEY, []);
    return Array.isArray(value) ? value as HeldCart[] : [];
};

const loadLastReceipt = () => {
    const value = readSessionValue<StoredReceipt | null>(POS_LAST_RECEIPT_STORAGE_KEY, null);
    return value?.sale && Array.isArray(value.items) ? value : null;
};

const persistHeldCarts = (carts: HeldCart[]) => {
    sessionStorage.setItem(POS_HELD_CARTS_STORAGE_KEY, JSON.stringify(carts));
};

export default function POS() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const toast = useToast();
    const [mode, setMode] = useState<POSMode>('SALE');
    const [cart, setCart] = useState<CartItem[]>(loadCartDraft);
    const [searchTerm, setSearchTerm] = useState('');
    const deferredSearch = useDeferredValue(searchTerm.trim());

    // Payment State
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [amountGiven, setAmountGiven] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
    const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
    const [showClearCartConfirm, setShowClearCartConfirm] = useState(false);
    const [showHeldCarts, setShowHeldCarts] = useState(false);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [heldCarts, setHeldCarts] = useState<HeldCart[]>(loadHeldCarts);
    const [lastSale, setLastSale] = useState<SaleResult | null>(() => loadLastReceipt()?.sale ?? null);
    const [receiptCart, setReceiptCart] = useState<PrintReceiptItem[]>(() => loadLastReceipt()?.items ?? []);
    const checkoutAttemptRef = useRef<POSCheckoutAttempt | null>(loadCheckoutAttempt());
    const checkoutSubmissionRef = useRef(false);
    const [customerSearch, setCustomerSearch] = useState('');
    const deferredCustomerSearch = useDeferredValue(customerSearch.trim());
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerPhone, setNewCustomerPhone] = useState('');

    // Price Check State
    const [checkedProduct, setCheckedProduct] = useState<Product | null>(null);

    const [discountCode, setDiscountCode] = useState('');
    const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const successDialogRef = useRef<HTMLDivElement>(null);
    const cartPanelRef = useRef<HTMLDivElement>(null);

    const parseMoneyInput = (value: string) => parseDecimalInput(value) || 0;

    const getLineTotal = (product: Product, quantity: number) => {
        return calculateLineTotal(product.price_ttc, quantity);
    };

    const { data: currentUser } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then((response) => response.data),
        staleTime: 60_000,
    });

    const { data: storeSettings } = useQuery({
        queryKey: ['publicSettings'],
        queryFn: () => client.get('/auth/settings/public/').then((response) => response.data),
        staleTime: 5 * 60_000,
    });
    const currencySymbol = String(storeSettings?.currency_symbol || 'DH').trim() || 'DH';
    const formatMoney = (amount: number | string) => `${Number(amount).toFixed(2)} ${currencySymbol}`;

    const {
        data: products = [],
        isFetching: productsLoading,
        isError: productsFailed,
        error: productsError,
        refetch: retryProducts,
    } = useQuery<Product[]>({
        queryKey: ['products', 'pos-search', deferredSearch],
        queryFn: () => client.get('/inventory/products/pos/', {
            params: { search: deferredSearch, active: true, page_size: 50 },
        }).then((response) => response.data.results || response.data),
        enabled: deferredSearch.length > 0,
    });

    const {
        data: customers = [],
        isFetching: customersLoading,
        isError: customersFailed,
        error: customersError,
        refetch: retryCustomers,
    } = useQuery<Customer[]>({
        queryKey: ['credit-customers', deferredCustomerSearch],
        queryFn: () => client.get('/credit/customers/', {
            params: { search: deferredCustomerSearch, page_size: 20 },
        }).then((response) => response.data.results || response.data),
        enabled: showPaymentModal && paymentMethod === 'CREDIT',
        staleTime: 10_000,
    });

    const createCustomerMutation = useMutation({
        mutationFn: (data: { name: string; phone?: string }) =>
            client.post('/credit/customers/', data).then((response) => response.data),
        onSuccess: (customer: Customer) => {
            queryClient.invalidateQueries({ queryKey: ['credit-customers'] });
            setSelectedCustomer(customer);
            setShowNewCustomerForm(false);
            setNewCustomerName('');
            setNewCustomerPhone('');
            toast.success(t('CustomerCreated'));
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('CustomerCreationFailed')));
        },
    });

    const submitNewCustomer = () => {
        const name = newCustomerName.trim();
        if (!name) {
            toast.error(t('CustomerNameRequired'));
            return;
        }
        const phone = newCustomerPhone.trim();
        createCustomerMutation.mutate({ name, ...(phone ? { phone } : {}) });
    };

    const addToCart = useCallback((product: Product) => {
        if (product.active === false || product.stock <= 0) {
            toast.error(product.active === false ? t('ProductDisabled') : t('ProductOutOfStock'));
            return;
        }
        setAppliedDiscount(null);
        setCart((current) => {
            const existing = current.find((item) => item.product.id === product.id);
            if (existing) {
                if (existing.quantity >= product.stock) {
                    toast.error(t('MaximumQuantityReached', { product: product.name }));
                    return current;
                }
                return current.map((item) => item.product.id === product.id
                    ? { ...item, quantity: item.quantity + 1 }
                    : item);
            }
            return [...current, { product, quantity: 1 }];
        });
        toast.success(t('ProductAddedToCart', { product: product.name }));
    }, [t, toast]);

    const handleProductAction = useCallback((product: Product) => {
        if (mode === 'SALE') {
            addToCart(product);
        } else {
            setCheckedProduct(product);
        }
    }, [addToCart, mode]);

    const handleBarcode = useCallback(async (barcode: string) => {
        if (showPaymentModal || showSuccessOverlay) return;
        try {
            const response = await client.get('/inventory/products/pos/', {
                params: { barcode, active: true, page_size: 2 },
            });
            const matches: Product[] = response.data.results || response.data;
            const product = matches.find((item) => item.barcode === barcode);
            if (!product) {
                toast.error(t('ProductUnavailableByBarcode', { barcode }));
                return;
            }
            handleProductAction(product);
        } catch (error) {
            toast.error(getApiErrorMessage(error, t('BarcodeSearchFailed')));
        }
    }, [handleProductAction, showPaymentModal, showSuccessOverlay, t, toast]);

    useBarcodeScanner(handleBarcode);

    // Checkout mutation
    const checkoutMutation = useMutation({
        mutationFn: (data: {
            items: Array<{ product_id: number; quantity: number }>;
            payment_method: PaymentMethod;
            amount_received?: number;
            discount_code?: string;
            customer_id?: number;
            expected_total: number;
            idempotency_key: string;
        }) =>
            client.post('/sales/sales/', data),
        onError: async (error: unknown) => {
            void queryClient.invalidateQueries({ queryKey: ['products'] });
            const message = getApiErrorMessage(error);
            if (
                message.toLowerCase().includes('prix')
                && message.toLowerCase().includes('chang')
            ) {
                const refreshed = await Promise.all(cart.map(async (item) => {
                    try {
                        const response = await client.get('/inventory/products/pos/', {
                            params: { barcode: item.product.barcode, page_size: 2 },
                        });
                        const matches: Product[] = response.data.results || response.data;
                        return matches.find(product => product.id === item.product.id) || null;
                    } catch {
                        return null;
                    }
                }));
                const refreshedById = new Map(
                    refreshed.filter((product): product is Product => Boolean(product))
                        .map(product => [product.id, product]),
                );
                setCart(current => current.map(item => ({
                    ...item,
                    product: refreshedById.get(item.product.id) || item.product,
                })));
                setAppliedDiscount(null);
                setAmountGiven('');
                toast.error(t('PriceChangedRefresh'));
                return;
            }
            toast.error(t('SaleValidationError', { message }));
        },
        onSuccess: (response) => {
            const sale = response.data as SaleResult;
            const productsById = new Map(cart.map((item) => [item.product.id, item.product]));
            setLastSale(sale);
            const receiptItems = new Map<string, PrintReceiptItem>();
            sale.items.forEach((item) => {
                const taxMultiplier = 1 + Number(item.tva_rate) / 100;
                const unitPrice = Number(item.unit_price_ht) * taxMultiplier;
                const key = `${item.product_id}:${unitPrice.toFixed(2)}`;
                const existing = receiptItems.get(key);
                if (existing) {
                    existing.quantity += Number(item.quantity);
                    existing.lineTotal = Number(existing.lineTotal || 0)
                        + Number(item.total_price_ht) * taxMultiplier;
                    return;
                }
                receiptItems.set(key, {
                    product: {
                        name: item.product_name,
                        barcode: productsById.get(Number(item.product_id))?.barcode || '',
                        price_ttc: unitPrice,
                    },
                    quantity: Number(item.quantity),
                    unitPrice,
                    lineTotal: Number(item.total_price_ht) * taxMultiplier,
                });
            });
            const printableItems = Array.from(receiptItems.values());
            setReceiptCart(printableItems);
            sessionStorage.setItem(POS_LAST_RECEIPT_STORAGE_KEY, JSON.stringify({
                sale,
                items: printableItems,
            } satisfies StoredReceipt));
            // Commit the local transition immediately after the authoritative
            // server response. If the page is reloaded before this callback,
            // the persisted attempt key is replayed; once here, the cart must
            // never remain available for a second sale.
            sessionStorage.removeItem(POS_CART_STORAGE_KEY);
            clearCheckoutAttempt();
            checkoutAttemptRef.current = null;
            setCart([]);
            // 1. Close payment modal and show success overlay first so the UI
            //    remains interactive even if printing fails or is slow.
            setShowPaymentModal(false);
            setShowSuccessOverlay(true);

            // 2. Invalidate queries (stock update)
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
            queryClient.invalidateQueries({ queryKey: ['acc-period'] });
            queryClient.invalidateQueries({ queryKey: ['acc-month'] });
            queryClient.invalidateQueries({ queryKey: ['acc-summary'] });
            queryClient.invalidateQueries({ queryKey: ['cashRegister'] });
            queryClient.invalidateQueries({ queryKey: ['credits'] });

        },
        onSettled: () => {
            checkoutSubmissionRef.current = false;
        },
    });

    const updateQuantity = (productId: number, delta: number) => {
        setAppliedDiscount(null);
        setCart((current) => current.map(item => {
            if (item.product.id === productId) {
                const newQty = Math.max(1, Math.min(item.quantity + delta, item.product.stock));
                return { ...item, quantity: newQty };
            }
            return item;
        }));
    };

    const setItemQuantity = (productId: number, value: string) => {
        const parsed = Number.parseInt(value, 10);
        setAppliedDiscount(null);
        setCart((current) => current.map(item => {
            if (item.product.id !== productId) return item;
            if (!Number.isFinite(parsed)) {
                return { ...item, quantity: 1 };
            }
            const newQty = Math.max(1, Math.min(parsed, item.product.stock));
            return { ...item, quantity: newQty };
        }));
    };

    const removeFromCart = (productId: number) => {
        setAppliedDiscount(null);
        setCart((current) => current.filter(item => item.product.id !== productId));
    };

    const subtotal = cart.reduce(
        (sum, item) => sum + getLineTotal(item.product, item.quantity),
        0,
    );
    const discountAmount = Math.min(appliedDiscount?.amount || 0, subtotal);
    const total = Math.max(0, subtotal - discountAmount);
    const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    const amountReceived = parseMoneyInput(amountGiven);
    const changeAmount = amountGiven.trim() ? amountReceived - total : -total;
    const canCheckout = paymentMethod === 'CREDIT'
        ? selectedCustomer !== null
        : paymentMethod !== 'CASH'
            || (amountGiven.trim().length > 0 && amountReceived >= total);

    const selectPaymentMethod = (value: PaymentMethod) => {
        setPaymentMethod(value);
        if (value !== 'CASH') setAmountGiven('');
    };

    const handlePaymentMethodKeyDown = (
        event: ReactKeyboardEvent<HTMLButtonElement>,
        current: PaymentMethod,
    ) => {
        const key = event.key;
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
        event.preventDefault();
        const index = PAYMENT_METHOD_VALUES.indexOf(current);
        const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
        const nextIndex = key === 'Home'
            ? 0
            : key === 'End'
                ? PAYMENT_METHOD_VALUES.length - 1
                : (index + delta + PAYMENT_METHOD_VALUES.length) % PAYMENT_METHOD_VALUES.length;
        const next = PAYMENT_METHOD_VALUES[nextIndex];
        selectPaymentMethod(next);
        requestAnimationFrame(() => document.getElementById(`payment-method-${next}`)?.focus());
    };

    const discountMutation = useMutation({
        mutationFn: (code: string) => client.post('/sales/discounts/apply/', {
            code,
            subtotal,
        }),
        onSuccess: (response) => {
            setAppliedDiscount({
                code: discountCode.trim().toUpperCase(),
                amount: Number(response.data.discount_amount),
                total: Number(response.data.new_total),
            });
            toast.success(t('DiscountApplied'));
        },
        onError: (error) => {
            setAppliedDiscount(null);
            toast.error(getApiErrorMessage(error, t('InvalidDiscountCode')));
        },
    });

    const handleCheckout = () => {
        if (checkoutSubmissionRef.current || checkoutMutation.isPending || cart.length === 0 || !canCheckout) return;
        if (paymentMethod === 'CREDIT' && !selectedCustomer) {
            toast.error(t('SelectCreditCustomer'));
            return;
        }

        const saleData = {
            items: cart.map(item => ({
                product_id: item.product.id,
                quantity: item.quantity
            })),
            payment_method: paymentMethod,
            expected_total: Number(total.toFixed(2)),
            ...(paymentMethod === 'CASH' ? { amount_received: amountReceived } : {}),
            ...(paymentMethod === 'CREDIT' && selectedCustomer
                ? { customer_id: selectedCustomer.id }
                : {}),
            ...(appliedDiscount ? { discount_code: appliedDiscount.code } : {}),
        };
        const fingerprint = JSON.stringify(saleData);
        checkoutAttemptRef.current = getOrCreateCheckoutAttempt(
            fingerprint,
            checkoutAttemptRef.current,
        );
        persistCheckoutAttempt(checkoutAttemptRef.current);

        // React state is intentionally not the only guard here: two click or
        // Enter events can arrive before the pending render disables the button.
        checkoutSubmissionRef.current = true;
        checkoutMutation.mutate({
            ...saleData,
            idempotency_key: checkoutAttemptRef.current.key,
        });
    };

    const resetSale = useCallback(() => {
        setCart([]);
        setAmountGiven('');
        setSearchTerm('');
        setDiscountCode('');
        setAppliedDiscount(null);
        setPaymentMethod('CASH');
        setCustomerSearch('');
        setSelectedCustomer(null);
        setShowNewCustomerForm(false);
        setNewCustomerName('');
        setNewCustomerPhone('');
        checkoutAttemptRef.current = null;
        clearCheckoutAttempt();
        sessionStorage.removeItem(POS_CART_STORAGE_KEY);
        searchInputRef.current?.focus();
    }, []);

    const closeSuccessOverlay = useCallback(() => {
        resetSale();
        setShowSuccessOverlay(false);
    }, [resetSale]);

    const printLastReceipt = useCallback(() => {
        if (!lastSale) return;
        const receiptSubtotal = Number(lastSale.total_ttc) + Number(lastSale.discount_amount);
        printReceipt({
            saleId: lastSale.id,
            items: receiptCart,
            subtotal: receiptSubtotal,
            discount: lastSale.discount_amount > 0
                ? {
                    name: lastSale.discount_code || appliedDiscount?.code || t('ManualDiscount'),
                    amount: Number(lastSale.discount_amount),
                }
                : undefined,
            total: Number(lastSale.total_ttc),
            paymentMethod: lastSale.payment_method,
            amountGiven: Number(lastSale.amount_received),
            change: Number(lastSale.change_amount),
            cashierName: currentUser?.username,
        }, {
            storeName: storeSettings?.store_name || 'Librairie',
            address: storeSettings?.store_address,
            phone: storeSettings?.store_phone,
            email: storeSettings?.store_email,
            logoUrl: storeSettings?.logo_url,
            header: storeSettings?.print_header,
            footer: storeSettings?.print_footer,
            currencySymbol,
        });
    }, [
        appliedDiscount?.code,
        currentUser?.username,
        lastSale,
        receiptCart,
        storeSettings,
        t,
        currencySymbol,
    ]);

    const holdCurrentCart = useCallback(() => {
        if (cart.length === 0) {
            toast.error(t('CannotHoldEmptyCart'));
            return;
        }
        if (heldCarts.length >= 5) {
            toast.error(t('HeldCartLimitReached'));
            return;
        }
        const now = new Date();
        const next = [{
            id: crypto.randomUUID(),
            label: t('HeldCartDefaultLabel', {
                time: now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
            }),
            createdAt: now.toISOString(),
            items: cart,
        }, ...heldCarts];
        setHeldCarts(next);
        persistHeldCarts(next);
        resetSale();
        toast.success(t('CartHeld'));
    }, [cart, heldCarts, resetSale, t, toast]);

    const resumeHeldCart = useCallback(async (draft: HeldCart) => {
        if (cart.length > 0) {
            toast.error(t('HoldCurrentCartFirst'));
            return;
        }
        const refreshed = await Promise.all(draft.items.map(async (item) => {
            try {
                const response = await client.get('/inventory/products/pos/', {
                    params: { barcode: item.product.barcode, active: true, page_size: 2 },
                });
                const matches: Product[] = response.data.results || response.data;
                const product = matches.find(candidate => candidate.id === item.product.id);
                if (!product || product.stock <= 0) return null;
                return {
                    product,
                    quantity: Math.max(1, Math.min(item.quantity, product.stock)),
                } satisfies CartItem;
            } catch {
                return null;
            }
        }));
        const availableItems = refreshed.filter((item): item is CartItem => Boolean(item));
        if (availableItems.length === 0) {
            toast.error(t('HeldCartProductsUnavailable'));
            return;
        }
        const next = heldCarts.filter(item => item.id !== draft.id);
        setHeldCarts(next);
        persistHeldCarts(next);
        setCart(availableItems);
        setShowHeldCarts(false);
        setAppliedDiscount(null);
        if (availableItems.length !== draft.items.length) {
            toast.error(t('SomeHeldProductsUnavailable'));
        } else {
            toast.success(t('HeldCartResumed'));
        }
        searchInputRef.current?.focus();
    }, [cart.length, heldCarts, t, toast]);

    const deleteHeldCart = useCallback((draftId: string) => {
        const next = heldCarts.filter(item => item.id !== draftId);
        setHeldCarts(next);
        persistHeldCarts(next);
        toast.success(t('HeldCartDeleted'));
    }, [heldCarts, t, toast]);

    useEffect(() => {
        const handleShortcuts = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            const isTyping = target?.matches('input, textarea, select, [contenteditable="true"]');
            if (event.key === 'F2' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
                event.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
                return;
            }
            if (showPaymentModal || showSuccessOverlay || checkedProduct) return;
            if (event.key === 'F4' && cart.length > 0) {
                event.preventDefault();
                setShowPaymentModal(true);
            } else if (event.key === 'F8' && cart.length > 0) {
                event.preventDefault();
                holdCurrentCart();
            } else if (event.key === 'F9') {
                event.preventDefault();
                setShowHeldCarts(true);
            } else if (event.key === 'F10' && lastSale) {
                event.preventDefault();
                printLastReceipt();
            } else if (!isTyping && event.key === '?') {
                event.preventDefault();
                setShowShortcuts(true);
            }
        };
        window.addEventListener('keydown', handleShortcuts);
        return () => window.removeEventListener('keydown', handleShortcuts);
    }, [
        cart.length,
        checkedProduct,
        holdCurrentCart,
        lastSale,
        printLastReceipt,
        showPaymentModal,
        showSuccessOverlay,
    ]);

    // Focus search on mount
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    useEffect(() => {
        if (cart.length === 0) {
            sessionStorage.removeItem(POS_CART_STORAGE_KEY);
            clearCheckoutAttempt();
            checkoutAttemptRef.current = null;
            return;
        }
        sessionStorage.setItem(POS_CART_STORAGE_KEY, JSON.stringify(cart));
    }, [cart]);

    useEffect(() => {
        if (showSuccessOverlay) successDialogRef.current?.focus();
    }, [showSuccessOverlay]);

    useEffect(() => {
        if (!showPaymentModal && !checkedProduct && !showSuccessOverlay && !showHeldCarts && !showShortcuts) return;

        const closeActiveDialog = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (checkoutMutation.isPending || showSuccessOverlay) return;
            setShowPaymentModal(false);
            setCheckedProduct(null);
            setShowHeldCarts(false);
            setShowShortcuts(false);
            searchInputRef.current?.focus();
        };

        window.addEventListener('keydown', closeActiveDialog);
        return () => window.removeEventListener('keydown', closeActiveDialog);
    }, [checkedProduct, checkoutMutation.isPending, showHeldCarts, showPaymentModal, showShortcuts, showSuccessOverlay]);

    return (
        <div className="pos-shell flex gap-6 h-[calc(100vh-120px)] animate-fadeIn relative">

            {/* Success Overlay (Auto-dismiss) */}
            {showSuccessOverlay && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md animate-fadeIn">
                    <div
                        ref={successDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="sale-success-title"
                        tabIndex={-1}
                        className="text-center w-full max-w-xl mx-4 px-8 py-10 bg-secondary rounded-2xl shadow-2xl animate-bounce-short"
                    >
                        <div className="w-24 h-24 bg-success rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-success/30">
                            <Check size={64} className="text-white" strokeWidth={4} />
                        </div>
                        <h2 id="sale-success-title" className="text-4xl font-bold text-success mb-2 whitespace-normal">{t('SaleCompleted')}</h2>
                        {lastSale && (
                            <div className="my-6 grid grid-cols-2 gap-3 text-left rounded-xl bg-tertiary p-4">
                                <span className="text-muted">{t('Ticket')}</span><strong>#{lastSale.id}</strong>
                                <span className="text-muted">{t('Total')}</span><strong>{formatMoney(lastSale.total_ttc)}</strong>
                                <span className="text-muted">{t('AmountGiven')}</span><strong>{formatMoney(lastSale.amount_received)}</strong>
                                <span className="text-muted">{t('Change')}</span><strong>{formatMoney(lastSale.change_amount)}</strong>
                            </div>
                        )}
                        <div className="flex flex-wrap justify-center gap-3">
                            <button onClick={printLastReceipt} className="btn-secondary px-6 py-3 font-bold">
                                <Printer size={18} /> {t('PrintReceipt')}
                            </button>
                            <button onClick={closeSuccessOverlay} className="btn-primary px-6 py-3 font-bold">
                                {t('NewSale')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showHeldCarts && (
                <div className="absolute inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" role="presentation">
                    <div className="card w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" role="dialog" aria-modal="true" aria-labelledby="held-carts-title">
                        <div className="flex items-center justify-between gap-4 mb-5">
                            <div>
                                <h2 id="held-carts-title" className="text-2xl font-bold">{t('HeldCarts')}</h2>
                                <p className="text-sm text-muted mt-1">{t('HeldCartsHint')}</p>
                            </div>
                            <button type="button" className="btn-ghost btn-icon" onClick={() => setShowHeldCarts(false)} aria-label={t('Close')}>
                                <X size={22} />
                            </button>
                        </div>
                        {heldCarts.length === 0 ? (
                            <div className="empty-state py-10">
                                <History size={42} aria-hidden="true" />
                                <p>{t('NoHeldCarts')}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {heldCarts.map(draft => {
                                    const draftCount = draft.items.reduce((sum, item) => sum + item.quantity, 0);
                                    const draftTotal = draft.items.reduce((sum, item) => sum + getLineTotal(item.product, item.quantity), 0);
                                    return (
                                        <div key={draft.id} className="rounded-xl border border-border bg-tertiary/30 p-4 flex flex-wrap items-center gap-4">
                                            <div className="flex-1 min-w-[220px]">
                                                <h3 className="font-bold">{draft.label}</h3>
                                                <p className="text-sm text-muted">
                                                    {t('HeldCartSummary', { count: draftCount, total: draftTotal.toFixed(2) })}
                                                </p>
                                                <p className="text-xs text-muted mt-1">{new Date(draft.createdAt).toLocaleString()}</p>
                                            </div>
                                            <button
                                                type="button"
                                                className="btn-primary btn-sm"
                                                disabled={cart.length > 0}
                                                title={cart.length > 0 ? t('HoldCurrentCartFirst') : undefined}
                                                onClick={() => void resumeHeldCart(draft)}
                                            >
                                                <CirclePlay size={17} /> {t('ResumeCart')}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn-ghost btn-icon text-danger"
                                                onClick={() => deleteHeldCart(draft.id)}
                                                aria-label={t('DeleteHeldCartLabel', { name: draft.label })}
                                            >
                                                <Trash2 size={17} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showShortcuts && (
                <div className="absolute inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" role="presentation">
                    <div className="card w-full max-w-lg p-6" role="dialog" aria-modal="true" aria-labelledby="pos-shortcuts-title">
                        <div className="flex items-center justify-between gap-4 mb-5">
                            <h2 id="pos-shortcuts-title" className="text-2xl font-bold flex items-center gap-2">
                                <Keyboard className="text-accent" /> {t('KeyboardShortcuts')}
                            </h2>
                            <button type="button" className="btn-ghost btn-icon" onClick={() => setShowShortcuts(false)} aria-label={t('Close')}>
                                <X size={22} />
                            </button>
                        </div>
                        <dl className="space-y-3">
                            {[
                                ['F2 / Ctrl+K', t('ShortcutFocusSearch')],
                                ['F4', t('ShortcutCheckout')],
                                ['F8', t('ShortcutHoldCart')],
                                ['F9', t('ShortcutHeldCarts')],
                                ['F10', t('ShortcutReprint')],
                                ['Esc', t('ShortcutCloseDialog')],
                                ['?', t('ShortcutShowHelp')],
                            ].map(([shortcut, description]) => (
                                <div key={shortcut} className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0">
                                    <dt><kbd className="rounded bg-tertiary px-2 py-1 font-mono text-sm font-bold">{shortcut}</kbd></dt>
                                    <dd className="text-sm text-muted text-right">{description}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                </div>
            )}

            {/* Price Check Overlay */}
            {checkedProduct && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={() => setCheckedProduct(null)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="price-check-title"
                        className="card pos-price-check-modal w-full max-w-lg p-8 shadow-2xl scale-100"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-start mb-6">
                            <h2 id="price-check-title" className="text-2xl font-bold flex items-center gap-2">
                                <ScanLine className="text-accent" />
                                {t('PriceCheck')}
                            </h2>
                            <button onClick={() => setCheckedProduct(null)} className="btn-ghost p-2" aria-label={t('Close')}>
                                <X size={24} />
                            </button>
                        </div>

                        <div className="pos-price-check-content flex gap-6">
                            <div className="w-1/3 aspect-square bg-tertiary rounded-xl flex items-center justify-center">
                                {checkedProduct.image_url ? (
                                    <img src={checkedProduct.image_url} alt={checkedProduct.name} className="w-full h-full object-cover rounded-xl" />
                                ) : (
                                    <Package size={64} className="text-muted" />
                                )}
                            </div>
                            <div className="flex-1 space-y-4">
                                <div>
                                    <h3 className="text-xl font-bold mb-1">{checkedProduct.name}</h3>
                                    <p className="font-mono text-muted">{checkedProduct.barcode}</p>
                                </div>
                                <div className="p-4 bg-accent-light rounded-xl border border-accent/20">
                                    <p className="text-sm text-accent font-medium mb-1">{t('SalePrice')}</p>
                                    <p className="text-4xl font-bold text-accent">{formatMoney(checkedProduct.price_ttc)}</p>
                                </div>
                                <div>
                                    <span className={`badge ${checkedProduct.stock > 0 ? 'badge-success' : 'badge-danger'} text-lg py-1 px-3`}>
                                        {checkedProduct.stock} {t('InStock').toLocaleLowerCase()}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Payment Modal */}
            {showPaymentModal && (
                <div
                    className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget && !checkoutMutation.isPending) {
                            setShowPaymentModal(false);
                        }
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="payment-dialog-title"
                        className="card pos-payment-modal w-full max-w-md p-0 shadow-2xl"
                    >
                        <div className="card-header bg-accent text-white flex justify-between items-center">
                            <h3 id="payment-dialog-title" className="text-xl font-bold flex items-center gap-2">
                                {paymentMethod === 'CREDIT' ? <User /> : paymentMethod === 'CARD' ? <CreditCard /> : <Banknote />}
                                {paymentMethod === 'CREDIT' ? t('CreditSale') : t('Checkout')}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowPaymentModal(false)}
                                disabled={checkoutMutation.isPending}
                                className="text-white hover:bg-secondary/20 p-1 rounded"
                                aria-label={t('Close')}
                            >
                                <X size={24} />
                            </button>
                        </div>
                        <div className="p-6 space-y-6">
                            <div className="text-center space-y-2">
                                <p className="text-muted uppercase text-sm font-semibold">{t('FinalTotal')}</p>
                                <p className="text-4xl font-bold text-accent">{formatMoney(total)}</p>
                            </div>

                            <fieldset className="space-y-2">
                                <legend className="block text-sm font-medium">{t('PaymentMethod')}</legend>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label={t('PaymentMethod')}>
                                    {([
                                        ['CASH', t('Cash'), Banknote],
                                        ['CARD', t('Card'), CreditCard],
                                        ['CREDIT', t('Credit'), User],
                                        ['OTHER', t('Other'), TicketPercent],
                                    ] as const).map(([value, label, Icon]) => (
                                        <button
                                            key={value}
                                            id={`payment-method-${value}`}
                                            type="button"
                                            role="radio"
                                            aria-checked={paymentMethod === value}
                                            tabIndex={paymentMethod === value ? 0 : -1}
                                            onClick={() => selectPaymentMethod(value)}
                                            onKeyDown={(event) => handlePaymentMethodKeyDown(event, value)}
                                            className={`rounded-xl border px-2 py-3 text-sm font-semibold flex flex-col items-center gap-1 transition-colors ${paymentMethod === value
                                                ? 'border-accent bg-accent-light text-accent'
                                                : 'border-border bg-secondary hover:border-accent/50'
                                                }`}
                                        >
                                            <Icon size={20} aria-hidden="true" />
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>

                            {paymentMethod === 'CREDIT' && (
                                <div className="space-y-3 rounded-xl border border-border bg-tertiary/30 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <label htmlFor="credit-customer-search" className="font-semibold">
                                            {t('CreditCustomer')}
                                        </label>
                                        <button
                                            type="button"
                                            className="btn-ghost text-sm"
                                            onClick={() => setShowNewCustomerForm((shown) => !shown)}
                                        >
                                            <UserPlus size={16} /> {t('New')}
                                        </button>
                                    </div>

                                    {showNewCustomerForm ? (
                                        <form
                                            className="space-y-2"
                                            onSubmit={(event) => {
                                                event.preventDefault();
                                                submitNewCustomer();
                                            }}
                                        >
                                            <input
                                                type="text"
                                                name="customer_name"
                                                className="input w-full"
                                                placeholder={t('CustomerNamePlaceholder')}
                                                aria-label={t('CustomerNamePlaceholder')}
                                                value={newCustomerName}
                                                onChange={(event) => setNewCustomerName(event.target.value)}
                                                autoFocus
                                            />
                                            <input
                                                type="tel"
                                                name="customer_phone"
                                                className="input w-full"
                                                placeholder={t('OptionalPhonePlaceholder')}
                                                aria-label={t('OptionalPhonePlaceholder')}
                                                value={newCustomerPhone}
                                                onChange={(event) => setNewCustomerPhone(event.target.value)}
                                            />
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    type="button"
                                                    className="btn-ghost"
                                                    onClick={() => setShowNewCustomerForm(false)}
                                                    disabled={createCustomerMutation.isPending}
                                                >
                                                    {t('Cancel')}
                                                </button>
                                                <button
                                                    type="submit"
                                                    className="btn-secondary"
                                                    disabled={createCustomerMutation.isPending || !newCustomerName.trim()}
                                                >
                                                    {createCustomerMutation.isPending ? t('Creating') : t('CreateAndSelect')}
                                                </button>
                                            </div>
                                        </form>
                                    ) : selectedCustomer ? (
                                        <div className="flex items-center justify-between gap-3 rounded-lg border border-success/40 bg-success-light p-3">
                                            <div className="min-w-0">
                                                <p className="font-bold truncate">{selectedCustomer.name}</p>
                                                {selectedCustomer.phone && <p className="text-xs text-muted truncate">{selectedCustomer.phone}</p>}
                                            </div>
                                            <button
                                                type="button"
                                                className="btn-ghost text-sm"
                                                onClick={() => setSelectedCustomer(null)}
                                            >
                                                {t('ChangeCustomer')}
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <input
                                                id="credit-customer-search"
                                                type="search"
                                                className="input w-full"
                                                placeholder={t('SearchCustomerPlaceholder')}
                                                value={customerSearch}
                                                onChange={(event) => setCustomerSearch(event.target.value)}
                                                autoFocus
                                            />
                                            <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-secondary">
                                                {customersLoading ? (
                                                    <p className="p-3 text-sm text-muted">{t('Searching')}</p>
                                                ) : customersFailed ? (
                                                    <div className="p-3 text-sm" role="alert">
                                                        <p className="text-danger">
                                                            {getApiErrorMessage(customersError, t('CheckConnectionRetry'))}
                                                        </p>
                                                        <button
                                                            type="button"
                                                            className="btn-ghost mt-2"
                                                            onClick={() => void retryCustomers()}
                                                        >
                                                            {t('Retry')}
                                                        </button>
                                                    </div>
                                                ) : customers.length === 0 ? (
                                                    <p className="p-3 text-sm text-muted">{t('NoCustomerFound')}</p>
                                                ) : customers.map((customer) => (
                                                    <button
                                                        key={customer.id}
                                                        type="button"
                                                        className="flex w-full items-center justify-between gap-3 border-b border-border p-3 text-left last:border-b-0 hover:bg-tertiary"
                                                        onClick={() => setSelectedCustomer(customer)}
                                                    >
                                                        <span className="font-medium truncate">{customer.name}</span>
                                                        {customer.phone && <span className="text-xs text-muted truncate">{customer.phone}</span>}
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                    <p className="text-xs text-muted">
                                        {t('CreditPaymentNotice')}
                                    </p>
                                </div>
                            )}

                            {paymentMethod === 'CASH' ? (
                                <>
                                    <div className="space-y-2">
                                        <label htmlFor="amount-received" className="block text-sm font-medium">{t('AmountGiven')}</label>
                                        <div className="flex rounded-xl border-2 border-border bg-secondary focus-within:border-accent">
                                            <input
                                                id="amount-received"
                                                name="amount_received"
                                                type="text"
                                                inputMode="decimal"
                                                autoComplete="off"
                                                autoFocus
                                                aria-invalid={amountGiven.trim().length > 0 && changeAmount < 0}
                                                className="money-input text-2xl font-bold py-3 pl-4 pr-3 w-full"
                                                placeholder="0.00"
                                                value={amountGiven}
                                                onChange={e => setAmountGiven(normalizeDecimalInput(e.target.value))}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && canCheckout) handleCheckout();
                                                }}
                                            />
                                            <span className="px-4 flex items-center text-muted font-bold border-l border-border">{currencySymbol}</span>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn-ghost text-sm"
                                            onClick={() => setAmountGiven(total.toFixed(2))}
                                        >
                                            {t('ExactAmount')}
                                        </button>
                                    </div>

                                    <div
                                        role="status"
                                        className={`p-4 rounded-xl flex justify-between items-center transition-colors ${changeAmount >= 0 ? 'bg-success-light text-success-dark' : 'bg-danger-light text-danger'
                                            }`}
                                    >
                                        <span className="font-semibold text-lg">{t('Change')}</span>
                                        <span className="text-3xl font-bold">{formatMoney(Math.max(0, changeAmount))}</span>
                                    </div>
                                </>
                            ) : paymentMethod !== 'CREDIT' ? (
                                <p className="rounded-xl bg-tertiary p-4 text-sm text-muted" role="status">
                                    {t('ExactPaymentNotice', { amount: total.toFixed(2) })}
                                </p>
                            ) : null}

                            <button
                                type="button"
                                onClick={handleCheckout}
                                disabled={checkoutMutation.isPending || !canCheckout}
                                aria-busy={checkoutMutation.isPending}
                                className="btn-primary w-full py-4 text-xl font-bold shadow-lg shadow-accent/20"
                            >
                                {checkoutMutation.isPending ? t('Validating') : t('ValidateSale')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Products Section */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Top Controls */}
                <div className="pos-controls flex items-center gap-4 mb-4">
                    <div className="pos-mode-tabs bg-tertiary p-1 rounded-lg flex gap-1">
                        <button
                            type="button"
                            onClick={() => setMode('SALE')}
                            aria-pressed={mode === 'SALE'}
                            className={`px-4 py-2 rounded-md font-medium text-sm transition-all flex items-center gap-2 ${mode === 'SALE' ? 'bg-secondary shadow text-accent' : 'text-muted hover:text-primary'
                                }`}
                        >
                            <ShoppingCart size={18} />
                            {t('SaleMode')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('PRICE_CHECK')}
                            aria-pressed={mode === 'PRICE_CHECK'}
                            className={`px-4 py-2 rounded-md font-medium text-sm transition-all flex items-center gap-2 ${mode === 'PRICE_CHECK' ? 'bg-accent text-white shadow' : 'text-muted hover:text-primary'
                                }`}
                        >
                            <ScanLine size={18} />
                            {t('PriceCheck')}
                        </button>
                    </div>

                    <div className="pos-quick-actions flex items-center gap-1">
                        <button
                            type="button"
                            className="btn-ghost btn-icon relative"
                            onClick={holdCurrentCart}
                            disabled={cart.length === 0 || heldCarts.length >= 5}
                            title={t('HoldCartShortcutTitle')}
                            aria-label={t('HoldCart')}
                        >
                            <CirclePause size={20} />
                        </button>
                        <button
                            type="button"
                            className="btn-ghost btn-icon relative"
                            onClick={() => setShowHeldCarts(true)}
                            title={t('HeldCartsShortcutTitle')}
                            aria-label={t('HeldCarts')}
                        >
                            <History size={20} />
                            {heldCarts.length > 0 && (
                                <span className="absolute -right-1 -top-1 min-w-5 h-5 rounded-full bg-warning text-white text-[11px] flex items-center justify-center px-1">
                                    {heldCarts.length}
                                </span>
                            )}
                        </button>
                        <button
                            type="button"
                            className="btn-ghost btn-icon"
                            onClick={printLastReceipt}
                            disabled={!lastSale}
                            title={t('ReprintLastReceiptShortcutTitle')}
                            aria-label={t('ReprintLastReceipt')}
                        >
                            <Printer size={20} />
                        </button>
                        <button
                            type="button"
                            className="btn-ghost btn-icon"
                            onClick={() => setShowShortcuts(true)}
                            title={t('KeyboardShortcuts')}
                            aria-label={t('KeyboardShortcuts')}
                        >
                            <Keyboard size={20} />
                        </button>
                    </div>

                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
                        <input
                            ref={searchInputRef}
                            id="pos-product-search"
                            name="product_search"
                            type="text"
                            autoComplete="off"
                            aria-label={mode === 'SALE' ? t('ScanOrSearch') : t('PriceCheck')}
                            aria-busy={productsLoading}
                            placeholder={mode === 'SALE' ? t('ScanOrSearch') : t('PriceCheck')}
                            className={`input-icon-left w-full transition-shadow ${mode === 'PRICE_CHECK' ? 'border-accent focus:ring-accent' : ''}`}
                            style={{ paddingLeft: '3rem' }}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && searchTerm.trim()) {
                                    void handleBarcode(searchTerm.trim());
                                }
                            }}
                        />
                    </div>
                </div>

                {/* Products Grid or Empty State */}
                <div className="flex-1 overflow-y-auto pr-2">
                    {!searchTerm ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted/50 select-none">
                            <div className="w-32 h-32 bg-tertiary rounded-full flex items-center justify-center mb-6 animate-pulse">
                                <ScanLine size={64} />
                            </div>
                            <h2 className="text-2xl font-bold mb-2">{t('ReadyToScan')}</h2>
                            <p className="text-lg">{t('ScanOrSearch')}</p>
                        </div>
                    ) : productsLoading ? (
                        <div className="h-full flex items-center justify-center text-muted" role="status">
                            {t('Loading')}
                        </div>
                    ) : productsFailed ? (
                        <div className="h-full flex flex-col items-center justify-center gap-3 text-center" role="alert">
                            <p className="font-semibold text-danger">
                                {getApiErrorMessage(productsError, t('ProductSearchFailed'))}
                            </p>
                            <button type="button" className="btn-secondary" onClick={() => void retryProducts()}>
                                {t('Retry')}
                            </button>
                        </div>
                    ) : products.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-muted" role="status">
                            <Package size={48} aria-hidden="true" />
                            <h2 className="text-xl font-bold text-primary">{t('NoSellableProduct')}</h2>
                            <p className="max-w-md">
                                {t('NoSellableProductHint')}
                            </p>
                        </div>
                    ) : (
                        <div className="pos-products-grid grid">
                            {products.map((product) => (
                                <button
                                    key={product.id}
                                    type="button"
                                    onClick={() => handleProductAction(product)}
                                    disabled={mode === 'SALE' && (product.stock <= 0 || product.active === false)}
                                    aria-label={t(mode === 'SALE' ? 'AddProductToCartLabel' : 'CheckProductPriceLabel', {
                                        product: product.name,
                                        price: product.price_ttc.toFixed(2),
                                        stock: product.stock,
                                    })}
                                    className={`card p-0 text-left transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl hover:shadow-accent/10 relative overflow-hidden group border-2 border-transparent hover:border-accent/30 ${mode === 'SALE' && (product.stock <= 0 || product.active === false) ? 'opacity-50 cursor-not-allowed grayscale' : ''
                                        }`}
                                >
                                    {/* Mode indicator badge */}
                                    {mode === 'PRICE_CHECK' && (
                                        <div className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-all duration-200 bg-accent text-white p-2 rounded-full shadow-lg">
                                            <ScanLine size={18} />
                                        </div>
                                    )}

                                    {/* Stock indicator badge */}
                                    <div className={`absolute top-3 left-3 z-10 px-3 py-1.5 rounded-full text-xs font-bold shadow-md ${product.stock > 5 ? 'bg-success text-white' :
                                            product.stock > 0 ? 'bg-warning text-white' :
                                                'bg-danger text-white'
                                        }`}>
                                        {product.stock > 0 ? `${product.stock} ${t('InStock').toLocaleLowerCase()}` : t('OutOfStock')}
                                    </div>

                                    {/* Large Product Image */}
                                    <div className="pos-product-image w-full h-48 bg-gradient-to-br from-tertiary to-tertiary/50 flex items-center justify-center overflow-hidden relative">
                                        {product.image_url ? (
                                            <img
                                                src={product.image_url}
                                                alt={product.name}
                                                className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-110"
                                            />
                                        ) : (
                                            <div className="flex flex-col items-center justify-center text-muted/50">
                                                <Package size={64} strokeWidth={1.5} />
                                                <span className="text-xs mt-2">{t('NoImage')}</span>
                                            </div>
                                        )}
                                        {/* Gradient overlay for better text readability */}
                                        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/20 to-transparent" />
                                    </div>

                                    {/* Product Info Section */}
                                    <div className="p-4 space-y-3">
                                        {/* Product Name - Large and Bold */}
                                        <h3 className="font-bold text-lg leading-snug text-primary line-clamp-2 min-h-[3.5rem] group-hover:text-accent transition-colors">
                                            {product.name}
                                        </h3>

                                        {/* Barcode */}
                                        <p className="text-xs text-muted font-mono bg-tertiary/50 px-2 py-1 rounded inline-block">
                                            📦 {product.barcode}
                                        </p>

                                        {/* Price - Large and Prominent */}
                                        <div className="pt-2 border-t border-border">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-muted uppercase font-medium">{t('Price')}</span>
                                            </div>
                                            <div className="flex items-baseline gap-1 mt-1">
                                                <span className="font-black text-3xl text-accent leading-none">
                                                    {product.price_ttc?.toFixed(2)}
                                                </span>
                                                <span className="text-lg font-bold text-accent/70">{currencySymbol}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Hover action hint */}
                                    <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                                </button>
                            ))}

                            {products.length === 0 && (
                                <div className="col-span-full text-center py-12 text-muted">
                                    <p>{t('NoProductForSearch', { search: searchTerm })}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {itemCount > 0 && (
                <button
                    type="button"
                    className="md:hidden fixed bottom-4 end-4 z-40 btn-primary rounded-full px-5 py-3 shadow-2xl"
                    aria-controls="pos-cart-panel"
                    onClick={() => {
                        cartPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        cartPanelRef.current?.focus({ preventScroll: true });
                    }}
                >
                    <ShoppingCart size={20} aria-hidden="true" />
                    {t('Cart')} · {itemCount} · {formatMoney(total)}
                </button>
            )}

            {/* Right Panel (Cart Only - Success is Overlay now) */}
            <div
                id="pos-cart-panel"
                ref={cartPanelRef}
                tabIndex={-1}
                className="pos-cart-panel w-[28rem] card flex flex-col shadow-xl border-t-4 border-t-accent"
            >
                <div className="card-header flex items-center gap-3 bg-tertiary/30">
                    <ShoppingCart size={26} className="text-accent" />
                    <h2 className="font-semibold text-xl">{t('Cart')}</h2>
                    {itemCount > 0 && (
                        <span className="badge badge-accent ml-auto">
                            {t('ItemsCount', { count: itemCount })}
                        </span>
                    )}
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-5">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted opacity-60">
                            <ShoppingCart size={64} className="mb-4 text-tertiary-dark" />
                            <p className="font-medium">{t('EmptyCart')}</p>
                            <p className="text-sm mt-1">{t('ScanOrSearch')}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {cart.map((item) => (
                                <div key={item.product.id} className="bg-tertiary/50 rounded-xl p-4 border border-transparent hover:border-accent/20 transition-colors">
                                    <div className="flex items-start gap-3 mb-3">
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-bold text-base leading-tight line-clamp-2">
                                                {item.product.name}
                                            </h3>
                                            <div className="text-sm text-muted flex items-center gap-2 mt-1.5">
                                                <span className="bg-secondary px-1.5 rounded">{item.product.barcode}</span>
                                                <span>{formatMoney(item.product.price_ttc)}/{t('UnitSuffix')}</span>
                                            </div>
                                        </div>
                                        <span className="font-bold text-xl text-primary whitespace-nowrap">
                                            {getLineTotal(item.product, item.quantity).toFixed(2)}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <button
                                            type="button"
                                            onClick={() => removeFromCart(item.product.id)}
                                            className="p-1.5 text-danger hover:bg-danger-light rounded-lg transition-colors"
                                            aria-label={t('RemoveFromCartLabel', { product: item.product.name })}
                                        >
                                            <Trash2 size={16} />
                                        </button>

                                        <div className="flex items-center gap-1 bg-secondary rounded-xl shadow-sm border border-border p-1">
                                            <button
                                                type="button"
                                                onClick={() => updateQuantity(item.product.id, -1)}
                                                className="w-8 h-8 flex items-center justify-center hover:bg-tertiary rounded-md transition-colors"
                                                aria-label={t('DecreaseQuantityLabel', { product: item.product.name })}
                                            >
                                                <Minus size={16} />
                                            </button>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                aria-label={t('ProductQuantityLabel', { product: item.product.name })}
                                                className="w-14 h-8 text-center font-bold text-xl bg-transparent rounded-md focus:bg-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30"
                                                value={String(item.quantity)}
                                                onChange={(e) => setItemQuantity(item.product.id, e.target.value)}
                                                onFocus={(e) => e.target.select()}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => updateQuantity(item.product.id, 1)}
                                                className="w-8 h-8 flex items-center justify-center hover:bg-tertiary rounded-md transition-colors"
                                                disabled={item.quantity >= item.product.stock}
                                                aria-label={t('IncreaseQuantityLabel', { product: item.product.name })}
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Cart Footer */}
                <div className="border-t p-6 bg-tertiary/10 space-y-4">
                    {cart.length > 0 && (
                        <div className="rounded-xl border border-accent/20 bg-accent-light/40 p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center shrink-0">
                                        <TicketPercent size={18} aria-hidden="true" />
                                    </span>
                                    <div className="min-w-0">
                                        <label htmlFor="discount-code" className="font-semibold leading-tight">{t('DiscountCode')}</label>
                                        <p className="text-xs text-muted">{t('ServerValidated')}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <div className="flex min-w-0 flex-1 rounded-xl border border-border bg-secondary focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                                    <input
                                        id="discount-code"
                                        name="discount_code"
                                        type="text"
                                        autoComplete="off"
                                        className="w-full min-w-0 bg-transparent px-3 py-2 font-bold uppercase outline-none"
                                        placeholder={t('DiscountCodePlaceholder')}
                                        value={discountCode}
                                        onChange={(e) => {
                                            setDiscountCode(e.target.value.toUpperCase());
                                            setAppliedDiscount(null);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' && discountCode.trim() && !discountMutation.isPending) {
                                                discountMutation.mutate(discountCode.trim().toUpperCase());
                                            }
                                        }}
                                    />
                                </div>
                                {appliedDiscount ? (
                                    <button
                                        type="button"
                                        className="btn-ghost text-danger"
                                        onClick={() => {
                                            setDiscountCode('');
                                            setAppliedDiscount(null);
                                        }}
                                    >
                                        {t('RemoveDiscount')}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        disabled={!discountCode.trim() || discountMutation.isPending}
                                        aria-busy={discountMutation.isPending}
                                        onClick={() => discountMutation.mutate(discountCode.trim().toUpperCase())}
                                    >
                                        {discountMutation.isPending ? t('Checking') : t('Apply')}
                                    </button>
                                )}
                            </div>
                            {appliedDiscount && (
                                <p className="text-xs font-medium text-success" role="status">
                                    {t('AppliedDiscountStatus', { code: appliedDiscount.code, amount: discountAmount.toFixed(2) })}
                                </p>
                            )}
                        </div>
                    )}

                    {discountAmount > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-baseline justify-between text-muted">
                                <span className="text-sm">{t('Subtotal')}</span>
                                <span className="text-lg">{formatMoney(subtotal)}</span>
                            </div>
                            <div className="flex items-baseline justify-between text-success">
                                <span className="text-sm font-medium">{t('Reduction')}</span>
                                <span className="text-lg font-bold">-{formatMoney(discountAmount)}</span>
                            </div>
                        </div>
                    )}

                    <div className="flex items-baseline justify-between">
                        <span className="text-muted font-medium uppercase text-sm">{t('FinalTotal')}</span>
                        <span className="text-3xl font-bold text-primary">{total.toFixed(2)} <span className="text-lg text-muted">{currencySymbol}</span></span>
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowPaymentModal(true)}
                        disabled={cart.length === 0}
                        className="btn-primary w-full py-4 text-xl font-bold shadow-xl shadow-accent/20 flex items-center justify-center gap-3 transform active:scale-[0.98] transition-all disabled:opacity-50 disabled:shadow-none"
                    >
                        <Banknote size={24} />
                        <span>{t('Checkout')}</span>
                    </button>

                    {cart.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowClearCartConfirm(true)}
                            className="w-full text-muted hover:text-danger text-sm flex items-center justify-center gap-2 py-2"
                        >
                            <Trash2 size={14} />
                            <span>{t('CancelSale')}</span>
                        </button>
                    )}
                </div>
            </div>

            <ConfirmDialog
                open={showClearCartConfirm}
                title={t('CancelCurrentSaleTitle')}
                description={t('CancelCurrentSaleDescription')}
                confirmLabel={t('ClearCart')}
                onCancel={() => setShowClearCartConfirm(false)}
                onConfirm={() => {
                    resetSale();
                    setShowClearCartConfirm(false);
                }}
            />
        </div>
    );
}
