import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import { X, Upload, Save } from 'lucide-react';
import { useToast } from './ToastContext';

interface ProductCreateModalProps {
    onClose: () => void;
    onSuccess: (product: Product) => void;
    initialBarcode?: string;
    initialName?: string;
}

interface Product {
    id: number;
    name: string;
    barcode: string;
    purchase_price: string | number;
}

type ProductFormData = {
    name: string;
    barcode: string;
    description: string;
    purchase_price: number;
    sale_price_ht: number;
    tva: number;
    stock: number;
    min_stock: number;
    category: string;
    supplier: string;
    active: boolean;
};

interface Category {
    id: number;
    name: string;
}

interface Supplier {
    id: number;
    name: string;
}

export default function ProductCreateModal({ onClose, onSuccess, initialBarcode = '', initialName = '' }: ProductCreateModalProps) {
    const toast = useToast();
    const [formData, setFormData] = useState({
        name: initialName,
        barcode: initialBarcode,
        description: '',
        purchase_price: 0,
        sale_price_ht: 0,
        tva: 20,
        stock: 0,
        min_stock: 5,
        category: '', // ID
        supplier: '', // ID
        active: true
    });
    const [image, setImage] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // Fetch Categories
    const { data: categories = [] } = useQuery<Category[]>({
        queryKey: ['categories'],
        queryFn: () => client.get('/inventory/categories/').then(res => res.data.results || res.data)
    });

    // Fetch Suppliers
    const { data: suppliers = [] } = useQuery<Supplier[]>({
        queryKey: ['suppliers'],
        queryFn: () => client.get('/inventory/suppliers/').then(res => res.data.results || res.data)
    });

    // Calculations
    const margin = formData.sale_price_ht - formData.purchase_price;
    const marginPercent = formData.purchase_price > 0
        ? ((margin / formData.purchase_price) * 100).toFixed(1)
        : '0.0';

    const createProduct = useMutation({
        mutationFn: async (data: ProductFormData) => {
            const formDataObj = new FormData();
            Object.entries(data).forEach(([key, value]) => {
                if (value !== undefined && value !== '') {
                    formDataObj.append(key, String(value));
                }
            });
            if (image) {
                formDataObj.append('image', image);
            }
            return client.post('/inventory/products/', formDataObj, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        onSuccess: (res) => {
            toast.success('Produit créé avec succès');
            onSuccess(res.data);
            onClose();
        },
        onError: (err: unknown) => {
            console.error(err);
            const msg = getApiErrorMessage(err, '', 'barcode')
                ? 'Ce code-barres existe déjà'
                : 'Erreur lors de la création';
            toast.error(msg);
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.barcode) {
            toast.error('Nom et Code-barres sont obligatoires');
            return;
        }
        createProduct.mutate(formData);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImage(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fadeIn">
            <div className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-lg font-bold">Nouveau Produit</h2>
                    <button onClick={onClose} className="p-1 hover:bg-tertiary rounded-full">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Image Upload */}
                        <div className="md:col-span-2 flex justify-center mb-4">
                            <div className="relative w-32 h-32 bg-tertiary rounded-lg border-2 border-dashed border-muted flex items-center justify-center overflow-hidden group hover:border-accent transition-colors">
                                {previewUrl ? (
                                    <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="text-center text-muted">
                                        <Upload size={24} className="mx-auto mb-1" />
                                        <span className="text-xs">Photo</span>
                                    </div>
                                )}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageChange}
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                />
                            </div>
                        </div>

                        {/* Basic Info */}
                        <div className="form-group">
                            <label className="label">Nom du produit *</label>
                            <input
                                type="text"
                                className="input w-full"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Code-barres *</label>
                            <input
                                type="text"
                                className="input w-full"
                                value={formData.barcode}
                                onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                                required
                            />
                        </div>

                        {/* Category & Supplier */}
                        <div className="form-group">
                            <label className="label">Catégorie</label>
                            <select
                                className="input w-full"
                                value={formData.category}
                                onChange={e => setFormData({ ...formData, category: e.target.value })}
                            >
                                <option value="">Sélectionner...</option>
                                {categories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="label">Fournisseur</label>
                            <select
                                className="input w-full"
                                value={formData.supplier}
                                onChange={e => setFormData({ ...formData, supplier: e.target.value })}
                            >
                                <option value="">Sélectionner...</option>
                                {suppliers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Pricing */}
                        <div className="form-group">
                            <label className="label">Prix d'achat (DH)</label>
                            <input
                                type="number"
                                step="0.01"
                                className="input w-full"
                                value={formData.purchase_price}
                                onChange={e => setFormData({ ...formData, purchase_price: parseFloat(e.target.value) || 0 })}
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Prix de vente HT (DH)</label>
                            <input
                                type="number"
                                step="0.01"
                                className="input w-full"
                                value={formData.sale_price_ht}
                                onChange={e => setFormData({ ...formData, sale_price_ht: parseFloat(e.target.value) || 0 })}
                            />
                        </div>

                        {/* Margin Display */}
                        <div className="md:col-span-2 bg-tertiary/50 p-3 rounded-lg flex justify-between items-center text-sm">
                            <div>
                                <span className="text-muted">Marge:</span> <span className="font-bold">{margin.toFixed(2)} DH</span>
                            </div>
                            <div>
                                <span className="text-muted">Taux:</span> <span className={`font-bold ${parseFloat(marginPercent) < 20 ? 'text-warning' : 'text-success'}`}>{marginPercent}%</span>
                            </div>
                        </div>

                        {/* Stock Info */}
                        <div className="form-group">
                            <label className="label">Stock Initial</label>
                            <input
                                type="number"
                                className="input w-full"
                                value={formData.stock}
                                onChange={e => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Stock Min.</label>
                            <input
                                type="number"
                                className="input w-full"
                                value={formData.min_stock}
                                onChange={e => setFormData({ ...formData, min_stock: parseInt(e.target.value) || 0 })}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-border mt-4">
                        <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
                        <button type="submit" disabled={createProduct.isPending} className="btn-primary flex items-center gap-2">
                            <Save size={18} />
                            {createProduct.isPending ? 'Création...' : 'Créer Produit'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
