import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiUrl } from '../api/client';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ToastContext';
import { Settings as SettingsIcon, Mail, Clock, Save, Check, Upload, Printer, Shield, Lock, Users, Database, Download, Send, AlertCircle } from 'lucide-react';

interface ReportSettings {
    email_recipients: string;
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
    company_name?: string;
    company_rc?: string;
    company_ice?: string;
    company_if?: string;
    company_patente?: string;
    company_cnss?: string;
    invoice_prefix?: string;
    invoice_footer?: string;
    cashier_can_view_stock: boolean;
    cashier_can_manage_stock: boolean;
}

interface ReportDiagnostic {
    report_settings?: {
        daily_enabled: boolean;
        recipients_count: number;
        daily_time: string;
    };
    smtp_config?: {
        backend?: string;
        host?: string;
        port?: number;
        user?: string;
        user_set?: boolean;
        password_set?: boolean;
        from_email?: string;
        config_error?: string | null;
    };
    last_daily_log?: {
        sent_at: string | null;
        success: boolean | null;
        error_message: string | null;
    } | null;
    last_log?: {
        sent_at: string | null;
        success: boolean | null;
        error_message: string | null;
    } | null;
    pythonanywhere_task?: string;
    pythonanywhere_env_file?: string;
    local_backup_sync_task?: string;
    message?: string;
    success?: boolean;
}

interface AppVersion {
    backend_commit?: string | null;
    backend_commit_short?: string | null;
    debug?: boolean;
}

