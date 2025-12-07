import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';
import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Mail, Clock, Save, Check, Upload, Printer, Shield, Lock, Users, Database, Download } from 'lucide-react';

interface ReportSettings {
    email_recipients: string;
    sender_email?: string;
    smtp_host?: string;
    smtp_port?: number;
    daily_enabled: boolean;
    daily_time: string;
    weekly_enabled: boolean;
    weekly_time: string;
    weekly_day: number;
    monthly_enabled: boolean;
    monthly_time: string;
    quarterly_enabled: boolean;
    quarterly_time: string;
    yearly_enabled: boolean;
    yearly_time: string;
}

interface AppSettings {
    store_name: string;
    store_address: string;
    store_phone: string;
    store_email: string;
    default_tva: number;
    currency: string;
    currency_symbol: string;
    store_logo?: string | null;
    logo_url?: string | null;
    print_header?: string;
    print_footer?: string;
    cashier_can_view_stock: boolean;
    cashier_can_manage_stock: boolean;
}

export default function Settings() {
    const queryClient = useQueryClient();
    const [showSuccess, setShowSuccess] = useState(false);
    const [activeTab, setActiveTab] = useState<'store' | 'reports' | 'permissions' | 'backup'>('store');
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);

    const { data: appSettings } = useQuery<AppSettings>({
        queryKey: ['appSettings'],
        queryFn: () => client.get('/auth/settings/').then(res => res.data)
    });

    const { data: reportSettings } = useQuery<ReportSettings>({
        queryKey: ['reportSettings'],
        queryFn: () => client.get('/reporting/settings/').then(res => res.data)
    });

    const [storeForm, setStoreForm] = useState<Partial<AppSettings>>({});
    const [reportForm, setReportForm] = useState<Partial<ReportSettings> & { sender_password?: string }>({});

    // Initialize forms when data loads
    useEffect(() => {
        if (appSettings) {
            setStoreForm(appSettings);
            if (appSettings.logo_url) {
                setLogoPreview(appSettings.logo_url);
            }
        }
    }, [appSettings]);

    useEffect(() => {
        if (reportSettings) {
            setReportForm(reportSettings);
        }
    }, [reportSettings]);

    const updateAppSettings = useMutation({
        mutationFn: (data: Partial<AppSettings>) => {
            const formData = new FormData();
            Object.entries(data).forEach(([key, value]) => {
                if (key !== 'store_logo' && key !== 'logo_url' && value !== null && value !== undefined) {
                    formData.append(key, value.toString());
                }
            });
            if (logoFile) {
                formData.append('store_logo', logoFile);
            }
            return client.patch('/auth/settings/', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['appSettings'] });
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
        }
    });

    const updateReportSettings = useMutation({
        mutationFn: (data: Partial<ReportSettings> & { sender_password?: string }) => client.patch('/reporting/settings/', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reportSettings'] });
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
        }
    });

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setLogoFile(file);
            setLogoPreview(URL.createObjectURL(file));
        }
    };

    const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Success Toast */}
            {showSuccess && (
                <div className="fixed top-4 right-4 z-50 bg-success text-white px-6 py-4 rounded-lg shadow-xl flex items-center gap-3 animate-slideUp">
                    <Check size={24} />
                    <span>Paramètres sauvegardés!</span>
                </div>
            )}

            <h1 className="text-2xl font-bold">Paramètres</h1>

            {/* Tabs */}
            <div className="flex gap-2 border-b overflow-x-auto">
                <button
                    onClick={() => setActiveTab('store')}
                    className={`px-6 py-3 font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${activeTab === 'store'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-muted hover:text-primary'
                        }`}
                >
                    <SettingsIcon size={18} className="inline mr-2" />
                    Boutique & Impression
                </button>
                <button
                    onClick={() => setActiveTab('reports')}
                    className={`px-6 py-3 font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${activeTab === 'reports'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-muted hover:text-primary'
                        }`}
                >
                    <Mail size={18} className="inline mr-2" />
                    Rapports & Email
                </button>
                <button
                    onClick={() => setActiveTab('permissions')}
                    className={`px-6 py-3 font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${activeTab === 'permissions'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-muted hover:text-primary'
                        }`}
                >
                    <Shield size={18} className="inline mr-2" />
                    Permissions & Sécurité
                </button>
                <button
                    onClick={() => setActiveTab('backup')}
                    className={`px-6 py-3 font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${activeTab === 'backup'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-muted hover:text-primary'
                        }`}
                >
                    <Database size={18} className="inline mr-2" />
                    Sauvegarde
                </button>
            </div>

            {/* Store Settings */}
            {activeTab === 'store' && (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        updateAppSettings.mutate(storeForm);
                    }}
                    className="space-y-6"
                >
                    {/* General Info */}
                    <div className="card max-w-2xl">
                        <div className="card-header">
                            <h2 className="font-semibold text-lg">Informations de la boutique</h2>
                        </div>
                        <div className="card-body space-y-4">
                            {/* Logo Upload */}
                            <div className="flex justify-center mb-6">
                                <div className="relative group cursor-pointer w-32 h-32">
                                    <div className="w-32 h-32 rounded-lg overflow-hidden border-2 border-dashed border-muted flex items-center justify-center bg-tertiary">
                                        {logoPreview ? (
                                            <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
                                        ) : (
                                            <div className="text-center p-2">
                                                <Upload className="mx-auto text-muted mb-1" size={24} />
                                                <span className="text-xs text-muted">Upload Logo</span>
                                            </div>
                                        )}
                                    </div>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleLogoChange}
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                    />
                                    <div className="absolute inset-0 bg-black bg-opacity-40 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs text-center">
                                        Modifier
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Nom de la boutique</label>
                                <input
                                    type="text"
                                    value={storeForm.store_name || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, store_name: e.target.value })}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Adresse</label>
                                <textarea
                                    value={storeForm.store_address || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, store_address: e.target.value })}
                                    rows={2}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-2">Téléphone</label>
                                    <input
                                        type="tel"
                                        value={storeForm.store_phone || ''}
                                        onChange={(e) => setStoreForm({ ...storeForm, store_phone: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">Email</label>
                                    <input
                                        type="email"
                                        value={storeForm.store_email || ''}
                                        onChange={(e) => setStoreForm({ ...storeForm, store_email: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-2">TVA par défaut (%)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={storeForm.default_tva || ''}
                                        onChange={(e) => setStoreForm({ ...storeForm, default_tva: parseFloat(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">Devise</label>
                                    <input
                                        type="text"
                                        value={storeForm.currency || ''}
                                        onChange={(e) => setStoreForm({ ...storeForm, currency: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">Symbole</label>
                                    <input
                                        type="text"
                                        value={storeForm.currency_symbol || ''}
                                        onChange={(e) => setStoreForm({ ...storeForm, currency_symbol: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Receipt Settings */}
                    <div className="card max-w-2xl">
                        <div className="card-header flex items-center gap-2">
                            <Printer size={20} className="text-primary" />
                            <h2 className="font-semibold text-lg">Personnalisation du Ticket</h2>
                        </div>
                        <div className="card-body space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">En-tête du ticket (Message de bienvenue)</label>
                                <textarea
                                    value={storeForm.print_header || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, print_header: e.target.value })}
                                    rows={2}
                                    placeholder="Ex: Bienvenue à la Librairie Attaquaddoum !"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">Pied de page (Message de fin)</label>
                                <textarea
                                    value={storeForm.print_footer || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, print_footer: e.target.value })}
                                    rows={2}
                                    placeholder="Ex: Merci de votre visite. À bientôt !"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="pt-2 max-w-2xl">
                        <button type="submit" className="btn-primary flex items-center gap-2 w-full justify-center">
                            <Save size={18} />
                            <span>Sauvegarder Tout</span>
                        </button>
                    </div>
                </form>
            )}

            {/* Report & Email Settings */}
            {activeTab === 'reports' && (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        updateReportSettings.mutate(reportForm);
                    }}
                    className="card max-w-2xl"
                >
                    <div className="card-header">
                        <h2 className="font-semibold text-lg">Configuration des Rapports et Email</h2>
                    </div>
                    <div className="card-body space-y-8">

                        {/* SMTP Configuration */}
                        <div className="space-y-4 border-b pb-6">
                            <h3 className="font-medium text-primary flex items-center gap-2">
                                <Mail size={18} />
                                Configuration Serveur d'Envoi (SMTP)
                            </h3>
                            <p className="text-sm text-muted">Configurez ici le compte email utilisé pour envoyer les rapports.</p>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-2">Email Expéditeur</label>
                                    <input
                                        type="email"
                                        placeholder="boutique@gmail.com"
                                        value={reportForm.sender_email || ''}
                                        onChange={(e) => setReportForm({ ...reportForm, sender_email: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">Mot de passe (App Password)</label>
                                    <input
                                        type="password"
                                        placeholder="••••••••"
                                        value={reportForm.sender_password || ''}
                                        onChange={(e) => setReportForm({ ...reportForm, sender_password: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-2">Serveur SMTP</label>
                                    <input
                                        type="text"
                                        placeholder="smtp.gmail.com"
                                        value={reportForm.smtp_host || 'smtp.gmail.com'}
                                        onChange={(e) => setReportForm({ ...reportForm, smtp_host: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">Port SMTP</label>
                                    <input
                                        type="number"
                                        placeholder="587"
                                        value={reportForm.smtp_port || 587}
                                        onChange={(e) => setReportForm({ ...reportForm, smtp_port: parseInt(e.target.value) })}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Recipients */}
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                Destinataires des rapports
                            </label>
                            <input
                                type="text"
                                placeholder="email1@example.com, email2@example.com"
                                value={reportForm.email_recipients || ''}
                                onChange={(e) => setReportForm({ ...reportForm, email_recipients: e.target.value })}
                            />
                            <p className="text-xs text-muted mt-1">Séparez les adresses par des virgules</p>
                        </div>

                        {/* Schedules */}
                        <div className="space-y-4">
                            <h3 className="font-medium text-primary flex items-center gap-2">
                                <Clock size={18} />
                                Planification
                            </h3>

                            {/* Daily */}
                            <div className="p-4 bg-tertiary rounded-lg">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            checked={reportForm.daily_enabled}
                                            onChange={(e) => setReportForm({ ...reportForm, daily_enabled: e.target.checked })}
                                            className="w-5 h-5"
                                        />
                                        <div>
                                            <p className="font-medium">Rapport Journalier</p>
                                            <p className="text-sm text-muted">Tous les jours</p>
                                        </div>
                                    </div>
                                    <input
                                        type="time"
                                        value={reportForm.daily_time || '23:00'}
                                        onChange={(e) => setReportForm({ ...reportForm, daily_time: e.target.value })}
                                        className="w-auto"
                                    />
                                </div>
                            </div>

                            {/* Weekly */}
                            <div className="p-4 bg-tertiary rounded-lg">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            checked={reportForm.weekly_enabled}
                                            onChange={(e) => setReportForm({ ...reportForm, weekly_enabled: e.target.checked })}
                                            className="w-5 h-5"
                                        />
                                        <div>
                                            <p className="font-medium">Rapport Hebdomadaire</p>
                                            <p className="text-sm text-muted">Chaque semaine</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={reportForm.weekly_day || 6}
                                            onChange={(e) => setReportForm({ ...reportForm, weekly_day: parseInt(e.target.value) })}
                                            className="w-auto"
                                        >
                                            {dayNames.map((day, i) => (
                                                <option key={i} value={i}>{day}</option>
                                            ))}
                                        </select>
                                        <input
                                            type="time"
                                            value={reportForm.weekly_time || '23:30'}
                                            onChange={(e) => setReportForm({ ...reportForm, weekly_time: e.target.value })}
                                            className="w-auto"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Monthly */}
                            <div className="p-4 bg-tertiary rounded-lg">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            checked={reportForm.monthly_enabled}
                                            onChange={(e) => setReportForm({ ...reportForm, monthly_enabled: e.target.checked })}
                                            className="w-5 h-5"
                                        />
                                        <div>
                                            <p className="font-medium">Rapport Mensuel</p>
                                            <p className="text-sm text-muted">Dernier jour du mois</p>
                                        </div>
                                    </div>
                                    <input
                                        type="time"
                                        value={reportForm.monthly_time || '23:45'}
                                        onChange={(e) => setReportForm({ ...reportForm, monthly_time: e.target.value })}
                                        className="w-auto"
                                    />
                                </div>
                            </div>

                            {/* Quarterly */}
                            <div className="p-4 bg-tertiary rounded-lg">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            checked={reportForm.quarterly_enabled}
                                            onChange={(e) => setReportForm({ ...reportForm, quarterly_enabled: e.target.checked })}
                                            className="w-5 h-5"
                                        />
                                        <div>
                                            <p className="font-medium">Rapport Trimestriel</p>
                                            <p className="text-sm text-muted">Fin Mars, Juin, Sept, Déc</p>
                                        </div>
                                    </div>
                                    <input
                                        type="time"
                                        value={reportForm.quarterly_time || '23:50'}
                                        onChange={(e) => setReportForm({ ...reportForm, quarterly_time: e.target.value })}
                                        className="w-auto"
                                    />
                                </div>
                            </div>

                            {/* Yearly */}
                            <div className="p-4 bg-tertiary rounded-lg">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            checked={reportForm.yearly_enabled}
                                            onChange={(e) => setReportForm({ ...reportForm, yearly_enabled: e.target.checked })}
                                            className="w-5 h-5"
                                        />
                                        <div>
                                            <p className="font-medium">Rapport Annuel</p>
                                            <p className="text-sm text-muted">31 Décembre</p>
                                        </div>
                                    </div>
                                    <input
                                        type="time"
                                        value={reportForm.yearly_time || '23:55'}
                                        onChange={(e) => setReportForm({ ...reportForm, yearly_time: e.target.value })}
                                        className="w-auto"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t">
                            <button type="submit" className="btn-primary flex items-center gap-2">
                                <Save size={18} />
                                <span>Sauvegarder les configurations email</span>
                            </button>
                        </div>
                    </div>
                </form>
            )}

            {/* Permissions Settings */}
            {activeTab === 'permissions' && (
                <div className="card max-w-2xl">
                    <div className="card-header flex items-center gap-2">
                        <Lock size={20} className="text-primary" />
                        <h2 className="font-semibold text-lg">Permissions & Sécurité</h2>
                    </div>
                    <div className="card-body space-y-6 text-center py-10">
                        <div className="w-16 h-16 bg-accent-light rounded-full flex items-center justify-center mx-auto mb-4">
                            <Shield size={32} className="text-accent" />
                        </div>

                        <h3 className="text-xl font-bold">La gestion des permissions a changé !</h3>

                        <p className="text-muted max-w-md mx-auto">
                            Pour plus de sécurité et de flexibilité, les permissions "Voir le Stock" et "Gérer le Stock" se configurent désormais <strong>individuellement pour chaque vendeur</strong>.
                        </p>

                        <div className="pt-4">
                            <button
                                onClick={() => window.location.href = '/users'}
                                className="btn-primary inline-flex items-center gap-2"
                            >
                                <Users size={18} />
                                Aller à la gestion des Utilisateurs
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Backup Settings */}
            {activeTab === 'backup' && (
                <div className="card max-w-2xl">
                    <div className="card-header flex items-center gap-2">
                        <Database size={20} className="text-primary" />
                        <h2 className="font-semibold text-lg">Sauvegarde de la base de données</h2>
                    </div>
                    <div className="card-body space-y-6 py-8">
                        <div className="text-center">
                            <div className="w-16 h-16 bg-accent-light rounded-full flex items-center justify-center mx-auto mb-4">
                                <Database size={32} className="text-accent" />
                            </div>
                            <h3 className="text-xl font-bold">Télécharger une copie de vos données</h3>
                            <p className="text-muted mt-2">Sélectionnez les données à inclure dans la sauvegarde :</p>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-lg mx-auto">
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-products"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">📦 Produits</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-categories"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">📂 Catégories</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-suppliers"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">🏢 Fournisseurs</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-sales"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">💰 Ventes</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-users"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">👥 Utilisateurs</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-settings"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">⚙️ Paramètres</span>
                            </label>
                        </div>

                        <div className="text-center pt-4">
                            <button
                                onClick={async () => {
                                    try {
                                        // Get selected options
                                        const params = new URLSearchParams();
                                        if ((document.getElementById('backup-products') as HTMLInputElement)?.checked) params.append('products', 'true');
                                        if ((document.getElementById('backup-categories') as HTMLInputElement)?.checked) params.append('categories', 'true');
                                        if ((document.getElementById('backup-suppliers') as HTMLInputElement)?.checked) params.append('suppliers', 'true');
                                        if ((document.getElementById('backup-sales') as HTMLInputElement)?.checked) params.append('sales', 'true');
                                        if ((document.getElementById('backup-users') as HTMLInputElement)?.checked) params.append('users', 'true');
                                        if ((document.getElementById('backup-settings') as HTMLInputElement)?.checked) params.append('settings', 'true');

                                        const response = await client.get(`/auth/backup/?${params.toString()}`, {
                                            responseType: 'blob'
                                        });
                                        const url = window.URL.createObjectURL(new Blob([response.data]));
                                        const link = document.createElement('a');
                                        link.href = url;
                                        const date = new Date().toISOString().split('T')[0];
                                        link.setAttribute('download', `libtak_backup_${date}.json`);
                                        document.body.appendChild(link);
                                        link.click();
                                        link.remove();
                                        window.URL.revokeObjectURL(url);
                                        setShowSuccess(true);
                                        setTimeout(() => setShowSuccess(false), 3000);
                                    } catch (error) {
                                        console.error('Erreur lors du téléchargement:', error);
                                        alert('Erreur lors du téléchargement de la sauvegarde');
                                    }
                                }}
                                className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-lg"
                            >
                                <Download size={24} />
                                Télécharger la sauvegarde
                            </button>
                        </div>

                        <p className="text-xs text-muted text-center">
                            Le fichier sera au format JSON. Conservez-le en lieu sûr.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
