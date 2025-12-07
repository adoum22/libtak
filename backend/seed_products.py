import os
import django
import random
from decimal import Decimal

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from inventory.models import Category, Product, Supplier

def seed_suppliers():
    """Créer des fournisseurs de démo"""
    suppliers_data = [
        {
            'name': 'Dar Al Kitab',
            'contact_name': 'Ahmed Bennani',
            'email': 'contact@daralitab.ma',
            'phone': '+212 5 22 123 456',
            'address': 'Casablanca, Maroc'
        },
        {
            'name': 'Papeterie Maroc',
            'contact_name': 'Fatima Alaoui',
            'email': 'info@papeteriemaroc.ma',
            'phone': '+212 5 22 789 012',
            'address': 'Rabat, Maroc'
        },
        {
            'name': 'Fournitures Scolaires Express',
            'contact_name': 'Youssef Tazi',
            'email': 'commandes@fse.ma',
            'phone': '+212 5 22 345 678',
            'address': 'Fès, Maroc'
        }
    ]
    
    suppliers = {}
    for data in suppliers_data:
        supplier, created = Supplier.objects.get_or_create(
            name=data['name'],
            defaults=data
        )
        suppliers[data['name']] = supplier
        if created:
            print(f"✓ Fournisseur '{data['name']}' créé")
    
    return suppliers


def seed_categories():
    """Créer des catégories de démo"""
    categories_data = [
        {'name': 'Livres', 'description': 'Romans, essais, littérature', 'icon': 'book', 'color': '#3b82f6'},
        {'name': 'Manuels Scolaires', 'description': 'Livres scolaires et parascolaires', 'icon': 'graduation-cap', 'color': '#10b981'},
        {'name': 'Papeterie', 'description': 'Papier, carnets, classeurs', 'icon': 'file-text', 'color': '#f59e0b'},
        {'name': 'Stylos & Écriture', 'description': 'Stylos, crayons, marqueurs', 'icon': 'pen', 'color': '#ef4444'},
        {'name': 'Fournitures de Bureau', 'description': 'Agrafeuses, scotch, ciseaux', 'icon': 'briefcase', 'color': '#8b5cf6'},
        {'name': 'Arts & Loisirs', 'description': 'Peinture, coloriage, créativité', 'icon': 'palette', 'color': '#ec4899'},
    ]
    
    categories = {}
    for data in categories_data:
        cat, created = Category.objects.get_or_create(
            name=data['name'],
            defaults=data
        )
        categories[data['name']] = cat
        if created:
            print(f"✓ Catégorie '{data['name']}' créée")
    
    return categories


