import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import { useTranslation } from 'react-i18next';
import Pagination from '../components/Pagination';
import ConfirmDialog from '../components/ConfirmDialog';
import {
    Truck,
    Plus,
    Edit,
    Trash2,
    X,
    Save,
    Search,
    Mail,
    Phone,
    MapPin,
    Package,
    Image as ImageIcon
} from 'lucide-react';

interface Supplier {
    id: number;
    name: string;
    contact_name: string;
    email: string;
    phone: string;
    address: string;
    notes: string;
    active: boolean;
    products_count: number;
    image_url: string | null;
}

interface SuppliersPage {
    count: number;
    results: Supplier[];
}

const PAGE_SIZE = 50;

export default function Suppliers() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [supplierToDeactivate, setSupplierToDeactivate] = useState<Supplier | null>(null);
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // États pour le "Smart Image Click" (Upload direct ou Visualisation)
    const [targetSupplierId, setTargetSupplierId] = useState<number | null>(null);
    const [viewingImageSupplier, setViewingImageSupplier] = useState<Supplier | null>(null);
    const listFileInputRef = useRef<HTMLInputElement>(null);

    const [formData, setFormData] = useState({
        name: '',
        contact_name: '',
        email: '',
        phone: '',
        address: '',
        notes: '',
        active: true
    });

    const { data: suppliersData, isLoading, isError, refetch } = useQuery<SuppliersPage>({
        queryKey: ['suppliers', search, page],
        queryFn: () => client.get('/inventory/suppliers/', { params: { search: search.trim() || undefined, page } }).then(res => ({
            count: Number(res.data?.count ?? (Array.isArray(res.data) ? res.data.length : 0)),
            results: res.data?.results ?? (Array.isArray(res.data) ? res.data : []),
        })),
        placeholderData: previous => previous,
    });

    const suppliers = suppliersData?.results ?? [];
    const totalItems = suppliersData?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    const buildFormData = (data: typeof formData, image: File | null) => {
        const payload = new FormData();
        payload.append('name', data.name);
        payload.append('contact_name', data.contact_name);
        payload.append('email', data.email);
        payload.append('phone', data.phone);
        payload.append('address', data.address);
        payload.append('notes', data.notes);
        payload.append('active', data.active ? 'true' : 'false');

        if (image) {
            payload.append('image', image);
        }
        return payload;
    };

    const createMutation = useMutation({
        mutationFn: (payload: FormData) => client.post('/inventory/suppliers/', payload, {
            headers: { 'Content-Type': 'multipart/form-data' }
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            closeModal();
        },
        onError: (error: unknown) => {
            toast.error(t('SupplierCreateError', { message: getApiErrorMessage(error) }));
        }
    });

    const updateMutation = useMutation({
        mutationFn: (data: { id: number; payload: FormData }) =>
            client.patch(`/inventory/suppliers/${data.id}/`, data.payload, {
                headers: { 'Content-Type': 'multipart/form-data' }
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            closeModal();
        },
        onError: (error: unknown) => {
            toast.error(t('SupplierUpdateError', { message: getApiErrorMessage(error) }));
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => client.delete(`/inventory/suppliers/${id}/`),
        onSuccess: () => {
            setSupplierToDeactivate(null);
            toast.success(t('SupplierDisabled'));
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
        },
        onError: () => toast.error(t('SupplierDisableFailed')),
    });

    const openCreateModal = () => {
        setEditingSupplier(null);
        setSelectedImage(null);
        setImagePreview(null);
        setFormData({
            name: '',
            contact_name: '',
            email: '',
            phone: '',
            address: '',
            notes: '',
            active: true
        });
        setShowModal(true);
    };

    const openEditModal = (supplier: Supplier) => {
        setEditingSupplier(supplier);
        setSelectedImage(null);
        setImagePreview(supplier.image_url);
        setFormData({
            name: supplier.name,
            contact_name: supplier.contact_name || '',
            email: supplier.email || '',
            phone: supplier.phone || '',
            address: supplier.address || '',
            notes: supplier.notes || '',
            active: supplier.active
        });
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setEditingSupplier(null);
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

    // Gestion Upload Direct depuis la liste
    const handleListUploadClick = (supplierId: number) => {
        setTargetSupplierId(supplierId);
        listFileInputRef.current?.click();
    };

    const handleListFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0] && targetSupplierId) {
            const file = e.target.files[0];
            const payload = new FormData();
            payload.append('image', file);

            updateMutation.mutate({ id: targetSupplierId, payload });

            e.target.value = '';
            setTargetSupplierId(null);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const payload = buildFormData(formData, selectedImage);

        if (editingSupplier) {
            updateMutation.mutate({ id: editingSupplier.id, payload });
        } else {
            createMutation.mutate(payload);
        }
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">{t('Suppliers')}</h1>
                    <p className="text-muted text-sm mt-1">{t('Suppliers')}</p>
                </div>
                <button type="button" onClick={openCreateModal} className="btn-primary flex items-center gap-2">
                    <Plus size={20} />
                    <span>{t('AddSupplier')}</span>
                </button>
            </div>

            {/* Search */}
            <div className="card p-4">
                <div className="relative max-w-md">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
                    <input
                        type="text"
                        placeholder={t('SearchSuppliers')}
                        style={{ paddingLeft: '3rem' }}
                        value={search}
                        aria-label={t('SearchSuppliers')}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    />
                </div>
            </div>

            {/* Suppliers Table */}
            <div className="card overflow-hidden">
                <div className="suppliers-mobile-list" aria-live="polite">
                    {isLoading ? (
                        <div className="p-6 text-center text-muted" role="status">{t('Loading')}</div>
                    ) : isError ? (
                        <div className="network-error-state m-3" role="alert">
                            <p>{t('SuppliersLoadFailed')}</p>
                            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>{t('Retry')}</button>
                        </div>
                    ) : suppliers.length === 0 ? (
                        <div className="p-6 text-center text-muted">{t('NoSuppliers')}</div>
                    ) : suppliers.map((supplier) => (
                        <article key={supplier.id} className="mobile-data-card">
                            <div className="flex items-start gap-3">
                                <button
                                    type="button"
                                    onClick={() => supplier.image_url ? setViewingImageSupplier(supplier) : handleListUploadClick(supplier.id)}
                                    className="w-12 h-12 bg-accent-light/20 rounded-xl flex items-center justify-center text-accent overflow-hidden shrink-0 border border-border"
                                    aria-label={t(supplier.image_url ? 'ViewSupplierLogo' : 'AddSupplierLogo', { name: supplier.name })}
                                >
                                    {supplier.image_url
                                        ? <img src={supplier.image_url} className="w-full h-full object-cover" alt="" />
                                        : <Truck size={23} aria-hidden="true" />}
                                </button>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-2">
                                        <h2 className="font-bold text-primary break-words">{supplier.name}</h2>
                                        <span className={`badge shrink-0 ${supplier.active ? 'badge-success' : 'badge-warning'}`}>
                                            {supplier.active ? t('Active') : t('Inactive')}
                                        </span>
                                    </div>
                                    {supplier.contact_name && <p className="text-sm text-muted mt-1">{supplier.contact_name}</p>}
                                </div>
                            </div>
                            <div className="grid gap-2 text-sm">
                                {supplier.email && <a className="mobile-data-line" href={`mailto:${supplier.email}`}><Mail size={15} /> <span>{supplier.email}</span></a>}
                                {supplier.phone && <a className="mobile-data-line" href={`tel:${supplier.phone}`}><Phone size={15} /> <span>{supplier.phone}</span></a>}
                                {supplier.address && <p className="mobile-data-line"><MapPin size={15} /> <span>{supplier.address}</span></p>}
                                <p className="mobile-data-line"><Package size={15} /> <span>{supplier.products_count} {t('Products')}</span></p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <button type="button" className="btn-secondary" onClick={() => openEditModal(supplier)}>
                                    <Edit size={17} /> {t('Edit')}
                                </button>
                                <button type="button" className="btn-outline text-danger" onClick={() => setSupplierToDeactivate(supplier)}>
                                    <Trash2 size={17} /> {t('Delete')}
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
                <div className="suppliers-desktop-table overflow-x-auto">
                    <table>
                        <caption className="sr-only">{t('SuppliersCaption')}</caption>
                        <thead>
                            <tr>
                                <th scope="col">{t('Supplier')}</th>
                                <th scope="col">{t('ContactName')}</th>
                                <th scope="col">{t('Details')}</th>
                                <th scope="col">{t('Address')}</th>
                                <th scope="col" className="text-center">{t('ProductsCount')}</th>
                                <th scope="col" className="text-center">{t('Active')}</th>
                                <th scope="col">{t('Actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan={7} className="text-center py-12 text-muted" role="status">{t('Loading')}</td></tr>
                            ) : isError ? (
                                <tr><td colSpan={7} className="text-center py-8"><div className="network-error-state" role="alert"><p>{t('SuppliersLoadFailed')}</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>{t('Retry')}</button></div></td></tr>
                            ) : suppliers.map((supplier) => (
                                <tr key={supplier.id} className="group hover:bg-muted/10">
                                    <td>
                                        <div className="flex items-center gap-3">
                                            {/* Smart Image Container */}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (supplier.image_url) {
                                                        setViewingImageSupplier(supplier);
                                                    } else {
                                                        handleListUploadClick(supplier.id);
                                                    }
                                                }}
                                                className="w-12 h-12 bg-accent-light/20 rounded-lg flex items-center justify-center text-accent overflow-hidden shrink-0 border border-border hover:ring-2 hover:ring-accent transition-all relative group/img"
                                                title={supplier.image_url ? t('ViewLogo') : t('AddLogo')}
                                                aria-label={t(supplier.image_url ? 'ViewSupplierLogo' : 'AddSupplierLogo', { name: supplier.name })}
                                            >
                                                {supplier.image_url ? (
                                                    <>
                                                        <img src={supplier.image_url} className="w-full h-full object-cover" alt={supplier.name} />
                                                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 flex items-center justify-center transition-opacity">
                                                            <Edit size={16} className="text-white" />
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Truck size={24} className="group-hover/img:hidden" />
                                                        <Plus size={24} className="hidden group-hover/img:block" />
                                                    </>
                                                )}
                                            </button>

                                            <div>
                                                <p className="font-bold text-primary">{supplier.name}</p>
                                                {supplier.notes && (
                                                    <p className="text-xs text-muted max-w-[200px] truncate" title={supplier.notes}>
                                                        {supplier.notes}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        {supplier.contact_name ? (
                                            <span className="font-medium">{supplier.contact_name}</span>
                                        ) : (
                                            <span className="text-muted text-sm italic">-</span>
                                        )}
                                    </td>
                                    <td>
                                        <div className="space-y-1 text-sm">
                                            {supplier.email && (
                                                <div className="flex items-center gap-2 text-muted select-all">
                                                    <Mail size={14} />
                                                    <span>{supplier.email}</span>
                                                </div>
                                            )}
                                            {supplier.phone && (
                                                <div className="flex items-center gap-2 text-muted">
                                                    <Phone size={14} />
                                                    <span className="font-mono">{supplier.phone}</span>
                                                </div>
                                            )}
                                            {!supplier.email && !supplier.phone && <span className="text-muted">-</span>}
                                        </div>
                                    </td>
                                    <td className="max-w-xs">
                                        {supplier.address ? (
                                            <div className="flex items-start gap-2 text-sm text-muted">
                                                <MapPin size={14} className="mt-1 shrink-0" />
                                                <span className="truncate">{supplier.address}</span>
                                            </div>
                                        ) : (
                                            <span className="text-muted text-sm italic">-</span>
                                        )}
                                    </td>
                                    <td className="text-center">
                                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-tertiary/50 border border-tertiary text-sm font-medium">
                                            <Package size={14} className="text-primary" />
                                            {supplier.products_count}
                                        </div>
                                    </td>
                                    <td className="text-center">
                                        <span className={`badge ${supplier.active ? 'badge-success' : 'badge-warning'}`}>
                                            {supplier.active ? t('Active') : t('Inactive')}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => openEditModal(supplier)}
                                                className="btn-ghost p-2 text-accent hover:bg-accent-light"
                                                title={t('EditSupplier')}
                                                aria-label={t('EditSupplierNamed', { name: supplier.name })}
                                            >
                                                <Edit size={18} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSupplierToDeactivate(supplier)}
                                                className="btn-ghost p-2 text-danger hover:bg-danger-light"
                                                title={t('Disable')}
                                                aria-label={t('DisableSupplierNamed', { name: supplier.name })}
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {!isLoading && !isError && suppliers.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="text-center py-12">
                                        <div className="flex flex-col items-center justify-center text-muted">
                                            <Truck size={48} className="mb-4 opacity-20" />
                                            <p className="text-lg font-medium">{t('NoSuppliers')}</p>
                                            <p className="text-sm">{search ? t('TryAnotherSearch') : t('StartWithFirstSupplier')}</p>
                                            {!search && <button type="button" onClick={openCreateModal} className="btn-outline mt-4 btn-sm">
                                                {t('AddNow')}
                                            </button>}
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {!isLoading && !isError && (
                    <Pagination currentPage={page} totalPages={totalPages} totalItems={totalItems} pageSize={PAGE_SIZE} onPageChange={setPage} />
                )}
            </div>

            {/* Modal de création / modification */}
            {showModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} aria-hidden="true" />
                    <div className="relative card w-full max-w-4xl animate-fadeScale p-0 overflow-hidden shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="supplier-modal-title">
                        <div className="p-6 border-b flex items-center justify-between bg-secondary z-10">
                            <div>
                                <h2 id="supplier-modal-title" className="text-xl font-bold text-primary">
                                    {editingSupplier ? t('EditSupplier') : t('NewSupplier')}
                                </h2>
                                <p className="text-sm text-muted">
                                    {editingSupplier ? t('UpdatePartnerInfo') : t('AddBusinessPartner')}
                                </p>
                            </div>
                            <button type="button" onClick={closeModal} className="btn-ghost p-2 -mr-2 text-muted hover:text-danger transition-colors" aria-label={t('CloseWindow')}>
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">

                            <div className="flex flex-col md:flex-row gap-8">
                                {/* Image Upload */}
                                <div className="w-full md:w-1/4 flex flex-col items-center">
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-40 h-40 bg-tertiary rounded-2xl border-2 border-dashed border-border hover:border-accent hover:bg-accent-light/10 transition-colors flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group shrink-0"
                                    >
                                        {imagePreview ? (
                                            <>
                                                <img src={imagePreview} className="w-full h-full object-cover" alt={t('LogoPreview')} />
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <span className="text-white font-medium flex items-center gap-2">
                                                        <Edit size={20} />
                                                        {t('Edit')}
                                                    </span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-center text-muted p-4">
                                                <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                                                    <ImageIcon size={32} />
                                                </div>
                                                <p className="font-medium">{t('LogoOrPhoto')}</p>
                                                <p className="text-xs mt-1">{t('ClickToUpload')}</p>
                                            </div>
                                        )}
                                    </button>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleImageChange}
                                            aria-label={t('ChooseSupplierLogo')}
                                        />
                                    <p className="text-xs text-muted text-center mt-2">
                                        {t('ImageFormatHint')}
                                    </p>
                                </div>

                                {/* Form Fields */}
                                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 content-start">
                                    <div className="col-span-1 md:col-span-2">
                                        <label htmlFor="supplier-name" className="block text-sm font-bold mb-2">{t('CompanyName')} *</label>
                                        <div className="relative">
                                            <Truck className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                            <input
                                                id="supplier-name"
                                                type="text"
                                                className="input-lg pl-12 font-bold"
                                                placeholder={t('CompanyNameExample')}
                                                value={formData.name}
                                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="supplier-contact" className="block text-sm font-medium mb-2">{t('ContactPerson')}</label>
                                        <div className="relative">
                                            <input
                                                id="supplier-contact"
                                                type="text"
                                                placeholder={t('ContactName')}
                                                value={formData.contact_name}
                                                onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="supplier-status" className="block text-sm font-medium mb-2">{t('Status')}</label>
                                        <select
                                            id="supplier-status"
                                            value={formData.active ? 'true' : 'false'}
                                            onChange={(e) => setFormData({ ...formData, active: e.target.value === 'true' })}
                                            className="w-full p-2.5 bg-secondary border border-border rounded-lg"
                                        >
                                            <option value="true">{t('Active')}</option>
                                            <option value="false">{t('Inactive')}</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label htmlFor="supplier-email" className="block text-sm font-medium mb-2">{t('Email')}</label>
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                            <input
                                                id="supplier-email"
                                                type="email"
                                                className="pl-12"
                                                placeholder="contact@entreprise.com"
                                                value={formData.email}
                                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="supplier-phone" className="block text-sm font-medium mb-2">{t('Phone')}</label>
                                        <div className="relative">
                                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                            <input
                                                id="supplier-phone"
                                                type="tel"
                                                className="pl-12 font-mono"
                                                placeholder="06..."
                                                value={formData.phone}
                                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="col-span-1 md:col-span-2">
                                        <label htmlFor="supplier-address" className="block text-sm font-medium mb-2">{t('Address')}</label>
                                        <div className="relative">
                                            <MapPin className="absolute left-3 top-3 text-muted" size={18} />
                                            <textarea
                                                id="supplier-address"
                                                rows={2}
                                                className="pl-12 resize-none"
                                                placeholder={t('FullAddressPlaceholder')}
                                                value={formData.address}
                                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="col-span-1 md:col-span-2">
                                        <label htmlFor="supplier-notes" className="block text-sm font-medium mb-2">{t('InternalNotes')}</label>
                                        <textarea
                                            id="supplier-notes"
                                            rows={3}
                                            className="resize-none"
                                            placeholder={t('SupplierNotesPlaceholder')}
                                            value={formData.notes}
                                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-6 border-t">
                                <button type="button" onClick={closeModal} className="btn-secondary px-6">
                                    {t('Cancel')}
                                </button>
                                <button type="submit" className="btn-primary flex items-center gap-2 px-8" disabled={createMutation.isPending || updateMutation.isPending}>
                                    <Save size={20} />
                                    <span>{editingSupplier ? t('Save') : t('CreateSupplier')}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Image View Modal (Comme dans l'inventaire) */}
            {viewingImageSupplier && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="presentation">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setViewingImageSupplier(null)} aria-hidden="true" />
                    <div className="relative bg-secondary rounded-2xl overflow-hidden max-w-lg w-full shadow-2xl animate-fadeScale" role="dialog" aria-modal="true" aria-labelledby="supplier-image-title">
                        <div className="relative aspect-square bg-tertiary flex items-center justify-center p-4">
                            <img
                                src={viewingImageSupplier.image_url!}
                                className="w-full h-full object-contain"
                                alt={viewingImageSupplier.name}
                            />
                            <button
                                type="button"
                                onClick={() => setViewingImageSupplier(null)}
                                className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full backdrop-blur-md transition-colors"
                                aria-label={t('ClosePreview')}
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 flex items-center justify-between bg-secondary border-t border-border">
                            <div>
                                <h3 id="supplier-image-title" className="font-bold text-lg text-primary">{viewingImageSupplier.name}</h3>
                                <p className="text-sm text-muted">{t('CurrentLogoPreview')}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    handleListUploadClick(viewingImageSupplier.id);
                                    setViewingImageSupplier(null);
                                }}
                                className="btn-primary flex items-center gap-2"
                            >
                                <Edit size={18} />
                                <span>{t('ChangeLogo')}</span>
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

            <ConfirmDialog
                open={Boolean(supplierToDeactivate)}
                title={t('DisableSupplierTitle')}
                description={supplierToDeactivate
                    ? t('DisableSupplierDescription', { name: supplierToDeactivate.name })
                    : ''}
                confirmLabel={t('Disable')}
                busy={deleteMutation.isPending}
                onCancel={() => setSupplierToDeactivate(null)}
                onConfirm={() => {
                    if (supplierToDeactivate) deleteMutation.mutate(supplierToDeactivate.id);
                }}
            />
        </div>
    );
}
