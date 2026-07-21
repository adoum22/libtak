from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.conf import settings
from django.utils import timezone
from django.utils.translation import gettext_lazy as _


class Supplier(models.Model):
    """Fournisseur de produits"""
    name = models.CharField(_('Name'), max_length=200)
    contact_name = models.CharField(_('Contact Name'), max_length=100, blank=True)
    email = models.EmailField(_('Email'), blank=True)
    phone = models.CharField(_('Phone'), max_length=20, blank=True)
    address = models.TextField(_('Address'), blank=True)
    notes = models.TextField(_('Notes'), blank=True)
    active = models.BooleanField(_('Active'), default=True)
    image = models.ImageField(_('Image'), upload_to='suppliers/', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _('Supplier')
        verbose_name_plural = _('Suppliers')
        ordering = ['name']

    def __str__(self):
        return self.name


class Category(models.Model):
    """Catégorie de produits"""
    name = models.CharField(_('Name'), max_length=100)
    description = models.TextField(_('Description'), blank=True)
    icon = models.CharField(_('Icon'), max_length=50, blank=True, help_text="Lucide icon name")
    color = models.CharField(_('Color'), max_length=7, blank=True, help_text="Hex color code")

    class Meta:
        verbose_name = _('Category')
        verbose_name_plural = _('Categories')
        ordering = ['name']

    def __str__(self):
        return self.name


class Product(models.Model):
    """Produit avec prix d'achat et de vente"""
    name = models.CharField(_('Name'), max_length=200)
    barcode = models.CharField(_('Barcode'), max_length=50, unique=True, db_index=True)
    description = models.TextField(_('Description'), blank=True)

    # Prix
    purchase_price = models.DecimalField(
        _('Purchase Price'),
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text=_('Cost price from supplier')
    )
    sale_price_ht = models.DecimalField(
        _('Sale Price HT'),
        max_digits=10,
        decimal_places=2,
        help_text=_('Selling price before tax')
    )
    tva = models.DecimalField(
        _('VAT (%)'),
        max_digits=5,
        decimal_places=2,
        default=20.00
    )

    # Stock
    stock = models.IntegerField(_('Stock'), default=0)
    min_stock = models.IntegerField(_('Min Stock'), default=5)

    # Relations
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='products'
    )
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='products',
        verbose_name=_('Supplier')
    )

    # Image
    image = models.ImageField(
        _('Image'),
        upload_to='products/',
        blank=True,
        null=True
    )

    # Status
    active = models.BooleanField(_('Active'), default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _('Product')
        verbose_name_plural = _('Products')
        ordering = ['name']
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['barcode']),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(purchase_price__gte=0),
                name='inventory_product_purchase_nonneg',
            ),
            models.CheckConstraint(
                condition=models.Q(sale_price_ht__gte=0),
                name='inventory_product_sale_nonneg',
            ),
            models.CheckConstraint(
                condition=models.Q(tva__gte=0, tva__lte=100),
                name='inventory_product_tva_range',
            ),
            models.CheckConstraint(
                condition=models.Q(stock__gte=0),
                name='inventory_product_stock_nonneg',
            ),
            models.CheckConstraint(
                condition=models.Q(min_stock__gte=0),
                name='inventory_product_min_stock_nonneg',
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.barcode})"

    # Helpers pour neutraliser les valeurs NULL / Decimal manquants — un
    # produit créé via une vieille migration ou un import bâclé peut avoir
    # min_stock=None ou purchase_price=None, ce qui faisait crasher le
    # serializer (TypeError sur '0 <= None') -> 500 sur /inventory/products/
    # -> "Erreur de chargement" côté frontend.
    @staticmethod
    def _safe_decimal(value, default='0'):
        from decimal import Decimal
        if value is None:
            return Decimal(default)
        return value if hasattr(value, 'quantize') else Decimal(str(value))

    @staticmethod
    def _safe_int(value, default=0):
        if value is None:
            return default
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    @property
    def price_ttc(self):
        """Prix public affiche/vendu.

        Le champ historique s'appelle encore `price_ttc` pour compatibilite
        API, mais LibTak ne majore plus automatiquement les prix avec la TVA.
        La TVA est reservee aux factures. Le prix courant de la fiche produit
        s'applique a tout le stock restant ; les lots FIFO ne conservent que
        leur cout d'achat pour la valorisation et la marge.
        """
        return self._safe_decimal(self.sale_price_ht)

    @property
    def profit_margin(self):
        """Marge bénéficiaire par unité"""
        current_layer = self.cost_layers.filter(
            remaining_quantity__gt=0,
        ).order_by('created_at', 'id').first()
        if current_layer:
            return (
                self._safe_decimal(self.sale_price_ht)
                - self._safe_decimal(current_layer.unit_cost)
            )
        return self._safe_decimal(self.sale_price_ht) - self._safe_decimal(self.purchase_price)

    @property
    def profit_percentage(self):
        """Pourcentage de marge"""
        current_layer = self.cost_layers.filter(
            remaining_quantity__gt=0,
        ).order_by('created_at', 'id').first()
        if current_layer:
            pp = self._safe_decimal(current_layer.unit_cost)
            sp = self._safe_decimal(self.sale_price_ht)
        else:
            pp = self._safe_decimal(self.purchase_price)
            sp = self._safe_decimal(self.sale_price_ht)
        if pp > 0:
            from decimal import Decimal
            return ((sp - pp) / pp) * Decimal('100')
        return 0

    @property
    def stock_value(self):
        """Valeur du stock au prix d'achat"""
        try:
            layered_value = self.cost_layers.aggregate(
                total=models.Sum(
                    models.F('remaining_quantity') * models.F('unit_cost'),
                    output_field=models.DecimalField(max_digits=14, decimal_places=2),
                ),
            )['total']
        except Exception:
            layered_value = None
        if layered_value is not None:
            return layered_value
        return self._safe_int(self.stock) * self._safe_decimal(self.purchase_price)

    @property
    def is_low_stock(self):
        """Vérifie si le stock est bas (robuste aux NULL legacy)."""
        return self._safe_int(self.stock) <= self._safe_int(self.min_stock, default=5)


