import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Printer, Save, Search, Trash2 } from 'lucide-react';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import { printInvoice, type InvoiceLine } from '../utils/invoicePrintService';

interface AppSettings {
    store_name: string;
    store_address?: string;
    store_phone?: string;
    store_email?: string;
    logo_url?: string | null;
    company_name?: string;
    company_rc?: string;
    company_ice?: string;
    company_if?: string;
    company_patente?: string;
    company_cnss?: string;
    invoice_prefix?: string;
    invoice_footer?: string;
}

interface Product {
    id: number;
    name: string;
    barcode: string;
    sale_price_ht: number;
    price_ttc: number;
    tva: number;
}

interface SaleItem {
    id: number;
    product_id?: number;
    product_name: string;
    quantity: number;
    unit_price_ht: number;
    tva_rate: number;
}

interface Sale {
    id: number;
    items: SaleItem[];
    total_ttc: number;
    created_at: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => `${value.toFixed(2)} DH`;

export default function Invoices() {
    const toast = useToast();
    const queryClient = useQueryClient();
    const [customer, setCustomer] = useState({
        name: '',
        address: '',
        ice: '',
        phone: '',
    });
    const [invoiceMeta, setInvoiceMeta] = useState({
        date: today(),
        dueDate: '',
        notes: '',
    });
    const [invoiceSerial] = useState(() => String(Date.now()).slice(-5));
    const [lines, setLines] = useState<InvoiceLine[]>([
        { description: '', quantity: 1, unitPrice: 0, tvaRate: 20 },
    ]);
    const [settingsDraft, setSettingsDraft] = useState<Partial<AppSettings>>({});
    const [productSearch, setProductSearch] = useState('');
    const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);

    const { data: settings } = useQuery<AppSettings>({
        queryKey: ['appSettings'],
        queryFn: () => client.get('/auth/settings/').then(res => res.data),
    });

    const { data: productSuggestions = [] } = useQuery<Product[]>({
        queryKey: ['invoice-products', productSearch],
        queryFn: () => client
            .get(`/inventory/products/?search=${encodeURIComponent(productSearch)}`)
            .then(res => res.data.results || res.data),
        enabled: productSearch.trim().length >= 2,
    });

    const { data: recentSales = [] } = useQuery<Sale[]>({
        queryKey: ['invoice-recent-sales'],
        queryFn: () => client.get('/sales/sales/').then(res => res.data.results || res.data),
    });

    const companyForm = Object.keys(settingsDraft).length ? settingsDraft : (settings ?? {});
    const invoiceNumber = `${companyForm.invoice_prefix || 'FAC'}-${new Date(invoiceMeta.date).getFullYear()}-${invoiceSerial}`;
    const total = useMemo(() => lines.reduce((sum, line) => (
        sum + (
            (Number(line.quantity) || 0)
            * (Number(line.unitPrice) || 0)
            * (1 + ((Number(line.tvaRate) || 0) / 100))
        )
    ), 0), [lines]);

