import os
import django
from datetime import date
import sys

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from reporting.tasks import get_report_data
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from io import BytesIO

def test_pdf_generation():
    print("--- Test Data Generation ---")
    start_date = date.today()
    end_date = date.today()
    
    # Mock Data with Special Chars
    data = {
        'total_sales': 10,
        'total_revenue': 1000.50,
        'total_profit': 200.00,
        'items_sold': [
            {'name': 'Cahier 24x32 96p', 'barcode': '123', 'quantity': 1, 'revenue': 10, 'profit': 2},
            {'name': 'Héloïse & Abélard', 'barcode': '456', 'quantity': 1, 'revenue': 20, 'profit': 5},
            {'name': 'Kit Géométrique écharpe', 'barcode': '789', 'quantity': 1, 'revenue': 15, 'profit': 3},
            # Arabic test? ReportLab standard fonts won't support it visually, but does it crash?
            # {'name': 'كتاب', 'barcode': '000', 'quantity': 1, 'revenue': 10, 'profit': 1} 
        ]
    }
    print("Mock Data created.")

    print("\n--- Test PDF Generation ---")
    try:
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        
        elements = []
        styles = getSampleStyleSheet()
        
        elements.append(Paragraph(f"Rapport Test", styles['Heading1']))
        
        # Summary
        summary_data = [
            ['Ventes', "CA", "Bénéfice Net"],
            [str(data['total_sales']), f"{data['total_revenue']:.2f} DH", f"{data['total_profit']:.2f} DH"]
        ]
        summary_table = Table(summary_data, colWidths=[5*cm, 5*cm, 5*cm])
        elements.append(summary_table)
        
        # Items
        table_data = [['Produit', 'Qté', 'CA', 'Marge']]
        for item in data['items_sold']:
            table_data.append([
                str(item['name'])[:20],
                str(item['quantity']),
                str(item['revenue']),
                str(item['profit'])
            ])
            
        product_table = Table(table_data)
        elements.append(product_table)
        
        doc.build(elements)
        print("PDF generated successfully.")
        pdf_len = len(buffer.getvalue())
        print(f"PDF Size: {pdf_len} bytes")
        
    except Exception as e:
        print(f"!!! Error generating PDF: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_pdf_generation()
