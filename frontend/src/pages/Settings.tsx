import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiUrl } from '../api/client';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/ToastContext';
import { Settings as SettingsIcon, Mail, Clock, Save, Check, Upload, Printer, Shield, Lock, Users, Database, Download, Send, AlertCircle } from 'lucide-react';
import { resolveWeeklyReportDay } from '../utils/reportSettings';

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

type SettingsTab = 'store' | 'reports' | 'permissions' | 'backup';

export default function Settings() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const toast = useToast();
    const navigate = useNavigate();
    const [showSuccess, setShowSuccess] = useState(false);
    const [activeTab, setActiveTab] = useState<SettingsTab>('store');
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [reportDiagnostic, setReportDiagnostic] = useState<ReportDiagnostic | null>(null);
    const [backupDiagnostic, setBackupDiagnostic] = useState<{ message: string; isError: boolean } | null>(null);

    const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tablist = event.currentTarget.closest<HTMLElement>('[role="tablist"]');
        const tabs = tablist
            ? Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
            : [];
        if (!tabs.length) return;

        event.preventDefault();
        const currentIndex = Math.max(0, tabs.indexOf(event.currentTarget));
        let nextIndex = currentIndex;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else {
            const isRtl = document.documentElement.dir === 'rtl';
            const visualDelta = event.key === 'ArrowRight' ? 1 : -1;
            const delta = isRtl ? -visualDelta : visualDelta;
            nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
        }
        tabs[nextIndex]?.focus();
        tabs[nextIndex]?.click();
    };

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
            queryClient.invalidateQueries({ queryKey: ['publicSettings'] });
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
        },
        onError: () => toast.error(t('SettingsStoreSaveFailed')),
    });

    const updateReportSettings = useMutation({
        mutationFn: (data: Partial<ReportSettings>) => client.patch('/reporting/settings/', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reportSettings'] });
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
        },
        onError: () => toast.error(t('SettingsReportSaveFailed')),
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
            setBackupDiagnostic({ message: t('SettingsBackupGenerated', { size: sizeKb }), isError: false });
        },
        onError: () => setBackupDiagnostic({ message: t('SettingsBackupGenerationFailed'), isError: true }),
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

    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Success Toast */}
            {showSuccess && (
                <div className="fixed top-4 right-4 z-50 bg-success text-white px-6 py-4 rounded-lg shadow-xl flex items-center gap-3 animate-slideUp" role="status" aria-live="polite">
                    <Check size={24} />
                    <span>{t('SettingsSaved')}</span>
                </div>
            )}

            <h1 className="text-2xl font-bold">{t('Settings')}</h1>

            <div className="card max-w-4xl p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div>
                        <p className="text-muted">API</p>
                        <p className="font-mono text-xs break-all">{getApiUrl()}</p>
                    </div>
                    <div>
                        <p className="text-muted">{t('SettingsBackendVersion')}</p>
                        <p className="font-mono">{appVersion?.backend_commit_short || '-'}</p>
                    </div>
                    <div>
                        <p className="text-muted">{t('SettingsFrontendVersion')}</p>
                        <p className="font-mono">{frontendCommit === '-' ? '-' : frontendCommit.slice(0, 12)}</p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="settings-tabs flex gap-2 border-b overflow-x-auto" role="tablist" aria-label={t('SettingsSections')}>
                <button
                    type="button"
                    role="tab"
                    id="settings-tab-store"
                    aria-selected={activeTab === 'store'}
                    aria-controls="settings-panel-store"
                    tabIndex={activeTab === 'store' ? 0 : -1}
                    onKeyDown={handleTabKeyDown}
                    onClick={() => setActiveTab('store')}
                    className={`px-6 py-3 font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${activeTab === 'store'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-muted hover:text-primary'
                        }`}
                >
                    <SettingsIcon size={18} className="inline mr-2" />
                    {t('SettingsStoreAndPrinting')}
                </button>
                <button
                    type="button"
                    role="tab"
                    id="settings-tab-reports"
                    aria-selected={activeTab === 'reports'}
                    aria-controls="settings-panel-reports"
                    tabIndex={activeTab === 'reports' ? 0 : -1}
                    onKeyDown={handleTabKeyDown}
                    onClick={() => setActiveTab('reports')}
                    className={`px-6 py-3 font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${activeTab === 'reports'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-muted hover:text-primary'
                        }`}
                >
                    <Mail size={18} className="inline mr-2" />
                    {t('SettingsReportsAndEmail')}
                </button>
                <button
                    type="button"
                    role="tab"
                    id="settings-tab-permissions"
                    aria-selected={activeTab === 'permissions'}
                    aria-controls="settings-panel-permissions"
                    tabIndex={activeTab === 'permissions' ? 0 : -1}
                    onKeyDown={handleTabKeyDown}
                    onClick={() => setActiveTab('permissions')}
                    className={`px-6 py-3 font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${activeTab === 'permissions'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-muted hover:text-primary'
                        }`}
                >
                    <Shield size={18} className="inline mr-2" />
                    {t('SettingsPermissionsAndSecurity')}
                </button>
                <button
                    type="button"
                    role="tab"
                    id="settings-tab-backup"
                    aria-selected={activeTab === 'backup'}
                    aria-controls="settings-panel-backup"
                    tabIndex={activeTab === 'backup' ? 0 : -1}
                    onKeyDown={handleTabKeyDown}
                    onClick={() => setActiveTab('backup')}
                    className={`px-6 py-3 font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${activeTab === 'backup'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-muted hover:text-primary'
                        }`}
                >
                    <Database size={18} className="inline mr-2" />
                    {t('Backup')}
                </button>
            </div>

            {activeTab === 'store' && appSettingsLoading && <div className="text-center py-12 text-muted" role="status">{t('Loading')}</div>}
            {activeTab === 'store' && appSettingsError && (
                <div className="network-error-state" role="alert"><p>{t('SettingsStoreUnavailable')}</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchAppSettings()}>{t('Retry')}</button></div>
            )}
            {activeTab === 'reports' && reportSettingsLoading && <div className="text-center py-12 text-muted" role="status">{t('Loading')}</div>}
            {activeTab === 'reports' && reportSettingsError && (
                <div className="network-error-state" role="alert"><p>{t('SettingsReportsUnavailable')}</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchReportSettings()}>{t('Retry')}</button></div>
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
                            <h2 className="font-semibold text-lg">{t('SettingsStoreInformation')}</h2>
                        </div>
                        <div className="card-body space-y-4">
                            {/* Logo Upload */}
                            <div className="flex justify-center mb-6">
                                <div className="relative group cursor-pointer w-32 h-32">
                                    <div className="w-32 h-32 rounded-lg overflow-hidden border-2 border-dashed border-muted flex items-center justify-center bg-tertiary">
                                        {currentLogoPreview ? (
                                            <img src={currentLogoPreview} alt={t('SettingsStoreLogo')} className="w-full h-full object-contain" />
                                        ) : (
                                            <div className="text-center p-2">
                                                <Upload className="mx-auto text-muted mb-1" size={24} />
                                                <span className="text-xs text-muted">{t('SettingsUploadLogo')}</span>
                                            </div>
                                        )}
                                    </div>
                                    <input
                                        id="settings-store-logo"
                                        type="file"
                                        accept="image/*"
                                        onChange={handleLogoChange}
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        aria-label={t('SettingsChooseStoreLogo')}
                                    />
                                    <div className="absolute inset-0 bg-black bg-opacity-40 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs text-center">
                                        {t('Edit')}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="settings-store-name" className="block text-sm font-medium mb-2">{t('SettingsStoreName')}</label>
                                <input
                                    id="settings-store-name"
                                    type="text"
                                    value={storeForm.store_name || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, store_name: e.target.value })}
                                />
                            </div>

                            <div>
                                <label htmlFor="settings-store-address" className="block text-sm font-medium mb-2">{t('Address')}</label>
                                <textarea
                                    id="settings-store-address"
                                    value={storeForm.store_address || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, store_address: e.target.value })}
                                    rows={2}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="settings-store-phone" className="block text-sm font-medium mb-2">{t('Phone')}</label>
                                    <input
                                        id="settings-store-phone"
                                        type="tel"
                                        value={storeForm.store_phone || ''}
                                        onChange={(e) => setStoreForm({ ...storeForm, store_phone: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="settings-store-email" className="block text-sm font-medium mb-2">{t('Email')}</label>
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
                                    <label htmlFor="settings-currency" className="block text-sm font-medium mb-2">{t('Currency')}</label>
                                    <input
                                        id="settings-currency"
                                        type="text"
                                        value={storeForm.currency || ''}
                                        onChange={(e) => setStoreForm({ ...storeForm, currency: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="settings-currency-symbol" className="block text-sm font-medium mb-2">{t('SettingsCurrencySymbol')}</label>
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
                            <h2 className="font-semibold text-lg">{t('SettingsReceiptCustomization')}</h2>
                        </div>
                        <div className="card-body space-y-4">
                            <div>
                                <label htmlFor="settings-print-header" className="block text-sm font-medium mb-2">{t('SettingsReceiptHeader')}</label>
                                <textarea
                                    id="settings-print-header"
                                    value={storeForm.print_header || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, print_header: e.target.value })}
                                    rows={2}
                                    placeholder={t('SettingsReceiptHeaderPlaceholder')}
                                />
                            </div>
                            <div>
                                <label htmlFor="settings-print-footer" className="block text-sm font-medium mb-2">{t('SettingsReceiptFooter')}</label>
                                <textarea
                                    id="settings-print-footer"
                                    value={storeForm.print_footer || ''}
                                    onChange={(e) => setStoreForm({ ...storeForm, print_footer: e.target.value })}
                                    rows={2}
                                    placeholder={t('SettingsReceiptFooterPlaceholder')}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="pt-2 max-w-2xl">
                        <button type="submit" className="btn-primary flex items-center gap-2 w-full justify-center">
                            <Save size={18} />
                            <span>{t('SaveAll')}</span>
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
                        <h2 className="font-semibold text-lg">{t('SettingsReportEmailConfiguration')}</h2>
                    </div>
                    <div className="card-body space-y-8">

                        {/* SMTP Configuration notice */}
                        <div className="space-y-2 border-b pb-6">
                            <h3 className="font-medium text-primary flex items-center gap-2">
                                <Mail size={18} />
                                {t('SettingsSmtpConfiguration')}
                            </h3>
                            <p className="text-sm text-muted">
                                {t('SettingsSmtpEnvironmentIntro')}
                                {' '}
                                <code className="ml-1">EMAIL_HOST</code>,
                                <code className="ml-1">EMAIL_PORT</code>,
                                <code className="ml-1">EMAIL_HOST_USER</code>,
                                <code className="ml-1">EMAIL_HOST_PASSWORD</code>,
                                <code className="ml-1">EMAIL_USE_TLS</code>.
                                {' '}{t('SettingsContactAdministrator')}
                            </p>
                        </div>

                        <div className="space-y-4 border-b pb-6">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div>
                                    <h3 className="font-medium text-primary flex items-center gap-2">
                                        <AlertCircle size={18} />
                                        {t('SettingsDailyReportDiagnostic')}
                                    </h3>
                                    <p className="text-sm text-muted">
                                        {t('SettingsDailyReportDiagnosticHelp')}
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
                                        {t('Diagnose')}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-primary"
                                        onClick={() => testDailyReport.mutate()}
                                        disabled={testDailyReport.isPending}
                                    >
                                        <Send size={16} />
                                        {t('SendTest')}
                                    </button>
                                </div>
                            </div>
                            {reportDiagnostic && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                    <div className="p-3 bg-tertiary/40 rounded-lg">
                                        <p className="font-semibold mb-1">{t('Email')}</p>
                                        <p>{t('Backend')}: {reportDiagnostic.smtp_config?.backend || '-'}</p>
                                        <p>SMTP: {reportDiagnostic.smtp_config?.host || '-'}:{reportDiagnostic.smtp_config?.port || '-'}</p>
                                        <p>{t('User')}: {reportDiagnostic.smtp_config?.user_set || reportDiagnostic.smtp_config?.user ? t('OK') : t('Missing')}</p>
                                        <p>{t('Password')}: {reportDiagnostic.smtp_config?.password_set ? t('OK') : t('Missing')}</p>
                                    </div>
                                    <div className="p-3 bg-tertiary/40 rounded-lg">
                                        <p className="font-semibold mb-1">{t('Report')}</p>
                                        <p>{t('Active')}: {diagnosticSettings?.daily_enabled ? t('Yes') : t('No')}</p>
                                        <p>{t('Recipients')}: {diagnosticSettings?.recipients_count ?? '-'}</p>
                                        <p>{t('Time')}: {diagnosticSettings?.daily_time || '-'}</p>
                                        <p>{t('LastStatus')}: {diagnosticLog?.success === true ? t('OK') : diagnosticLog ? t('Error') : '-'}</p>
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
                                            <p className="font-semibold mb-1">{t('SettingsDailyPythonAnywhereCommand')}</p>
                                            <code className="text-xs">{reportDiagnostic.pythonanywhere_task}</code>
                                            {reportDiagnostic.pythonanywhere_env_file && (
                                                <p className="text-xs text-muted mt-2">
                                                    {t('SettingsVariablesLoadedFrom', { file: reportDiagnostic.pythonanywhere_env_file })}
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
                                {t('SettingsReportRecipients')}
                            </label>
                            <input
                                id="settings-report-recipients"
                                type="text"
                                placeholder="email1@example.com, email2@example.com"
                                value={reportForm.email_recipients || ''}
                                onChange={(e) => setReportForm({ ...reportForm, email_recipients: e.target.value })}
                            />
                            <p className="text-xs text-muted mt-1">{t('SettingsSeparateEmails')}</p>
                        </div>

                        {/* Schedules */}
                        <div className="space-y-4">
                            <h3 className="font-medium text-primary flex items-center gap-2">
                                <Clock size={18} />
                                {t('Schedule')}
                            </h3>

                            {/* Daily */}
                            <div className="p-4 bg-tertiary rounded-lg">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            aria-label={t('SettingsDailyReport')}
                                            checked={reportForm.daily_enabled}
                                            onChange={(e) => setReportForm({ ...reportForm, daily_enabled: e.target.checked })}
                                            className="w-5 h-5"
                                        />
                                        <div>
                                            <p className="font-medium">{t('SettingsDailyReport')}</p>
                                            <p className="text-sm text-muted">{t('EveryDay')}</p>
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
                                            aria-label={t('SettingsWeeklyReport')}
                                            checked={reportForm.weekly_enabled}
                                            onChange={(e) => setReportForm({ ...reportForm, weekly_enabled: e.target.checked })}
                                            className="w-5 h-5"
                                        />
                                        <div>
                                            <p className="font-medium">{t('SettingsWeeklyReport')}</p>
                                            <p className="text-sm text-muted">{t('EveryWeek')}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={resolveWeeklyReportDay(reportForm.weekly_day)}
                                            onChange={(e) => setReportForm({ ...reportForm, weekly_day: parseInt(e.target.value) })}
                                            className="w-auto"
                                        >
                                            {dayNames.map((day, i) => (
                                                <option key={day} value={i}>{t(day)}</option>
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
                                            aria-label={t('SettingsMonthlyReport')}
                                            checked={reportForm.monthly_enabled}
                                            onChange={(e) => setReportForm({ ...reportForm, monthly_enabled: e.target.checked })}
                                            className="w-5 h-5"
                                        />
                                        <div>
                                            <p className="font-medium">{t('SettingsMonthlyReport')}</p>
                                            <p className="text-sm text-muted">{t('LastDayOfMonth')}</p>
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
                                            aria-label={t('SettingsQuarterlyReport')}
                                            checked={reportForm.quarterly_enabled}
                                            onChange={(e) => setReportForm({ ...reportForm, quarterly_enabled: e.target.checked })}
                                            className="w-5 h-5"
                                        />
                                        <div>
                                            <p className="font-medium">{t('SettingsQuarterlyReport')}</p>
                                            <p className="text-sm text-muted">{t('SettingsQuarterEnds')}</p>
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
                                            aria-label={t('SettingsYearlyReport')}
                                            checked={reportForm.yearly_enabled}
                                            onChange={(e) => setReportForm({ ...reportForm, yearly_enabled: e.target.checked })}
                                            className="w-5 h-5"
                                        />
                                        <div>
                                            <p className="font-medium">{t('SettingsYearlyReport')}</p>
                                            <p className="text-sm text-muted">{t('SettingsYearEnd')}</p>
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
                                <span>{t('SettingsSaveEmailConfiguration')}</span>
                            </button>
                        </div>
                    </div>
                </form>
            )}

            {/* Permissions Settings */}
            {activeTab === 'permissions' && appSettingsLoading && <div className="text-center py-12 text-muted" role="status">{t('Loading')}</div>}
            {activeTab === 'permissions' && appSettingsError && (
                <div className="network-error-state" role="alert"><p>{t('SettingsPermissionsUnavailable')}</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchAppSettings()}>{t('Retry')}</button></div>
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
                        <h2 className="font-semibold text-lg">{t('SettingsPermissionsAndSecurity')}</h2>
                    </div>
                    <div className="card-body space-y-6 py-8">
                        <div className="w-16 h-16 bg-accent-light rounded-full flex items-center justify-center mx-auto mb-4">
                            <Shield size={32} className="text-accent" />
                        </div>

                        <h3 className="text-xl font-bold text-center">{t('SettingsSellerStockRights')}</h3>

                        <p className="text-muted max-w-lg mx-auto text-center">
                            {t('SettingsSellerStockRightsHelp')}
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
                                <span><strong className="block">{t('SettingsAllowSellerViewStock')}</strong><span className="text-sm text-muted">{t('SettingsAllowSellerViewStockHelp')}</span></span>
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
                                <span><strong className="block">{t('SettingsAllowSellerManageStock')}</strong><span className="text-sm text-muted">{t('SettingsAllowSellerManageStockHelp')}</span></span>
                            </label>
                        </div>

                        <div className="pt-4 flex flex-col sm:flex-row justify-center gap-3">
                            <button
                                type="submit"
                                className="btn-primary inline-flex items-center justify-center gap-2"
                                disabled={updateAppSettings.isPending}
                            >
                                <Save size={18} />
                                {updateAppSettings.isPending ? t('Saving') : t('SettingsSaveGlobalRights')}
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/users')}
                                className="btn-secondary inline-flex items-center justify-center gap-2"
                            >
                                <Users size={18} />
                                {t('SettingsManageIndividualRights')}
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
                        <h2 className="font-semibold text-lg">{t('SettingsDatabaseBackup')}</h2>
                    </div>
                    <div className="card-body space-y-6 py-8">
                        <div className="text-center">
                            <div className="w-16 h-16 bg-accent-light rounded-full flex items-center justify-center mx-auto mb-4">
                                <Database size={32} className="text-accent" />
                            </div>
                            <h3 className="text-xl font-bold">{t('SettingsDownloadDataCopy')}</h3>
                            <p className="text-muted mt-2">{t('SettingsSelectBackupData')}</p>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-lg mx-auto">
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-products"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">📦 {t('Products')}</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-categories"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">📂 {t('Categories')}</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-suppliers"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">🏢 {t('Suppliers')}</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-sales"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">💰 {t('Sales')}</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-users"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">👥 {t('Users')}</span>
                            </label>
                            <label className="flex items-center gap-2 p-3 bg-tertiary/30 rounded-lg cursor-pointer hover:bg-tertiary/50 transition-colors">
                                <input
                                    type="checkbox"
                                    id="backup-settings"
                                    defaultChecked
                                    className="w-5 h-5 accent-accent"
                                />
                                <span className="text-sm font-medium">⚙️ {t('Settings')}</span>
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
                                            toast.warning(t('SettingsSelectBackupSection'));
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
                                        toast.error(t('SettingsBackupDownloadFailed'));
                                    }
                                }}
                                className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-lg"
                            >
                                <Download size={24} />
                                {t('SettingsDownloadBackup')}
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
                                {testBackup.isPending ? t('Checking') : t('SettingsTestBackup')}
                            </button>
                            {backupDiagnostic && (
                                <p className={`text-sm mt-3 ${backupDiagnostic.isError ? 'text-danger' : 'text-success'}`}>
                                    {backupDiagnostic.message}
                                </p>
                            )}
                        </div>

                        <p className="text-xs text-muted text-center">
                            {t('SettingsBackupFileHelp')}
                        </p>
                        <div className="p-4 bg-tertiary/40 rounded-lg text-sm">
                            <p className="font-semibold mb-2">{t('SettingsAutomaticLocalBackup')}</p>
                            <p className="text-muted mb-2">
                                {t('SettingsAutomaticLocalBackupHelp')}
                            </p>
                            <code className="text-xs">cd ~/libtak/backend && python manage.py local_backup_sync</code>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
