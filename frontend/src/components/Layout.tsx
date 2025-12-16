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
    Calculator
} from 'lucide-react';
import { useState, useEffect } from 'react';
import SyncStatus from './SyncStatus';

export default function Layout() {
    const { t, i18n } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Récupérer le profil utilisateur complet pour les permissions granulaires
    const { data: currentUser } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then(res => res.data),
        retry: false
    });

    const userRole = localStorage.getItem('userRole') || 'CASHIER';
    const isAdmin = userRole === 'ADMIN';

    // Charger le thème sauvegardé
    useEffect(() => {
        const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' || 'light';
        setTheme(savedTheme);
        document.documentElement.setAttribute('data-theme', savedTheme);
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userRole');
        navigate('/login');
    };

    const navItems = [
        { icon: LayoutDashboard, label: t('Dashboard'), path: '/', show: true },
        { icon: ShoppingCart, label: t('POS'), path: '/pos', show: true },
        {
            icon: Package,
            label: 'Stock',
            path: '/inventory',
            show: isAdmin || currentUser?.can_view_stock === true
        },
        { icon: Truck, label: t('Suppliers'), path: '/suppliers', show: isAdmin },
        { icon: ClipboardList, label: 'Commandes', path: '/purchase-orders', show: isAdmin },
        { icon: RotateCcw, label: 'Retours', path: '/returns', show: isAdmin },
        { icon: ClipboardCheck, label: 'Inventaire', path: '/stock-count', show: isAdmin },
        { icon: FileText, label: t('Reports'), path: '/reports', show: isAdmin },
        { icon: Users, label: t('Users'), path: '/users', show: isAdmin },
        { icon: Calculator, label: 'Zakat', path: '/zakat', show: isAdmin },
        { icon: Settings, label: t('Settings'), path: '/settings', show: isAdmin },
    ];

    const filteredNavItems = navItems.filter(item => item.show);

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
                    <h1>📚 Librairie Attaquaddoum</h1>
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
                                <Icon size={20} />
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
        </div>
    );
}
