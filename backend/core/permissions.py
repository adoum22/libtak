from rest_framework import permissions


class IsAdminRole(permissions.BasePermission):
    """
    Permission pour les administrateurs uniquement
    """
    message = "Accès réservé aux administrateurs."
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.is_admin_role
        )


class IsCashierRole(permissions.BasePermission):
    """
    Permission pour les vendeurs (caissiers)
    """
    message = "Accès réservé aux vendeurs."
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.is_cashier_role
        )


class IsAdminOrReadOnly(permissions.BasePermission):
    """
    Admin peut tout faire, les autres peuvent seulement lire
    """
    message = "Modification réservée aux administrateurs."
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Lecture autorisée pour tous les authentifiés
        if request.method in permissions.SAFE_METHODS:
            return True
        
        # Écriture réservée aux admins
        return request.user.is_admin_role


class IsAdminOrCashierReadOnly(permissions.BasePermission):
    """
    Admin peut tout faire, vendeur peut lire et certaines actions
    """
    message = "Cette action est réservée aux administrateurs."
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Admin a tous les droits
        if request.user.is_admin_role:
            return True
        
        # Vendeur peut lire
        if request.method in permissions.SAFE_METHODS:
            return True
        
        return False


class CanAccessPOS(permissions.BasePermission):
    """
    Accès au module POS - Admin et Vendeur
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.user.is_admin_role or request.user.is_cashier_role


class CanAccessReports(permissions.BasePermission):
    """
    Accès aux rapports - Admin uniquement
    """
    message = "Accès aux rapports réservé aux administrateurs."
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.is_admin_role
        )


class CanManageUsers(permissions.BasePermission):
    """
    Gestion des utilisateurs - Admin uniquement
    """
    message = "Gestion des utilisateurs réservée aux administrateurs."
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.is_admin_role
        )


class CanViewInventory(permissions.BasePermission):
    """
    Lecture Inventaire : 
    - Admin : Toujours OK
    - Vendeur : Si setting 'cashier_can_view_stock' est True
    """
    message = "L'accès à l'inventaire n'est pas autorisé."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
            
        if request.user.is_admin_role:
            return True
            
        # Vérification pour Vendeur
        return request.user.can_view_stock


class CanManageInventory(permissions.BasePermission):
    """
    Gestion Inventaire (Ajout/Modif) :
    - Admin : Toujours OK
    - Vendeur : Si user.can_manage_stock est True
    - Lecture seule : Toujours OK si la permission de Vue est passée (gérée avant)
    """
    message = "Modification de l'inventaire non autorisée."
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Lecture (SAFE_METHODS) est gérée par CanViewInventory ou IsAuthenticated
        if request.method in permissions.SAFE_METHODS:
            return True
            
        # Écriture
        if request.user.is_admin_role:
            return True
            
        # Vérification pour Vendeur en écriture
        return request.user.can_manage_stock