class ProductCostLayer(models.Model):
    """Lot de coût d'achat consommé en FIFO par les ventes."""
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='cost_layers',
    )
    source_movement = models.OneToOneField(
        'StockMovement',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cost_layer',
    )
    unit_cost = models.DecimalField(_('Unit Cost'), max_digits=10, decimal_places=2)
    sale_price = models.DecimalField(
        _('Sale Price'),
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
    )
    initial_quantity = models.PositiveIntegerField(_('Initial Quantity'))
    remaining_quantity = models.PositiveIntegerField(_('Remaining Quantity'))
    note = models.CharField(_('Note'), max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _('Product Cost Layer')
        verbose_name_plural = _('Product Cost Layers')
        ordering = ['created_at', 'id']
        indexes = [
            models.Index(fields=['product', 'remaining_quantity', 'created_at']),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(unit_cost__gte=0),
                name='inventory_fifo_cost_nonneg',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(sale_price__isnull=True)
                    | models.Q(sale_price__gte=0)
                ),
                name='inventory_fifo_sale_nonneg',
            ),
            models.CheckConstraint(
                condition=models.Q(
                    remaining_quantity__lte=models.F('initial_quantity')
                ),
                name='inventory_fifo_remaining_lte_initial',
            ),
        ]

    def __str__(self):
        return f"{self.product.name}: {self.remaining_quantity}/{self.initial_quantity} @ {self.unit_cost}"

    @classmethod
    def create_layer(
        cls,
        product,
        quantity,
        unit_cost=None,
        sale_price=None,
        source_movement=None,
        note='',
    ):
        if quantity <= 0:
            return None
        return cls.objects.create(
            product=product,
            source_movement=source_movement,
            unit_cost=unit_cost if unit_cost is not None else product.purchase_price,
            sale_price=sale_price if sale_price is not None else product.sale_price_ht,
            initial_quantity=quantity,
            remaining_quantity=quantity,
            note=note,
        )

    @classmethod
    def active_quantity(cls, product):
        """Return the quantity represented by the product's active FIFO lots."""
        return cls.objects.filter(
            product=product,
            remaining_quantity__gt=0,
        ).aggregate(total=models.Sum('remaining_quantity'))['total'] or 0

    @classmethod
    def invariant_delta(cls, product):
        """Positive means stock is missing FIFO units; negative means excess lots."""
        return int(product.stock or 0) - int(cls.active_quantity(product))

    @classmethod
    def assert_matches_stock(cls, product):
        delta = cls.invariant_delta(product)
        if delta:
            raise ValidationError(
                f'Incoherence FIFO pour le produit {product.pk}: '
                f'stock={product.stock}, ecart_lots={delta}.'
            )

    @classmethod
    def reconcile_to_stock(cls, product, note='Rattrapage invariant FIFO'):
        """Atomically make active FIFO quantities match ``Product.stock``."""
        with transaction.atomic():
            locked_product = Product.objects.select_for_update().get(pk=product.pk)
            target = int(locked_product.stock or 0)
            if target < 0:
                raise ValidationError(
                    f'Le stock négatif du produit {locked_product.pk} '
                    'doit être corrigé par un mouvement audité.'
                )
            layers = list(
                cls.objects.select_for_update()
                .filter(product=locked_product, remaining_quantity__gt=0)
                .order_by('created_at', 'id')
            )
            active = sum(layer.remaining_quantity for layer in layers)
            before = active

            if active < target:
                cls.create_layer(
                    product=locked_product,
                    quantity=target - active,
                    unit_cost=locked_product.purchase_price,
                    sale_price=locked_product.sale_price_ht,
                    note=note,
                )
            elif active > target:
                excess = active - target
                for layer in layers:
                    if excess <= 0:
                        break
                    consumed = min(excess, layer.remaining_quantity)
                    layer.remaining_quantity -= consumed
                    layer.save(update_fields=['remaining_quantity'])
                    excess -= consumed

            after = cls.active_quantity(locked_product)
            return {
                'product_id': locked_product.pk,
                'stock': target,
                'layers_before': before,
                'layers_after': after,
                'changed': before != after,
            }

    @classmethod
    def ensure_layers_cover_stock(cls, product):
        # Legacy versions could create duplicate initial lots or change stock
        # without a movement. Reconcile both missing and excess quantities.
        cls.reconcile_to_stock(product, note='Rattrapage stock sans lot')

    @classmethod
    def consume_fifo_breakdown(cls, product, quantity):
        if quantity <= 0:
            return []

        cls.ensure_layers_cover_stock(product)
        remaining = quantity
        chunks = []

        layers = (
            cls.objects.select_for_update()
            .filter(product=product, remaining_quantity__gt=0)
            .order_by('created_at', 'id')
        )
        for layer in layers:
            if remaining <= 0:
                break
            consumed = min(remaining, layer.remaining_quantity)
            layer.remaining_quantity -= consumed
            layer.save(update_fields=['remaining_quantity'])
            chunks.append({
                'quantity': consumed,
                'unit_cost': layer.unit_cost,
                # Le FIFO determine uniquement le cout. Tous les exemplaires
                # sont vendus au prix courant unique de la fiche produit.
                'sale_price': product.sale_price_ht,
                'total_cost': layer.unit_cost * consumed,
            })
            remaining -= consumed

        if remaining > 0:
            chunks.append({
                'quantity': remaining,
                'unit_cost': product.purchase_price,
                'sale_price': product.sale_price_ht,
                'total_cost': product.purchase_price * remaining,
            })

        return chunks

    @classmethod
    def consume_fifo(cls, product, quantity):
        return sum(
            chunk['total_cost']
            for chunk in cls.consume_fifo_breakdown(product, quantity)
        )


