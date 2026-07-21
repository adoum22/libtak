export interface CurrentUserPermissions {
    role?: string;
    can_view_stock?: boolean;
    can_manage_stock?: boolean;
}

export const canAccessStock = (user: CurrentUserPermissions | null | undefined) => (
    user?.role === 'ADMIN'
    || user?.can_view_stock === true
    || user?.can_manage_stock === true
);
