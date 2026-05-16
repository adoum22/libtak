import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { useToast } from '../components/ToastContext';
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';
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
    Percent,
    CreditCard,
    UserPlus,
    User
} from 'lucide-react';

interface Product {
    id: number;
    name: string;
    barcode: string;
    sale_price_ht: number;
    price_ttc: number;
    price_layers?: Array<{
        remaining_quantity: number;
        sale_price: number;
    }>;
    stock: number;
    image_url?: string;
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
type PaymentChoice = 'CASH' | 'CREDIT';

export default function POS() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const [mode, setMode] = useState<POSMode>('SALE');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    // Payment State
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [amountGiven, setAmountGiven] = useState('');
    const [showSuccessOverlay, setShowSuccessOverlay] = useState(false); // New overlay state
    const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>('CASH');

    // Credit-specific state
    const [customerSearch, setCustomerSearch] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerPhone, setNewCustomerPhone] = useState('');

    // Price Check State
    const [checkedProduct, setCheckedProduct] = useState<Product | null>(null);

    // Direct discount in DH
    const [discountInput, setDiscountInput] = useState('');

    const searchInputRef = useRef<HTMLInputElement>(null);

    const parseMoneyInput = (value: string) => parseDecimalInput(value) || 0;

    const getLineTotal = (product: Product, quantity: number) => {
        let remaining = quantity;
        let total = 0;
        const layers = product.price_layers || [];

        for (const layer of layers) {
            if (remaining <= 0) break;
            const layerQty = Math.min(remaining, layer.remaining_quantity);
            total += layerQty * Number(layer.sale_price);
            remaining -= layerQty;
        }

        if (remaining > 0) {
            total += remaining * product.price_ttc;
        }

        return total;
    };

    // Fetch products
    const { data: products = [] } = useQuery<Product[]>({
        queryKey: ['products', searchTerm],
        queryFn: () => client.get(`/inventory/products/?search=${searchTerm}`).then(res => res.data.results || res.data)
    });

    const addToCart = (product: Product) => {
        const existing = cart.find(item => item.product.id === product.id);
        if (existing) {
            if (existing.quantity < product.stock) {
                setCart(cart.map(item =>
                    item.product.id === product.id
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                ));
            }
        } else {
            if (product.stock > 0) {
                setCart([...cart, { product, quantity: 1 }]);
            }
        }
    };

    const handleProductAction = (product: Product) => {
        if (mode === 'SALE') {
            addToCart(product);
        } else {
            setCheckedProduct(product);
        }
    };

    // Barcode Scanner Hook
    useBarcodeScanner((barcode) => {
        const product = products.find(p => p.barcode === barcode);
        if (product) {
            handleProductAction(product);
        }
    });

    // Debounce customer search to avoid one HTTP call per keystroke
    const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedCustomerSearch(customerSearch), 250);
        return () => clearTimeout(t);
    }, [customerSearch]);

    // Customers search (only when credit mode is open)
    const { data: customers = [], isFetching: customersLoading } = useQuery<Customer[]>({
        queryKey: ['credit-customers', debouncedCustomerSearch],
        queryFn: () =>
            client.get(`/credit/customers/?search=${encodeURIComponent(debouncedCustomerSearch)}`)
                .then(res => res.data.results || res.data),
        enabled: showPaymentModal && paymentChoice === 'CREDIT',
        staleTime: 10_000,
    });

    const createCustomerMutation = useMutation({
        mutationFn: (data: { name: string; phone?: string }) =>
            client.post('/credit/customers/', data).then(res => res.data),
        onSuccess: (created: Customer) => {
            queryClient.invalidateQueries({ queryKey: ['credit-customers'] });
            setSelectedCustomer(created);
            setShowNewCustomerForm(false);
            setNewCustomerName('');
            setNewCustomerPhone('');
        },
        onError: (error: unknown) => {
            toast.error("Erreur création client : " + getApiErrorMessage(error));
        },
    });

    const submitNewCustomer = () => {
        const name = newCustomerName.trim();
        if (!name) {
            toast.error('Le nom du client est requis.');
            return;
        }
        const payload: { name: string; phone?: string } = { name };
        const phone = newCustomerPhone.trim();
        if (phone) payload.phone = phone;
        createCustomerMutation.mutate(payload);
    };

    const resetPaymentModal = useCallback(() => {
        setShowPaymentModal(false);
        setAmountGiven('');
        setPaymentChoice('CASH');
        setCustomerSearch('');
        setSelectedCustomer(null);
        setShowNewCustomerForm(false);
        setNewCustomerName('');
        setNewCustomerPhone('');
    }, []);

    // Checkout mutation
    const checkoutMutation = useMutation({
        mutationFn: (data: {
            items: Array<{ product_id: number; quantity: number }>;
            payment_method: string;
            discount_amount: number;
            customer_id?: number;
        }) =>
            client.post('/sales/sales/', data),
        onError: (error: unknown) => {
            console.error("Erreur Checkout:", error);
            toast.error("Erreur lors de la validation : " + getApiErrorMessage(error));
        },
        onSuccess: () => {
            // 1. Reset cart + payment state immediately. The success overlay
            //    is non-blocking; the next sale must start clean even if the
            //    cashier dismisses the overlay quickly.
            resetSale();
            setShowSuccessOverlay(true);

            // 2. Invalidate queries (stock + accounting + credit)
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['sales'] });
            queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
            queryClient.invalidateQueries({ queryKey: ['acc-period'] });
            queryClient.invalidateQueries({ queryKey: ['acc-month'] });
            queryClient.invalidateQueries({ queryKey: ['acc-summary'] });
            queryClient.invalidateQueries({ queryKey: ['cashRegister'] });
            queryClient.invalidateQueries({ queryKey: ['credits'] });
        }
    });

    const updateQuantity = (productId: number, delta: number) => {
        setCart(cart.map(item => {
            if (item.product.id === productId) {
                const newQty = Math.max(1, Math.min(item.quantity + delta, item.product.stock));
                return { ...item, quantity: newQty };
            }
            return item;
        }));
    };

    const setItemQuantity = (productId: number, value: string) => {
        const parsed = Number.parseInt(value, 10);
        setCart(cart.map(item => {
            if (item.product.id !== productId) return item;
            if (!Number.isFinite(parsed)) {
                return { ...item, quantity: 1 };
            }
            const newQty = Math.max(1, Math.min(parsed, item.product.stock));
            return { ...item, quantity: newQty };
        }));
    };

    const removeFromCart = (productId: number) => {
        setCart(cart.filter(item => item.product.id !== productId));
    };

    const handleCheckout = () => {
        if (cart.length === 0) return;

        if (paymentChoice === 'CREDIT' && !selectedCustomer) {
            toast.error("Sélectionnez un client pour la vente à crédit.");
            return;
        }

        const payload: {
            items: Array<{ product_id: number; quantity: number }>;
            discount_amount: number;
            payment_method: string;
            customer_id?: number;
        } = {
            items: cart.map(item => ({
                product_id: item.product.id,
                quantity: item.quantity
            })),
            discount_amount: discountAmount,
            payment_method: paymentChoice,
        };
        if (paymentChoice === 'CREDIT' && selectedCustomer) {
            payload.customer_id = selectedCustomer.id;
        }

        checkoutMutation.mutate(payload);
    };

    const resetSale = useCallback(() => {
        setCart([]);
        setAmountGiven('');
        setSearchTerm('');
        setDiscountInput('');
        setPaymentChoice('CASH');
        setSelectedCustomer(null);
        setCustomerSearch('');
        setShowNewCustomerForm(false);
        setNewCustomerName('');
        setNewCustomerPhone('');
        searchInputRef.current?.focus();
    }, []);

    const closeSuccessOverlay = useCallback(() => {
        resetSale();
        setShowSuccessOverlay(false);
    }, [resetSale]);

    const subtotal = cart.reduce((sum, item) => sum + getLineTotal(item.product, item.quantity), 0);
    const parsedDiscount = parseMoneyInput(discountInput);
    const discountAmount = Math.min(Math.max(parsedDiscount, 0), subtotal);
    const total = Math.max(0, subtotal - discountAmount);
    const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    const amountReceived = parseMoneyInput(amountGiven);
    const changeAmount = amountReceived ? amountReceived - total : 0;
    const discountTooHigh = parsedDiscount > subtotal && subtotal > 0;

    // Focus search on mount
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!showSuccessOverlay) return;

        const timer = window.setTimeout(closeSuccessOverlay, 5000);
        return () => window.clearTimeout(timer);
    }, [closeSuccessOverlay, showSuccessOverlay]);

    return (
        <div className="pos-shell flex gap-6 h-[calc(100vh-120px)] animate-fadeIn relative">

            {/* Success Overlay (Auto-dismiss) */}
            {showSuccessOverlay && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md animate-fadeIn">
                    <div className="text-center w-full max-w-xl mx-4 px-8 py-10 bg-secondary rounded-2xl shadow-2xl animate-bounce-short">
                        <div className="w-24 h-24 bg-success rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-success/30">
                            <Check size={64} className="text-white" strokeWidth={4} />
                        </div>
                        <h2 className="text-4xl font-bold text-success mb-2 whitespace-normal">Vente Validée !</h2>
                        <p className="text-muted text-lg mb-6">Retour à la caisse dans 5 secondes...</p>
                        <button
                            onClick={closeSuccessOverlay}
                            className="btn-primary px-6 py-3 font-bold"
                        >
                            Nouvelle vente
                        </button>
                    </div>
                </div>
            )}

            {/* Price Check Overlay */}
            {checkedProduct && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={() => setCheckedProduct(null)}>
                    <div className="card pos-price-check-modal w-full max-w-lg p-8 shadow-2xl scale-100" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-6">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <ScanLine className="text-accent" />
                                Vérification Prix
                            </h2>
                            <button onClick={() => setCheckedProduct(null)} className="btn-ghost p-2">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="pos-price-check-content flex gap-6">
                            <div className="w-1/3 aspect-square bg-tertiary rounded-xl flex items-center justify-center">
                                {checkedProduct.image_url ? (
                                    <img src={checkedProduct.image_url} className="w-full h-full object-cover rounded-xl" />
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
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
                    <div className="card pos-payment-modal w-full max-w-md p-0 shadow-2xl">
                        <div className={`card-header text-white flex justify-between items-center ${paymentChoice === 'CREDIT' ? 'bg-warning' : 'bg-accent'}`}>
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                {paymentChoice === 'CREDIT' ? <CreditCard /> : <Banknote />}
                                {paymentChoice === 'CREDIT' ? 'Vente à crédit' : 'Paiement Espèces'}
                            </h3>
                            <button onClick={resetPaymentModal} aria-label="Fermer" className="text-white hover:bg-secondary/20 p-1 rounded">
                                <X size={24} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="text-center space-y-2">
                                <p className="text-muted uppercase text-sm font-semibold">Total à payer</p>
                                <p className={`text-4xl font-bold ${paymentChoice === 'CREDIT' ? 'text-warning' : 'text-accent'}`}>{total.toFixed(2)} DH</p>
                            </div>

                            {/* Mode selector */}
                            <div className="grid grid-cols-2 gap-2 bg-tertiary/40 p-1 rounded-xl">
                                <button
                                    type="button"
                                    onClick={() => setPaymentChoice('CASH')}
                                    className={`flex items-center justify-center gap-2 py-2 rounded-lg font-semibold text-sm transition ${paymentChoice === 'CASH' ? 'bg-accent text-white shadow' : 'text-muted hover:text-primary'}`}
                                >
                                    <Banknote size={18} /> Espèces
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPaymentChoice('CREDIT')}
                                    className={`flex items-center justify-center gap-2 py-2 rounded-lg font-semibold text-sm transition ${paymentChoice === 'CREDIT' ? 'bg-warning text-white shadow' : 'text-muted hover:text-primary'}`}
                                >
                                    <CreditCard size={18} /> Crédit
                                </button>
                            </div>

                            {paymentChoice === 'CASH' && (
                                <>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-medium">Montant Perçu</label>
                                        <div className="flex rounded-xl border-2 border-border bg-secondary focus-within:border-accent">
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                autoFocus
                                                className="money-input text-2xl font-bold py-3 pl-4 pr-3 w-full"
                                                placeholder="0.00"
                                                value={amountGiven}
                                                onChange={e => setAmountGiven(normalizeDecimalInput(e.target.value))}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && changeAmount >= 0) handleCheckout();
                                                }}
                                            />
                                            <span className="px-4 flex items-center text-muted font-bold border-l border-border">DH</span>
                                        </div>
                                    </div>
                                    <div className={`p-4 rounded-xl flex justify-between items-center transition-colors ${changeAmount >= 0 ? 'bg-success-light text-success-dark' : 'bg-danger-light text-danger'
                                        }`}>
                                        <span className="font-semibold text-lg">Monnaie à rendre</span>
                                        <span className="text-3xl font-bold">{Math.max(0, changeAmount).toFixed(2)} DH</span>
                                    </div>
                                </>
                            )}

                            {paymentChoice === 'CREDIT' && (
                                <div className="space-y-3">
                                    <p className="text-xs text-muted">
                                        La vente ne sera pas ajoutée au chiffre du jour ni à la caisse. Elle apparaîtra dans la section Crédit jusqu'au règlement.
                                    </p>

                                    {selectedCustomer ? (
                                        <div className="flex items-center justify-between gap-3 p-3 rounded-xl border-2 border-warning/40 bg-warning-light/30">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="w-9 h-9 rounded-full bg-warning text-white flex items-center justify-center shrink-0">
                                                    <User size={18} />
                                                </span>
                                                <div className="min-w-0">
                                                    <p className="font-bold truncate">{selectedCustomer.name}</p>
                                                    {selectedCustomer.phone && (
                                                        <p className="text-xs text-muted truncate">{selectedCustomer.phone}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }}
                                                className="btn-ghost btn-sm"
                                            >
                                                Changer
                                            </button>
                                        </div>
                                    ) : showNewCustomerForm ? (
                                        <div className="space-y-2 p-3 rounded-xl border border-border bg-secondary">
                                            <label className="block text-sm font-medium">Nouveau client</label>
                                            <input
                                                type="text"
                                                autoFocus
                                                placeholder="Nom du client"
                                                value={newCustomerName}
                                                onChange={e => setNewCustomerName(e.target.value)}
                                                className="input w-full"
                                            />
                                            <input
                                                type="tel"
                                                placeholder="Téléphone (optionnel)"
                                                value={newCustomerPhone}
                                                onChange={e => setNewCustomerPhone(e.target.value)}
                                                className="input w-full"
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowNewCustomerForm(false)}
                                                    className="btn-ghost flex-1"
                                                >
                                                    Annuler
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={!newCustomerName.trim() || createCustomerMutation.isPending}
                                                    onClick={submitNewCustomer}
                                                    className="btn-primary flex-1"
                                                >
                                                    {createCustomerMutation.isPending ? '...' : 'Créer'}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                                <input
                                                    type="text"
                                                    autoFocus
                                                    placeholder="Rechercher un client..."
                                                    value={customerSearch}
                                                    onChange={e => setCustomerSearch(e.target.value)}
                                                    className="input w-full pl-10"
                                                />
                                            </div>
                                            <div className="max-h-44 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                                                {customersLoading ? (
                                                    <p className="text-sm text-muted p-3 text-center">Recherche...</p>
                                                ) : customers.length === 0 ? (
                                                    <p className="text-sm text-muted p-3 text-center">
                                                        {customerSearch ? 'Aucun client trouvé.' : 'Tapez pour rechercher.'}
                                                    </p>
                                                ) : (
                                                    customers.map(c => (
                                                        <button
                                                            key={c.id}
                                                            type="button"
                                                            onClick={() => setSelectedCustomer(c)}
                                                            className="w-full text-left p-3 hover:bg-tertiary/40 transition flex justify-between items-center gap-3"
                                                        >
                                                            <div className="min-w-0">
                                                                <p className="font-medium truncate">{c.name}</p>
                                                                {c.phone && <p className="text-xs text-muted truncate">{c.phone}</p>}
                                                            </div>
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setShowNewCustomerForm(true)}
                                                className="btn-ghost w-full flex items-center justify-center gap-2"
                                            >
                                                <UserPlus size={16} />
                                                Nouveau client
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}

                            <button
                                onClick={handleCheckout}
                                disabled={
                                    checkoutMutation.isPending
                                    || (paymentChoice === 'CASH' && changeAmount < 0)
                                    || (paymentChoice === 'CREDIT' && !selectedCustomer)
                                }
                                className={`w-full py-4 text-xl font-bold shadow-lg flex items-center justify-center gap-2 ${paymentChoice === 'CREDIT' ? 'btn bg-warning text-white hover:bg-warning/90 shadow-warning/20' : 'btn-primary shadow-accent/20'}`}
                            >
                                {checkoutMutation.isPending
                                    ? 'Validation...'
                                    : paymentChoice === 'CREDIT'
                                        ? 'ENREGISTRER LE CRÉDIT'
                                        : 'VALIDER LA VENTE'}
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
                            onClick={() => setMode('SALE')}
                            className={`px-4 py-2 rounded-md font-medium text-sm transition-all flex items-center gap-2 ${mode === 'SALE' ? 'bg-secondary shadow text-accent' : 'text-muted hover:text-primary'
                                }`}
                        >
                            <ShoppingCart size={18} />
                            Mode Vente
                        </button>
                        <button
                            onClick={() => setMode('PRICE_CHECK')}
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
                            type="text"
                            placeholder={mode === 'SALE' ? "Rechercher pour ajouter au panier..." : "Scanner pour vérifier le prix..."}
                            className={`input-icon-left w-full transition-shadow ${mode === 'PRICE_CHECK' ? 'border-accent focus:ring-accent' : ''}`}
                            style={{ paddingLeft: '3rem' }}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
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
                    ) : (
                        <div className="pos-products-grid grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
                            {products.map((product) => (
                                <button
                                    key={product.id}
                                    onClick={() => handleProductAction(product)}
                                    disabled={mode === 'SALE' && product.stock <= 0}
                                    className={`card p-0 text-left transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl hover:shadow-accent/10 relative overflow-hidden group border-2 border-transparent hover:border-accent/30 ${mode === 'SALE' && product.stock <= 0 ? 'opacity-50 cursor-not-allowed grayscale' : ''
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
                                            onClick={() => removeFromCart(item.product.id)}
                                            className="p-1.5 text-danger hover:bg-danger-light rounded-lg transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>

                                        <div className="flex items-center gap-1 bg-secondary rounded-xl shadow-sm border border-border p-1">
                                            <button
                                                onClick={() => updateQuantity(item.product.id, -1)}
                                                className="w-8 h-8 flex items-center justify-center hover:bg-tertiary rounded-md transition-colors"
                                            >
                                                <Minus size={16} />
                                            </button>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                aria-label={`Quantite ${item.product.name}`}
                                                className="w-14 h-8 text-center font-bold text-xl bg-transparent rounded-md focus:bg-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30"
                                                value={String(item.quantity)}
                                                onChange={(e) => setItemQuantity(item.product.id, e.target.value)}
                                                onFocus={(e) => e.target.select()}
                                            />
                                            <button
                                                onClick={() => updateQuantity(item.product.id, 1)}
                                                className="w-8 h-8 flex items-center justify-center hover:bg-tertiary rounded-md transition-colors"
                                                disabled={item.quantity >= item.product.stock}
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
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center shrink-0">
                                        <Percent size={18} />
                                    </span>
                                    <div className="min-w-0">
                                        <p className="font-semibold leading-tight">Reduction directe</p>
                                        <p className="text-xs text-muted">Montant deduit en dirhams</p>
                                    </div>
                                </div>
                                <div className="flex w-44 shrink-0 rounded-xl border border-border bg-secondary focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        className="money-input w-full min-w-0 px-3 py-2 text-right font-bold"
                                        placeholder="0.00"
                                        value={discountInput}
                                        onChange={(e) => setDiscountInput(normalizeDecimalInput(e.target.value))}
                                    />
                                    <span className="px-3 flex items-center text-xs font-bold text-muted border-l border-border">DH</span>
                                </div>
                            </div>
                            {discountTooHigh && (
                                <p className="text-xs font-medium text-warning">
                                    Reduction limitee au total du panier.
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
                        onClick={() => setShowPaymentModal(true)}
                        disabled={cart.length === 0}
                        className="btn-primary w-full py-4 text-xl font-bold shadow-xl shadow-accent/20 flex items-center justify-center gap-3 transform active:scale-[0.98] transition-all disabled:opacity-50 disabled:shadow-none"
                    >
                        <Banknote size={24} />
                        <span>ENCAISSER</span>
                    </button>

                    {cart.length > 0 && (
                        <button
                            onClick={() => { if (confirm('Vider le panier ?')) setCart([]) }}
                            className="w-full text-muted hover:text-danger text-sm flex items-center justify-center gap-2 py-2"
                        >
                            <Trash2 size={14} />
                            <span>Annuler la vente</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
