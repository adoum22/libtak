import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';
import { useToast } from '../components/Toast';
import { useTranslation } from 'react-i18next';
import {
    Users as UsersIcon,
    UserPlus,
    Search,
    Shield,
    Edit,
    Power,
    Lock
} from 'lucide-react';

interface User {
    id: number;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    role: 'ADMIN' | 'CASHIER';
    phone: string;
    avatar: string | null;
    is_active: boolean;
    can_view_stock: boolean;
    can_manage_stock: boolean;
}

export default function Users() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const { t } = useTranslation();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRole, setFilterRole] = useState<'ALL' | 'ADMIN' | 'CASHIER'>('ALL');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [selectedUserForPassword, setSelectedUserForPassword] = useState<User | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        first_name: '',
        last_name: '',
        role: 'CASHIER' as 'ADMIN' | 'CASHIER',
        phone: '',
        password: '',
        can_view_stock: false,
        can_manage_stock: false,
        avatar: null as File | null
    });
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    // Fetch Users
    const { data: users, isLoading } = useQuery<User[]>({
        queryKey: ['users'],
        queryFn: () => client.get('/auth/users/').then(res => res.data)
    });

    // Mutations
    const createMutation = useMutation({
        mutationFn: (data: FormData) => client.post('/auth/users/', data, {
            headers: { 'Content-Type': 'multipart/form-data' }
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            closeModal();
        },
        onError: (error: any) => {
            toast.error('Erreur: ' + (error.response?.data?.detail || JSON.stringify(error.response?.data)));
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) =>
            client.patch(`/auth/users/${id}/`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            closeModal();
            toast.success('Utilisateur mis à jour avec succès !');
        },
        onError: (error: any) => {
            toast.error('Erreur: ' + (error.response?.data?.detail || JSON.stringify(error.response?.data)));
        }
    });

    const toggleActiveMutation = useMutation({
        mutationFn: (id: number) => client.post(`/auth/users/${id}/toggle_active/`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
        }
    });

    const resetPasswordMutation = useMutation({
        mutationFn: ({ id, password }: { id: number; password: string }) =>
            client.post(`/auth/users/${id}/reset_password/`, { new_password: password }),
        onSuccess: () => {
            toast.success('Mot de passe réinitialisé avec succès.');
            closePasswordModal();
        },
        onError: (error: any) => {
            toast.error('Erreur: ' + (error.response?.data?.detail || 'Impossible de changer le mot de passe'));
        }
    });

    const handleOpenModal = (user: User | null = null) => {
        if (user) {
            setEditingUser(user);
            setFormData({
                username: user.username,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                phone: user.phone || '',
                password: '',
                can_view_stock: user.can_view_stock || false,
                can_manage_stock: user.can_manage_stock || false,
                avatar: null
            });
            setPreviewImage(user.avatar);
        } else {
            setEditingUser(null);
            setFormData({
                username: '',
                email: '',
                first_name: '',
                last_name: '',
                role: 'CASHIER',
                phone: '',
                password: '', // Only for creation
                can_view_stock: false,
                can_manage_stock: false,
                avatar: null
            });
            setPreviewImage(null);
        }
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingUser(null);
        setPreviewImage(null);
    };

    const handleOpenPasswordModal = (user: User) => {
        setSelectedUserForPassword(user);
        setNewPassword('');
        setIsPasswordModalOpen(true);
    };

    const closePasswordModal = () => {
        setIsPasswordModalOpen(false);
        setSelectedUserForPassword(null);
        setNewPassword('');
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (editingUser) {
            // Update mode: Send JSON (preserves booleans properly)
            const updatePayload = {
                username: formData.username,
                email: formData.email,
                first_name: formData.first_name,
                last_name: formData.last_name,
                role: formData.role,
                phone: formData.phone,
                can_view_stock: formData.can_view_stock,
                can_manage_stock: formData.can_manage_stock,
                is_active: formData.role === 'ADMIN' ? true : (editingUser.is_active ?? true)
            };
            updateMutation.mutate({ id: editingUser.id, data: updatePayload });
        } else {
            // Create mode: Send FormData (for avatar support)
            const data = new FormData();
            data.append('username', formData.username);
            data.append('email', formData.email);
            data.append('first_name', formData.first_name);
            data.append('last_name', formData.last_name);
            data.append('role', formData.role);
            data.append('phone', formData.phone);
            data.append('can_view_stock', String(formData.can_view_stock));
            data.append('can_manage_stock', String(formData.can_manage_stock));
            if (formData.password) data.append('password', formData.password);
            if (formData.avatar) data.append('avatar', formData.avatar);

            createMutation.mutate(data);
        }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setFormData({ ...formData, avatar: file });
            setPreviewImage(URL.createObjectURL(file));
        }
    };

    const filteredUsers = users?.filter(user => {
        const matchesSearch =
            user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.last_name.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesRole = filterRole === 'ALL' || user.role === filterRole;

        return matchesSearch && matchesRole;
    });

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                        {t('Users')}
                    </h1>
                    <p className="text-muted mt-1">{t('Permissions')}</p>
                </div>
                <button
                    onClick={() => handleOpenModal()}
                    className="btn-primary flex items-center gap-2"
                >
                    <UserPlus size={20} />
                    {t('AddUser')}
                </button>
            </div>

            {/* Filters */}
            <div className="card p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
                <div className="relative w-full md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                    <input
                        type="text"
                        placeholder={t('SearchUsers')}
                        className="input pl-10 w-full"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex bg-tertiary/30 p-1 rounded-lg">
                    {(['ALL', 'ADMIN', 'CASHIER'] as const).map((role) => (
                        <button
                            key={role}
                            onClick={() => setFilterRole(role)}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${filterRole === role
                                ? 'bg-white text-primary shadow-sm'
                                : 'text-muted hover:text-primary'
                                }`}
                        >
                            {role === 'ALL' ? t('All') : role === 'ADMIN' ? t('Admin') : t('Cashier')}
                        </button>
                    ))}
                </div>
            </div>

            {/* Users Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {isLoading ? (
                    <div className="col-span-full text-center py-12">
                        <div className="loader mx-auto"></div>
                        <p className="mt-4 text-muted">Chargement des utilisateurs...</p>
                    </div>
                ) : filteredUsers?.length === 0 ? (
                    <div className="col-span-full text-center py-12 bg-tertiary/10 rounded-xl border border-dashed border-tertiary">
                        <UsersIcon size={48} className="mx-auto text-muted mb-4" />
                        <h3 className="text-lg font-bold">Aucun utilisateur trouvé</h3>
                        <p className="text-muted">Créez votre premier utilisateur pour commencer.</p>
                    </div>
                ) : (
                    filteredUsers?.map((user) => (
                        <div key={user.id} className="card group hover:shadow-lg transition-all duration-300">
                            <div className="p-6">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="relative">
                                        <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-white shadow-md bg-tertiary/20">
                                            {user.avatar ? (
                                                <img
                                                    src={user.avatar}
                                                    alt={user.username}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary to-accent text-white text-xl font-bold">
                                                    {user.first_name[0]}{user.last_name[0]}
                                                </div>
                                            )}
                                        </div>
                                        <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white ${user.is_active ? 'bg-success' : 'bg-red-500'
                                            }`} title={user.is_active ? 'Actif' : 'Inactif'}></div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleOpenPasswordModal(user)}
                                            className="p-2 hover:bg-tertiary/20 rounded-full text-muted hover:text-primary transition-colors"
                                            title="Changer mot de passe"
                                        >
                                            <Lock size={18} />
                                        </button>
                                        <button
                                            onClick={() => handleOpenModal(user)}
                                            className="p-2 hover:bg-tertiary/20 rounded-full text-muted hover:text-accent transition-colors"
                                            title="Modifier"
                                        >
                                            <Edit size={18} />
                                        </button>
                                        <button
                                            onClick={() => toggleActiveMutation.mutate(user.id)}
                                            className={`p-2 hover:bg-tertiary/20 rounded-full transition-colors ${user.is_active ? 'text-success hover:text-red-500' : 'text-red-500 hover:text-success'
                                                }`}
                                            title={user.is_active ? 'Désactiver' : 'Activer'}
                                        >
                                            <Power size={18} />
                                        </button>
                                    </div>
                                </div>

                                <h3 className="text-lg font-bold mb-1">{user.first_name} {user.last_name}</h3>
                                <p className="text-sm text-muted mb-3">@{user.username}</p>

                                <div className="flex items-center gap-2 mb-4">
                                    <span className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 ${user.role === 'ADMIN'
                                        ? 'bg-primary/10 text-primary'
                                        : 'bg-accent/10 text-accent'
                                        }`}>
                                        {user.role === 'ADMIN' ? <Shield size={12} /> : <UsersIcon size={12} />}
                                        {user.role === 'ADMIN' ? 'Administrateur' : 'Vendeur'}
                                    </span>
                                </div>

                                <div className="space-y-2 text-sm text-muted border-t pt-4">
                                    <div>
                                        <span className="opacity-70 block text-xs uppercase tracking-wider mb-1">Email</span>
                                        {user.email}
                                    </div>
                                    <div>
                                        <span className="opacity-70 block text-xs uppercase tracking-wider mb-1">Téléphone</span>
                                        {user.phone || '-'}
                                    </div>
                                    {user.role === 'CASHIER' && (
                                        <div className="grid grid-cols-2 gap-2 mt-3">
                                            <div className={`p-2 rounded bg-tertiary/20 text-center ${user.can_view_stock ? 'text-success' : 'text-muted'}`}>
                                                <span className="text-xs font-bold block">Voir Stock</span>
                                                {user.can_view_stock ? '✓' : '✗'}
                                            </div>
                                            <div className={`p-2 rounded bg-tertiary/20 text-center ${user.can_manage_stock ? 'text-success' : 'text-muted'}`}>
                                                <span className="text-xs font-bold block">Gérer Stock</span>
                                                {user.can_manage_stock ? '✓' : '✗'}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* User Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
                    <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-scaleIn">
                        <div className="p-6 border-b flex justify-between items-center bg-gray-50/50">
                            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                                {editingUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
                            </h2>
                            <button onClick={closeModal} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors">
                                ×
                            </button>
                        </div>

                        <div className="p-8">
                            <form className="space-y-6">
                                {/* Avatar Upload */}
                                <div className="flex justify-center mb-6">
                                    <div className="relative group cursor-pointer">
                                        <div className="w-24 h-24 rounded-full overflow-hidden bg-tertiary/20 border-2 border-dashed border-tertiary hover:border-primary transition-colors flex items-center justify-center">
                                            {previewImage ? (
                                                <img src={previewImage} alt="Preview" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="text-center p-2">
                                                    <UserPlus className="mx-auto text-muted mb-1" size={20} />
                                                    <span className="text-xs text-muted block">Photo</span>
                                                </div>
                                            )}
                                        </div>
                                        <input
                                            type="file"
                                            className="absolute inset-0 opacity-0 cursor-pointer"
                                            onChange={handleImageChange}
                                            accept="image/*"
                                        />
                                        <div className="absolute bottom-0 right-0 bg-primary text-white p-1 rounded-full shadow-lg transform translate-x-1/4 translate-y-1/4">
                                            <Edit size={12} />
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group">
                                        <label>Prénom</label>
                                        <input
                                            type="text"
                                            value={formData.first_name}
                                            onChange={e => setFormData({ ...formData, first_name: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Nom</label>
                                        <input
                                            type="text"
                                            value={formData.last_name}
                                            onChange={e => setFormData({ ...formData, last_name: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group">
                                        <label>Nom d'utilisateur</label>
                                        <input
                                            type="text"
                                            value={formData.username}
                                            onChange={e => setFormData({ ...formData, username: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <select
                                            value={formData.role}
                                            onChange={e => setFormData({ ...formData, role: e.target.value as 'ADMIN' | 'CASHIER' })}
                                        >
                                            <option value="CASHIER">Vendeur</option>
                                            <option value="ADMIN">Administrateur</option>
                                        </select>
                                    </div>
                                </div>

                                {formData.role === 'CASHIER' && (
                                    <div className="card bg-tertiary/20 p-4 border border-tertiary">
                                        <h3 className="font-bold text-sm mb-3 text-muted">Permissions Vendeur</h3>
                                        <div className="space-y-3">
                                            <label className="flex items-center gap-3 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={formData.can_view_stock}
                                                    onChange={e => setFormData({ ...formData, can_view_stock: e.target.checked })}
                                                    className="w-5 h-5 accent-accent"
                                                />
                                                <div>
                                                    <span className="font-medium block">Voir le stock</span>
                                                    <span className="text-xs text-muted">Peut consulter l'inventaire en lecture seule</span>
                                                </div>
                                            </label>

                                            <label className="flex items-center gap-3 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={formData.can_manage_stock}
                                                    onChange={e => setFormData({ ...formData, can_manage_stock: e.target.checked })}
                                                    className="w-5 h-5 accent-accent"
                                                />
                                                <div>
                                                    <span className="font-medium block">Modifier le stock</span>
                                                    <span className="text-xs text-muted">Peut ajouter, modifier et supprimer des produits</span>
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                )}

                                <div className="form-group">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Téléphone</label>
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    />
                                </div>

                                {!editingUser && (
                                    <div className="form-group">
                                        <label>Mot de passe</label>
                                        <input
                                            type="password"
                                            value={formData.password}
                                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                                            required
                                            minLength={6}
                                        />
                                    </div>
                                )}

                                <div className="pt-6 border-t flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={closeModal}
                                        className="btn-ghost"
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSubmit}
                                        className="btn-primary"
                                        disabled={createMutation.isPending || updateMutation.isPending}
                                    >
                                        {createMutation.isPending || updateMutation.isPending ? (
                                            <span className="flex items-center gap-2">
                                                <span className="loader w-4 h-4 border-2"></span>
                                                Traitement...
                                            </span>
                                        ) : (
                                            editingUser ? 'Mettre à jour' : 'Créer'
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Password Modal */}
            {isPasswordModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
                    <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl animate-scaleIn">
                        <div className="p-6 border-b flex justify-between items-center bg-gray-50/50">
                            <h3 className="text-lg font-bold">Changer mot de passe</h3>
                            <button onClick={closePasswordModal} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200">×</button>
                        </div>
                        <div className="p-6">
                            <p className="text-sm text-muted mb-4">
                                Réinitialisation pour <strong>{selectedUserForPassword?.username}</strong>
                            </p>
                            <input
                                type="password"
                                placeholder="Nouveau mot de passe"
                                className="input w-full mb-4"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                            />
                            <div className="flex justify-end gap-2">
                                <button onClick={closePasswordModal} className="btn-ghost">Annuler</button>
                                <button
                                    onClick={() => selectedUserForPassword && resetPasswordMutation.mutate({
                                        id: selectedUserForPassword.id,
                                        password: newPassword
                                    })}
                                    className="btn-primary"
                                    disabled={resetPasswordMutation.isPending || !newPassword}
                                >
                                    Sauvegarder
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
