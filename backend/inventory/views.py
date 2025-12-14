from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from core.permissions import CanManageInventory, CanViewInventory, IsAdminRole
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import Sum, F
from django.utils import timezone

from .models import Category, Product, Supplier, StockMovement, PurchaseOrder, PurchaseOrderItem, InventoryCount, InventoryCountItem
from .serializers import (
    CategorySerializer, 
    ProductSerializer, 
    ProductCreateSerializer,
    SupplierSerializer, 
    StockMovementSerializer,
    StockInSerializer,
    PurchaseOrderSerializer,
    PurchaseOrderCreateSerializer,
    InventoryCountSerializer,
    InventoryCountCreateSerializer,
    InventoryCountItemSerializer
)


class SupplierViewSet(viewsets.ModelViewSet):
    """API pour les fournisseurs"""
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'contact_name', 'email', 'phone']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']
    
    def get_queryset(self):
        queryset = super().get_queryset()
        active = self.request.query_params.get('active')
        if active is not None:
            queryset = queryset.filter(active=active.lower() == 'true')
        return queryset


class CategoryViewSet(viewsets.ModelViewSet):
    """API pour les catégories"""
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter]
    search_fields = ['name']


class ProductViewSet(viewsets.ModelViewSet):
    """API pour les produits"""
    queryset = Product.objects.select_related('category', 'supplier').all()
    permission_classes = [IsAuthenticated, CanManageInventory]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['category', 'supplier', 'active']
    search_fields = ['name', 'barcode', 'description']
    ordering_fields = ['name', 'stock', 'sale_price_ht', 'created_at']
    ordering = ['name']
    
    def get_serializer_class(self):
        if self.action == 'create':
            return ProductCreateSerializer
        return ProductSerializer
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filtre par code-barres exact
        barcode = self.request.query_params.get('barcode')
        if barcode:
            queryset = queryset.filter(barcode=barcode)
        
        # Filtre stock bas
        low_stock = self.request.query_params.get('low_stock')
        if low_stock and low_stock.lower() == 'true':
            queryset = queryset.filter(stock__lte=F('min_stock'))
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Statistiques globales des produits"""
        products = self.get_queryset()
        
        total_products = products.count()
        active_products = products.filter(active=True).count()
        low_stock_count = products.filter(stock__lte=F('min_stock')).count()
        out_of_stock = products.filter(stock=0).count()
        
        # Valeur totale du stock
        stock_value = products.aggregate(
            total=Sum(F('stock') * F('purchase_price'))
        )['total'] or 0
        
        return Response({
            'total_products': total_products,
            'active_products': active_products,
            'low_stock_count': low_stock_count,
            'out_of_stock': out_of_stock,
            'stock_value': float(stock_value)
        })
    
    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser], permission_classes=[IsAuthenticated, CanManageInventory])
    def import_excel(self, request):
        """Import products from Excel/CSV file"""
        try:
            try:
                import pandas as pd
                import openpyxl # Check existence
            except ImportError as e:
                return Response(
                    {'detail': f'Erreur configuration serveur (librairie manquante): {str(e)}. Essayez de redémarrer le serveur backend.'}, 
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

            from .models import Category, Supplier

            if 'file' not in request.FILES:
                return Response({'detail': 'Aucun fichier fourni.'}, status=status.HTTP_400_BAD_REQUEST)
            
            file = request.FILES['file']
            
            try:
                if file.name.endswith('.csv'):
                    df = pd.read_csv(file)
                else:
                    df = pd.read_excel(file)
            except Exception as e:
                return Response({'detail': f'Impossible de lire le fichier : {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Standardize column names (lowercase, strip)
            df.columns = df.columns.str.lower().str.strip()
            
            # Column Aliases (French/English)
            column_mapping = {
                'nom': 'name', 'désignation': 'name', 'designation': 'name', 'libellé': 'name', 'titre': 'name', 'produit': 'name',
                'code': 'barcode', 'code barre': 'barcode', 'code-barre': 'barcode', 'ean': 'barcode', 'ref': 'barcode', 'référence': 'barcode',
                'prix achat': 'purchase_price', 'coût': 'purchase_price', 'cout': 'purchase_price', 'pa': 'purchase_price',
                'prix vente': 'sale_price', 'pv': 'sale_price', 'prix': 'sale_price',
                'quantité': 'stock', 'qte': 'stock', 'qté': 'stock',
                'min': 'min_stock', 'seuil': 'min_stock', 'sueil': 'min_stock', 'alerte': 'min_stock', 'stock min': 'min_stock',
                'catégorie': 'category', 'famille': 'category', 'rayon': 'category',
                'fournisseur': 'supplier'
            }
            df.rename(columns=column_mapping, inplace=True)
            
            created_count = 0
            errors = []
            
            # Required columns
            if 'name' not in df.columns or 'barcode' not in df.columns:
                found_cols = ", ".join(df.columns.tolist())
                return Response(
                    {'detail': f'Colonnes obligatoires manquantes : "name" (ou Nom) et "barcode" (ou EAN/Code).\nColonnes trouvées : {found_cols}'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            for index, row in df.iterrows():
                try:
                    barcode = str(row['barcode']).strip()
                    # Skip empty barcodes
                    if not barcode or barcode.lower() == 'nan':
                        continue
                        
                    if Product.objects.filter(barcode=barcode).exists():
                        continue # Skip existing

                    # Category
                    category_name = row.get('category', 'Général')
                    if pd.isna(category_name) or not str(category_name).strip():
                        category_name = 'Général'
                        
                    category, _ = Category.objects.get_or_create(
                        name=str(category_name).strip(), 
                        defaults={'description': 'Auto-created from import'}
                    )
                    
                    # Supplier (Optional)
                    supplier = None
                    supplier_name = row.get('supplier')
                    if pd.notna(supplier_name) and str(supplier_name).strip() and str(supplier_name).lower() != 'nan':
                        supplier, _ = Supplier.objects.get_or_create(name=str(supplier_name).strip())
                    
                    # Prices (defaults)
                    purchase_price = row.get('purchase_price', 0)
                    sale_price_ht = row.get('sale_price', 0)
                    
                    # Handle NaN/None
                    if pd.isna(purchase_price): purchase_price = 0
                    if pd.isna(sale_price_ht): sale_price_ht = 0
                    
                    Product.objects.create(
                        name=row['name'],
                        barcode=barcode,
                        description=row.get('description', '') if pd.notna(row.get('description')) else '',
                        purchase_price=purchase_price,
                        sale_price_ht=sale_price_ht,
                        tva=row.get('tva', 20) if pd.notna(row.get('tva')) else 20,
                        stock=row.get('stock', 0) if pd.notna(row.get('stock')) else 0,
                        min_stock=row.get('min_stock', 5) if pd.notna(row.get('min_stock')) else 5,
                        category=category,
                        supplier=supplier
                    )
                    created_count += 1
                except Exception as e:
                    errors.append(f"Ligne {index + 2}: {str(e)}")
            
            return Response({
                'created': created_count,
                'errors': errors
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            # Catch-all for any other unhandled error
            import traceback
            traceback.print_exc()
            return Response({'detail': f'Erreur interne : {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['post'])
    def add_stock(self, request, pk=None):
        """Ajouter du stock à un produit"""
        product = self.get_object()
        serializer = StockInSerializer(data={
            'product': product.id,
            **request.data
        }, context={'request': request})
        
        if serializer.is_valid():
            movement = serializer.save()
            return Response({
                'message': f'{movement.quantity} unités ajoutées au stock',
                'new_stock': product.stock,
                'movement_id': movement.id
            })
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class StockMovementViewSet(viewsets.ModelViewSet):
    """API pour les mouvements de stock"""
    queryset = StockMovement.objects.select_related(
        'product', 'supplier', 'created_by'
    ).all()
    serializer_class = StockMovementSerializer
    permission_classes = [IsAuthenticated, CanViewInventory, CanManageInventory]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['product', 'movement_type', 'supplier']
    ordering_fields = ['created_at']
    ordering = ['-created_at']
    http_method_names = ['get', 'post', 'head', 'options']  # Pas de modification/suppression
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filtre par période
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        
        return queryset
    
    @action(detail=False, methods=['post'])
    def stock_in(self, request):
        """Entrée de stock (réapprovisionnement)"""
        serializer = StockInSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            movement = serializer.save()
            return Response(
                StockMovementSerializer(movement).data,
                status=status.HTTP_201_CREATED
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['post'])
    def bulk_stock_in(self, request):
        """Entrée de stock en masse"""
        items = request.data.get('items', [])
        results = []
        errors = []
        
        for item in items:
            serializer = StockInSerializer(data=item, context={'request': request})
            if serializer.is_valid():
                movement = serializer.save()
                results.append({
                    'product_id': item['product'],
                    'quantity': item['quantity'],
                    'success': True,
                    'movement_id': movement.id
                })
            else:
                errors.append({
                    'product_id': item.get('product'),
                    'errors': serializer.errors
                })
        
        return Response({
            'success': results,
            'errors': errors,
            'total_success': len(results),
            'total_errors': len(errors)
        })


class PurchaseOrderViewSet(viewsets.ModelViewSet):
    """API pour les commandes fournisseurs"""
    queryset = PurchaseOrder.objects.select_related('supplier', 'created_by').prefetch_related('items__product').all()
    permission_classes = [IsAuthenticated, IsAdminRole]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['supplier', 'status']
    ordering = ['-created_at']
    
    def get_serializer_class(self):
        if self.action == 'create':
            return PurchaseOrderCreateSerializer
        return PurchaseOrderSerializer
    
    @action(detail=True, methods=['post'])
    def send(self, request, pk=None):
        """Marquer commande comme envoyée"""
        order = self.get_object()
        if order.status != 'DRAFT':
            return Response({'detail': 'Commande déjà envoyée'}, status=400)
        order.status = 'SENT'
        order.save()
        return Response({'status': 'Commande envoyée'})
    
    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        """Réceptionner la commande et mettre à jour le stock"""
        order = self.get_object()
        if order.status not in ['SENT', 'PARTIAL']:
            return Response({'detail': 'Commande non envoyée'}, status=400)
        
        received_items = request.data.get('items', [])
        
        for received in received_items:
            try:
                item = order.items.get(id=received['item_id'])
                qty = int(received.get('quantity', item.quantity))
                item.received_quantity += qty
                item.save()
                
                # Ajouter au stock
                item.product.stock += qty
                item.product.save()
                
                # Créer mouvement de stock
                StockMovement.objects.create(
                    product=item.product,
                    movement_type='IN',
                    quantity=qty,
                    unit_cost=item.unit_cost,
                    supplier=order.supplier,
                    reference=f"PO-{order.reference}",
                    created_by=request.user
                )
            except PurchaseOrderItem.DoesNotExist:
                pass
        
        # Vérifier si toute la commande est reçue
        all_received = all(i.received_quantity >= i.quantity for i in order.items.all())
        order.status = 'RECEIVED' if all_received else 'PARTIAL'
        order.save()
        
        return Response(PurchaseOrderSerializer(order, context={'request': request}).data)
    
    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Annuler la commande"""
        order = self.get_object()
        order.status = 'CANCELLED'
        order.save()
        return Response({'status': 'Commande annulée'})