class StockMovement(models.Model):
    """Historique des mouvements de stock"""
    class MovementType(models.TextChoices):
        IN = 'IN', _('Stock In')           # Entrée (achat/réapprovisionnement)
        OUT = 'OUT', _('Stock Out')        # Sortie (vente)
        ADJUST = 'ADJUST', _('Adjustment') # Ajustement manuel
        RETURN = 'RETURN', _('Return')     # Retour client

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='movements'
    )
    movement_type = models.CharField(
        _('Movement Type'),
        max_length=10,
        choices=MovementType.choices
    )
    quantity = models.IntegerField(_('Quantity'))
    unit_cost = models.DecimalField(
        _('Unit Cost'),
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=_('Cost per unit for stock in')
    )
    sale_price = models.DecimalField(
        _('Sale Price'),
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=_('Sale price for this stock lot'),
    )
    stock_before = models.IntegerField(_('Stock Before'))
    stock_after = models.IntegerField(_('Stock After'))
    reference = models.CharField(
        _('Reference'),
        max_length=100,
        blank=True,
        help_text=_('Invoice number, sale ID, etc.')
    )
    notes = models.TextField(_('Notes'), blank=True)
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name=_('Supplier')
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        verbose_name=_('Created By')
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _('Stock Movement')
        verbose_name_plural = _('Stock Movements')
        ordering = ['-created_at']
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(unit_cost__isnull=True)
                    | models.Q(unit_cost__gte=0)
                ),
                name='inventory_movement_cost_nonneg',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(sale_price__isnull=True)
                    | models.Q(sale_price__gte=0)
                ),
                name='inventory_movement_sale_nonneg',
            ),
        ]

    def __str__(self):
        return f"{self.get_movement_type_display()} - {self.product.name} ({self.quantity})"

    def save(self, *args, **kwargs):
        """Mise à jour atomique du stock produit"""
        if self.pk:
            super().save(*args, **kwargs)
            return

        valid_types = {choice for choice, _label in self.MovementType.choices}
        if self.movement_type not in valid_types:
            raise ValidationError({'movement_type': 'Type de mouvement invalide.'})
        requested_quantity = int(self.quantity)
        if self.movement_type == self.MovementType.ADJUST:
            if requested_quantity < 0:
                raise ValidationError({
                    'quantity': 'Le stock cible ne peut pas être négatif.'
                })
        elif requested_quantity <= 0:
            raise ValidationError({
                'quantity': 'La quantité doit être strictement positive.'
            })
        if self.unit_cost is not None and self.unit_cost < 0:
            raise ValidationError({
                'unit_cost': 'Le coût unitaire ne peut pas être négatif.'
            })
        if self.sale_price is not None and self.sale_price < 0:
            raise ValidationError({
                'sale_price': 'Le prix de vente ne peut pas être négatif.'
            })

        with transaction.atomic():
            product = (
                Product.objects.select_for_update().get(pk=self.product_id)
            )
            ProductCostLayer.reconcile_to_stock(product)
            self.stock_before = product.stock

            if (
                self.movement_type == self.MovementType.OUT
                and requested_quantity > product.stock
            ):
                raise ValidationError({'quantity': 'Stock insuffisant.'})

            if self.movement_type == self.MovementType.IN:
                product.stock += self.quantity
            elif self.movement_type == self.MovementType.OUT:
                ProductCostLayer.consume_fifo(product, abs(self.quantity))
                product.stock -= self.quantity
            elif self.movement_type == self.MovementType.RETURN:
                product.stock += self.quantity
            elif self.movement_type == self.MovementType.ADJUST:
                # Pour adjustment, quantity est la nouvelle valeur absolue
                new_total = self.quantity
                self.quantity = new_total - self.stock_before
                if self.quantity < 0:
                    ProductCostLayer.consume_fifo(product, abs(self.quantity))
                product.stock = new_total

            self.stock_after = product.stock
            product.save(update_fields=['stock', 'updated_at'])
            super().save(*args, **kwargs)
            if self.movement_type in {self.MovementType.IN, self.MovementType.RETURN}:
                ProductCostLayer.create_layer(
                    product=product,
                    quantity=abs(self.quantity),
                    unit_cost=(
                        self.unit_cost
                        if self.unit_cost is not None
                        else product.purchase_price
                    ),
                    sale_price=(
                        self.sale_price
                        if self.sale_price is not None
                        else product.sale_price_ht
                    ),
                    source_movement=self,
                    note=self.get_movement_type_display(),
                )
            elif self.movement_type == self.MovementType.ADJUST and self.quantity > 0:
                ProductCostLayer.create_layer(
                    product=product,
                    quantity=self.quantity,
                    unit_cost=(
                        self.unit_cost
                        if self.unit_cost is not None
                        else product.purchase_price
                    ),
                    sale_price=(
                        self.sale_price
                        if self.sale_price is not None
                        else product.sale_price_ht
                    ),
                    source_movement=self,
                    note='Ajustement stock',
                )
            ProductCostLayer.assert_matches_stock(product)


