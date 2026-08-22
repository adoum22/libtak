import io
import runpy
from contextlib import redirect_stdout

from django.test import TestCase

from inventory.models import Product, ProductCostLayer, StockMovement


class SeedProductsTest(TestCase):
    def run_seed_with_windows_console_encoding(self):
        raw = io.BytesIO()
        output = io.TextIOWrapper(raw, encoding='cp1252', write_through=True)
        with redirect_stdout(output):
            runpy.run_module('seed_products', run_name='__main__')
        output.detach()

    def test_seed_is_cp1252_safe_atomic_and_fifo_consistent(self):
        self.run_seed_with_windows_console_encoding()

        self.assertEqual(Product.objects.count(), 17)
        self.assertEqual(StockMovement.objects.count(), 17)
        for product in Product.objects.all():
            self.assertEqual(
                ProductCostLayer.active_quantity(product),
                product.stock,
            )

        # Re-running installation data must neither duplicate products nor
        # create a second initial stock movement/layer.
        self.run_seed_with_windows_console_encoding()
        self.assertEqual(Product.objects.count(), 17)
        self.assertEqual(StockMovement.objects.count(), 17)