def seed_products(categories, suppliers):
    """Créer des produits de démo"""
    products_data = [
        # Livres
        {
            'name': 'Harry Potter à l\'école des sorciers',
            'barcode': '9780747532743',
            'purchase_price': 60.00,
            'sale_price_ht': 95.00,
            'category': 'Livres',
            'supplier': 'Dar Al Kitab',
            'stock': 25
        },
        {
            'name': 'Le Petit Prince',
            'barcode': '9782070408504',
            'purchase_price': 35.00,
            'sale_price_ht': 55.00,
            'category': 'Livres',
            'supplier': 'Dar Al Kitab',
            'stock': 40
        },
        {
            'name': 'L\'Alchimiste',
            'barcode': '9782290004449',
            'purchase_price': 45.00,
            'sale_price_ht': 75.00,
            'category': 'Livres',
            'supplier': 'Dar Al Kitab',
            'stock': 30
        },
        
        # Manuels Scolaires
        {
            'name': 'Manuel de Mathématiques 6ème',
            'barcode': '9782091712345',
            'purchase_price': 80.00,
            'sale_price_ht': 120.00,
            'category': 'Manuels Scolaires',
            'supplier': 'Dar Al Kitab',
            'stock': 50
        },
        {
            'name': 'Manuel de Français 6ème',
            'barcode': '9782091754321',
            'purchase_price': 75.00,
            'sale_price_ht': 115.00,
            'category': 'Manuels Scolaires',
            'supplier': 'Dar Al Kitab',
            'stock': 45
        },
        
        # Papeterie
        {
            'name': 'Cahier Grand Format 96 pages',
            'barcode': '3086126700015',
            'purchase_price': 8.00,
            'sale_price_ht': 15.00,
            'category': 'Papeterie',
            'supplier': 'Papeterie Maroc',
            'stock': 200
        },
        {
            'name': 'Cahier Petit Format 48 pages',
            'barcode': '3086126700022',
            'purchase_price': 4.00,
            'sale_price_ht': 8.00,
            'category': 'Papeterie',
            'supplier': 'Papeterie Maroc',
            'stock': 300
        },
        {
            'name': 'Ramette Papier A4 500 feuilles',
            'barcode': '3086126700039',
            'purchase_price': 35.00,
            'sale_price_ht': 55.00,
            'category': 'Papeterie',
            'supplier': 'Papeterie Maroc',
            'stock': 100
        },
        
        # Stylos
        {
            'name': 'Stylo Bic Cristal Bleu',
            'barcode': '3086123001092',
            'purchase_price': 2.00,
            'sale_price_ht': 4.00,
            'category': 'Stylos & Écriture',
            'supplier': 'Fournitures Scolaires Express',
            'stock': 500
        },
        {
            'name': 'Stylo Bic Cristal Noir',
            'barcode': '3086123001108',
            'purchase_price': 2.00,
            'sale_price_ht': 4.00,
            'category': 'Stylos & Écriture',
            'supplier': 'Fournitures Scolaires Express',
            'stock': 400
        },
        {
            'name': 'Stylo Bic Cristal Rouge',
            'barcode': '3086123001115',
            'purchase_price': 2.00,
            'sale_price_ht': 4.00,
            'category': 'Stylos & Écriture',
            'supplier': 'Fournitures Scolaires Express',
            'stock': 350
        },
        {
            'name': 'Crayon HB avec Gomme',
            'barcode': '3086123002020',
            'purchase_price': 1.50,
            'sale_price_ht': 3.00,
            'category': 'Stylos & Écriture',
            'supplier': 'Fournitures Scolaires Express',
            'stock': 600
        },
        
        # Fournitures Bureau
        {
            'name': 'Gomme Maped',
            'barcode': '3154141125008',
            'purchase_price': 3.00,
            'sale_price_ht': 6.00,
            'category': 'Fournitures de Bureau',
            'supplier': 'Fournitures Scolaires Express',
            'stock': 250
        },
        {
            'name': 'Taille-crayon Métal',
            'barcode': '3154141125015',
            'purchase_price': 5.00,
            'sale_price_ht': 10.00,
            'category': 'Fournitures de Bureau',
            'supplier': 'Fournitures Scolaires Express',
            'stock': 180
        },
        {
            'name': 'Règle 30cm Transparente',
            'barcode': '3154141125022',
            'purchase_price': 4.00,
            'sale_price_ht': 8.00,
            'category': 'Fournitures de Bureau',
            'supplier': 'Fournitures Scolaires Express',
            'stock': 220
        },
        
        # Arts & Loisirs
        {
            'name': 'Boîte Crayons de Couleur 12 pcs',
            'barcode': '3154141126012',
            'purchase_price': 25.00,
            'sale_price_ht': 45.00,
            'category': 'Arts & Loisirs',
            'supplier': 'Fournitures Scolaires Express',
            'stock': 80
        },
        {
            'name': 'Boîte Feutres 12 couleurs',
            'barcode': '3154141126029',
            'purchase_price': 30.00,
            'sale_price_ht': 55.00,
            'category': 'Arts & Loisirs',
            'supplier': 'Fournitures Scolaires Express',
            'stock': 75
        },
    ]
    
    for data in products_data:
        if not Product.objects.filter(barcode=data['barcode']).exists():
            Product.objects.create(
                name=data['name'],
                barcode=data['barcode'],
                purchase_price=Decimal(str(data['purchase_price'])),
                sale_price_ht=Decimal(str(data['sale_price_ht'])),
                category=categories.get(data['category']),
                supplier=suppliers.get(data['supplier']),
                stock=data['stock'],
                min_stock=5
            )
            print(f"✓ Produit '{data['name']}' créé")


if __name__ == '__main__':
    print("\n=== Création des fournisseurs ===")
    suppliers = seed_suppliers()
    
    print("\n=== Création des catégories ===")
    categories = seed_categories()
    
    print("\n=== Création des produits ===")
    seed_products(categories, suppliers)
    
    print("\n=== Terminé ===")
    print(f"Total produits: {Product.objects.count()}")
    print(f"Total catégories: {Category.objects.count()}")
    print(f"Total fournisseurs: {Supplier.objects.count()}")
    print()