class PriceHistory(models.Model):
    """Historique des changements de prix"""
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='price_history'
    )
    old_purchase_price = models.DecimalField(
        _('Old Purchase Price'),
        max_digits=10,
        decimal_places=2
    )
    new_purchase_price = models.DecimalField(
        _('New Purchase Price'),
        max_digits=10,
        decimal_places=2
    )
    old_sale_price = models.DecimalField(
        _('Old Sale Price'),
        max_digits=10,
        decimal_places=2
    )
    new_sale_price = models.DecimalField(
        _('New Sale Price'),
        max_digits=10,
        decimal_places=2
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        verbose_name=_('Changed By')
    )
    reason = models.TextField(_('Reason'), blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _('Price History')
        verbose_name_plural = _('Price Histories')
        ordering = ['-changed_at']

    def __str__(self):
        return f"{self.product.name} - {self.changed_at.strftime('%Y-%m-%d')}"

    @property
    def purchase_price_change(self):
        """Calcul du changement de prix d'achat"""
        return self.new_purchase_price - self.old_purchase_price

    @property
    def sale_price_change(self):
        """Calcul du changement de prix de vente"""
        return self.new_sale_price - self.old_sale_price


class PurchaseOrder(models.Model):
    """Commandes fournisseurs"""
    class OrderStatus(models.TextChoices):
        DRAFT = 'DRAFT', _('Draft')
        SENT = 'SENT', _('Sent')
        PARTIALLY_RECEIVED = 'PARTIAL', _('Partially Received')
        RECEIVED = 'RECEIVED', _('Received')
        CANCELLED = 'CANCELLED', _('Cancelled')

    reference = models.CharField(_('Reference'), max_length=50, unique=True, blank=True)
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.PROTECT,
        related_name='purchase_orders',
        verbose_name=_('Supplier')
    )
    status = models.CharField(
        _('Status'),
        max_length=20,
        choices=OrderStatus.choices,
        default=OrderStatus.DRAFT
    )
    notes = models.TextField(_('Notes'), blank=True)
    expected_date = models.DateField(_('Expected Date'), null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        verbose_name=_('Created By')
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _('Purchase Order')
        verbose_name_plural = _('Purchase Orders')
        ordering = ['-created_at']

    def __str__(self):
        return f"PO-{self.reference or self.id} ({self.supplier.name})"

    def save(self, *args, **kwargs):
        if not self.reference:
            import uuid
            from django.utils import timezone
            date_str = timezone.now().strftime('%Y%m%d')
            self.reference = f'PO-{date_str}-{uuid.uuid4().hex[:8].upper()}'
        super().save(*args, **kwargs)

    @property
    def total_amount(self):
        """Montant total de la commande"""
        return sum(item.total for item in self.items.all())

    @property
    def items_count(self):
        """Nombre d'articles dans la commande"""
        return self.items.count()

    @property
    def paid_amount(self):
        """Total des règlements actifs, hors règlements contrepassés."""
        return (
            self.payments.filter(
                status=SupplierPayment.PaymentStatus.ACTIVE,
            ).aggregate(total=models.Sum('amount'))['total']
            or Decimal('0.00')
        )

    @property
    def balance_due(self):
        """Solde restant dû, borné à zéro par sécurité d'affichage."""
        return max(self.total_amount - self.paid_amount, Decimal('0.00'))

    @property
    def payment_status(self):
        paid = self.paid_amount
        if paid <= 0:
            return 'UNPAID'
        if paid >= self.total_amount:
            return 'PAID'
        return 'PARTIAL'


class PurchaseOrderItem(models.Model):
    """Articles de commande fournisseur"""
    order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name='items'
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name='purchase_order_items'
    )
    quantity = models.IntegerField(_('Quantity'))
    unit_cost = models.DecimalField(_('Unit Cost'), max_digits=10, decimal_places=2)
    sale_price = models.DecimalField(
        _('Sale Price'),
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=_('Public sale price to apply when receiving this order'),
    )
    received_quantity = models.IntegerField(_('Received'), default=0)
    received_cost_total = models.DecimalField(
        _('Actual Received Cost Total'),
        max_digits=14,
        decimal_places=2,
        default=0,
        help_text=_('Cumulated supplier cost actually applied on received units'),
    )

    class Meta:
        verbose_name = _('Purchase Order Item')
        verbose_name_plural = _('Purchase Order Items')
        constraints = [
            models.UniqueConstraint(
                fields=['order', 'product'],
                name='inventory_po_unique_product',
            ),
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name='inventory_po_quantity_positive',
            ),
            models.CheckConstraint(
                condition=models.Q(received_quantity__gte=0),
                name='inventory_po_received_nonneg',
            ),
            models.CheckConstraint(
                condition=models.Q(received_quantity__lte=models.F('quantity')),
                name='inventory_po_received_lte_quantity',
            ),
            models.CheckConstraint(
                condition=models.Q(unit_cost__gte=0),
                name='inventory_po_cost_nonneg',
            ),
            models.CheckConstraint(
                condition=models.Q(received_cost_total__gte=0),
                name='inventory_po_received_cost_nonneg',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(sale_price__isnull=True)
                    | models.Q(sale_price__gte=0)
                ),
                name='inventory_po_sale_nonneg',
            ),
        ]

    def __str__(self):
        return f"{self.quantity}x {self.product.name}"

    @property
    def total(self):
        remaining_quantity = self.quantity - self.received_quantity
        return self.received_cost_total + (remaining_quantity * self.unit_cost)

    @property
    def is_fully_received(self):
        return self.received_quantity >= self.quantity


