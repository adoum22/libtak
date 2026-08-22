import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import client, {
    clearAuthSession,
    getRefreshToken,
} from '../api/client';
import { useTranslation } from 'react-i18next';
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    FileText,
    LogOut,
    Users,
    Truck,
    Settings,
    Sun,
    Moon,
    Menu,
    RotateCcw,
    ClipboardList,
    ClipboardCheck,
    Wallet,
    Activity,
    HandCoins,
    Landmark,
    CreditCard,
    BadgePercent,
    X,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import SyncStatus from './SyncStatus';
import StockRealtimeBridge from './StockRealtimeBridge';
import { getPrimaryMobilePaths } from '../utils/mobileNavigation';

const FOCUSABLE_SIDEBAR_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const getVisibleFocusableElements = (container: HTMLElement) => (
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SIDEBAR_SELECTOR))
        .filter(element => {
            const style = window.getComputedStyle(element);
            return !element.hidden
                && element.getAttribute('aria-hidden') !== 'true'
                && style.display !== 'none'
                && style.visibility !== 'hidden';
        })
);

export default function Layout() {
    const { t, i18n } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        const saved = localStorage.getItem('theme');
        if (saved === 'dark' || saved === 'light') return saved;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isMobileSidebar, setIsMobileSidebar] = useState(() => (
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(max-width: 1023px)').matches
            : false
    ));
    const sidebarRef = useRef<HTMLElement>(null);
    const mainContentRef = useRef<HTMLDivElement>(null);
    const skipLinkRef = useRef<HTMLAnchorElement>(null);
    const mobileNavigationRef = useRef<HTMLElement>(null);
    const sidebarTriggerRef = useRef<HTMLElement | null>(null);

    // Récupérer le profil utilisateur complet pour les permissions granulaires
    const { data: currentUser } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then(res => res.data),
        retry: false,
        staleTime: 60_000,
    });

    const isAdmin = currentUser?.role === 'ADMIN';

    const { data: appSettings } = useQuery({
        queryKey: ['publicSettings'],
        queryFn: () => client.get('/auth/settings/public/').then(res => res.data),
        retry: false,
        staleTime: 5 * 60_000,
    });

    // Charger le thème sauvegardé
    useEffect(() => {
        localStorage.setItem('theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    useEffect(() => {
        const language = i18n.resolvedLanguage || i18n.language || 'fr';
        const direction = language === 'ar' ? 'rtl' : 'ltr';
        localStorage.setItem('language', language);
        document.documentElement.lang = language;
        document.documentElement.dir = direction;
    }, [i18n.language, i18n.resolvedLanguage]);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const mediaQuery = window.matchMedia('(max-width: 1023px)');
        const handleViewportChange = (event: MediaQueryListEvent | MediaQueryList) => {
            setIsMobileSidebar(event.matches);
            if (!event.matches) setSidebarOpen(false);
        };
        handleViewportChange(mediaQuery);
        mediaQuery.addEventListener?.('change', handleViewportChange);
        return () => mediaQuery.removeEventListener?.('change', handleViewportChange);
    }, []);

    useEffect(() => {
        const sidebar = sidebarRef.current;
        const mainContent = mainContentRef.current;
        const skipLink = skipLinkRef.current;
        const mobileNavigation = mobileNavigationRef.current;
        if (!sidebar || !mainContent) return;

        if (!isMobileSidebar) {
            sidebar.inert = false;
            sidebar.removeAttribute('aria-hidden');
            if (skipLink) skipLink.inert = false;
            if (mobileNavigation) mobileNavigation.inert = false;
            return;
        }

        if (!sidebarOpen) {
            sidebar.inert = true;
            sidebar.setAttribute('aria-hidden', 'true');
            if (skipLink) skipLink.inert = false;
            if (mobileNavigation) mobileNavigation.inert = false;
            return;
        }

        sidebarTriggerRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const previousBodyOverflow = document.body.style.overflow;
        const previousMainAriaHidden = mainContent.getAttribute('aria-hidden');
        const previousMainInert = mainContent.inert;
        const previousSkipLinkAriaHidden = skipLink?.getAttribute('aria-hidden') ?? null;
        const previousSkipLinkInert = skipLink?.inert === true;
        const previousMobileNavigationAriaHidden = mobileNavigation?.getAttribute('aria-hidden') ?? null;
        const previousMobileNavigationInert = mobileNavigation?.inert === true;

        sidebar.inert = false;
        sidebar.removeAttribute('aria-hidden');
        mainContent.inert = true;
        mainContent.setAttribute('aria-hidden', 'true');
        if (skipLink) {
            skipLink.inert = true;
            skipLink.setAttribute('aria-hidden', 'true');
        }
        if (mobileNavigation) {
            mobileNavigation.inert = true;
            mobileNavigation.setAttribute('aria-hidden', 'true');
        }
        document.body.style.overflow = 'hidden';

        const focusInitialControl = () => {
            const initial = sidebar.querySelector<HTMLElement>('[data-sidebar-initial-focus]')
                || getVisibleFocusableElements(sidebar)[0]
                || sidebar;
            initial.focus();
        };
        const animationFrame = window.requestAnimationFrame(focusInitialControl);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setSidebarOpen(false);
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = getVisibleFocusableElements(sidebar);
            if (focusable.length === 0) {
                event.preventDefault();
                sidebar.focus();
                return;
            }
            const first = focusable[0]!;
            const last = focusable.at(-1)!;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        const keepFocusInside = (event: FocusEvent) => {
            if (!sidebar.contains(event.target as Node)) focusInitialControl();
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('focusin', keepFocusInside);
        return () => {
            window.cancelAnimationFrame(animationFrame);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('focusin', keepFocusInside);
            document.body.style.overflow = previousBodyOverflow;
            mainContent.inert = previousMainInert;
            if (previousMainAriaHidden == null) mainContent.removeAttribute('aria-hidden');
            else mainContent.setAttribute('aria-hidden', previousMainAriaHidden);
            if (skipLink) {
                skipLink.inert = previousSkipLinkInert;
                if (previousSkipLinkAriaHidden == null) skipLink.removeAttribute('aria-hidden');
                else skipLink.setAttribute('aria-hidden', previousSkipLinkAriaHidden);
            }
            if (mobileNavigation) {
                mobileNavigation.inert = previousMobileNavigationInert;
                if (previousMobileNavigationAriaHidden == null) mobileNavigation.removeAttribute('aria-hidden');
                else mobileNavigation.setAttribute('aria-hidden', previousMobileNavigationAriaHidden);
            }
            if (isMobileSidebar) {
                sidebar.inert = true;
                sidebar.setAttribute('aria-hidden', 'true');
            }
            const trigger = sidebarTriggerRef.current;
            if (trigger?.isConnected) window.requestAnimationFrame(() => trigger.focus());
        };
    }, [isMobileSidebar, sidebarOpen]);

    const toggleTheme = () => {
        setTheme(current => current === 'light' ? 'dark' : 'light');
    };

    const handleLogout = async () => {
        const refresh = getRefreshToken();
        if (refresh) {
            try {
                await client.post('/auth/logout/', { refresh });
            } catch {
                // ignore - still clear local state
            }
        }
        if ('caches' in window) {
            try {
                const names = await caches.keys();
                await Promise.all(names.map(n => caches.delete(n)));
            } catch {
                // ignore
            }
        }
        clearAuthSession();
        await queryClient.cancelQueries();
        queryClient.clear();
        navigate('/login', { replace: true });
    };

    const navItems = [
        { icon: LayoutDashboard, label: t('Dashboard'), mobileLabel: t('Home'), path: '/', show: isAdmin, tone: 'dashboard' },
        { icon: Wallet, label: t('CashRegister'), path: '/cash-register', show: isAdmin, tone: 'cash' },
        { icon: Landmark, label: isAdmin ? t('Accounting') : t('Expenses'), path: '/accounting', show: true, tone: 'accounting' },
        { icon: FileText, label: t('Reports'), path: '/reports', show: isAdmin, tone: 'reports' },
        {
            icon: Package,
            label: t('Stock'),
            path: '/inventory',
            show: isAdmin || currentUser?.can_view_stock === true,
            tone: 'stock',
        },
        { icon: ShoppingCart, label: t('Sales'), mobileLabel: t('Sale'), path: '/pos', show: true, tone: 'sale' },
        { icon: CreditCard, label: t('Credit'), path: '/credit', show: true, tone: 'credit' },
        { icon: BadgePercent, label: t('Discounts'), path: '/discounts', show: isAdmin, tone: 'sale' },
        { icon: ClipboardList, label: t('PurchaseOrders'), path: '/purchase-orders', show: isAdmin, tone: 'orders' },
        { icon: Truck, label: t('Suppliers'), path: '/suppliers', show: isAdmin, tone: 'suppliers' },
        { icon: RotateCcw, label: t('Returns'), path: '/returns', show: isAdmin, tone: 'returns' },
        { icon: ClipboardCheck, label: t('StockCount'), path: '/stock-count', show: isAdmin, tone: 'inventory' },
        { icon: HandCoins, label: t('Zakat'), path: '/zakat', show: isAdmin, tone: 'zakat' },
        { icon: Users, label: t('Users'), path: '/users', show: isAdmin, tone: 'users' },
        { icon: Activity, label: t('Activity'), path: '/activity', show: isAdmin, tone: 'activity' },
        { icon: Settings, label: t('Settings'), path: '/settings', show: isAdmin, tone: 'settings' },
    ];

    const filteredNavItems = navItems.filter(item => item.show);
    const mobileNavPaths = getPrimaryMobilePaths(isAdmin);
    const mobileNavItems = mobileNavPaths
        .map(path => filteredNavItems.find(item => item.path === path))
        .filter((item): item is typeof filteredNavItems[number] => Boolean(item));
    const currentNavItem = filteredNavItems.find(item => item.path === '/'
        ? location.pathname === '/'
        : location.pathname.startsWith(item.path));
    const currentPageLabel = currentNavItem?.label
        || (location.pathname === '/forbidden' ? t('AccessDenied') : null)
        || (location.pathname === '/404' ? t('PageNotFound') : null)
        || t('PageNotFound');

    const languageSelector = (className: string) => (
        <div className={className} role="group" aria-label={t('LanguageSelector')}>
            {([
                ['fr', 'FR', t('French')],
                ['en', 'EN', t('English')],
                ['ar', 'AR', t('Arabic')],
            ] as const).map(([language, shortLabel, accessibleLabel]) => (
                <button
                    key={language}
                    type="button"
                    onClick={() => void i18n.changeLanguage(language)}
                    className={`btn-sm btn-ghost ${i18n.resolvedLanguage === language || i18n.language === language ? 'bg-accent-light text-accent' : ''}`}
                    aria-label={accessibleLabel}
                    aria-pressed={i18n.resolvedLanguage === language || i18n.language === language}
                >
                    {shortLabel}
                </button>
            ))}
        </div>
    );

    return (
        <div className="flex min-h-screen" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
            <a ref={skipLinkRef} className="skip-link" href="#main-content">{t('SkipToContent')}</a>
            {/* Overlay for mobile */}
            {sidebarOpen && (
                <button
                    type="button"
                    aria-label={t('CloseMenu')}
                    className="fixed inset-0 bg-black opacity-50 z-30 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                    tabIndex={-1}
                    aria-hidden="true"
                />
            )}

            {/* Sidebar */}
            <aside
                ref={sidebarRef}
                className={`sidebar ${sidebarOpen ? 'open' : ''}`}
                aria-hidden={isMobileSidebar && !sidebarOpen ? true : undefined}
                aria-label={t('MainNavigation')}
                tabIndex={-1}
            >
                <div className="sidebar-brand">
                    <div className="brand-logo">
                        {appSettings?.logo_url ? (
                            <img src={appSettings.logo_url} alt={t('StoreLogo')} />
                        ) : (
                            <span>LT</span>
                        )}
                    </div>
                    <div className="brand-text">
                        <h1>{appSettings?.store_name || 'Librairie'}</h1>
                        <p>Attaquaddoum</p>
                    </div>
                    <button
                        type="button"
                        className="sidebar-close btn-ghost btn-icon"
                        onClick={() => setSidebarOpen(false)}
                        aria-label={t('CloseMenu')}
                        data-sidebar-initial-focus
                    >
                        <X size={22} aria-hidden="true" />
                    </button>
                </div>

                <nav className="sidebar-nav" aria-label={t('MainNavigation')}>
                    {filteredNavItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = item.path === '/'
                            ? location.pathname === '/'
                            : location.pathname.startsWith(item.path);
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`nav-item ${isActive ? 'active' : ''}`}
                                onClick={() => setSidebarOpen(false)}
                                aria-current={isActive ? 'page' : undefined}
                            >
                                <span className={`nav-icon nav-icon-${item.tone}`}>
                                    <Icon size={19} />
                                </span>
                                <span>{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                <div className="sidebar-footer">
                    {languageSelector('sidebar-language-switcher')}
                    <button
                        onClick={handleLogout}
                        className="nav-item w-full text-danger hover:bg-danger-light"
                        style={{ color: 'var(--color-danger)' }}
                    >
                        <LogOut size={20} />
                        <span>{t('Logout')}</span>
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <div ref={mainContentRef} className="main-content flex-1 flex flex-col">
                {/* Top Bar */}
                <header className="topbar">
                    <div className="flex items-center gap-4">
                        <button
                            className="mobile-menu-toggle btn-ghost btn-icon lg:hidden"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            aria-label={sidebarOpen ? t('CloseMenu') : t('OpenMenu')}
                            aria-expanded={sidebarOpen}
                        >
                            <Menu size={24} />
                        </button>
                        <h2 className="text-lg font-semibold">
                            {currentPageLabel}
                        </h2>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Sync Status Indicator */}
                        <SyncStatus />
                        <StockRealtimeBridge />

                        {/* Language Switcher */}
                        {languageSelector('topbar-language-switcher flex gap-1')}

                        {/* Theme Toggle */}
                        <button
                            onClick={toggleTheme}
                            className="btn-ghost btn-icon"
                            title={theme === 'light' ? t('DarkMode') : t('LightMode')}
                            aria-label={theme === 'light' ? t('DarkMode') : t('LightMode')}
                        >
                            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                        </button>

                        {/* User Badge */}
                        <div className={`badge ${isAdmin ? 'badge-accent' : 'badge-success'}`}>
                            {currentUser?.first_name || currentUser?.username || (isAdmin ? t('Administrator') : t('Seller'))}
                        </div>
                    </div>
                </header>

                {/* Page Content */}
                <main id="main-content" tabIndex={-1} className="page-content flex-1">
                    <Outlet />
                </main>
            </div>

            <nav
                ref={mobileNavigationRef}
                className={`mobile-bottom-nav ${sidebarOpen ? 'sidebar-open' : ''}`}
                aria-label={t('MobileNavigation')}
                aria-hidden={sidebarOpen || undefined}
            >
                {mobileNavItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.path === '/'
                        ? location.pathname === '/'
                        : location.pathname.startsWith(item.path);
                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`mobile-bottom-item ${isActive ? 'active' : ''}`}
                            aria-current={isActive ? 'page' : undefined}
                        >
                            <Icon size={20} />
                            <span>{item.mobileLabel || item.label}</span>
                        </Link>
                    );
                })}
                <button
                    type="button"
                    className="mobile-bottom-item"
                    onClick={() => setSidebarOpen(true)}
                    aria-label={t('More')}
                    aria-expanded={sidebarOpen}
                >
                    <Menu size={20} />
                    <span>{t('More')}</span>
                </button>
            </nav>
        </div>
    );
}
