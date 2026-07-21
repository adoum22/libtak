from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from inventory.models import Product, ProductCostLayer


class Command(BaseCommand):
    help = (
        'Audit FIFO layer quantities against Product.stock. '
        'Dry-run by default; pass --apply to repair discrepancies.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', dest='apply_changes')
        parser.add_argument('--product', type=int, dest='product_id')

    def handle(self, *args, **options):
        queryset = Product.objects.order_by('id')
        product_id = options.get('product_id')
        if product_id is not None:
            queryset = queryset.filter(pk=product_id)
            if not queryset.exists():
                raise CommandError(f'Produit {product_id} introuvable.')

        issues = []
        for product in queryset.iterator():
            active = ProductCostLayer.active_quantity(product)
            if active != product.stock:
                issues.append((product.pk, product.stock, active))

        if not options['apply_changes']:
            for pk, stock, active in issues:
                self.stdout.write(
                    f'Produit {pk}: stock={stock}, lots_actifs={active}, '
                    f'ecart={stock - active}'
                )
            self.stdout.write(
                self.style.WARNING(
                    f'Dry-run: {len(issues)} incoherence(s). Utilisez --apply pour reparer.'
                )
            )
            return

        repaired = 0
        with transaction.atomic():
            for pk, _stock, _active in issues:
                product = Product.objects.select_for_update().get(pk=pk)
                ProductCostLayer.reconcile_to_stock(
                    product,
                    note='Réconciliation FIFO manuelle',
                )
                repaired += 1

        self.stdout.write(self.style.SUCCESS(f'{repaired} produit(s) réconcilié(s).'))