class SupplierPayment(models.Model):
    """Règlement de trésorerie d'une commande fournisseur.

    Un règlement n'est volontairement ni une dépense d'exploitation ni un
    coût des ventes. Le coût est reconnu par les lots FIFO au moment de la
    vente ; ce modèle suit uniquement la dette fournisseur et la trésorerie.
    """

    class PaymentMethod(models.TextChoices):
        CASH = 'CASH', _('Cash')
        BANK = 'BANK', _('Bank')
        OTHER = 'OTHER', _('Other')

    class PaymentStatus(models.TextChoices):
        ACTIVE = 'ACTIVE', _('Active')
        REVERSED = 'REVERSED', _('Reversed')

    order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.PROTECT,
        related_name='payments',
        verbose_name=_('Purchase Order'),
    )
    amount = models.DecimalField(
        _('Amount'),
        max_digits=12,
        decimal_places=2,
    )
    method = models.CharField(
        _('Payment Method'),
        max_length=10,
        choices=PaymentMethod.choices,
    )
    paid_on = models.DateField(_('Paid On'), default=timezone.localdate)
    reference = models.CharField(_('Reference'), max_length=100, blank=True)
    note = models.TextField(_('Note'), blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='supplier_payments_created',
        verbose_name=_('Created By'),
    )
    operation_id = models.CharField(
        _('Idempotency Key'),
        max_length=64,
        unique=True,
        editable=False,
    )
    operation_payload_hash = models.CharField(max_length=64, editable=False)
    status = models.CharField(
        _('Status'),
        max_length=10,
        choices=PaymentStatus.choices,
        default=PaymentStatus.ACTIVE,
    )
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='supplier_payments_reversed',
        verbose_name=_('Reversed By'),
    )
    reversed_at = models.DateTimeField(_('Reversed At'), null=True, blank=True)
    reversal_reason = models.CharField(_('Reversal Reason'), max_length=255, blank=True)
    reversal_operation_id = models.CharField(
        _('Reversal Idempotency Key'),
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        editable=False,
    )
    reversal_payload_hash = models.CharField(max_length=64, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _('Supplier Payment')
        verbose_name_plural = _('Supplier Payments')
        ordering = ['-paid_on', '-created_at', '-id']
        indexes = [
            models.Index(fields=['order', 'status']),
            models.Index(fields=['method', 'paid_on', 'status']),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name='inventory_supplier_payment_amount_pos',
            ),
        ]

    def __str__(self):
        return f'{self.order.reference}: {self.amount} ({self.method})'


