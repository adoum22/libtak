import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import { useTranslation } from 'react-i18next';
import Pagination from '../components/Pagination';
import ConfirmDialog from '../components/ConfirmDialog';
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
    effective_can_view_stock: boolean;
    effective_can_manage_stock: boolean;
}

const PAGE_SIZE = 12;

const fetchAllUsers = async (): Promise<User[]> => {
    const users: User[] = [];
    let nextUrl: string | null = '/auth/users/?page=1';
    while (nextUrl) {
        const response = await client.get(nextUrl);
        if (Array.isArray(response.data)) return response.data;
        users.push(...(response.data?.results ?? []));
        const next = response.data?.next as string | null | undefined;
        nextUrl = next ? `${new URL(next, window.location.origin).pathname}${new URL(next, window.location.origin).search}` : null;
    }
    return users;
};

type UserUpdatePayload = Partial<Omit<User, 'id' | 'avatar'>> & {
    avatar?: File | null;
};

export default function Users() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const { t } = useTranslation();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRole, setFilterRole] = useState<'ALL' | 'ADMIN' | 'CASHIER'>('ALL');
    const [page, setPage] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [selectedUserForPassword, setSelectedUserForPassword] = useState<User | null>(null);
    const [pendingStatusUser, setPendingStatusUser] = useState<User | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        first_name: '',
        last_name: '',
        role: 'CASHIER' as 'ADMIN' | 'CASHIER',
        phone: '',
        password: '',
        password_confirm: '',
        can_view_stock: false,
        can_manage_stock: false,
        avatar: null as File | null
    });
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    // Fetch Users
    const { data: users = [], isLoading, isError, refetch } = useQuery<User[]>({
        queryKey: ['users'],
        queryFn: fetchAllUsers,
    });
    const { data: currentUser } = useQuery<User>({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then(response => response.data),
        staleTime: 60_000,
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
        onError: (error: unknown) => {
            toast.error(t('OperationError', { message: getApiErrorMessage(error) }));
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: number; data: UserUpdatePayload }) =>
            client.patch(`/auth/users/${id}/`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            closeModal();
            toast.success(t('UserUpdated'));
        },
        onError: (error: unknown) => {
            toast.error(t('OperationError', { message: getApiErrorMessage(error) }));
        }
    });

    const toggleActiveMutation = useMutation({
        mutationFn: (id: number) => client.post(`/auth/users/${id}/toggle_active/`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setPendingStatusUser(null);
            toast.success(t('UserStatusUpdated'));
        },
        onError: (error: unknown) => {
            setPendingStatusUser(null);
            toast.error(t('OperationError', { message: getApiErrorMessage(error) }));
        },
    });

    const resetPasswordMutation = useMutation({
        mutationFn: ({ id, password }: { id: number; password: string }) =>
            client.post(`/auth/users/${id}/reset_password/`, { new_password: password }),
        onSuccess: () => {
            toast.success(t('PasswordResetSuccess'));
            closePasswordModal();
        },
        onError: (error: unknown) => {
            toast.error(t('OperationError', { message: getApiErrorMessage(error, t('PasswordChangeFailed')) }));
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
                password_confirm: '',
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
                password: '',
                password_confirm: '',
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
        // Refresh user list to avoid rendering issues
        queryClient.invalidateQueries({ queryKey: ['users'] });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!editingUser && formData.password !== formData.password_confirm) {
            toast.error(t('PasswordsDoNotMatch'));
            return;
        }

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
                is_active: editingUser.is_active ?? true,
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
            if (formData.password) {
                data.append('password', formData.password);
                data.append('password_confirm', formData.password_confirm);
            }
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

    useEffect(() => () => {
        if (previewImage?.startsWith('blob:')) URL.revokeObjectURL(previewImage);
    }, [previewImage]);

    const filteredUsers = users?.filter(user => {
        const matchesSearch =
            user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.last_name.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesRole = filterRole === 'ALL' || user.role === filterRole;

        return matchesSearch && matchesRole;
    });
    const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
    const visibleUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-primary">
                        {t('Users')}
                    </h1>
                    <p className="text-muted mt-1">{t('Permissions')}</p>
                </div>
                <button
                    type="button"
                    onClick={() => handleOpenModal()}
                    className="btn-primary flex items-center gap-2"
                    title={t('AddUser')}
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
                        aria-label={t('SearchUsers')}
                        onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                    />
                </div>
                <div className="flex bg-tertiary/30 p-1 rounded-lg" role="group" aria-label={t('FilterByRole')}>
                    {(['ALL', 'ADMIN', 'CASHIER'] as const).map((role) => (
                        <button
                            type="button"
                            key={role}
                            onClick={() => { setFilterRole(role); setPage(1); }}
                            aria-pressed={filterRole === role}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${filterRole === role
                                ? 'bg-secondary text-primary shadow-sm'
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
                        <p className="mt-4 text-muted">{t('UsersLoading')}</p>
                    </div>
                ) : isError ? (
                    <div className="col-span-full network-error-state" role="alert">
                        <p className="font-semibold">{t('UsersLoadFailed')}</p>
                        <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>{t('Retry')}</button>
                    </div>
                ) : filteredUsers.length === 0 ? (
                    <div className="col-span-full text-center py-12 bg-tertiary/10 rounded-xl border border-dashed border-tertiary">
                        <UsersIcon size={48} className="mx-auto text-muted mb-4" />
                        <h2 className="text-lg font-bold">{t('NoUsersFound')}</h2>
                        <p className="text-muted">{users.length === 0 ? t('CreateFirstUser') : t('BroadenUserFilters')}</p>
                    </div>
                ) : (
                    visibleUsers.map((user) => (
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
                                                    {user.first_name?.[0] || user.username[0]}{user.last_name?.[0] || ''}
                                                </div>
                                            )}
                                        </div>
                                        <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white ${user.is_active ? 'bg-success' : 'bg-danger'}`} title={user.is_active ? t('Active') : t('Inactive')}>
                                            <span className="sr-only">{user.is_active ? t('ActiveAccount') : t('InactiveAccount')}</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleOpenPasswordModal(user)}
                                            className="p-2 hover:bg-tertiary/20 rounded-full text-muted hover:text-primary transition-colors"
                                            title={t('ChangePassword')}
                                            aria-label={t('ChangePasswordFor', { username: user.username })}
                                        >
                                            <Lock size={18} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleOpenModal(user)}
                                            className="p-2 hover:bg-tertiary/20 rounded-full text-muted hover:text-accent transition-colors"
                                            title={t('Edit')}
                                            aria-label={t('EditNamed', { name: user.username })}
                                        >
                                            <Edit size={18} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPendingStatusUser(user)}
                                            disabled={user.id === currentUser?.id}
                                            className={`p-2 hover:bg-tertiary/20 rounded-full transition-colors ${user.is_active ? 'text-success hover:text-red-500' : 'text-red-500 hover:text-success'
                                                }`}
                                            title={user.id === currentUser?.id
                                                ? t('CannotDisableOwnAccount')
                                                : user.is_active ? t('Disable') : t('Enable')}
                                            aria-label={user.id === currentUser?.id
                                                ? t('CannotDisableOwnAccount')
                                                : t(user.is_active ? 'DisableNamed' : 'EnableNamed', { name: user.username })}
                                        >
                                            <Power size={18} />
                                        </button>
                                    </div>
                                </div>

                                <h2 className="text-lg font-bold mb-1">{user.first_name} {user.last_name}</h2>
                                <p className="text-sm text-muted mb-3">@{user.username}</p>

                                <div className="flex items-center gap-2 mb-4">
                                    <span className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 ${user.role === 'ADMIN'
                                        ? 'bg-primary/10 text-primary'
                                        : 'bg-accent/10 text-accent'
                                        }`}>
                                        {user.role === 'ADMIN' ? <Shield size={12} /> : <UsersIcon size={12} />}
                                        {user.role === 'ADMIN' ? t('Administrator') : t('Seller')}
                                    </span>
                                </div>

                                <div className="space-y-2 text-sm text-muted border-t pt-4">
                                    <div>
                                        <span className="opacity-70 block text-xs uppercase tracking-wider mb-1">{t('Email')}</span>
                                        {user.email}
                                    </div>
                                    <div>
                                        <span className="opacity-70 block text-xs uppercase tracking-wider mb-1">{t('Phone')}</span>
                                        {user.phone || '-'}
                                    </div>
                                    {user.role === 'CASHIER' && (
                                        <div className="grid grid-cols-2 gap-2 mt-3">
                                            <div className={`p-2 rounded bg-tertiary/20 text-center ${user.effective_can_view_stock ? 'text-success' : 'text-muted'}`}>
                                                <span className="text-xs font-bold block">{t('ViewStockShort')}</span>
                                                {user.effective_can_view_stock ? '✓' : '✗'}
                                                {user.effective_can_view_stock !== user.can_view_stock && (
                                                    <span className="block text-[10px] text-muted">{t('GlobalPermission')}</span>
                                                )}
                                            </div>
                                            <div className={`p-2 rounded bg-tertiary/20 text-center ${user.effective_can_manage_stock ? 'text-success' : 'text-muted'}`}>
                                                <span className="text-xs font-bold block">{t('ManageStockShort')}</span>
                                                {user.effective_can_manage_stock ? '✓' : '✗'}
                                                {user.effective_can_manage_stock !== user.can_manage_stock && (
                                                    <span className="block text-[10px] text-muted">{t('GlobalPermission')}</span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {!isLoading && !isError && (
                <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    totalItems={filteredUsers.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                />
            )}

            {/* User Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn" role="presentation">
                    <div className="bg-secondary rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-scaleIn" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
                        <div className="p-6 border-b flex justify-between items-center bg-tertiary/50">
                            <h2 id="user-modal-title" className="text-2xl font-bold text-primary">
                                {editingUser ? t('EditUser') : t('NewUser')}
                            </h2>
                            <button type="button" onClick={closeModal} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-tertiary transition-colors" aria-label={t('CloseWindow')}>
                                ×
                            </button>
                        </div>

                        <div className="p-8">
                            <form className="space-y-6" onSubmit={handleSubmit}>
                                {/* Avatar Upload */}
                                <div className="flex justify-center mb-6">
                                    <div className="relative group cursor-pointer">
                                        <div className="w-24 h-24 rounded-full overflow-hidden bg-tertiary/20 border-2 border-dashed border-tertiary hover:border-primary transition-colors flex items-center justify-center">
                                            {previewImage ? (
                                                <img src={previewImage} alt={t('AvatarPreview')} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="text-center p-2">
                                                    <UserPlus className="mx-auto text-muted mb-1" size={20} />
                                                    <span className="text-xs text-muted block">{t('Photo')}</span>
                                                </div>
                                            )}
                                        </div>
                                        <input
                                            type="file"
                                            className="absolute inset-0 opacity-0 cursor-pointer"
                                            onChange={handleImageChange}
                                            accept="image/*"
                                            aria-label={t('ChooseAvatar')}
                                        />
                                        <div className="absolute bottom-0 right-0 bg-primary text-white p-1 rounded-full shadow-lg transform translate-x-1/4 translate-y-1/4">
                                            <Edit size={12} />
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group">
                                        <label htmlFor="user-first-name">{t('FirstName')}</label>
                                        <input
                                            id="user-first-name"
                                            type="text"
                                            value={formData.first_name}
                                            onChange={e => setFormData({ ...formData, first_name: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="user-last-name">{t('LastName')}</label>
                                        <input
                                            id="user-last-name"
                                            type="text"
                                            value={formData.last_name}
                                            onChange={e => setFormData({ ...formData, last_name: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group">
                                        <label htmlFor="user-username">{t('Username')}</label>
                                        <input
                                            id="user-username"
                                            type="text"
                                            value={formData.username}
                                            onChange={e => setFormData({ ...formData, username: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="user-role">{t('Role')}</label>
                                        <select
                                            id="user-role"
                                            value={formData.role}
                                            onChange={e => setFormData({ ...formData, role: e.target.value as 'ADMIN' | 'CASHIER' })}
                                        >
                                            <option value="CASHIER">{t('Seller')}</option>
                                            <option value="ADMIN">{t('Administrator')}</option>
                                        </select>
                                    </div>
                                </div>

                                {formData.role === 'CASHIER' && (
                                    <div className="card bg-tertiary/20 p-4 border border-tertiary">
                                        <h3 className="font-bold text-sm mb-3 text-muted">{t('SellerPermissions')}</h3>
                                        <div className="space-y-3">
                                            <label className="flex items-center gap-3 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={formData.can_view_stock}
                                                    onChange={e => setFormData({ ...formData, can_view_stock: e.target.checked })}
                                                    className="w-5 h-5 accent-accent"
                                                />
                                                <div>
                                                    <span className="font-medium block">{t('ViewStock')}</span>
                                                    <span className="text-xs text-muted">{t('ViewStockReadOnlyHint')}</span>
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
                                                    <span className="font-medium block">{t('ManageStock')}</span>
                                                    <span className="text-xs text-muted">{t('ManageStockHint')}</span>
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                )}

                                <div className="form-group">
                                    <label htmlFor="user-email">{t('Email')}</label>
                                    <input
                                        id="user-email"
                                        type="email"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="user-phone">{t('Phone')}</label>
                                    <input
                                        id="user-phone"
                                        type="tel"
                                        value={formData.phone}
                                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    />
                                </div>

                                {!editingUser && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="form-group">
                                            <label htmlFor="user-password">{t('Password')}</label>
                                            <input
                                                id="user-password"
                                                type="password"
                                                value={formData.password}
                                                onChange={e => setFormData({ ...formData, password: e.target.value })}
                                                required
                                                minLength={12}
                                                aria-describedby="user-password-help"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="user-password-confirm">{t('ConfirmPassword')}</label>
                                            <input
                                                id="user-password-confirm"
                                                type="password"
                                                value={formData.password_confirm}
                                                onChange={e => setFormData({ ...formData, password_confirm: e.target.value })}
                                                required
                                                minLength={12}
                                            />
                                        </div>
                                    </div>
                                )}
                                {!editingUser && <p id="user-password-help" className="text-xs text-muted">{t('MinimumPasswordLength')}</p>}

                                <div className="pt-6 border-t flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={closeModal}
                                        className="btn-ghost"
                                    >
                                        {t('Cancel')}
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn-primary"
                                        disabled={createMutation.isPending || updateMutation.isPending}
                                    >
                                        {createMutation.isPending || updateMutation.isPending ? (
                                            <span className="flex items-center gap-2">
                                                <span className="loader w-4 h-4 border-2"></span>
                                                {t('Processing')}
                                            </span>
                                        ) : (
                                            editingUser ? t('UpdateUser') : t('Create')
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
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn" role="presentation">
                    <div className="bg-secondary rounded-2xl w-full max-w-sm shadow-2xl animate-scaleIn" role="dialog" aria-modal="true" aria-labelledby="password-modal-title">
                        <div className="p-6 border-b flex justify-between items-center bg-tertiary/50">
                            <h2 id="password-modal-title" className="text-lg font-bold">{t('ChangePassword')}</h2>
                            <button type="button" onClick={closePasswordModal} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-tertiary" aria-label={t('CloseWindow')}>×</button>
                        </div>
                        <form className="p-6" onSubmit={(event) => { event.preventDefault(); if (selectedUserForPassword) resetPasswordMutation.mutate({ id: selectedUserForPassword.id, password: newPassword }); }}>
                            <p className="text-sm text-muted mb-4">
                                {t('PasswordResetFor', { username: selectedUserForPassword?.username })}
                            </p>
                            <input
                                aria-label={t('NewPassword')}
                                type="password"
                                placeholder={t('NewPassword')}
                                className="input w-full mb-4"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                minLength={12}
                                required
                                aria-describedby="reset-password-help"
                            />
                            <p id="reset-password-help" className="text-xs text-muted mb-4">{t('MinimumPasswordLength')}</p>
                            <div className="flex justify-end gap-2">
                                <button type="button" onClick={closePasswordModal} className="btn-ghost">{t('Cancel')}</button>
                                <button
                                    type="submit"
                                    className="btn-primary"
                                    disabled={resetPasswordMutation.isPending || newPassword.length < 12}
                                >
                                    {t('Save')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={Boolean(pendingStatusUser)}
                title={pendingStatusUser?.is_active ? t('DisableUserTitle') : t('EnableUserTitle')}
                description={pendingStatusUser?.is_active
                    ? t('DisableUserDescription', { name: pendingStatusUser.username })
                    : t('EnableUserDescription', { name: pendingStatusUser?.username })}
                confirmLabel={pendingStatusUser?.is_active ? t('Disable') : t('Enable')}
                busy={toggleActiveMutation.isPending}
                onCancel={() => setPendingStatusUser(null)}
                onConfirm={() => {
                    if (pendingStatusUser) toggleActiveMutation.mutate(pendingStatusUser.id);
                }}
            />
        </div>
    );
}
