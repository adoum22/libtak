import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';
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
} from 'lucide-react';
import { useState, useEffect } from 'react';
import SyncStatus from './SyncStatus';

export default function Layout() {
    const { t, i18n } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const [theme, setTheme] = useState<'light' | 'dark'>(() =>
        localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'
    );
    const [sidebarOpen, setSidebarOpen] = useState(false);

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

    const toggleTheme = () => {
        setTheme(current => current === 'light' ? 'dark' : 'light');
    };

    const handleLogout = async () => {
        const refresh = localStorage.getItem('refreshToken');
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
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('userRole');
        navigate('/login');
    };

    const navItems = [
        { icon: LayoutDashboard, label: t('Dashboard'), path: '/', show: true, tone: 'dashboard' },
        { icon: ShoppingCart, label: 'Vente', path: '/pos', show: true, tone: 'sale' },
        { icon: Wallet, label: 'Caisse', path: '/cash-register', show: isAdmin, tone: 'cash' },
        {
            icon: Package,
            label: 'Stock',
            path: '/inventory',
            show: isAdmin || currentUser?.can_view_stock === true,
            tone: 'stock',
        },
        { icon: Truck, label: t('Suppliers'), path: '/suppliers', show: isAdmin, tone: 'suppliers' },
        { icon: ClipboardList, label: 'Commandes', path: '/purchase-orders', show: isAdmin, tone: 'orders' },
        { icon: RotateCcw, label: 'Retours', path: '/returns', show: isAdmin, tone: 'returns' },
        { icon: ClipboardCheck, label: 'Inventaire', path: '/stock-count', show: isAdmin, tone: 'inventory' },
        { icon: FileText, label: t('Reports'), path: '/reports', show: isAdmin, tone: 'reports' },
        { icon: Users, label: t('Users'), path: '/users', show: isAdmin, tone: 'users' },
        { icon: HandCoins, label: 'Zakat', path: '/zakat', show: isAdmin, tone: 'zakat' },
        { icon: Landmark, label: isAdmin ? 'Comptabilité' : 'Dépenses', path: '/accounting', show: true, tone: 'accounting' },
        { icon: Activity, label: 'Activité', path: '/activity', show: isAdmin, tone: 'activity' },
        { icon: Settings, label: t('Settings'), path: '/settings', show: isAdmin, tone: 'settings' },
    ];

    const filteredNavItems = navItems.filter(item => item.show);
    const mobileNavPaths = ['/', '/accounting', '/cash-register', '/inventory', '/reports'];
    const mobileNavItems = mobileNavPaths
        .map(path => filteredNavItems.find(item => item.path === path))
        .filter((item): item is typeof filteredNavItems[number] => Boolean(item));

    return (
        <div className="flex min-h-screen" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
            {/* Overlay for mobile */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black opacity-50 z-30 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-brand">
                    <div className="brand-logo">
                        {appSettings?.logo_url ? (
                            <img src={appSettings.logo_url} alt="Logo" />
                        ) : (
                            <span>LT</span>
                        )}
                    </div>
                    <div className="brand-text">
                        <h1>{appSettings?.store_name || 'Librairie'}</h1>
                        <p>Attaquaddoum</p>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {filteredNavItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`nav-item ${isActive ? 'active' : ''}`}
                                onClick={() => setSidebarOpen(false)}
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
            <div className="main-content flex-1 flex flex-col">
                {/* Top Bar */}
                <header className="topbar">
                    <div className="flex items-center gap-4">
                        <button
                            className="btn-ghost btn-icon lg:hidden"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                        >
                            <Menu size={24} />
                        </button>
                        <h2 className="text-lg font-semibold">
                            {filteredNavItems.find(i => i.path === location.pathname)?.label || 'Librairie'}
                        </h2>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Sync Status Indicator */}
                        <SyncStatus />

                        {/* Language Switcher */}
                        <div className="flex gap-1">
                            <button
                                onClick={() => i18n.changeLanguage('fr')}
                                className={`btn-sm btn-ghost ${i18n.language === 'fr' ? 'bg-accent-light text-accent' : ''}`}
                            >
                                FR
                            </button>
                            <button
                                onClick={() => i18n.changeLanguage('en')}
                                className={`btn-sm btn-ghost ${i18n.language === 'en' ? 'bg-accent-light text-accent' : ''}`}
                            >
                                EN
                            </button>
                            <button
                                onClick={() => i18n.changeLanguage('ar')}
                                className={`btn-sm btn-ghost ${i18n.language === 'ar' ? 'bg-accent-light text-accent' : ''}`}
                            >
                                AR
                            </button>
                        </div>

                        {/* Theme Toggle */}
                        <button
                            onClick={toggleTheme}
                            className="btn-ghost btn-icon"
                            title={theme === 'light' ? 'Mode sombre' : 'Mode clair'}
                        >
                            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                        </button>

                        {/* User Badge */}
                        <div className={`badge ${isAdmin ? 'badge-accent' : 'badge-success'}`}>
                            {isAdmin ? 'Admin' : 'Vendeur'}
                        </div>
                    </div>
                </header>

                {/* Page Content */}
                <main className="page-content flex-1">
                    <Outlet />
                </main>
            </div>

            <nav className="mobile-bottom-nav" aria-label="Navigation mobile">
                {mobileNavItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`mobile-bottom-item ${isActive ? 'active' : ''}`}
                        >
                            <Icon size={20} />
                            <span>{item.label}</span>
                        </Link>
                    );
                })}
            </nav>
        </div>
    );
}