class PurchaseReceipt(models.Model):
    """Durable idempotency record for a supplier-order reception."""

    order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name='receipts',
    )
    receipt_id = models.CharField(max_length=64)
    payload_hash = models.CharField(max_length=64)
    result = models.JSONField(default=dict)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='purchase_receipts',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['order', 'receipt_id'],
                name='inventory_receipt_unique_order_key',
            ),
        ]


class InventoryCount(models.Model):
    """Comptage d'inventaire physique"""
    class CountStatus(models.TextChoices):
        IN_PROGRESS = 'IN_PROGRESS', _('In Progress')
        COMPLETED = 'COMPLETED', _('Completed')
        VALIDATED = 'VALIDATED', _('Validated')

    name = models.CharField(_('Name'), max_length=100)
    status = models.CharField(
        _('Status'),
        max_length=20,
        choices=CountStatus.choices,
        default=CountStatus.IN_PROGRESS
    )
    notes = models.TextField(_('Notes'), blank=True)
    counted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='inventory_counts',
        verbose_name=_('Counted By')
    )
    validated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='validated_counts',
        verbose_name=_('Validated By')
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = _('Inventory Count')
        verbose_name_plural = _('Inventory Counts')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} - {self.get_status_display()}"


class InventoryCountItem(models.Model):
    """Articles comptés"""
    count = models.ForeignKey(
        InventoryCount,
        on_delete=models.CASCADE,
        related_name='items'
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name='count_items'
    )
    expected_quantity = models.IntegerField(_('Expected'))
    counted_quantity = models.IntegerField(_('Counted'), null=True, blank=True)

    class Meta:
        verbose_name = _('Count Item')
        verbose_name_plural = _('Count Items')
        unique_together = ['count', 'product']
        constraints = [
            models.CheckConstraint(
                condition=models.Q(expected_quantity__gte=0),
                name='inventory_count_expected_nonneg',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(counted_quantity__isnull=True)
                    | models.Q(counted_quantity__gte=0)
                ),
                name='inventory_count_counted_nonneg',
            ),
        ]

    def __str__(self):
        return f"{self.product.name}: {self.counted_quantity}/{self.expected_quantity}"

    @property
    def difference(self):
        if self.counted_quantity is None:
            return None
        return self.counted_quantity - self.expected_quantity


class SyncStockSnapshot(models.Model):
    """Latest monotonic stock snapshot for one store origin and product."""

    origin_id = models.UUIDField()
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='sync_stock_snapshots',
    )
    stock = models.PositiveIntegerField()
    source_updated_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['origin_id', 'product'],
                name='inventory_sync_stock_unique_origin_product',
            ),
        ]
        indexes = [
            models.Index(
                fields=['product', 'source_updated_at'],
                name='inv_sync_stock_prod_time_idx',
            ),
        ]