export default function Settings() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const navigate = useNavigate();
    const [showSuccess, setShowSuccess] = useState(false);
    const [activeTab, setActiveTab] = useState<'store' | 'reports' | 'permissions' | 'backup'>('store');
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [reportDiagnostic, setReportDiagnostic] = useState<ReportDiagnostic | null>(null);
    const [backupDiagnostic, setBackupDiagnostic] = useState<string | null>(null);

    const { data: appSettings, isLoading: appSettingsLoading, isError: appSettingsError, refetch: refetchAppSettings } = useQuery<AppSettings>({
        queryKey: ['appSettings'],
        queryFn: () => client.get('/auth/settings/').then(res => res.data)
    });

    const { data: reportSettings, isLoading: reportSettingsLoading, isError: reportSettingsError, refetch: refetchReportSettings } = useQuery<ReportSettings>({
        queryKey: ['reportSettings'],
        queryFn: () => client.get('/reporting/settings/').then(res => res.data)
    });

    const { data: appVersion } = useQuery<AppVersion>({
        queryKey: ['appVersion'],
        queryFn: () => client.get('/auth/version/').then(res => res.data),
        retry: 1,
    });

    const [storeDraft, setStoreDraft] = useState<Partial<AppSettings>>({});
    const [reportDraft, setReportDraft] = useState<Partial<ReportSettings>>({});
    const storeForm = Object.keys(storeDraft).length > 0 ? storeDraft : (appSettings ?? {});
    const reportForm = Object.keys(reportDraft).length > 0 ? reportDraft : (reportSettings ?? {});
    const currentLogoPreview = logoPreview ?? appSettings?.logo_url ?? null;
    const frontendCommit = import.meta.env.VITE_COMMIT_SHA || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || '-';
    const setStoreForm = (value: Partial<AppSettings>) => setStoreDraft(value);
    const setReportForm = (value: Partial<ReportSettings>) => setReportDraft(value);
    const diagnosticLog = reportDiagnostic?.last_daily_log ?? reportDiagnostic?.last_log ?? null;
    const diagnosticSettings = reportDiagnostic?.report_settings ?? (reportDiagnostic ? {
        daily_enabled: Boolean(reportForm.daily_enabled),
        recipients_count: (reportForm.email_recipients || '')
            .split(',')
            .filter((email) => email.trim().length > 0)
            .length,
        daily_time: reportForm.daily_time || '-',
    } : undefined);

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
        },
        onError: () => toast.error('Les paramètres de la boutique n’ont pas pu être enregistrés.'),
    });

    const updateReportSettings = useMutation({
        mutationFn: (data: Partial<ReportSettings>) => client.patch('/reporting/settings/', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reportSettings'] });
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
        },
        onError: () => toast.error('Les paramètres de rapport n’ont pas pu être enregistrés.'),
    });

    const testDailyReport = useMutation({
        mutationFn: () => client.post('/reporting/logs/test_email/'),
        onSuccess: (res) => setReportDiagnostic(res.data),
    });

    const diagnoseReports = useMutation({
        mutationFn: () => client.get('/reporting/logs/diagnose/'),
        onSuccess: (res) => setReportDiagnostic(res.data),
    });

    const testBackup = useMutation({
        mutationFn: () => client.get('/auth/backup/?products=true&categories=true&suppliers=true&sales=true&users=true&settings=true', {
            responseType: 'blob',
        }),
        onSuccess: (res) => {
            const sizeKb = Math.max(1, Math.round(res.data.size / 1024));
            setBackupDiagnostic(`Sauvegarde generee correctement (${sizeKb} Ko).`);
        },
        onError: () => setBackupDiagnostic('Erreur pendant la generation de la sauvegarde.'),
    });

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setLogoFile(file);
            setLogoPreview(URL.createObjectURL(file));
        }
    };

    useEffect(() => () => {
        if (logoPreview) URL.revokeObjectURL(logoPreview);
    }, [logoPreview]);

    const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Success Toast */}
            {showSuccess && (
                <div className="fixed top-4 right-4 z-50 bg-success text-white px-6 py-4 rounded-lg shadow-xl flex items-center gap-3 animate-slideUp" role="status" aria-live="polite">
                    <Check size={24} />
                    <span>Paramètres sauvegardés!</span>
                </div>
            )}

            <h1 className="text-2xl font-bold">Paramètres</h1>

            <div className="card max-w-4xl p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div>
                        <p className="text-muted">API</p>
                        <p className="font-mono text-xs break-all">{getApiUrl()}</p>
                    </div>
                    <div>
                        <p className="text-muted">Version backend</p>
                        <p className="font-mono">{appVersion?.backend_commit_short || '-'}</p>
                    </div>
                    <div>
                        <p className="text-muted">Version frontend</p>
                        <p className="font-mono">{frontendCommit === '-' ? '-' : frontendCommit.slice(0, 12)}</p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="settings-tabs flex gap-2 border-b overflow-x-auto" role="tablist" aria-label="Sections des paramètres">
                <button
                    type="button"
                    role="tab"
                    id="settings-tab-store"
                    aria-selected={activeTab === 'store'}
                    aria-controls="settings-panel-store"
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
                    type="button"
                    role="tab"
                    id="settings-tab-reports"
                    aria-selected={activeTab === 'reports'}
                    aria-controls="settings-panel-reports"
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
                    type="button"
                    role="tab"
                    id="settings-tab-permissions"
                    aria-selected={activeTab === 'permissions'}
                    aria-controls="settings-panel-permissions"
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
                    type="button"
                    role="tab"
                    id="settings-tab-backup"
                    aria-selected={activeTab === 'backup'}
                    aria-controls="settings-panel-backup"
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

            {activeTab === 'store' && appSettingsLoading && <div className="text-center py-12 text-muted" role="status">Chargement…</div>}
            {activeTab === 'store' && appSettingsError && (
                <div className="network-error-state" role="alert"><p>Les paramètres de la boutique sont indisponibles. Le formulaire est désactivé pour protéger les valeurs existantes.</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchAppSettings()}>Réessayer</button></div>
            )}
            {activeTab === 'reports' && reportSettingsLoading && <div className="text-center py-12 text-muted" role="status">Chargement…</div>}
            {activeTab === 'reports' && reportSettingsError && (
                <div className="network-error-state" role="alert"><p>Les paramètres de rapport sont indisponibles. Le formulaire est désactivé pour protéger les valeurs existantes.</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchReportSettings()}>Réessayer</button></div>
            )}

            {/* Store Settings */}
            {activeTab === 'store' && !appSettingsLoading && !appSettingsError && (
                <form
                    id="settings-panel-store"
                    role="tabpanel"
                    aria-labelledby="settings-tab-store"
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
                                        {currentLogoPreview ? (
                                            <img src={currentLogoPreview} alt="Logo" className="w-full h-full object-contain" />
                                        ) : (
                                            <div className="text-center p-2">
                                                <Upload className="mx-auto text-muted mb-1" size={24} />
                                                <span className="text-xs text-muted">Upload Logo</span>
                                            </div>
                                        )}
                                    </div>
                                    <input
                                        id="settings-store-logo"
                                        type="file"
                                        accept="image/*"
                                        onChange={handleLogoChange}
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        aria-label="Choisir le logo de la boutique"
                                    />
                                    <div className="absolute inset-0 bg-black bg-opacity-40 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs text-center">
                                        Modifier
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="settings-store-name" className="block text-sm font-medium mb-2">Nom de la boutique</label>
                                <input
                                    id="settings-store-name"
                                    type="text"
                                    value={storeForm.store_name || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, store_name: e.target.value })}
                                />
                            </div>

                            <div>
                                <label htmlFor="settings-store-address" className="block text-sm font-medium mb-2">Adresse</label>
                                <textarea
                                    id="settings-store-address"
                                    value={storeForm.store_address || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, store_address: e.target.value })}
                                    rows={2}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="settings-store-phone" className="block text-sm font-medium mb-2">Téléphone</label>
                                    <input
                                        id="settings-store-phone"
                                        type="tel"
                                        value={storeForm.store_phone || ''}
                                        onChange={(e) => setStoreForm({ ...storeForm, store_phone: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="settings-store-email" className="block text-sm font-medium mb-2">Email</label>
                                    <input
                                        id="settings-store-email"
                                        type="email"
                                        value={storeForm.store_email || ''}
                                        onChange={(e) => setStoreForm({ ...storeForm, store_email: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="settings-currency" className="block text-sm font-medium mb-2">Devise</label>
                                    <input
                                        id="settings-currency"
                                        type="text"
                                        value={storeForm.currency || ''}
                                        onChange={(e) => setStoreForm({ ...storeForm, currency: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="settings-currency-symbol" className="block text-sm font-medium mb-2">Symbole</label>
                                    <input
                                        id="settings-currency-symbol"
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
                                <label htmlFor="settings-print-header" className="block text-sm font-medium mb-2">En-tête du ticket (message de bienvenue)</label>
                                <textarea
                                    id="settings-print-header"
                                    value={storeForm.print_header || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, print_header: e.target.value })}
                                    rows={2}
                                    placeholder="Ex: Bienvenue à la Librairie Attaquaddoum !"
                                />
                            </div>
                            <div>
                                <label htmlFor="settings-print-footer" className="block text-sm font-medium mb-2">Pied de page (message de fin)</label>
                                <textarea
                                    id="settings-print-footer"
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
            {activeTab === 'reports' && !reportSettingsLoading && !reportSettingsError && (
                <form
                    id="settings-panel-reports"
                    role="tabpanel"
                    aria-labelledby="settings-tab-reports"
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

                        {/* SMTP Configuration notice */}
                        <div className="space-y-2 border-b pb-6">
                            <h3 className="font-medium text-primary flex items-center gap-2">
                                <Mail size={18} />
                                Configuration Serveur d'Envoi (SMTP)
                            </h3>
                            <p className="text-sm text-muted">
                                La configuration SMTP (serveur, identifiants, mot de passe) est désormais gérée
                                par les variables d'environnement du serveur :
                                <code className="ml-1">EMAIL_HOST</code>,
                                <code className="ml-1">EMAIL_PORT</code>,
                                <code className="ml-1">EMAIL_HOST_USER</code>,
                                <code className="ml-1">EMAIL_HOST_PASSWORD</code>,
                                <code className="ml-1">EMAIL_USE_TLS</code>.
                                Contactez votre administrateur pour les modifier.
                            </p>
                        </div>

                        <div className="space-y-4 border-b pb-6">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div>
                                    <h3 className="font-medium text-primary flex items-center gap-2">
                                        <AlertCircle size={18} />
                                        Diagnostic rapport journalier
                                    </h3>
                                    <p className="text-sm text-muted">
                                        Verifie les destinataires, SMTP, dernier envoi et commande PythonAnywhere.
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={() => diagnoseReports.mutate()}
                                        disabled={diagnoseReports.isPending}
                                    >
                                        <AlertCircle size={16} />
                                        Diagnostiquer
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-primary"
                                        onClick={() => testDailyReport.mutate()}
                                        disabled={testDailyReport.isPending}
                                    >
                                        <Send size={16} />
                                        Envoyer test
                                    </button>
                                </div>
                            </div>
                            {reportDiagnostic && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                    <div className="p-3 bg-tertiary/40 rounded-lg">
                                        <p className="font-semibold mb-1">Email</p>
                                        <p>Backend: {reportDiagnostic.smtp_config?.backend || '-'}</p>
                                        <p>SMTP: {reportDiagnostic.smtp_config?.host || '-'}:{reportDiagnostic.smtp_config?.port || '-'}</p>
                                        <p>Utilisateur: {reportDiagnostic.smtp_config?.user_set || reportDiagnostic.smtp_config?.user ? 'OK' : 'Manquant'}</p>
                                        <p>Mot de passe: {reportDiagnostic.smtp_config?.password_set ? 'OK' : 'Manquant'}</p>
                                    </div>
                                    <div className="p-3 bg-tertiary/40 rounded-lg">
                                        <p className="font-semibold mb-1">Rapport</p>
                                        <p>Actif: {diagnosticSettings?.daily_enabled ? 'Oui' : 'Non'}</p>
                                        <p>Destinataires: {diagnosticSettings?.recipients_count ?? '-'}</p>
                                        <p>Heure: {diagnosticSettings?.daily_time || '-'}</p>
                                        <p>Dernier statut: {diagnosticLog?.success === true ? 'OK' : diagnosticLog ? 'Erreur' : '-'}</p>
                                    </div>
                                    {diagnosticLog?.error_message && (
                                        <div className="md:col-span-2 p-3 bg-danger-light text-danger rounded-lg">
                                            {diagnosticLog.error_message}
                                        </div>
                                    )}
                                    {reportDiagnostic.smtp_config?.config_error && (
                                        <div className="md:col-span-2 p-3 bg-danger-light text-danger rounded-lg">
                                            {reportDiagnostic.smtp_config.config_error}
                                        </div>
                                    )}
                                    {reportDiagnostic.pythonanywhere_task && (
                                        <div className="md:col-span-2 p-3 bg-tertiary/40 rounded-lg">
                                            <p className="font-semibold mb-1">Commande PythonAnywhere quotidienne</p>
                                            <code className="text-xs">{reportDiagnostic.pythonanywhere_task}</code>
                                            {reportDiagnostic.pythonanywhere_env_file && (
                                                <p className="text-xs text-muted mt-2">
                                                    Variables chargees depuis {reportDiagnostic.pythonanywhere_env_file}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Recipients */}
                        <div>
                            <label htmlFor="settings-report-recipients" className="block text-sm font-medium mb-2">
                                Destinataires des rapports
                            </label>
                            <input
                                id="settings-report-recipients"
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
                                                <option key={day} value={i}>{day}</option>
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
            {activeTab === 'permissions' && appSettingsLoading && <div className="text-center py-12 text-muted" role="status">Chargement…</div>}
            {activeTab === 'permissions' && appSettingsError && (
                <div className="network-error-state" role="alert"><p>Les permissions sont indisponibles. Aucun changement n’est possible tant que les valeurs actuelles ne sont pas chargées.</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchAppSettings()}>Réessayer</button></div>
            )}
            {activeTab === 'permissions' && !appSettingsLoading && !appSettingsError && (
                <form
                    id="settings-panel-permissions"
                    role="tabpanel"
                    aria-labelledby="settings-tab-permissions"
                    className="card max-w-2xl"
                    onSubmit={(event) => {
                        event.preventDefault();
                        updateAppSettings.mutate({
                            cashier_can_view_stock: Boolean(storeForm.cashier_can_view_stock),
                            cashier_can_manage_stock: Boolean(storeForm.cashier_can_manage_stock),
                        });
                    }}
                >
                    <div className="card-header flex items-center gap-2">
                        <Lock size={20} className="text-primary" />
                        <h2 className="font-semibold text-lg">Permissions & Sécurité</h2>
                    </div>
                    <div className="card-body space-y-6 py-8">
                        <div className="w-16 h-16 bg-accent-light rounded-full flex items-center justify-center mx-auto mb-4">
                            <Shield size={32} className="text-accent" />
                        </div>

                        <h3 className="text-xl font-bold text-center">Droits stock des vendeurs</h3>

                        <p className="text-muted max-w-lg mx-auto text-center">
                            Ces droits globaux s’appliquent à tous les vendeurs. Les droits individuels configurés dans « Utilisateurs » s’ajoutent à ces valeurs ; ils ne peuvent pas retirer un droit global.
                        </p>

                        <div className="space-y-3 rounded-xl border border-border p-4 bg-secondary">
                            <label className="flex items-start gap-3 cursor-pointer text-left">
                                <input
                                    type="checkbox"
                                    className="w-5 h-5 mt-0.5 accent-accent"
                                    checked={Boolean(storeForm.cashier_can_view_stock)}
                                    onChange={(event) => setStoreForm({
                                        ...storeForm,
                                        cashier_can_view_stock: event.target.checked,
                                        cashier_can_manage_stock: event.target.checked
                                            ? Boolean(storeForm.cashier_can_manage_stock)
                                            : false,
                                    })}
                                />
                                <span><strong className="block">Autoriser tous les vendeurs à voir le stock</strong><span className="text-sm text-muted">Donne accès au module Stock en lecture seule.</span></span>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer text-left">
                                <input
                                    type="checkbox"
                                    className="w-5 h-5 mt-0.5 accent-accent"
                                    checked={Boolean(storeForm.cashier_can_manage_stock)}
                                    onChange={(event) => setStoreForm({
                                        ...storeForm,
                                        cashier_can_manage_stock: event.target.checked,
                                        cashier_can_view_stock: event.target.checked
                                            ? true
                                            : Boolean(storeForm.cashier_can_view_stock),
                                    })}
                                />
                                <span><strong className="block">Autoriser tous les vendeurs à gérer le stock</strong><span className="text-sm text-muted">Inclut automatiquement le droit de voir le stock.</span></span>
                            </label>
                        </div>

                        <div className="pt-4 flex flex-col sm:flex-row justify-center gap-3">
                            <button
                                type="submit"
                                className="btn-primary inline-flex items-center justify-center gap-2"
                                disabled={updateAppSettings.isPending}
                            >
                                <Save size={18} />
                                {updateAppSettings.isPending ? 'Enregistrement…' : 'Enregistrer les droits globaux'}
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/users')}
                                className="btn-secondary inline-flex items-center justify-center gap-2"
                            >
                                <Users size={18} />
                                Gérer les droits individuels
                            </button>
                        </div>
                    </div>
                </form>
            )}

            {/* Backup Settings */}
            {activeTab === 'backup' && (
                <div id="settings-panel-backup" role="tabpanel" aria-labelledby="settings-tab-backup" className="card max-w-2xl">
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
                                        const selections = [
                                            ['products', 'backup-products'],
                                            ['categories', 'backup-categories'],
                                            ['suppliers', 'backup-suppliers'],
                                            ['sales', 'backup-sales'],
                                            ['users', 'backup-users'],
                                            ['settings', 'backup-settings'],
                                        ] as const;
                                        let selectedCount = 0;
                                        selections.forEach(([parameter, inputId]) => {
                                            const checked = Boolean(
                                                (document.getElementById(inputId) as HTMLInputElement | null)?.checked
                                            );
                                            params.set(parameter, String(checked));
                                            if (checked) selectedCount += 1;
                                        });

                                        if (selectedCount === 0) {
                                            toast.warning('Sélectionnez au moins une rubrique à sauvegarder.');
                                            return;
                                        }

                                        const response = await client.get(`/auth/backup/?${params.toString()}`, {
                                            responseType: 'blob'
                                        });
                                        const url = window.URL.createObjectURL(new Blob([response.data]));
                                        const link = document.createElement('a');
                                        link.href = url;
                                        const date = new Date().toISOString().split('T')[0];
                                        link.setAttribute('download', `libtak_backup_${date}.xlsx`);
                                        document.body.appendChild(link);
                                        link.click();
                                        link.remove();
                                        window.URL.revokeObjectURL(url);
                                        setShowSuccess(true);
                                        setTimeout(() => setShowSuccess(false), 3000);
                                    } catch {
                                        toast.error('La sauvegarde n’a pas pu être téléchargée. Réessayez.');
                                    }
                                }}
                                className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-lg"
                            >
                                <Download size={24} />
                                Télécharger la sauvegarde
                            </button>
                        </div>

                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => testBackup.mutate()}
                                disabled={testBackup.isPending}
                                className="btn-secondary inline-flex items-center gap-2"
                            >
                                <Database size={18} />
                                {testBackup.isPending ? 'Verification...' : 'Tester la sauvegarde'}
                            </button>
                            {backupDiagnostic && (
                                <p className={`text-sm mt-3 ${backupDiagnostic.startsWith('Erreur') ? 'text-danger' : 'text-success'}`}>
                                    {backupDiagnostic}
                                </p>
                            )}
                        </div>

                        <p className="text-xs text-muted text-center">
                            Le fichier sera au format Excel (.xlsx) avec plusieurs feuilles. Ouvrez-le avec Excel ou Google Sheets.
                        </p>
                        <div className="p-4 bg-tertiary/40 rounded-lg text-sm">
                            <p className="font-semibold mb-2">Sauvegarde locale automatique</p>
                            <p className="text-muted mb-2">
                                Pour un serveur local/offline, planifiez cette commande toutes les 30 minutes. Elle cree d'abord une sauvegarde locale, puis tente une synchronisation cloud si elle est configuree.
                            </p>
                            <code className="text-xs">cd ~/libtak/backend && python manage.py local_backup_sync</code>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
