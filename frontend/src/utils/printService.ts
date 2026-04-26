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
    email?: string;
    taxId?: string;
    logoUrl?: string | null;
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

function escapeHtml(value: string | number | null | undefined): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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
                <td colspan="3" class="item-name">${escapeHtml(item.product.name)}</td>
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
        .store-logo {
            max-width: 28mm;
            max-height: 18mm;
            object-fit: contain;
            margin: 0 auto 5px;
            display: block;
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
        ${settings.logoUrl ? `<img class="store-logo" src="${escapeHtml(settings.logoUrl)}" alt="Logo" />` : ''}
        <div class="store-name">${escapeHtml(settings.storeName)}</div>
        ${settings.address ? `<div class="store-info">${escapeHtml(settings.address)}</div>` : ''}
        ${settings.phone ? `<div class="store-info">Tel: ${escapeHtml(settings.phone)}</div>` : ''}
        ${settings.email ? `<div class="store-info">${escapeHtml(settings.email)}</div>` : ''}
        ${settings.taxId ? `<div class="store-info">IF: ${escapeHtml(settings.taxId)}</div>` : ''}
        ${settings.header ? `<div class="store-info">${escapeHtml(settings.header)}</div>` : ''}
    </div>

    <div class="receipt-info">
        <div><span>Ticket N°:</span><span>${data.saleId}</span></div>
        <div><span>Date:</span><span>${dateStr} ${timeStr}</span></div>
        ${data.cashierName ? `<div><span>Vendeur:</span><span>${escapeHtml(data.cashierName)}</span></div>` : ''}
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
            <div class="discount"><span>Remise (${escapeHtml(data.discount.name)}):</span><span>-${formatPrice(data.discount.amount)}</span></div>
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
        ${escapeHtml(settings.footer || 'Merci pour votre visite!')}
    </div>

    <div class="barcode">
        *** ${data.saleId.toString().padStart(8, '0')} ***
    </div>
</body>
</html>
    `;
}

/**
 * Print receipt using a hidden iframe.
 *
 * Why iframe and not window.open():
 *  - window.open() called from an async callback (mutation onSuccess) is
 *    routinely blocked by popup blockers.
 *  - window.print() inside a popup steals focus and can freeze the parent
 *    tab's event loop (the POS "Nouvelle vente" button stops responding).
 *  - An iframe lives inside the parent document: no popup blocker, no focus
 *    theft, parent UI stays interactive even while the print dialog is open.
 */
export function printReceipt(data: PrintReceiptData, settings?: StoreSettings): void {
    const html = generateReceiptHTML(data, settings);

    // Remove any leftover print iframe from a previous receipt
    const previous = document.getElementById('libtak-print-frame');
    if (previous && previous.parentNode) {
        previous.parentNode.removeChild(previous);
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'libtak-print-frame';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    // Off-screen but still rendered (display:none breaks print in some browsers)
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';

    let cleanedUp = false;
    const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    iframe.onload = () => {
        const win = iframe.contentWindow;
        if (!win) {
            cleanup();
            return;
        }
        try {
            win.focus();
            win.print();
        } catch (err) {
            console.error('Print failed:', err);
        }
        // Modern browsers fire afterprint on the iframe window
        const afterPrint = () => cleanup();
        try {
            win.addEventListener('afterprint', afterPrint, { once: true });
        } catch {
            // ignore
        }
        // Safety net in case afterprint never fires (Safari iframe quirks)
        setTimeout(cleanup, 4000);
    };

    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
        cleanup();
        console.error('Could not access print iframe document');
        return;
    }
    doc.open();
    doc.write(html);
    doc.close();
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