class InventoryCountViewSet(viewsets.ModelViewSet):
    """API pour les inventaires physiques"""
    queryset = InventoryCount.objects.select_related('created_by').prefetch_related('items__product').all()
    permission_classes = [IsAuthenticated, IsAdminRole]
    filter_backends = [filters.OrderingFilter]
    ordering = ['-created_at']
    
    def get_serializer_class(self):
        if self.action == 'create':
            return InventoryCountCreateSerializer
        return InventoryCountSerializer
    
    @action(detail=True, methods=['post'])
    def update_counts(self, request, pk=None):
        """Mettre à jour les quantités comptées"""
        count = self.get_object()
        if count.status != 'IN_PROGRESS':
            return Response({'detail': 'Comptage non en cours'}, status=400)
        
        counted_items = request.data.get('items', [])
        for item_data in counted_items:
            try:
                item = count.items.get(id=item_data['id'])
                item.counted_quantity = item_data.get('counted_quantity', 0)
                item.save()
            except InventoryCountItem.DoesNotExist:
                pass
        
        return Response(InventoryCountSerializer(count, context={'request': request}).data)
    
    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Marquer le comptage comme terminé"""
        count = self.get_object()
        count.status = 'COMPLETED'
        count.completed_at = timezone.now()
        count.save()
        return Response({'status': 'Comptage terminé'})
    
    @action(detail=True, methods=['post'])
    def validate(self, request, pk=None):
        """Valider le comptage et ajuster le stock"""
        count = self.get_object()
        if count.status != 'COMPLETED':
            return Response({'detail': 'Comptage non terminé'}, status=400)
        
        adjustments = []
        for item in count.items.all():
            diff = item.difference
            if diff != 0:
                # Ajuster le stock
                item.product.stock = item.counted_quantity
                item.product.save()
                
                # Créer mouvement de stock
                StockMovement.objects.create(
                    product=item.product,
                    movement_type='ADJUSTMENT',
                    quantity=abs(diff),
                    notes=f"Ajustement inventaire #{count.id}: {diff:+d}",
                    created_by=request.user
                )
                adjustments.append({
                    'product': item.product.name,
                    'expected': item.expected_quantity,
                    'counted': item.counted_quantity,
                    'difference': diff
                })
        
        count.status = 'VALIDATED'
        count.save()
        
        return Response({
            'status': 'Stock ajusté',
            'adjustments': adjustments
        })
