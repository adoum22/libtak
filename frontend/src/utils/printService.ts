/**
 * Print Service for Thermal Receipt Printers
 * Uses the browser's print dialog with receipt-optimized styling
 */

interface CartItem {
    product: {
        name: string;
        barcode: string;
        price_ttc: number;
    };
    quantity: number;
}

interface PrintReceiptData {
    saleId: number;
    items: CartItem[];
    subtotal: number;
    discount?: { name: string; amount: number };
    total: number;
    paymentMethod: string;
    amountGiven?: number;
    change?: number;
    cashierName?: string;
}

interface StoreSettings {
    storeName: string;
    address?: string;
    phone?: string;
    taxId?: string;
    header?: string;
    footer?: string;
}

const defaultSettings: StoreSettings = {
    storeName: 'Librairie Attaquaddoum',
    address: 'Casablanca, Maroc',
    phone: '',
    taxId: '',
    header: '',
    footer: 'Merci pour votre visite!'
};

/**
 * Format currency for receipt
 */
function formatPrice(amount: number): string {
    return amount.toFixed(2) + ' DH';
}

/**
 * Generate receipt HTML for thermal printer (80mm width)
 */
function generateReceiptHTML(data: PrintReceiptData, settings: StoreSettings = defaultSettings): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR');
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const paymentLabels: Record<string, string> = {
        'CASH': 'Espèces',
        'CARD': 'Carte Bancaire',
        'TRANSFER': 'Virement'
    };

    let itemsHTML = '';
    for (const item of data.items) {
        const lineTotal = item.product.price_ttc * item.quantity;
        itemsHTML += `
            <tr>
                <td colspan="3" class="item-name">${item.product.name}</td>
            </tr>
            <tr>
                <td class="qty">${item.quantity} x ${formatPrice(item.product.price_ttc)}</td>
                <td></td>
                <td class="price">${formatPrice(lineTotal)}</td>
            </tr>
        `;
    }

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Ticket #${data.saleId}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        @page {
            size: 80mm auto;
            margin: 0;
        }
        body {
            font-family: 'Courier New', monospace;
            font-size: 12px;
            width: 80mm;
            padding: 5mm;
            background: white;
            color: black;
        }
        .header {
            text-align: center;
            margin-bottom: 10px;
            border-bottom: 1px dashed #000;
            padding-bottom: 10px;
        }
        .store-name {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .store-info {
            font-size: 10px;
        }
        .receipt-info {
            margin: 10px 0;
            font-size: 11px;
        }
        .receipt-info div {
            display: flex;
            justify-content: space-between;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0;
        }
        .item-name {
            font-weight: bold;
            padding-top: 5px;
        }
        .qty {
            font-size: 11px;
            color: #555;
        }
        .price {
            text-align: right;
        }
        .separator {
            border-top: 1px dashed #000;
            margin: 10px 0;
        }
        .totals {
            margin: 10px 0;
        }
        .totals div {
            display: flex;
            justify-content: space-between;
            padding: 2px 0;
        }
        .total-line {
            font-weight: bold;
            font-size: 14px;
            border-top: 1px solid #000;
            padding-top: 5px;
            margin-top: 5px;
        }
        .discount {
            color: #c00;
        }
        .payment-info {
            margin: 10px 0;
            padding: 5px;
            background: #f5f5f5;
        }
        .footer {
            text-align: center;
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px dashed #000;
            font-size: 11px;
        }
        .barcode {
            text-align: center;
            margin-top: 10px;
            font-size: 10px;
        }
        @media print {
            body {
                width: 80mm;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="store-name">${settings.storeName}</div>
        ${settings.address ? `<div class="store-info">${settings.address}</div>` : ''}
        ${settings.phone ? `<div class="store-info">Tél: ${settings.phone}</div>` : ''}
        ${settings.taxId ? `<div class="store-info">IF: ${settings.taxId}</div>` : ''}
        ${settings.header ? `<div class="store-info">${settings.header}</div>` : ''}
    </div>

    <div class="receipt-info">
        <div><span>Ticket N°:</span><span>${data.saleId}</span></div>
        <div><span>Date:</span><span>${dateStr} ${timeStr}</span></div>
        ${data.cashierName ? `<div><span>Vendeur:</span><span>${data.cashierName}</span></div>` : ''}
    </div>

    <div class="separator"></div>

    <table>
        <tbody>
            ${itemsHTML}
        </tbody>
    </table>

    <div class="separator"></div>

    <div class="totals">
        ${data.discount ? `
            <div><span>Sous-total:</span><span>${formatPrice(data.subtotal)}</span></div>
            <div class="discount"><span>Remise (${data.discount.name}):</span><span>-${formatPrice(data.discount.amount)}</span></div>
        ` : ''}
        <div class="total-line">
            <span>TOTAL:</span>
            <span>${formatPrice(data.total)}</span>
        </div>
    </div>

    <div class="payment-info">
        <div><span>Mode de paiement:</span><span>${paymentLabels[data.paymentMethod] || data.paymentMethod}</span></div>
        ${data.amountGiven ? `<div><span>Montant reçu:</span><span>${formatPrice(data.amountGiven)}</span></div>` : ''}
        ${data.change && data.change > 0 ? `<div><span>Monnaie rendue:</span><span>${formatPrice(data.change)}</span></div>` : ''}
    </div>

    <div class="footer">
        ${settings.footer || 'Merci pour votre visite!'}
    </div>

    <div class="barcode">
        *** ${data.saleId.toString().padStart(8, '0')} ***
    </div>
</body>
</html>
    `;
}

/**
 * Print receipt using browser print dialog
 */
export function printReceipt(data: PrintReceiptData, settings?: StoreSettings): void {
    const html = generateReceiptHTML(data, settings);

    // Create print window
    const printWindow = window.open('', '_blank', 'width=300,height=600');
    if (!printWindow) {
        console.error('Could not open print window. Check popup blocker.');
        return;
    }

    printWindow.document.write(html);
    printWindow.document.close();

    // Wait for content to load then print
    printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
        // Close after printing (optional - user can close manually)
        setTimeout(() => {
            printWindow.close();
        }, 1000);
    };
}

/**
 * Print via ESC/POS commands (for direct USB thermal printers)
 * This requires a backend endpoint or WebUSB API
 */
export async function printReceiptDirect(data: PrintReceiptData, settings?: StoreSettings): Promise<boolean> {
    try {
        // This would connect to a backend endpoint that sends ESC/POS commands
        // to the thermal printer directly via USB or network
        const response = await fetch('/api/print', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data, settings })
        });
        return response.ok;
    } catch (error) {
        console.error('Direct print failed:', error);
        // Fallback to browser print
        printReceipt(data, settings);
        return false;
    }
}

export default {
    printReceipt,
    printReceiptDirect,
    generateReceiptHTML
};
