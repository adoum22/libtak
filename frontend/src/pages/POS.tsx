import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { useToast } from '../components/Toast';
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
    ScanLine
} from 'lucide-react';

interface Product {
    id: number;
    name: string;
    barcode: string;
    sale_price_ht: number;
    price_ttc: number;
    stock: number;
    image_url?: string;
}

interface CartItem {
    product: Product;
    quantity: number;
}

type POSMode = 'SALE' | 'PRICE_CHECK';

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

    // Price Check State
    const [checkedProduct, setCheckedProduct] = useState<Product | null>(null);

    const searchInputRef = useRef<HTMLInputElement>(null);

    // Fetch products
    const { data: products = [] } = useQuery<Product[]>({
        queryKey: ['products', searchTerm],
        queryFn: () => client.get(`/inventory/products/?search=${searchTerm}`).then(res => res.data.results || res.data)
    });

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

    // Checkout mutation
    const checkoutMutation = useMutation({
        mutationFn: (data: { items: Array<{ product_id: number; quantity: number }>; payment_method: string }) =>
            client.post('/sales/sales/', data),
        onError: (error: any) => {
            console.error("Erreur Checkout:", error);
            toast.error("Erreur lors de la validation : " +
                (error.response?.data?.detail || error.message || "Erreur inconnue")
            );
        },
        onSuccess: () => {
            // 1. Close modal
            setShowPaymentModal(false);

            // 2. Show Success Overlay
            setShowSuccessOverlay(true);

            // 3. Invalidate queries (stock update)
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });

            // 4. Auto Reset after 2 seconds
            setTimeout(() => {
                resetSale();
                setShowSuccessOverlay(false);
            }, 2000);
        }
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

    const updateQuantity = (productId: number, delta: number) => {
        setCart(cart.map(item => {
            if (item.product.id === productId) {
                const newQty = Math.max(1, Math.min(item.quantity + delta, item.product.stock));
                return { ...item, quantity: newQty };
            }
            return item;
        }));
    };

    const removeFromCart = (productId: number) => {
        setCart(cart.filter(item => item.product.id !== productId));
    };

    const handleCheckout = () => {
        if (cart.length === 0) return;

        const payload = {
            items: cart.map(item => ({
                product_id: item.product.id,
                quantity: item.quantity
            })),
            payment_method: 'CASH'
        };

        checkoutMutation.mutate(payload);
    };

    const resetSale = () => {
        setCart([]);
        setAmountGiven('');
        setSearchTerm('');
        searchInputRef.current?.focus();
    };

    const total = cart.reduce((sum, item) => sum + (item.product.price_ttc * item.quantity), 0);
    const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    const changeAmount = parseFloat(amountGiven) ? parseFloat(amountGiven) - total : 0;

    // Focus search on mount
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    return (
        <div className="flex gap-6 h-[calc(100vh-120px)] animate-fadeIn relative">

            {/* Success Overlay (Auto-dismiss) */}
            {showSuccessOverlay && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md animate-fadeIn">
                    <div className="text-center p-12 bg-white rounded-3xl shadow-2xl animate-bounce-short">
                        <div className="w-24 h-24 bg-success rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-success/30">
                            <Check size={64} className="text-white" strokeWidth={4} />
                        </div>
                        <h2 className="text-4xl font-bold text-success mb-2">Vente Validée !</h2>
                        <p className="text-muted text-lg">Retour à la caisse...</p>
                    </div>
                </div>
            )}

            {/* Price Check Overlay */}
            {checkedProduct && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={() => setCheckedProduct(null)}>
                    <div className="card w-full max-w-lg p-8 shadow-2xl scale-100" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-6">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <ScanLine className="text-accent" />
                                Vérification Prix
                            </h2>
                            <button onClick={() => setCheckedProduct(null)} className="btn-ghost p-2">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="flex gap-6">
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
                    <div className="card w-full max-w-md p-0 shadow-2xl">
                        <div className="card-header bg-accent text-white flex justify-between items-center">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <Banknote />
                                Paiement Espèces
                            </h3>
                            <button onClick={() => setShowPaymentModal(false)} className="text-white hover:bg-white/20 p-1 rounded">
                                <X size={24} />
                            </button>
                        </div>
                        <div className="p-6 space-y-6">
                            <div className="text-center space-y-2">
                                <p className="text-muted uppercase text-sm font-semibold">Total à payer</p>
                                <p className="text-4xl font-bold text-accent">{total.toFixed(2)} DH</p>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-sm font-medium">Montant Perçu</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        autoFocus
                                        className="text-2xl font-bold py-3 pl-4 pr-12 w-full border-2 focus:border-accent rounded-xl"
                                        placeholder="0.00"
                                        value={amountGiven}
                                        onChange={e => setAmountGiven(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && changeAmount >= 0) handleCheckout();
                                        }}
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted font-bold">DH</span>
                                </div>
                            </div>

                            <div className={`p-4 rounded-xl flex justify-between items-center transition-colors ${changeAmount >= 0 ? 'bg-success-light text-success-dark' : 'bg-danger-light text-danger'
                                }`}>
                                <span className="font-semibold text-lg">Monnaie à rendre</span>
                                <span className="text-3xl font-bold">{Math.max(0, changeAmount).toFixed(2)} DH</span>
                            </div>

                            <button
                                onClick={handleCheckout}
                                disabled={checkoutMutation.isPending || changeAmount < 0}
                                className="btn-primary w-full py-4 text-xl font-bold shadow-lg shadow-accent/20"
                            >
                                {checkoutMutation.isPending ? 'Validation...' : 'VALIDER LA VENTE'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Products Section */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Top Controls */}
                <div className="flex items-center gap-4 mb-4">
                    <div className="bg-tertiary p-1 rounded-lg flex gap-1">
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
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                            {products.map((product) => (
                                <button
                                    key={product.id}
                                    onClick={() => handleProductAction(product)}
                                    disabled={mode === 'SALE' && product.stock <= 0}
                                    className={`card p-4 text-left transition hover:scale-[1.02] hover:shadow-lg relative overflow-hidden group ${mode === 'SALE' && product.stock <= 0 ? 'opacity-50 cursor-not-allowed' : ''
                                        }`}
                                >
                                    {mode === 'PRICE_CHECK' && (
                                        <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-accent text-white p-1 rounded-full">
                                            <ScanLine size={16} />
                                        </div>
                                    )}

                                    <div className="w-full h-32 bg-tertiary rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                                        {product.image_url ? (
                                            <img
                                                src={product.image_url}
                                                alt={product.name}
                                                className="w-full h-full object-cover rounded-lg"
                                            />
                                        ) : (
                                            <Package size={40} className="text-muted" />
                                        )}
                                    </div>
                                    <h3 className="font-bold text-lg leading-tight mb-1 text-primary">
                                        {product.name}
                                    </h3>
                                    <p className="text-xs text-muted font-mono mb-3 truncate">
                                        {product.barcode}
                                    </p>
                                    <div className="flex items-end justify-between mt-auto">
                                        <span className="font-bold text-xl text-accent">
                                            {product.price_ttc?.toFixed(2)} <span className="text-sm">DH</span>
                                        </span>
                                        <span className={`badge ${product.stock > 5 ? 'badge-success' : product.stock > 0 ? 'badge-warning' : 'badge-danger'}`}>
                                            {product.stock}
                                        </span>
                                    </div>
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
            <div className="w-96 card flex flex-col shadow-xl border-t-4 border-t-accent">
                <div className="card-header flex items-center gap-3 bg-tertiary/30">
                    <ShoppingCart size={24} className="text-accent" />
                    <h2 className="font-semibold text-lg">Panier en cours</h2>
                    {itemCount > 0 && (
                        <span className="badge badge-accent ml-auto">
                            {itemCount} article{itemCount > 1 ? 's' : ''}
                        </span>
                    )}
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-4">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted opacity-60">
                            <ShoppingCart size={64} className="mb-4 text-tertiary-dark" />
                            <p className="font-medium">Votre panier est vide</p>
                            <p className="text-sm mt-1">Scanner un produit pour commencer</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {cart.map((item) => (
                                <div key={item.product.id} className="bg-tertiary/50 rounded-xl p-3 border border-transparent hover:border-accent/20 transition-colors">
                                    <div className="flex items-start gap-3 mb-2">
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-bold text-sm truncate leading-tight">
                                                {item.product.name}
                                            </h4>
                                            <div className="text-xs text-muted flex items-center gap-2 mt-1">
                                                <span className="bg-white px-1.5 rounded">{item.product.barcode}</span>
                                                <span>{item.product.price_ttc?.toFixed(2)} DH/u</span>
                                            </div>
                                        </div>
                                        <span className="font-bold text-lg text-primary">
                                            {(item.product.price_ttc * item.quantity).toFixed(2)}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <button
                                            onClick={() => removeFromCart(item.product.id)}
                                            className="p-1.5 text-danger hover:bg-danger-light rounded-lg transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>

                                        <div className="flex items-center gap-1 bg-white rounded-lg shadow-sm border border-border p-0.5">
                                            <button
                                                onClick={() => updateQuantity(item.product.id, -1)}
                                                className="w-8 h-8 flex items-center justify-center hover:bg-tertiary rounded-md transition-colors"
                                            >
                                                <Minus size={16} />
                                            </button>
                                            <span className="w-10 text-center font-bold text-lg">
                                                {item.quantity}
                                            </span>
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
                <div className="border-t p-6 bg-tertiary/10 space-y-6">
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
