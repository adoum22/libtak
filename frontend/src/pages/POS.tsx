import { useState, useRef, useEffect, useCallback, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { useToast } from '../components/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';
import { printReceipt, type PrintReceiptItem } from '../utils/printService';
import { calculateLineTotal } from '../utils/pricing';
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

const loadCartDraft = (): CartItem[] => {
    try {
        const value = JSON.parse(sessionStorage.getItem('libtak.posCart') || '[]');
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
};

export default function POS() {
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
    const [lastSale, setLastSale] = useState<SaleResult | null>(null);
    const [receiptCart, setReceiptCart] = useState<PrintReceiptItem[]>([]);
    const checkoutAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
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

    const { data: customers = [], isFetching: customersLoading } = useQuery<Customer[]>({
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
            toast.success('Client créé et sélectionné.');
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, 'Création du client impossible.'));
        },
    });

    const submitNewCustomer = () => {
        const name = newCustomerName.trim();
        if (!name) {
            toast.error('Le nom du client est requis.');
            return;
        }
        const phone = newCustomerPhone.trim();
        createCustomerMutation.mutate({ name, ...(phone ? { phone } : {}) });
    };

    const addToCart = useCallback((product: Product) => {
        if (product.active === false || product.stock <= 0) {
            toast.error(product.active === false ? 'Produit désactivé.' : 'Produit en rupture de stock.');
            return;
        }
        setAppliedDiscount(null);
        setCart((current) => {
            const existing = current.find((item) => item.product.id === product.id);
            if (existing) {
                if (existing.quantity >= product.stock) {
                    toast.error(`Quantité maximale atteinte pour ${product.name}.`);
                    return current;
                }
                return current.map((item) => item.product.id === product.id
                    ? { ...item, quantity: item.quantity + 1 }
                    : item);
            }
            return [...current, { product, quantity: 1 }];
        });
        toast.success(`${product.name} ajouté au panier.`);
    }, [toast]);

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
                toast.error(`Produit introuvable ou prix de vente non configuré : ${barcode}`);
                return;
            }
            handleProductAction(product);
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Recherche du code-barres impossible.'));
        }
    }, [handleProductAction, showPaymentModal, showSuccessOverlay, toast]);

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
                toast.error('Le prix a changé. Le panier a été actualisé : vérifiez puis confirmez à nouveau.');
                return;
            }
            toast.error("Erreur lors de la validation : " + message);
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
            setReceiptCart(Array.from(receiptItems.values()));
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

        }
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
            toast.success('Code de remise appliqué.');
        },
        onError: (error) => {
            setAppliedDiscount(null);
            toast.error(getApiErrorMessage(error, 'Code de remise invalide.'));
        },
    });

    const handleCheckout = () => {
        if (cart.length === 0 || !canCheckout) return;
        if (paymentMethod === 'CREDIT' && !selectedCustomer) {
            toast.error('Sélectionnez un client pour la vente à crédit.');
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
        if (checkoutAttemptRef.current?.fingerprint !== fingerprint) {
            checkoutAttemptRef.current = { fingerprint, key: crypto.randomUUID() };
        }

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
        sessionStorage.removeItem('libtak.posCart');
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
                    name: lastSale.discount_code || appliedDiscount?.code || 'Remise manuelle',
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
        });
    }, [
        appliedDiscount?.code,
        currentUser?.username,
        lastSale,
        receiptCart,
        storeSettings,
    ]);

    // Focus search on mount
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    useEffect(() => {
        sessionStorage.setItem('libtak.posCart', JSON.stringify(cart));
    }, [cart]);

    useEffect(() => {
        if (!showPaymentModal && !checkedProduct && !showSuccessOverlay) return;

        const closeActiveDialog = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (checkoutMutation.isPending || showSuccessOverlay) return;
            setShowPaymentModal(false);
            setCheckedProduct(null);
            searchInputRef.current?.focus();
        };

        window.addEventListener('keydown', closeActiveDialog);
        return () => window.removeEventListener('keydown', closeActiveDialog);
    }, [checkedProduct, checkoutMutation.isPending, showPaymentModal, showSuccessOverlay]);

    return (
        <div className="pos-shell flex gap-6 h-[calc(100vh-120px)] animate-fadeIn relative">

            {/* Success Overlay (Auto-dismiss) */}
            {showSuccessOverlay && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md animate-fadeIn">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="sale-success-title"
                        className="text-center w-full max-w-xl mx-4 px-8 py-10 bg-secondary rounded-2xl shadow-2xl animate-bounce-short"
                    >
                        <div className="w-24 h-24 bg-success rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-success/30">
                            <Check size={64} className="text-white" strokeWidth={4} />
                        </div>
                        <h2 id="sale-success-title" className="text-4xl font-bold text-success mb-2 whitespace-normal">Vente validée</h2>
                        {lastSale && (
                            <div className="my-6 grid grid-cols-2 gap-3 text-left rounded-xl bg-tertiary p-4">
                                <span className="text-muted">Ticket</span><strong>#{lastSale.id}</strong>
                                <span className="text-muted">Total</span><strong>{Number(lastSale.total_ttc).toFixed(2)} DH</strong>
                                <span className="text-muted">Reçu</span><strong>{Number(lastSale.amount_received).toFixed(2)} DH</strong>
                                <span className="text-muted">Monnaie</span><strong>{Number(lastSale.change_amount).toFixed(2)} DH</strong>
                            </div>
                        )}
                        <div className="flex flex-wrap justify-center gap-3">
                            <button onClick={printLastReceipt} className="btn-secondary px-6 py-3 font-bold">
                                <Printer size={18} /> Imprimer le ticket
                            </button>
                            <button onClick={closeSuccessOverlay} className="btn-primary px-6 py-3 font-bold">
                                Nouvelle vente
                            </button>
                        </div>
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
                                Vérification Prix
                            </h2>
                            <button onClick={() => setCheckedProduct(null)} className="btn-ghost p-2" aria-label="Fermer la vérification du prix">
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
                                    <p className="text-sm text-accent font-medium mb-1">Prix de vente</p>
                                    <p className="text-4xl font-bold text-accent">{checkedProduct.price_ttc.toFixed(2)} DH</p>
                                </div>
                                <div>
                                    <span className={`badge ${checkedProduct.stock > 0 ? 'badge-success' : 'badge-danger'} text-lg py-1 px-3`}>
                                        {checkedProduct.stock} en stock
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
                                {paymentMethod === 'CREDIT' ? 'Vente à crédit' : 'Encaissement'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowPaymentModal(false)}
                                disabled={checkoutMutation.isPending}
                                className="text-white hover:bg-secondary/20 p-1 rounded"
                                aria-label="Fermer la fenêtre de paiement"
                            >
                                <X size={24} />
                            </button>
                        </div>
                        <div className="p-6 space-y-6">
                            <div className="text-center space-y-2">
                                <p className="text-muted uppercase text-sm font-semibold">Total à payer</p>
                                <p className="text-4xl font-bold text-accent">{total.toFixed(2)} DH</p>
                            </div>

                            <fieldset className="space-y-2">
                                <legend className="block text-sm font-medium">Mode de paiement</legend>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Mode de paiement">
                                    {([
                                        ['CASH', 'Espèces', Banknote],
                                        ['CARD', 'Carte', CreditCard],
                                        ['CREDIT', 'Crédit', User],
                                        ['OTHER', 'Autre', TicketPercent],
                                    ] as const).map(([value, label, Icon]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            role="radio"
                                            aria-checked={paymentMethod === value}
                                            onClick={() => {
                                                setPaymentMethod(value);
                                                if (value !== 'CASH') setAmountGiven('');
                                            }}
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
                                            Client du crédit
                                        </label>
                                        <button
                                            type="button"
                                            className="btn-ghost text-sm"
                                            onClick={() => setShowNewCustomerForm((shown) => !shown)}
                                        >
                                            <UserPlus size={16} /> Nouveau
                                        </button>
                                    </div>

                                    {showNewCustomerForm ? (
                                        <div className="space-y-2">
                                            <input
                                                type="text"
                                                className="input w-full"
                                                placeholder="Nom du client *"
                                                value={newCustomerName}
                                                onChange={(event) => setNewCustomerName(event.target.value)}
                                                autoFocus
                                            />
                                            <input
                                                type="tel"
                                                className="input w-full"
                                                placeholder="Téléphone (facultatif)"
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
                                                    Annuler
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn-secondary"
                                                    onClick={submitNewCustomer}
                                                    disabled={createCustomerMutation.isPending || !newCustomerName.trim()}
                                                >
                                                    {createCustomerMutation.isPending ? 'Création…' : 'Créer et sélectionner'}
                                                </button>
                                            </div>
                                        </div>
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
                                                Changer
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <input
                                                id="credit-customer-search"
                                                type="search"
                                                className="input w-full"
                                                placeholder="Rechercher par nom ou téléphone…"
                                                value={customerSearch}
                                                onChange={(event) => setCustomerSearch(event.target.value)}
                                                autoFocus
                                            />
                                            <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-secondary">
                                                {customersLoading ? (
                                                    <p className="p-3 text-sm text-muted">Recherche…</p>
                                                ) : customers.length === 0 ? (
                                                    <p className="p-3 text-sm text-muted">Aucun client trouvé.</p>
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
                                        Aucun encaissement immédiat : le règlement sera suivi dans la rubrique Crédits.
                                    </p>
                                </div>
                            )}

                            {paymentMethod === 'CASH' ? (
                                <>
                                    <div className="space-y-2">
                                        <label htmlFor="amount-received" className="block text-sm font-medium">Montant reçu</label>
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
                                            <span className="px-4 flex items-center text-muted font-bold border-l border-border">DH</span>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn-ghost text-sm"
                                            onClick={() => setAmountGiven(total.toFixed(2))}
                                        >
                                            Montant exact
                                        </button>
                                    </div>

                                    <div
                                        role="status"
                                        className={`p-4 rounded-xl flex justify-between items-center transition-colors ${changeAmount >= 0 ? 'bg-success-light text-success-dark' : 'bg-danger-light text-danger'
                                            }`}
                                    >
                                        <span className="font-semibold text-lg">Monnaie à rendre</span>
                                        <span className="text-3xl font-bold">{Math.max(0, changeAmount).toFixed(2)} DH</span>
                                    </div>
                                </>
                            ) : paymentMethod !== 'CREDIT' ? (
                                <p className="rounded-xl bg-tertiary p-4 text-sm text-muted" role="status">
                                    Le montant sera validé exactement à {total.toFixed(2)} DH.
                                </p>
                            ) : null}

                            <button
                                type="button"
                                onClick={handleCheckout}
                                disabled={checkoutMutation.isPending || !canCheckout}
                                aria-busy={checkoutMutation.isPending}
                                className="btn-primary w-full py-4 text-xl font-bold shadow-lg shadow-accent/20"
                            >
                                {checkoutMutation.isPending ? 'Validation…' : 'Valider la vente'}
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
                            Mode Vente
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('PRICE_CHECK')}
                            aria-pressed={mode === 'PRICE_CHECK'}
                            className={`px-4 py-2 rounded-md font-medium text-sm transition-all flex items-center gap-2 ${mode === 'PRICE_CHECK' ? 'bg-accent text-white shadow' : 'text-muted hover:text-primary'
                                }`}
                        >
                            <ScanLine size={18} />
                            Vérification Prix
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
                            aria-label={mode === 'SALE' ? 'Rechercher ou scanner un produit' : 'Scanner un produit pour vérifier son prix'}
                            aria-busy={productsLoading}
                            placeholder={mode === 'SALE' ? "Rechercher pour ajouter au panier..." : "Scanner pour vérifier le prix..."}
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
                            <h2 className="text-2xl font-bold mb-2">Prêt à scanner</h2>
                            <p className="text-lg">Scannez un code-barres ou recherchez un produit</p>
                        </div>
                    ) : productsLoading ? (
                        <div className="h-full flex items-center justify-center text-muted" role="status">
                            Recherche des produits…
                        </div>
                    ) : productsFailed ? (
                        <div className="h-full flex flex-col items-center justify-center gap-3 text-center" role="alert">
                            <p className="font-semibold text-danger">
                                {getApiErrorMessage(productsError, 'Impossible de rechercher les produits.')}
                            </p>
                            <button type="button" className="btn-secondary" onClick={() => void retryProducts()}>
                                Réessayer
                            </button>
                        </div>
                    ) : products.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-muted" role="status">
                            <Package size={48} aria-hidden="true" />
                            <h2 className="text-xl font-bold text-primary">Aucun produit vendable trouvé</h2>
                            <p className="max-w-md">
                                Vérifiez la recherche. Un article sans prix de vente configuré doit être corrigé dans le stock avant de passer en caisse.
                            </p>
                        </div>
                    ) : (
                        <div className="pos-products-grid grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
                            {products.map((product) => (
                                <button
                                    key={product.id}
                                    type="button"
                                    onClick={() => handleProductAction(product)}
                                    disabled={mode === 'SALE' && (product.stock <= 0 || product.active === false)}
                                    aria-label={`${mode === 'SALE' ? 'Ajouter' : 'Vérifier'} ${product.name}, ${product.price_ttc.toFixed(2)} DH, stock ${product.stock}`}
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
                                        {product.stock > 0 ? `${product.stock} en stock` : 'Rupture'}
                                    </div>

                                    {/* Large Product Image */}
                                    <div className="w-full h-48 bg-gradient-to-br from-tertiary to-tertiary/50 flex items-center justify-center overflow-hidden relative">
                                        {product.image_url ? (
                                            <img
                                                src={product.image_url}
                                                alt={product.name}
                                                className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-110"
                                            />
                                        ) : (
                                            <div className="flex flex-col items-center justify-center text-muted/50">
                                                <Package size={64} strokeWidth={1.5} />
                                                <span className="text-xs mt-2">Pas d'image</span>
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
                                                <span className="text-xs text-muted uppercase font-medium">Prix</span>
                                            </div>
                                            <div className="flex items-baseline gap-1 mt-1">
                                                <span className="font-black text-3xl text-accent leading-none">
                                                    {product.price_ttc?.toFixed(2)}
                                                </span>
                                                <span className="text-lg font-bold text-accent/70">DH</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Hover action hint */}
                                    <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                                </button>
                            ))}

                            {products.length === 0 && (
                                <div className="col-span-full text-center py-12 text-muted">
                                    <p>Aucun produit trouvé pour "{searchTerm}"</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Right Panel (Cart Only - Success is Overlay now) */}
            <div className="pos-cart-panel w-[28rem] card flex flex-col shadow-xl border-t-4 border-t-accent">
                <div className="card-header flex items-center gap-3 bg-tertiary/30">
                    <ShoppingCart size={26} className="text-accent" />
                    <h2 className="font-semibold text-xl">Panier en cours</h2>
                    {itemCount > 0 && (
                        <span className="badge badge-accent ml-auto">
                            {itemCount} article{itemCount > 1 ? 's' : ''}
                        </span>
                    )}
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-5">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted opacity-60">
                            <ShoppingCart size={64} className="mb-4 text-tertiary-dark" />
                            <p className="font-medium">Votre panier est vide</p>
                            <p className="text-sm mt-1">Scanner un produit pour commencer</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {cart.map((item) => (
                                <div key={item.product.id} className="bg-tertiary/50 rounded-xl p-4 border border-transparent hover:border-accent/20 transition-colors">
                                    <div className="flex items-start gap-3 mb-3">
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-bold text-base leading-tight line-clamp-2">
                                                {item.product.name}
                                            </h4>
                                            <div className="text-sm text-muted flex items-center gap-2 mt-1.5">
                                                <span className="bg-secondary px-1.5 rounded">{item.product.barcode}</span>
                                                <span>{item.product.price_ttc?.toFixed(2)} DH/u</span>
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
                                            aria-label={`Retirer ${item.product.name} du panier`}
                                        >
                                            <Trash2 size={16} />
                                        </button>

                                        <div className="flex items-center gap-1 bg-secondary rounded-xl shadow-sm border border-border p-1">
                                            <button
                                                type="button"
                                                onClick={() => updateQuantity(item.product.id, -1)}
                                                className="w-8 h-8 flex items-center justify-center hover:bg-tertiary rounded-md transition-colors"
                                                aria-label={`Diminuer la quantité de ${item.product.name}`}
                                            >
                                                <Minus size={16} />
                                            </button>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                aria-label={`Quantité de ${item.product.name}`}
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
                                                aria-label={`Augmenter la quantité de ${item.product.name}`}
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
                                        <label htmlFor="discount-code" className="font-semibold leading-tight">Code de remise</label>
                                        <p className="text-xs text-muted">Validation sécurisée par le serveur</p>
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
                                        placeholder="EX. RENTREE10"
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
                                        Retirer
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        disabled={!discountCode.trim() || discountMutation.isPending}
                                        aria-busy={discountMutation.isPending}
                                        onClick={() => discountMutation.mutate(discountCode.trim().toUpperCase())}
                                    >
                                        {discountMutation.isPending ? 'Vérification…' : 'Appliquer'}
                                    </button>
                                )}
                            </div>
                            {appliedDiscount && (
                                <p className="text-xs font-medium text-success" role="status">
                                    Code {appliedDiscount.code} appliqué : −{discountAmount.toFixed(2)} DH
                                </p>
                            )}
                        </div>
                    )}

                    {discountAmount > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-baseline justify-between text-muted">
                                <span className="text-sm">Sous-total</span>
                                <span className="text-lg">{subtotal.toFixed(2)} DH</span>
                            </div>
                            <div className="flex items-baseline justify-between text-success">
                                <span className="text-sm font-medium">Reduction</span>
                                <span className="text-lg font-bold">-{discountAmount.toFixed(2)} DH</span>
                            </div>
                        </div>
                    )}

                    <div className="flex items-baseline justify-between">
                        <span className="text-muted font-medium uppercase text-sm">Total à payer</span>
                        <span className="text-3xl font-bold text-primary">{total.toFixed(2)} <span className="text-lg text-muted">DH</span></span>
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowPaymentModal(true)}
                        disabled={cart.length === 0}
                        className="btn-primary w-full py-4 text-xl font-bold shadow-xl shadow-accent/20 flex items-center justify-center gap-3 transform active:scale-[0.98] transition-all disabled:opacity-50 disabled:shadow-none"
                    >
                        <Banknote size={24} />
                        <span>ENCAISSER</span>
                    </button>

                    {cart.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowClearCartConfirm(true)}
                            className="w-full text-muted hover:text-danger text-sm flex items-center justify-center gap-2 py-2"
                        >
                            <Trash2 size={14} />
                            <span>Annuler la vente</span>
                        </button>
                    )}
                </div>
            </div>

            <ConfirmDialog
                open={showClearCartConfirm}
                title="Annuler la vente en cours ?"
                description="Tous les articles et la remise du panier seront retirés. Aucune vente ne sera enregistrée."
                confirmLabel="Vider le panier"
                onCancel={() => setShowClearCartConfirm(false)}
                onConfirm={() => {
                    resetSale();
                    setShowClearCartConfirm(false);
                }}
            />
        </div>
    );
}
