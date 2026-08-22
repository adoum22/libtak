/**
 * Print Service for Thermal Receipt Printers
 * Uses the browser's print dialog with receipt-optimized styling
 */

import i18n from '../i18n';

export interface PrintReceiptItem {
    product: {
        name: string;
        barcode: string;
        price_ttc: number;
    };
    quantity: number;
    unitPrice?: number;
    lineTotal?: number;
}

interface PrintReceiptData {
    saleId: number;
    items: PrintReceiptItem[];
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
    currencySymbol?: string;
}

const defaultSettings: StoreSettings = {
    storeName: 'Librairie Attaquaddoum',
    address: 'Casablanca, Maroc',
    phone: '',
    taxId: '',
    header: '',
    footer: ''
};

/**
 * Format currency for receipt
 */
function formatPrice(amount: number, locale: string, currencySymbol: string): string {
    return amount.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }) + ` ${currencySymbol}`;
}

function escapeHtml(value: string | number | null | undefined): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function safeImageUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        const parsed = new URL(value, window.location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        return parsed.href;
    } catch {
        return null;
    }
}

/**
 * Generate receipt HTML for thermal printer (80mm width)
 */
export function generateReceiptHTML(
    data: PrintReceiptData,
    settings: StoreSettings = defaultSettings,
    language = i18n.resolvedLanguage || i18n.language || 'fr',
): string {
    const locale = language === 'ar' ? 'ar-MA' : language === 'en' ? 'en-GB' : 'fr-FR';
    const direction = language === 'ar' ? 'rtl' : 'ltr';
    const currencySymbol = String(settings.currencySymbol || 'DH').trim() || 'DH';
    const translate = (key: string, options?: Record<string, unknown>) => String(i18n.t(key, {
        ...options,
        lng: language,
    }));
    const now = new Date();
    const dateStr = now.toLocaleDateString(locale);
    const timeStr = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

    const paymentLabels: Record<string, string> = {
        'CASH': translate('ReceiptPaymentCash'),
        'CARD': translate('ReceiptPaymentCard'),
        'CREDIT': translate('ReceiptPaymentCredit'),
        'OTHER': translate('ReceiptPaymentOther'),
        'TRANSFER': translate('ReceiptPaymentTransfer'),
    };

    let itemsHTML = '';
    for (const item of data.items) {
        const unitPrice = item.unitPrice ?? item.product.price_ttc;
        const lineTotal = item.lineTotal ?? unitPrice * item.quantity;
        itemsHTML += `
            <tr>
                <td colspan="3" class="item-name">${escapeHtml(item.product.name)}</td>
            </tr>
            <tr>
                <td class="qty">${item.quantity} x ${formatPrice(unitPrice, locale, currencySymbol)}</td>
                <td></td>
                <td class="price">${formatPrice(lineTotal, locale, currencySymbol)}</td>
            </tr>
        `;
    }

    const logoUrl = safeImageUrl(settings.logoUrl);

    return `
<!DOCTYPE html>
<html lang="${escapeHtml(language)}" dir="${direction}">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(translate('ReceiptTitle', { id: data.saleId }))}</title>
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
        ${logoUrl ? `<img class="store-logo" src="${escapeHtml(logoUrl)}" alt="Logo" />` : ''}
        <div class="store-name">${escapeHtml(settings.storeName)}</div>
        ${settings.address ? `<div class="store-info">${escapeHtml(settings.address)}</div>` : ''}
        ${settings.phone ? `<div class="store-info">${escapeHtml(translate('ReceiptPhone'))}: ${escapeHtml(settings.phone)}</div>` : ''}
        ${settings.email ? `<div class="store-info">${escapeHtml(settings.email)}</div>` : ''}
        ${settings.taxId ? `<div class="store-info">IF: ${escapeHtml(settings.taxId)}</div>` : ''}
        ${settings.header ? `<div class="store-info">${escapeHtml(settings.header)}</div>` : ''}
    </div>

    <div class="receipt-info">
        <div><span>${escapeHtml(translate('ReceiptNumber'))}:</span><span>${data.saleId}</span></div>
        <div><span>${escapeHtml(translate('Date'))}:</span><span>${dateStr} ${timeStr}</span></div>
        ${data.cashierName ? `<div><span>${escapeHtml(translate('Cashier'))}:</span><span>${escapeHtml(data.cashierName)}</span></div>` : ''}
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
            <div><span>${escapeHtml(translate('Subtotal'))}:</span><span>${formatPrice(data.subtotal, locale, currencySymbol)}</span></div>
            <div class="discount"><span>${escapeHtml(translate('Discount'))} (${escapeHtml(data.discount.name)}):</span><span>-${formatPrice(data.discount.amount, locale, currencySymbol)}</span></div>
        ` : ''}
        <div class="total-line">
            <span>${escapeHtml(translate('Total')).toUpperCase()}:</span>
            <span>${formatPrice(data.total, locale, currencySymbol)}</span>
        </div>
    </div>

    <div class="payment-info">
        <div><span>${escapeHtml(translate('PaymentMethod'))}:</span><span>${escapeHtml(paymentLabels[data.paymentMethod] || data.paymentMethod)}</span></div>
        ${data.paymentMethod === 'CASH' && data.amountGiven !== undefined ? `<div><span>${escapeHtml(translate('AmountReceived'))}:</span><span>${formatPrice(data.amountGiven, locale, currencySymbol)}</span></div>` : ''}
        ${data.paymentMethod === 'CASH' && data.change !== undefined && data.change > 0 ? `<div><span>${escapeHtml(translate('ChangeReturned'))}:</span><span>${formatPrice(data.change, locale, currencySymbol)}</span></div>` : ''}
    </div>

    <div class="footer">
        ${escapeHtml(settings.footer || translate('ReceiptThankYou'))}
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
            if (import.meta.env.DEV) console.error('Print failed:', err);
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
        if (import.meta.env.DEV) console.error('Could not access print iframe document');
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
        if (import.meta.env.DEV) console.error('Direct print failed:', error);
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