    const saveSettings = useMutation({
        mutationFn: (payload: Partial<AppSettings>) => client.patch('/auth/settings/', payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['appSettings'] });
            toast.success('Informations facture enregistrées');
        },
        onError: (error: unknown) => toast.error(getApiErrorMessage(error, 'Erreur sauvegarde')),
    });

    const updateLine = (index: number, patch: Partial<InvoiceLine>) => {
        setLines(current => current.map((line, i) => (
            i === index ? { ...line, ...patch } : line
        )));
    };

    const removeLine = (index: number) => {
        setLines(current => current.length === 1 ? current : current.filter((_, i) => i !== index));
    };

    const selectProductForLine = (index: number, product: Product) => {
        updateLine(index, {
            description: `${product.name} (${product.barcode})`,
            unitPrice: Number(product.sale_price_ht) || 0,
            tvaRate: Number(product.tva) || 0,
        });
        setProductSearch('');
        setActiveLineIndex(null);
    };

    const loadSale = (sale: Sale) => {
        setLines(sale.items.map(item => ({
            description: item.product_name,
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unit_price_ht) || 0,
            tvaRate: Number(item.tva_rate) || 0,
        })));
        toast.success(`Vente #${sale.id} chargée sans modifier le stock`);
    };

    const handlePrint = () => {
        const cleanLines = lines.filter(line => line.description.trim() && Number(line.quantity) > 0);
        if (!customer.name.trim()) {
            toast.error('Nom du client requis');
            return;
        }
        if (cleanLines.length === 0) {
            toast.error('Ajoute au moins une ligne de facture');
            return;
        }

        printInvoice({
            invoiceNumber,
            invoiceDate: invoiceMeta.date,
            dueDate: invoiceMeta.dueDate,
            customerName: customer.name,
            customerAddress: customer.address,
            customerIce: customer.ice,
            customerPhone: customer.phone,
            notes: invoiceMeta.notes,
            lines: cleanLines,
            company: {
                name: companyForm.company_name || companyForm.store_name || 'Librairie Attaquaddoum',
                address: companyForm.store_address,
                phone: companyForm.store_phone,
                email: companyForm.store_email,
                rc: companyForm.company_rc,
                ice: companyForm.company_ice,
                taxId: companyForm.company_if,
                patente: companyForm.company_patente,
                cnss: companyForm.company_cnss,
                logoUrl: companyForm.logo_url,
                footer: companyForm.invoice_footer,
            },
        });
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <FileText size={26} /> Factures
                </h1>
                <button className="btn-primary flex items-center gap-2" onClick={handlePrint}>
                    <Printer size={18} /> Imprimer
                </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="card p-6 xl:col-span-2 space-y-5">
                    <div className="flex items-center justify-between">
                        <h2 className="font-semibold text-lg">Nouvelle facture</h2>
                        <span className="badge badge-accent">{invoiceNumber}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-2">Date</label>
                            <input
                                type="date"
                                value={invoiceMeta.date}
                                onChange={(e) => setInvoiceMeta({ ...invoiceMeta, date: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">Échéance</label>
                            <input
                                type="date"
                                value={invoiceMeta.dueDate}
                                onChange={(e) => setInvoiceMeta({ ...invoiceMeta, dueDate: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">Total</label>
                            <div className="input-like font-bold text-xl">{money(total)}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                            type="text"
                            placeholder="Nom du client"
                            value={customer.name}
                            onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                        />
                        <input
                            type="text"
                            placeholder="ICE client"
                            value={customer.ice}
                            onChange={(e) => setCustomer({ ...customer, ice: e.target.value })}
                        />
                        <input
                            type="text"
                            placeholder="Téléphone client"
                            value={customer.phone}
                            onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                        />
                        <input
                            type="text"
                            placeholder="Adresse client"
                            value={customer.address}
                            onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
                        />
                    </div>

                    <div className="space-y-3">
                        <div className="grid grid-cols-[1fr_90px_130px_90px_44px] gap-2 text-sm font-semibold text-muted px-1">
                            <span>Description</span>
                            <span>Qté</span>
                            <span>Prix HT</span>
                            <span>TVA</span>
                            <span></span>
                        </div>
                        {lines.map((line, index) => (
                            <div key={index} className="grid grid-cols-[1fr_90px_130px_90px_44px] gap-2">
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Article, prestation ou code-barres"
                                        value={line.description}
                                        onFocus={() => {
                                            setActiveLineIndex(index);
                                            setProductSearch(line.description);
                                        }}
                                        onChange={(e) => {
                                            updateLine(index, { description: e.target.value });
                                            setActiveLineIndex(index);
                                            setProductSearch(e.target.value);
                                        }}
                                    />
                                    {activeLineIndex === index && productSuggestions.length > 0 && (
                                        <div className="absolute left-0 right-0 top-full mt-1 bg-secondary border rounded-lg shadow-xl z-50 max-h-56 overflow-auto">
                                            {productSuggestions.slice(0, 8).map(product => (
                                                <button
                                                    key={product.id}
                                                    type="button"
                                                    className="w-full text-left px-3 py-2 hover:bg-tertiary flex items-center justify-between gap-3"
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        selectProductForLine(index, product);
                                                    }}
                                                >
                                                    <span>
                                                        <span className="font-medium">{product.name}</span>
                                                        <span className="block text-xs text-muted">{product.barcode}</span>
                                                    </span>
                                                    <span className="text-sm font-semibold">{Number(product.sale_price_ht).toFixed(2)} DH HT</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={line.quantity}
                                    onChange={(e) => updateLine(index, { quantity: Number(e.target.value) })}
                                />
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={line.unitPrice}
                                    onChange={(e) => updateLine(index, { unitPrice: Number(e.target.value) })}
                                />
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={line.tvaRate}
                                    onChange={(e) => updateLine(index, { tvaRate: Number(e.target.value) })}
                                />
                                <button
                                    type="button"
                                    className="btn-ghost btn-icon text-red-500"
                                    onClick={() => removeLine(index)}
                                    title="Supprimer"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            className="btn-secondary flex items-center gap-2"
                            onClick={() => setLines([...lines, { description: '', quantity: 1, unitPrice: 0, tvaRate: 20 }])}
                        >
                            <Plus size={18} /> Ajouter une ligne
                        </button>
                    </div>

                    <textarea
                        rows={3}
                        placeholder="Notes visibles sur la facture"
                        value={invoiceMeta.notes}
                        onChange={(e) => setInvoiceMeta({ ...invoiceMeta, notes: e.target.value })}
                    />
                </div>

                <div className="card p-6 space-y-4">
                    <h2 className="font-semibold text-lg">Infos société</h2>
                    <input
                        type="text"
                        placeholder="Nom de la société"
                        value={companyForm.company_name || ''}
                        onChange={(e) => setSettingsDraft({ ...companyForm, company_name: e.target.value })}
                    />
                    <input
                        type="text"
                        placeholder="RC"
                        value={companyForm.company_rc || ''}
                        onChange={(e) => setSettingsDraft({ ...companyForm, company_rc: e.target.value })}
                    />
                    <input
                        type="text"
                        placeholder="ICE"
                        value={companyForm.company_ice || ''}
                        onChange={(e) => setSettingsDraft({ ...companyForm, company_ice: e.target.value })}
                    />
                    <input
                        type="text"
                        placeholder="IF"
                        value={companyForm.company_if || ''}
                        onChange={(e) => setSettingsDraft({ ...companyForm, company_if: e.target.value })}
                    />
                    <input
                        type="text"
                        placeholder="Patente"
                        value={companyForm.company_patente || ''}
                        onChange={(e) => setSettingsDraft({ ...companyForm, company_patente: e.target.value })}
                    />
                    <input
                        type="text"
                        placeholder="CNSS"
                        value={companyForm.company_cnss || ''}
                        onChange={(e) => setSettingsDraft({ ...companyForm, company_cnss: e.target.value })}
                    />
                    <input
                        type="text"
                        placeholder="Préfixe facture"
                        value={companyForm.invoice_prefix || ''}
                        onChange={(e) => setSettingsDraft({ ...companyForm, invoice_prefix: e.target.value })}
                    />
                    <textarea
                        rows={3}
                        placeholder="Pied de facture"
                        value={companyForm.invoice_footer || ''}
                        onChange={(e) => setSettingsDraft({ ...companyForm, invoice_footer: e.target.value })}
                    />
                    <button
                        className="btn-primary w-full flex items-center justify-center gap-2"
                        disabled={saveSettings.isPending}
                        onClick={() => saveSettings.mutate(companyForm)}
                    >
                        <Save size={18} /> Enregistrer les infos
                    </button>
                </div>
            </div>

            <div className="card p-6 space-y-4">
                <h2 className="font-semibold text-lg flex items-center gap-2">
                    <Search size={18} /> Dernières ventes
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    {recentSales.slice(0, 8).map(sale => (
                        <button
                            key={sale.id}
                            type="button"
                            className="p-3 rounded-lg border border-border hover:border-accent text-left transition-colors"
                            onClick={() => loadSale(sale)}
                        >
                            <span className="font-semibold">Vente #{sale.id}</span>
                            <span className="block text-sm text-muted">
                                {new Date(sale.created_at).toLocaleString('fr-FR')}
                            </span>
                            <span className="block text-sm font-bold text-accent">{money(Number(sale.total_ttc) || 0)}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
