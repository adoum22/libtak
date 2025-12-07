import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';
import { useToast } from '../components/Toast';
import { useTranslation } from 'react-i18next';
import {
    Plus,
    Search,
    Edit,
    Trash2,
    Package,
    AlertTriangle,
    X,
    Save,
    Image as ImageIcon,
    Truck,
    AlertCircle,
    Banknote,
    ScanLine,
    Upload
} from 'lucide-react';

interface Product {
    id: number;
    name: string;
    barcode: string;
    description: string;
    purchase_price: number;
    sale_price_ht: number;
    price_ttc: number;
    tva: number;
    stock: number;
    min_stock: number;
    category: number | null;
    category_name: string | null;
    supplier: number | null;
    supplier_name: string | null;
    profit_margin: number;
    is_low_stock: boolean;
    image_url: string | null;
}

interface Category {
    id: number;
    name: string;
}

interface Supplier {
    id: number;
    name: string;
}

export default function Inventory() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [targetProductId, setTargetProductId] = useState<number | null>(null);
    const [viewingImageProduct, setViewingImageProduct] = useState<Product | null>(null);
    const listFileInputRef = useRef<HTMLInputElement>(null);

    const [formData, setFormData] = useState({
        name: '',
        barcode: '',
        description: '',
        purchase_price: '',
        sale_price_ht: '',
        tva: '20',
        stock: '0',
        min_stock: '5',
        category: '',
        supplier: ''
    });

    const { data: productsData } = useQuery({
        queryKey: ['products', search],
        queryFn: () => client.get(`/inventory/products/?search=${search}`).then(res => res.data)
    });

    const products: Product[] = productsData?.results || productsData || [];

    const { data: categoriesData } = useQuery({
        queryKey: ['categories'],
        queryFn: () => client.get('/inventory/categories/').then(res => res.data)
    });

    const categories: Category[] = categoriesData?.results || categoriesData || [];

    const { data: suppliersData } = useQuery({
        queryKey: ['suppliers'],
        queryFn: () => client.get('/inventory/suppliers/').then(res => res.data)
    });

    const suppliers: Supplier[] = suppliersData?.results || suppliersData || [];

    const buildFormData = (data: typeof formData, image: File | null) => {
        const payload = new FormData();
        payload.append('name', data.name);
        payload.append('barcode', data.barcode);
        payload.append('description', data.description);
        payload.append('purchase_price', data.purchase_price || '0');
        payload.append('sale_price_ht', data.sale_price_ht);
        payload.append('tva', data.tva);
        payload.append('stock', data.stock);
        payload.append('min_stock', data.min_stock);

        if (data.category) payload.append('category', data.category);
        if (data.supplier) payload.append('supplier', data.supplier);

        if (image) {
            payload.append('image', image);
        }
        return payload;
    };

    const createMutation = useMutation({
        mutationFn: (payload: FormData) => client.post('/inventory/products/', payload, {
            headers: { 'Content-Type': 'multipart/form-data' }
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            closeModal();
        },
        onError: (error: any) => {
            toast.error('Erreur lors de la création : ' + (error.response?.data?.detail || JSON.stringify(error.response?.data)));
        }
    });

    const updateMutation = useMutation({
        mutationFn: (data: { id: number; payload: FormData }) =>
            client.patch(`/inventory/products/${data.id}/`, data.payload, {
                headers: { 'Content-Type': 'multipart/form-data' }
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            closeModal();
        },
        onError: (error: any) => {
            console.error("Update Error:", error);
            const detail = error.response?.data?.detail
                || JSON.stringify(error.response?.data)
                || error.message
                || "Erreur inconnue";
            toast.error(`Erreur lors de la modification : ${detail}`);
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => client.delete(`/inventory/products/${id}/`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] })
    });

    const importExcelFileRef = useRef<HTMLInputElement | null>(null);

    const importMutation = useMutation({
        mutationFn: (file: File) => {
            const formData = new FormData();
            formData.append('file', file);
            return client.post('/inventory/products/import_excel/', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            toast.success(`Import terminé ! ${data.data.created} produits créés. ${data.data.errors.length} erreurs.`);
        },
        onError: (error: any) => {
            console.error("Import Error Details:", error);
            const detail = error.response?.data?.detail
                || error.response?.statusText
                || error.message;
            const status = error.response?.status ? ` (Status: ${error.response.status})` : '';
            toast.error(`Erreur import${status} : ${detail}`);
        }
    });

    const { data: currentUser } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then(res => res.data),
        retry: false
    });

    // Check permissions
    const userRole = localStorage.getItem('userRole') || 'CASHIER';
    const isAdmin = userRole === 'ADMIN';
    const canManageStock = isAdmin || (currentUser?.can_manage_stock === true);

    const openCreateModal = () => {
        if (!canManageStock) return;
        setEditingProduct(null);
        // ... (rest of initial state reset)
        setFormData({
            name: '',
            barcode: '',
            description: '',
            purchase_price: '',
            sale_price_ht: '',
            tva: '20',
            stock: '0',
            min_stock: '5',
            category: '',
            supplier: ''
        });
        setShowModal(true);
    };

    const openEditModal = (product: Product) => {
        setEditingProduct(product);
        setSelectedImage(null);
        setImagePreview(product.image_url);
        setFormData({
            name: product.name,
            barcode: product.barcode,
            description: product.description || '',
            purchase_price: product.purchase_price?.toString() || '',
            sale_price_ht: product.sale_price_ht?.toString() || '',
            tva: product.tva?.toString() || '20',
            stock: product.stock?.toString() || '0',
            min_stock: product.min_stock?.toString() || '5',
            category: product.category?.toString() || '',
            supplier: product.supplier?.toString() || ''
        });
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setEditingProduct(null);
        setSelectedImage(null);
        setImagePreview(null);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setSelectedImage(file);
            setImagePreview(URL.createObjectURL(file));
        }
    };

    // Direct Upload Handler
    const handleListUploadClick = (productId: number) => {
        setTargetProductId(productId);
        listFileInputRef.current?.click();
    };

    const handleListFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0] && targetProductId) {
            const file = e.target.files[0];
            const payload = new FormData();
            payload.append('image', file);

            updateMutation.mutate({ id: targetProductId, payload });

            // Reset
            e.target.value = '';
            setTargetProductId(null);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const payload = buildFormData(formData, selectedImage);

        if (editingProduct) {
            updateMutation.mutate({ id: editingProduct.id, payload });
        } else {
            createMutation.mutate(payload);
        }
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">{t('Inventory')}</h1>
                {canManageStock && (
                    <div className="flex gap-2">
                        <input
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            className="hidden"
                            ref={importExcelFileRef}
                            onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                    importMutation.mutate(e.target.files[0]);
                                    e.target.value = ''; // Reset input
                                }
                            }}
                        />
                        <button
                            onClick={() => importExcelFileRef.current?.click()}
                            className="btn-secondary flex items-center gap-2"
                            disabled={importMutation.isPending}
                        >
                            <Upload size={20} />
                            <span>{importMutation.isPending ? t('Loading') : t('ImportExcel')}</span>
                        </button>

                        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
                            <Plus size={20} />
                            <span>{t('AddProduct')}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Search */}
            <div className="card p-4">
                <div className="relative max-w-md">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
                    <input
                        type="text"
                        placeholder={t('SearchProducts')}
                        style={{ paddingLeft: '3rem' }}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Products Table */}
            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table>
                        <thead>
                            <tr>
                                <th>Produit</th>
                                <th>Code-barres</th>
                                <th>Catégorie</th>
                                {isAdmin && <th className="text-right">Prix Achat</th>}
                                <th className="text-right">Prix Vente TTC</th>
                                {isAdmin && <th className="text-right">Marge</th>}
                                <th className="text-center">Stock</th>
                                <th className="text-center">Seuil</th>
                                <th>Fournisseur</th>
                                {canManageStock && <th>Actions</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {products.map((product) => (
                                <tr key={product.id}>
                                    <td>
                                        <div className="flex items-center gap-3">
                                            <div
                                                onClick={() => {
                                                    if (product.image_url) {
                                                        setViewingImageProduct(product);
                                                    } else {
                                                        handleListUploadClick(product.id);
                                                    }
                                                }}
                                                className="w-10 h-10 bg-tertiary rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden cursor-pointer hover:ring-2 hover:ring-accent transition-all relative group"
                                                title={product.image_url ? "Voir la photo" : "Ajouter une photo"}
                                            >
                                                {product.image_url ? (
                                                    <>
                                                        <img
                                                            src={product.image_url}
                                                            alt=""
                                                            className="w-full h-full object-cover"
                                                        />
                                                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                            <Edit size={12} className="text-white" />
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Package size={20} className="text-muted group-hover:hidden" />
                                                        <Plus size={20} className="text-accent hidden group-hover:block" />
                                                    </>
                                                )}
                                            </div>
                                            <div>
                                                <p className="font-medium">{product.name}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="font-mono text-sm">{product.barcode}</td>
                                    <td>
                                        {product.category_name && (
                                            <span className="badge badge-accent">{product.category_name}</span>
                                        )}
                                    </td>
                                    {isAdmin && <td className="text-right">{product.purchase_price?.toFixed(2)} DH</td>}
                                    <td className="text-right font-semibold">{product.price_ttc?.toFixed(2)} DH</td>
                                    {isAdmin && (
                                        <td className="text-right">
                                            <span className={product.profit_margin > 0 ? 'text-success' : 'text-danger'}>
                                                {product.profit_margin?.toFixed(2)} DH
                                            </span>
                                        </td>
                                    )}
                                    <td className="text-center">
                                        <span className={`badge ${product.stock === 0 ? 'badge-danger' :
                                            product.is_low_stock ? 'badge-warning' : 'badge-success'
                                            }`}>
                                            {product.is_low_stock && <AlertTriangle size={12} className="mr-1" />}
                                            {product.stock}
                                        </span>
                                    </td>
                                    <td className="text-center text-muted font-mono">{product.min_stock}</td>
                                    <td className="text-sm">{product.supplier_name || '-'}</td>
                                    {canManageStock && (
                                        <td>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => openEditModal(product)}
                                                    className="btn-ghost p-2 text-accent hover:bg-accent-light"
                                                >
                                                    <Edit size={18} />
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (confirm('Supprimer ce produit?')) {
                                                            deleteMutation.mutate(product.id);
                                                        }
                                                    }}
                                                    className="btn-ghost p-2 text-danger hover:bg-danger-light"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black opacity-50 backdrop-blur-sm" onClick={closeModal} />
                    <div className="relative card w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-slideUp p-0">
                        {/* Header */}
                        <div className="p-6 border-b flex items-center justify-between bg-secondary sticky top-0 z-10">
                            <h2 className="text-xl font-bold">
                                {editingProduct ? 'Modifier le produit' : 'Nouveau produit'}
                            </h2>
                            <button onClick={closeModal} className="btn-ghost p-2 -mr-2">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-8">

                            {/* Top Section: Image & Basic Info */}
                            <div className="flex flex-col md:flex-row gap-8">
                                {/* Image Upload Column - Reduced Size */}
                                <div className="w-full md:w-1/4 flex flex-col items-center">
                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-40 h-40 bg-tertiary rounded-2xl border-2 border-dashed border-border hover:border-accent hover:bg-accent-light/10 transition-colors flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group shrink-0"
                                    >
                                        {imagePreview ? (
                                            <>
                                                <img src={imagePreview} className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <span className="text-white font-medium flex items-center gap-2">
                                                        <Edit size={20} />
                                                        Modifier
                                                    </span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-center text-muted p-4">
                                                <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                                                    <ImageIcon size={32} />
                                                </div>
                                                <p className="font-medium">Ajouter une photo</p>
                                                <p className="text-xs mt-1">Cliquez pour uploader</p>
                                            </div>
                                        )}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleImageChange}
                                        />
                                    </div>
                                    <p className="text-xs text-muted text-center mt-2">
                                        JPG, PNG ou WEBP max 5Mo
                                    </p>
                                </div>

                                {/* Basic Info Column */}
                                <div className="flex-1 space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold mb-2">Nom du produit *</label>
                                        <input
                                            type="text"
                                            className="input-lg text-lg font-bold"
                                            placeholder="Ex: Stylo Plume Parker"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Code-barres *</label>
                                            <div className="relative">
                                                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                                <input
                                                    type="text"
                                                    className="pl-12 font-mono"
                                                    value={formData.barcode}
                                                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                                                    required
                                                    disabled={!!editingProduct}
                                                    placeholder="Scan..."
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Catégorie</label>
                                            <select
                                                value={formData.category}
                                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                                className="w-full p-2.5 bg-secondary border border-border rounded-lg"
                                            >
                                                <option value="">-- Non classé --</option>
                                                {categories.map(cat => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-2">Description</label>
                                        <textarea
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            rows={4}
                                            className="w-full resize-none"
                                            placeholder="Détails du produit..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <hr className="border-border" />

                            {/* Middle Section: Logistics & Stock (Highlighted) */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="bg-accent-light/10 p-6 rounded-2xl border border-accent/10">
                                    <h3 className="flex items-center gap-2 font-bold text-accent mb-4">
                                        <Truck size={20} />
                                        Logistique & Fournisseur
                                    </h3>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-bold mb-2">Fournisseur</label>
                                            <select
                                                value={formData.supplier}
                                                onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                                                className="w-full p-3 bg-secondary border-2 border-accent/20 rounded-xl focus:border-accent focus:ring-accent"
                                            >
                                                <option value="">Sélectionner un fournisseur...</option>
                                                {suppliers.map(sup => (
                                                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Stock Actuel</label>
                                                <input
                                                    type="number"
                                                    value={formData.stock}
                                                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                                                    className="font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium mb-2 text-danger flex items-center gap-1">
                                                    <AlertCircle size={14} />
                                                    Stock Critique
                                                </label>
                                                <input
                                                    type="number"
                                                    value={formData.min_stock}
                                                    onChange={(e) => setFormData({ ...formData, min_stock: e.target.value })}
                                                    className="border-danger/30 focus:border-danger focus:ring-danger bg-danger-light/10"
                                                />
                                                <p className="text-[10px] text-danger mt-1">Seuil d'alerte stock bas</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-tertiary/30 p-6 rounded-2xl border border-tertiary">
                                    <h3 className="flex items-center gap-2 font-bold text-primary mb-4">
                                        <Banknote size={20} />
                                        Prix & Marges
                                    </h3>

                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            {isAdmin && (
                                                <div>
                                                    <label className="block text-sm font-medium mb-2">Prix Achat HT</label>
                                                    <div className="relative">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={formData.purchase_price}
                                                            onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                                                        />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">DH</span>
                                                    </div>
                                                </div>
                                            )}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">TVA (%)</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={formData.tva}
                                                    onChange={(e) => setFormData({ ...formData, tva: e.target.value })}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-bold mb-2">Prix de Vente HT *</label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className="text-lg font-bold border-accent"
                                                    value={formData.sale_price_ht}
                                                    onChange={(e) => setFormData({ ...formData, sale_price_ht: e.target.value })}
                                                    required
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted font-bold">DH</span>
                                            </div>
                                        </div>

                                        {formData.sale_price_ht && (
                                            <div className="text-sm text-right p-2 bg-secondary rounded-lg border border-border">
                                                <span className="text-muted">Prix TTC estimé : </span>
                                                <span className="font-bold text-primary">
                                                    {(parseFloat(formData.sale_price_ht) * (1 + parseFloat(formData.tva) / 100)).toFixed(2)} DH
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end gap-3 pt-6 border-t bg-secondary sticky bottom-0 -mx-6 px-6 pb-2">
                                <button type="button" onClick={closeModal} className="btn-secondary px-6">
                                    Annuler
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary flex items-center gap-2 px-8 text-lg"
                                    disabled={createMutation.isPending || updateMutation.isPending}
                                >
                                    <Save size={20} />
                                    <span>{editingProduct ? 'Enregistrer les modifications' : 'Créer le produit'}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Image View Modal */}
            {viewingImageProduct && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setViewingImageProduct(null)} />
                    <div className="relative bg-secondary rounded-2xl overflow-hidden max-w-lg w-full shadow-2xl animate-fadeScale">
                        <div className="relative aspect-square bg-gray-100">
                            <img
                                src={viewingImageProduct.image_url!}
                                className="w-full h-full object-contain"
                                alt={viewingImageProduct.name}
                            />
                            <button
                                onClick={() => setViewingImageProduct(null)}
                                className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full backdrop-blur-md transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 flex items-center justify-between bg-secondary">
                            <div>
                                <h3 className="font-bold text-lg">{viewingImageProduct.name}</h3>
                                <p className="text-sm text-muted">Aperçu de l'image actuelle</p>
                            </div>
                            <button
                                onClick={() => {
                                    handleListUploadClick(viewingImageProduct.id);
                                    setViewingImageProduct(null);
                                }}
                                className="btn-primary flex items-center gap-2"
                            >
                                <Edit size={18} />
                                <span>Changer la photo</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Hidden Input for List Upload */}
            <input
                ref={listFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleListFileChange}
            />
        </div>
    );
}
