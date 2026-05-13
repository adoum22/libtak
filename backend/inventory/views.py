from rest_framework import viewsets, filters, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from core.permissions import CanManageInventory, CanViewInventory, IsAdminRole, IsAdminOrReadOnly
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django_filters.rest_framework import DjangoFilterBackend
from django.core.files.base import ContentFile
from django.shortcuts import get_object_or_404
from django.db.models import DecimalField, Sum, F, Q
from django.utils import timezone
from decimal import Decimal, InvalidOperation
from io import BytesIO, StringIO
import csv
import logging
import unicodedata
import zipfile

logger = logging.getLogger(__name__)

from .models import Category, Product, ProductCostLayer, Supplier, StockMovement, PurchaseOrder, PurchaseOrderItem, InventoryCount, InventoryCountItem
from .serializers import (
    CategorySerializer,
    ProductSerializer,
    ProductCostLayerSerializer,
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


def update_product_cost_layer_for_request(request, product_id):
    product = get_object_or_404(Product, pk=product_id)
    layer_id = request.data.get('layer_id') or request.data.get('id')

    if layer_id:
        try:
            layer = product.cost_layers.get(id=layer_id)
        except ProductCostLayer.DoesNotExist:
            return Response({'detail': 'Lot FIFO introuvable pour ce produit.'}, status=404)
    else:
        layers = list(product.cost_layers.filter(
            remaining_quantity__gt=0,
        ).order_by('created_at', 'id'))
        index = int(request.data.get('index', 0) or 0)
        if index < 0 or index >= len(layers):
            return Response({'detail': 'Lot FIFO introuvable pour cette position.'}, status=404)
        layer = layers[index]

    serializer = ProductCostLayerSerializer(
        layer,
        data=request.data,
        partial=True,
        context={'request': request},
    )
    serializer.is_valid(raise_exception=True)
    serializer.save()
    first_active_layer = product.cost_layers.filter(
        remaining_quantity__gt=0,
    ).order_by('created_at', 'id').first()
    if first_active_layer and first_active_layer.id == layer.id:
        product.purchase_price = layer.unit_cost
        if layer.sale_price is not None:
            product.sale_price_ht = layer.sale_price
        product.save(update_fields=['purchase_price', 'sale_price_ht', 'updated_at'])
    product.refresh_from_db()
    return Response({
        'layer': serializer.data,
        'product': ProductSerializer(product, context={'request': request}).data,
    })


@api_view(['PATCH', 'POST'])
@permission_classes([IsAuthenticated, CanManageInventory])
def update_product_cost_layer(request, product_id):
    """Endpoint explicite et stable pour corriger un lot FIFO produit."""
    return update_product_cost_layer_for_request(request, product_id)


class SupplierViewSet(viewsets.ModelViewSet):
    """API pour les fournisseurs"""
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
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
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
    filter_backends = [filters.SearchFilter]
    search_fields = ['name']


class ProductViewSet(viewsets.ModelViewSet):
    """API pour les produits"""
    queryset = Product.objects.select_related('category', 'supplier').prefetch_related('cost_layers').all()
    permission_classes = [IsAuthenticated, CanManageInventory]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['category', 'supplier', 'active']
    search_fields = ['name', 'barcode', 'description']
    ordering_fields = ['name', 'stock', 'sale_price_ht', 'created_at']
    ordering = ['name']

    def _parse_decimal_param(self, name):
        value = self.request.query_params.get(name)
        if value in (None, ''):
            return None
        try:
            return Decimal(str(value).replace(',', '.'))
        except (InvalidOperation, TypeError):
            return None

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

        # Filtre stock bas (incluant les ruptures)
        low_stock = self.request.query_params.get('low_stock')
        if low_stock and low_stock.lower() == 'true':
            queryset = queryset.filter(stock__lte=F('min_stock'))

        # Filtre rupture seulement (stock = 0)
        stock_status = self.request.query_params.get('stock_status')
        if stock_status == 'out':
            queryset = queryset.filter(stock__lte=0)
        elif stock_status == 'low':
            queryset = queryset.filter(stock__lte=F('min_stock'), stock__gt=0)

        purchase_price = self._parse_decimal_param('purchase_price')
        purchase_price_min = self._parse_decimal_param('purchase_price_min')
        purchase_price_max = self._parse_decimal_param('purchase_price_max')

        # Recherche prix achat sur le prix par defaut du produit OU sur les lots
        # FIFO actifs. Utile pour retrouver les produits inventaires a 0 / 1000 DH.
        if purchase_price is not None:
            queryset = queryset.filter(
                Q(purchase_price=purchase_price)
                | Q(
                    cost_layers__remaining_quantity__gt=0,
                    cost_layers__unit_cost=purchase_price,
                )
            ).distinct()
        if purchase_price_min is not None:
            queryset = queryset.filter(
                Q(purchase_price__gte=purchase_price_min)
                | Q(
                    cost_layers__remaining_quantity__gt=0,
                    cost_layers__unit_cost__gte=purchase_price_min,
                )
            ).distinct()
        if purchase_price_max is not None:
            queryset = queryset.filter(
                Q(purchase_price__lte=purchase_price_max)
                | Q(
                    cost_layers__remaining_quantity__gt=0,
                    cost_layers__unit_cost__lte=purchase_price_max,
                )
            ).distinct()

        return queryset

    def perform_create(self, serializer):
        product = serializer.save()
        ProductCostLayer.create_layer(
            product=product,
            quantity=product.stock,
            unit_cost=product.purchase_price,
            sale_price=product.sale_price_ht,
            note='Stock initial produit',
        )

    def perform_update(self, serializer):
        old_product = Product.objects.get(pk=serializer.instance.pk)
        product = serializer.save()
        delta = product.stock - old_product.stock
        purchase_price_changed = product.purchase_price != old_product.purchase_price
        sale_price_changed = product.sale_price_ht != old_product.sale_price_ht
        if delta > 0:
            ProductCostLayer.create_layer(
                product=product,
                quantity=delta,
                unit_cost=product.purchase_price,
                sale_price=product.sale_price_ht,
                note='Ajout stock via fiche produit',
            )
        elif delta < 0:
            ProductCostLayer.consume_fifo(product, abs(delta))
        elif purchase_price_changed or sale_price_changed:
            current_layer = product.cost_layers.filter(
                remaining_quantity__gt=0,
            ).order_by('created_at', 'id').first()
            if current_layer:
                update_fields = []
                if purchase_price_changed:
                    current_layer.unit_cost = product.purchase_price
                    update_fields.append('unit_cost')
                if sale_price_changed:
                    current_layer.sale_price = product.sale_price_ht
                    update_fields.append('sale_price')
                if update_fields:
                    current_layer.save(update_fields=update_fields)

    def _update_cost_layer(self, product, layer, request):
        serializer = ProductCostLayerSerializer(
            layer,
            data=request.data,
            partial=True,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        product.refresh_from_db()
        return Response({
            'layer': serializer.data,
            'product': ProductSerializer(product, context={'request': request}).data,
        })

    @action(detail=True, methods=['patch'], url_path=r'cost-layers/(?P<layer_id>[^/.]+)')
    def update_cost_layer(self, request, pk=None, layer_id=None):
        """Corriger un lot FIFO actif appartenant au produit."""
        product = self.get_object()
        try:
            layer = product.cost_layers.get(id=layer_id)
        except ProductCostLayer.DoesNotExist:
            return Response({'detail': 'Lot FIFO introuvable pour ce produit.'}, status=404)
        return self._update_cost_layer(product, layer, request)

    @action(detail=True, methods=['patch'], url_path=r'cost-layers/by-position/(?P<position>[0-9]+)')
    def update_cost_layer_by_position(self, request, pk=None, position=None):
        """Fallback: corriger un lot FIFO actif par sa position dans la liste."""
        request.data['index'] = position
        return update_product_cost_layer_for_request(request, pk)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Statistiques globales des produits"""
        products = self.get_queryset()

        total_products = products.count()
        active_products = products.filter(active=True).count()
        low_stock_count = products.filter(stock__lte=F('min_stock')).count()
        out_of_stock = products.filter(stock=0).count()

        product_ids = products.values('id')
        stock_value = ProductCostLayer.objects.filter(
            product_id__in=product_ids,
            remaining_quantity__gt=0,
        ).aggregate(
            total=Sum(
                F('remaining_quantity') * F('unit_cost'),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
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
        return self._import_products_file(request)

    def _normalize_import_column(self, value):
        text = unicodedata.normalize('NFKD', str(value or ''))
        text = text.encode('ascii', 'ignore').decode('ascii')
        text = text.lower().strip().replace('_', ' ').replace('-', ' ')
        text = ' '.join(text.split())
        column_mapping = {
            'nom': 'name',
            'name': 'name',
            'designation': 'name',
            'libelle': 'name',
            'titre': 'name',
            'produit': 'name',
            'code': 'barcode',
            'code barre': 'barcode',
            'barcode': 'barcode',
            'ean': 'barcode',
            'ref': 'barcode',
            'reference': 'barcode',
            'prix achat': 'purchase_price',
            'cout': 'purchase_price',
            'pa': 'purchase_price',
            'purchase price': 'purchase_price',
            'prix vente': 'sale_price',
            'prix vente ht': 'sale_price',
            'pv': 'sale_price',
            'prix': 'sale_price',
            'sale price': 'sale_price',
            'sale price ht': 'sale_price',
            'quantite': 'stock',
            'qte': 'stock',
            'qty': 'stock',
            'stock': 'stock',
            'min': 'min_stock',
            'seuil': 'min_stock',
            'sueil': 'min_stock',
            'alerte': 'min_stock',
            'stock min': 'min_stock',
            'min stock': 'min_stock',
            'categorie': 'category',
            'category': 'category',
            'famille': 'category',
            'rayon': 'category',
            'fournisseur': 'supplier',
            'supplier': 'supplier',
            'description': 'description',
            'tva': 'tva',
            'vat': 'tva',
            'image': 'image',
            'photo': 'image',
        }
        return column_mapping.get(text, text)

    def _is_blank_import_value(self, value):
        if value is None:
            return True
        if isinstance(value, str):
            return value.strip().lower() in {'', 'nan', 'none', 'null'}
        return False

    def _import_text(self, value, default=''):
        if self._is_blank_import_value(value):
            return default
        return str(value).strip()

    def _import_decimal(self, value, default='0'):
        if self._is_blank_import_value(value):
            return Decimal(default)
        try:
            return Decimal(str(value).strip().replace(',', '.'))
        except (InvalidOperation, ValueError):
            return Decimal(default)

    def _import_int(self, value, default=0):
        if self._is_blank_import_value(value):
            return default
        try:
            return int(self._import_decimal(value, str(default)))
        except (InvalidOperation, ValueError):
            return default

    def _rows_from_csv_bytes(self, data):
        try:
            text = data.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = data.decode('cp1252')

        sample = text[:2048]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=',;')
        except csv.Error:
            dialect = csv.excel

        reader = csv.DictReader(StringIO(text), dialect=dialect)
        columns = [
            self._normalize_import_column(column)
            for column in (reader.fieldnames or [])
            if column
        ]
        rows = []
        for line_number, row in enumerate(reader, start=2):
            normalized = {}
            for key, value in row.items():
                if key is not None:
                    normalized[self._normalize_import_column(key)] = value
            rows.append((line_number, normalized))
        return columns, rows

    def _rows_from_excel_bytes(self, data):
        from openpyxl import load_workbook

        workbook = load_workbook(BytesIO(data), read_only=True, data_only=True)
        worksheet = workbook.active
        iterator = worksheet.iter_rows(values_only=True)
        headers = next(iterator, None)
        if not headers:
            return [], []

        columns = [self._normalize_import_column(header) for header in headers]
        rows = []
        for line_number, values in enumerate(iterator, start=2):
            normalized = {}
            for index, value in enumerate(values):
                if index < len(columns) and columns[index]:
                    normalized[columns[index]] = value
            rows.append((line_number, normalized))
        return columns, rows

    def _rows_from_import_bytes(self, filename, data):
        lower_name = filename.lower()
        if lower_name.endswith('.csv'):
            return self._rows_from_csv_bytes(data)
        if lower_name.endswith(('.xlsx', '.xlsm')):
            return self._rows_from_excel_bytes(data)
        raise ValueError('Format non supporte. Utilise CSV, XLSX ou ZIP.')

    def _zip_product_file(self, archive):
        preferred_names = (
            'produits.csv',
            'products.csv',
            'produits.xlsx',
            'products.xlsx',
        )
        members_by_name = {
            member.lower().replace('\\', '/').rsplit('/', 1)[-1]: member
            for member in archive.namelist()
        }
        for preferred_name in preferred_names:
            if preferred_name in members_by_name:
                return members_by_name[preferred_name]

        for member in archive.namelist():
            lower_member = member.lower()
            if lower_member.endswith(('.csv', '.xlsx', '.xlsm')):
                return member
        return None

    def _zip_image_members(self, archive):
        allowed_extensions = ('.jpg', '.jpeg', '.png', '.webp', '.gif')
        by_stem = {}
        by_name = {}
        for member in archive.namelist():
            lower_member = member.lower()
            if not lower_member.endswith(allowed_extensions):
                continue
            name = lower_member.rsplit('/', 1)[-1]
            stem = name.rsplit('.', 1)[0]
            by_name[name] = member
            by_stem.setdefault(stem, member)
        return by_name, by_stem

    def _zip_image_for_row(self, archive, image_maps, barcode, image_ref):
        if not archive:
            return None, None

        by_name, by_stem = image_maps
        candidates = []
        image_text = self._import_text(image_ref)
        if image_text:
            normalized = image_text.replace('\\', '/').lower().rsplit('/', 1)[-1]
            candidates.append(normalized)
            candidates.append(normalized.rsplit('.', 1)[0])
        if barcode:
            candidates.append(str(barcode).lower())

        for candidate in candidates:
            member = by_name.get(candidate) or by_stem.get(candidate)
            if member:
                filename = member.rsplit('/', 1)[-1]
                return filename, ContentFile(archive.read(member))
        return None, None

    def _import_products_file(self, request):
        """Import products from CSV, XLSX or ZIP without pandas."""
        if 'file' not in request.FILES:
            return Response(
                {'detail': 'Aucun fichier fourni.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        uploaded_file = request.FILES['file']
        archive = None
        image_maps = ({}, {})

        try:
            uploaded_data = uploaded_file.read()
            source_name = uploaded_file.name

            if source_name.lower().endswith('.zip'):
                archive = zipfile.ZipFile(BytesIO(uploaded_data))
                product_member = self._zip_product_file(archive)
                if not product_member:
                    return Response(
                        {'detail': 'Le ZIP doit contenir un fichier CSV ou XLSX.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                source_name = product_member
                uploaded_data = archive.read(product_member)
                image_maps = self._zip_image_members(archive)

            columns, rows = self._rows_from_import_bytes(source_name, uploaded_data)
            if 'name' not in columns or 'barcode' not in columns:
                found_cols = ', '.join(columns)
                return Response(
                    {
                        'detail': (
                            'Colonnes obligatoires manquantes : "name" '
                            '(ou Nom) et "barcode" (ou EAN/Code). '
                            f'Colonnes trouvees : {found_cols}'
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            created_count = 0
            updated_count = 0
            images_count = 0
            skipped_count = 0
            errors = []

            for line_number, row in rows:
                try:
                    barcode = self._import_text(row.get('barcode'))
                    name = self._import_text(row.get('name'))
                    if not barcode or not name:
                        skipped_count += 1
                        continue

                    existing_product = Product.objects.filter(barcode=barcode).first()
                    if existing_product:
                        image_name, image_content = self._zip_image_for_row(
                            archive,
                            image_maps,
                            barcode,
                            row.get('image'),
                        )
                        if image_name and image_content and not existing_product.image:
                            existing_product.image.save(
                                image_name,
                                image_content,
                                save=True,
                            )
                            updated_count += 1
                            images_count += 1
                        else:
                            skipped_count += 1
                        continue

                    category_name = self._import_text(row.get('category'), 'General')
                    category, _ = Category.objects.get_or_create(
                        name=category_name,
                        defaults={'description': 'Auto-created from import'},
                    )

                    supplier = None
                    supplier_name = self._import_text(row.get('supplier'))
                    if supplier_name:
                        supplier, _ = Supplier.objects.get_or_create(
                            name=supplier_name,
                        )

                    product = Product(
                        name=name,
                        barcode=barcode,
                        description=self._import_text(row.get('description')),
                        purchase_price=self._import_decimal(
                            row.get('purchase_price'), '0'
                        ),
                        sale_price_ht=self._import_decimal(row.get('sale_price'), '0'),
                        tva=Decimal('0'),
                        stock=self._import_int(row.get('stock'), 0),
                        min_stock=self._import_int(row.get('min_stock'), 5),
                        category=category,
                        supplier=supplier,
                    )

                    image_name, image_content = self._zip_image_for_row(
                        archive,
                        image_maps,
                        barcode,
                        row.get('image'),
                    )
                    if image_name and image_content:
                        product.image.save(image_name, image_content, save=False)
                        images_count += 1

                    product.save()
                    ProductCostLayer.create_layer(
                        product=product,
                        quantity=product.stock,
                        unit_cost=product.purchase_price,
                        sale_price=product.sale_price_ht,
                        note='Stock importé',
                    )
                    created_count += 1
                except Exception as exc:
                    errors.append(f"Ligne {line_number}: {exc}")

            return Response(
                {
                    'created': created_count,
                    'updated': updated_count,
                    'images': images_count,
                    'skipped': skipped_count,
                    'errors': errors,
                },
                status=status.HTTP_201_CREATED,
            )
        except ValueError as exc:
            return Response(
                {'detail': str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except zipfile.BadZipFile:
            return Response(
                {'detail': 'Fichier ZIP invalide.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            logger.exception("Product import failed")
            return Response(
                {'detail': "Erreur interne lors de l'import."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        finally:
            if archive:
                archive.close()

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


class ProductCostLayerViewSet(viewsets.ModelViewSet):
    """API pour consulter et corriger les lots FIFO actifs."""
    queryset = ProductCostLayer.objects.select_related('product').all()
    serializer_class = ProductCostLayerSerializer
    permission_classes = [IsAuthenticated, CanManageInventory]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['product']
    ordering_fields = ['created_at', 'unit_cost', 'sale_price']
    ordering = ['created_at', 'id']

    def get_queryset(self):
        queryset = super().get_queryset()
        active_only = self.request.query_params.get('active_only')
        if active_only and active_only.lower() == 'true':
            queryset = queryset.filter(remaining_quantity__gt=0)
        return queryset


class PurchaseOrderViewSet(viewsets.ModelViewSet):
    """API pour les commandes fournisseurs"""
    queryset = (
        PurchaseOrder.objects.select_related('supplier', 'created_by')
        .prefetch_related('items__product__cost_layers')
        .all()
    )
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
        """Réceptionner la commande et mettre à jour le stock.

        Format attendu de chaque item dans `items` :
            {
              "item_id":              <int, requis>,
              "quantity":             <int, optionnel — défaut = restant à recevoir>,
              "unit_cost":            <decimal, optionnel — prix réel de la livraison,
                                       remplace le prix négocié à la commande si fourni.
                                       Utile quand le fournisseur change le prix au
                                       dernier moment>,
              "update_purchase_price": <bool, optionnel — si true, met à jour
                                       Product.purchase_price avec ce nouveau coût
                                       (prix par défaut pour les futures commandes)>,
              "new_sale_price":       <decimal, optionnel — si fourni, met à jour
                                       Product.sale_price_ht (prix de vente public)>
            }

        Chaque réception crée un nouveau ProductCostLayer FIFO au coût indiqué :
        les anciennes unités déjà en stock continuent d'être consommées en premier
        avec leur prix d'origine, les nouvelles unités s'empilent au prix de cette
        livraison-ci. C'est le comportement FIFO attendu par l'utilisateur.
        """
        from django.db import transaction
        from decimal import Decimal, InvalidOperation

        order = self.get_object()
        if order.status not in ['SENT', 'PARTIAL']:
            return Response(
                {'detail': 'Commande non envoyée — réception impossible.'},
                status=400,
            )

        received_items = request.data.get('items', [])
        if not received_items:
            return Response(
                {'detail': "Aucun article à réceptionner."},
                status=400,
            )

        def parse_decimal(value):
            if value in (None, ''):
                return None
            try:
                return Decimal(str(value))
            except (InvalidOperation, TypeError):
                return None

        results = []
        with transaction.atomic():
            for received in received_items:
                try:
                    item = order.items.select_related('product').get(
                        id=received['item_id']
                    )
                except (PurchaseOrderItem.DoesNotExist, KeyError):
                    continue

                remaining = max(0, item.quantity - item.received_quantity)
                qty = int(received.get('quantity', remaining))
                if qty <= 0:
                    continue
                if qty > remaining:
                    qty = remaining  # safeguard contre la sur-réception

                # Coût appliqué à cette livraison : override saisi à la réception
                # OU prix négocié à la commande par défaut.
                override_cost = parse_decimal(received.get('unit_cost'))
                applied_cost = override_cost if override_cost is not None else item.unit_cost

                # Optionnel : propager comme nouveau prix d'achat par défaut sur le produit
                update_default = bool(received.get('update_purchase_price'))
                # Prix de vente public a appliquer : priorite a la saisie de
                # reception, sinon au prix prevu sur la commande fournisseur.
                new_sale_price = (
                    parse_decimal(received.get('new_sale_price'))
                    or item.sale_price
                )

                # Création du mouvement de stock — déclenche automatiquement
                # la création du ProductCostLayer FIFO via StockMovement.save()
                StockMovement.objects.create(
                    product=item.product,
                    movement_type='IN',
                    quantity=qty,
                    unit_cost=applied_cost,
                    sale_price=new_sale_price,
                    supplier=order.supplier,
                    reference=f"PO-{order.reference}",
                    notes=(
                        f"Réception commande {order.reference}"
                        if not override_cost
                        else f"Réception {order.reference} — prix ajusté à la livraison"
                    ),
                    created_by=request.user,
                )

                # Met à jour la quantité reçue de la ligne de commande
                item.received_quantity += qty
                item.save(update_fields=['received_quantity'])

                # Mise à jour des prix produit si demandé
                product_changes = []
                if update_default and applied_cost is not None:
                    item.product.purchase_price = applied_cost
                    product_changes.append('purchase_price')
                if product_changes:
                    product_changes.append('updated_at')
                    item.product.save(update_fields=product_changes)

                results.append({
                    'item_id': item.id,
                    'product': item.product.name,
                    'received': qty,
                    'unit_cost_applied': float(applied_cost or 0),
                    'updated_purchase_price': update_default,
                    'updated_sale_price': new_sale_price is not None and new_sale_price > 0,
                })

            # Mise à jour du statut de la commande
            all_received = not PurchaseOrderItem.objects.filter(
                order=order,
                received_quantity__lt=F('quantity'),
            ).exists()
            order.status = 'RECEIVED' if all_received else 'PARTIAL'
            order.save(update_fields=['status', 'updated_at'])
            order.refresh_from_db()

        return Response({
            'order': PurchaseOrderSerializer(order, context={'request': request}).data,
            'results': results,
        })

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Annuler la commande"""
        order = self.get_object()
        order.status = 'CANCELLED'
        order.save()
        return Response({'status': 'Commande annulée'})


class InventoryCountViewSet(viewsets.ModelViewSet):
    """API pour les inventaires physiques"""
    queryset = InventoryCount.objects.select_related('counted_by').prefetch_related('items__product').all()
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
