import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, Eye, EyeOff, LogIn } from 'lucide-react';
import client from '../api/client';

export default function Login() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const response = await client.post('/auth/login/', { username, password });
            localStorage.setItem('token', response.data.access);

            // Récupérer les infos utilisateur
            try {
                const meResponse = await client.get('/auth/me/');
                localStorage.setItem('userRole', meResponse.data.role);
            } catch {
                localStorage.setItem('userRole', 'CASHIER');
            }

            navigate('/');
        } catch (err: any) {
            console.error(err);
            const errorMessage = err.response?.data?.detail || 'Identifiants incorrects';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-primary p-4">
            {/* Background Pattern */}
            <div className="absolute inset-0 overflow-hidden">
                <div
                    className="absolute inset-0 opacity-5"
                    style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%236366f1' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                    }}
                />
            </div>

            <div className="card w-full max-w-md relative animate-slideUp">
                {/* Header */}
                <div className="text-center p-8 border-b border-[var(--color-border)]">
                    <div className="w-16 h-16 bg-accent-light rounded-xl flex items-center justify-center mx-auto mb-4">
                        <BookOpen size={32} className="text-accent" />
                    </div>
                    <h1 className="text-2xl font-bold mb-1">Librairie Attaquaddoum</h1>
                    <p className="text-muted">Connectez-vous à votre compte</p>
                </div>

                {/* Form */}
                <div className="p-8">
                    {error && (
                        <div className="bg-danger-light text-danger p-4 rounded-lg mb-6 flex items-center gap-2">
                            <span className="text-sm">{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                Nom d'utilisateur
                            </label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="admin"
                                required
                                autoFocus
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2">
                                Mot de passe
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    style={{ paddingRight: '3rem' }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
                                >
                                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full btn-lg"
                        >
                            {loading ? (
                                <span className="animate-pulse">Connexion...</span>
                            ) : (
                                <>
                                    <LogIn size={20} />
                                    <span>{t('Login')}</span>
                                </>
                            )}
                        </button>
                    </form>

                    {/* Demo Credentials */}
                    <div className="mt-8 p-4 bg-tertiary rounded-lg">
                        <p className="text-sm text-muted mb-2 font-medium">Comptes de démo:</p>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <span className="badge badge-accent">Admin</span>
                                <p className="mt-1 font-mono">admin / admin123</p>
                            </div>
                            <div>
                                <span className="badge badge-success">Vendeur</span>
                                <p className="mt-1 font-mono">vendeur / vendeur123</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
