import React, { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import { X, Upload, Save } from 'lucide-react';
import { useToast } from './ToastContext';
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';
import { useTranslation } from 'react-i18next';
import useCurrency from '../hooks/useCurrency';

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
    purchase_price: string;
    sale_price_ht: string;
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
    const { t } = useTranslation();
    const currency = useCurrency();
    const toast = useToast();
    const dialogRef = useRef<HTMLDivElement>(null);
    const formId = useId();
    const [formData, setFormData] = useState({
        name: initialName,
        barcode: initialBarcode,
        description: '',
        purchase_price: '',
        sale_price_ht: '',
        stock: 0,
        min_stock: 5,
        category: '', // ID
        supplier: '', // ID
        active: true
    });
    const [image, setImage] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // Fetch Categories
    const { data: categories = [], isLoading: categoriesLoading, isError: categoriesError } = useQuery<Category[]>({
        queryKey: ['categories'],
        queryFn: () => client.get('/inventory/categories/').then(res => res.data.results || res.data)
    });

    // Fetch Suppliers
    const { data: suppliers = [], isLoading: suppliersLoading, isError: suppliersError } = useQuery<Supplier[]>({
        queryKey: ['suppliers'],
        queryFn: () => client.get('/inventory/suppliers/').then(res => res.data.results || res.data)
    });

    // Calculations
    const purchasePrice = parseDecimalInput(formData.purchase_price) || 0;
    const salePrice = parseDecimalInput(formData.sale_price_ht) || 0;
    const margin = salePrice - purchasePrice;
    const marginPercent = purchasePrice > 0
        ? ((margin / purchasePrice) * 100).toFixed(1)
        : '0.0';

    useEffect(() => {
        dialogRef.current?.focus();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    useEffect(() => () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);

    const createProduct = useMutation({
        mutationFn: async (data: ProductFormData) => {
            const formDataObj = new FormData();
            Object.entries(data).forEach(([key, value]) => {
                if (value !== undefined && value !== '') {
                    const normalizedValue = key === 'purchase_price' || key === 'sale_price_ht'
                        ? normalizeDecimalInput(String(value))
                        : String(value);
                    formDataObj.append(key, normalizedValue);
                }
            });
            formDataObj.append('tva', '0');
            if (image) {
                formDataObj.append('image', image);
            }
            return client.post('/inventory/products/', formDataObj, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        onSuccess: (res) => {
            toast.success(t('ProductCreated'));
            onSuccess(res.data);
            onClose();
        },
        onError: (err: unknown) => {
            const msg = getApiErrorMessage(err, '', 'barcode')
                ? t('DuplicateBarcode')
                : t('CreationFailed');
            toast.error(msg);
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.barcode) {
            toast.error(t('NameBarcodeRequired'));
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fadeIn" role="presentation">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                data-modal-native-escape="true"
                aria-labelledby={`${formId}-title`}
                tabIndex={-1}
                className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 id={`${formId}-title`} className="text-lg font-bold">{t('NewProduct')}</h2>
                    <button type="button" onClick={onClose} className="p-1 hover:bg-tertiary rounded-full" aria-label={t('CloseWindow')}>
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Image Upload */}
                        <div className="md:col-span-2 flex justify-center mb-4">
                            <div className="relative w-32 h-32 bg-tertiary rounded-lg border-2 border-dashed border-muted flex items-center justify-center overflow-hidden group hover:border-accent transition-colors">
                                {previewUrl ? (
                                    <img src={previewUrl} alt={t('ProductPreview')} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="text-center text-muted">
                                        <Upload size={24} className="mx-auto mb-1" />
                                        <span className="text-xs">{t('Photo')}</span>
                                    </div>
                                )}
                                <input
                                    id={`${formId}-image`}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageChange}
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    aria-label={t('ChooseProductPhoto')}
                                />
                            </div>
                        </div>

                        {/* Basic Info */}
                        <div className="form-group">
                            <label className="label" htmlFor={`${formId}-name`}>{t('ProductName')} *</label>
                            <input
                                id={`${formId}-name`}
                                type="text"
                                className="input w-full"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="label" htmlFor={`${formId}-barcode`}>{t('Barcode')} *</label>
                            <input
                                id={`${formId}-barcode`}
                                type="text"
                                className="input w-full"
                                value={formData.barcode}
                                onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                                required
                            />
                        </div>

                        <div className="form-group md:col-span-2">
                            <label className="label" htmlFor={`${formId}-description`}>{t('Description')}</label>
                            <textarea
                                id={`${formId}-description`}
                                className="input w-full"
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                rows={3}
                            />
                        </div>

                        {/* Category & Supplier */}
                        <div className="form-group">
                            <label className="label" htmlFor={`${formId}-category`}>{t('Category')}</label>
                            <select
                                id={`${formId}-category`}
                                className="input w-full"
                                value={formData.category}
                                onChange={e => setFormData({ ...formData, category: e.target.value })}
                            >
                                <option value="">{categoriesLoading ? t('Loading') : categoriesError ? t('CategoriesUnavailable') : t('SelectOption')}</option>
                                {categories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="label" htmlFor={`${formId}-supplier`}>{t('Supplier')}</label>
                            <select
                                id={`${formId}-supplier`}
                                className="input w-full"
                                value={formData.supplier}
                                onChange={e => setFormData({ ...formData, supplier: e.target.value })}
                            >
                                <option value="">{suppliersLoading ? t('Loading') : suppliersError ? t('SuppliersUnavailable') : t('SelectOption')}</option>
                                {suppliers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Pricing */}
                        <div className="form-group">
                            <label className="label" htmlFor={`${formId}-purchase-price`}>{t('PurchasePriceCurrency', { symbol: currency.symbol })}</label>
                            <input
                                id={`${formId}-purchase-price`}
                                type="text"
                                inputMode="decimal"
                                step="0.01"
                                className="input w-full"
                                value={formData.purchase_price}
                                onChange={e => setFormData({ ...formData, purchase_price: normalizeDecimalInput(e.target.value) })}
                            />
                        </div>

                        <div className="form-group">
                            <label className="label" htmlFor={`${formId}-sale-price`}>{t('SalePriceCurrency', { symbol: currency.symbol })}</label>
                            <input
                                id={`${formId}-sale-price`}
                                type="text"
                                inputMode="decimal"
                                step="0.01"
                                className="input w-full"
                                value={formData.sale_price_ht}
                                onChange={e => setFormData({ ...formData, sale_price_ht: normalizeDecimalInput(e.target.value) })}
                            />
                        </div>

                        {/* Margin Display */}
                        <div className="md:col-span-2 bg-tertiary/50 p-3 rounded-lg flex justify-between items-center text-sm">
                            <div>
                                <span className="text-muted">{t('Margin')}:</span> <span className="font-bold">{currency.format(margin)}</span>
                            </div>
                            <div>
                                <span className="text-muted">{t('Rate')}:</span> <span className={`font-bold ${parseFloat(marginPercent) < 20 ? 'text-warning' : 'text-success'}`}>{marginPercent}%</span>
                            </div>
                        </div>

                        {/* Stock Info */}
                        <div className="form-group">
                            <label className="label" htmlFor={`${formId}-stock`}>{t('InitialStock')}</label>
                            <input
                                id={`${formId}-stock`}
                                type="number"
                                min="0"
                                className="input w-full"
                                value={formData.stock}
                                onChange={e => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                            />
                        </div>

                        <div className="form-group">
                            <label className="label" htmlFor={`${formId}-min-stock`}>{t('MinStock')}</label>
                            <input
                                id={`${formId}-min-stock`}
                                type="number"
                                min="0"
                                className="input w-full"
                                value={formData.min_stock}
                                onChange={e => setFormData({ ...formData, min_stock: parseInt(e.target.value) || 0 })}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-border mt-4">
                        <button type="button" onClick={onClose} className="btn-secondary">{t('Cancel')}</button>
                        <button type="submit" disabled={createProduct.isPending} className="btn-primary flex items-center gap-2">
                            <Save size={18} />
                            {createProduct.isPending ? t('Creating') : t('CreateProductAction')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
