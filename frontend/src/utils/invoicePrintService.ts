export interface InvoiceLine {
    description: string;
    quantity: number;
    unitPrice: number;
}

export interface InvoiceCompany {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    rc?: string;
    ice?: string;
    taxId?: string;
    patente?: string;
    cnss?: string;
    logoUrl?: string | null;
    footer?: string;
}

export interface InvoicePrintData {
    invoiceNumber: string;
    invoiceDate: string;
    dueDate?: string;
    customerName: string;
    customerAddress?: string;
    customerIce?: string;
    customerPhone?: string;
    lines: InvoiceLine[];
    notes?: string;
    company: InvoiceCompany;
}

const money = (value: number) => `${value.toFixed(2)} DH`;

const escapeHtml = (value: string | number | null | undefined): string =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

export function printInvoice(data: InvoicePrintData): void {
    const subtotal = data.lines.reduce((sum, line) => (
        sum + (line.quantity * line.unitPrice)
    ), 0);

    const rows = data.lines.map(line => {
        const total = line.quantity * line.unitPrice;
        return `
            <tr>
                <td>${escapeHtml(line.description)}</td>
                <td class="num">${line.quantity}</td>
                <td class="num">${money(line.unitPrice)}</td>
                <td class="num">${money(total)}</td>
            </tr>
        `;
    }).join('');

    const companyMeta = [
        data.company.rc ? `RC: ${escapeHtml(data.company.rc)}` : '',
        data.company.ice ? `ICE: ${escapeHtml(data.company.ice)}` : '',
        data.company.taxId ? `IF: ${escapeHtml(data.company.taxId)}` : '',
        data.company.patente ? `Patente: ${escapeHtml(data.company.patente)}` : '',
        data.company.cnss ? `CNSS: ${escapeHtml(data.company.cnss)}` : '',
    ].filter(Boolean).join(' | ');

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <title>Facture ${escapeHtml(data.invoiceNumber)}</title>
    <style>
        @page { size: A4; margin: 16mm; }
        * { box-sizing: border-box; }
        body {
            font-family: Arial, sans-serif;
            color: #111827;
            margin: 0;
            background: #fff;
            font-size: 12px;
        }
        .header {
            display: flex;
            justify-content: space-between;
            gap: 24px;
            padding-bottom: 18px;
            border-bottom: 2px solid #0f766e;
        }
        .brand { display: flex; gap: 14px; align-items: flex-start; }
        .logo {
            width: 72px;
            height: 72px;
            object-fit: contain;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 6px;
        }
        .company-name { font-size: 22px; font-weight: 800; color: #0f766e; }
        .muted { color: #4b5563; line-height: 1.45; }
        .invoice-title { text-align: right; }
        .invoice-title h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: 0; }
        .section { margin-top: 24px; }
        .panel {
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 14px;
        }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        .label { color: #6b7280; font-size: 11px; text-transform: uppercase; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; margin-top: 24px; }
        th {
            background: #0f766e;
            color: #fff;
            text-align: left;
            padding: 10px;
            font-size: 11px;
            text-transform: uppercase;
        }
        td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
        .num { text-align: right; white-space: nowrap; }
        .total-box {
            margin-left: auto;
            margin-top: 18px;
            width: 280px;
            border: 1px solid #0f766e;
            border-radius: 12px;
            overflow: hidden;
        }
        .total-row {
            display: flex;
            justify-content: space-between;
            padding: 12px 14px;
            font-weight: 700;
        }
        .grand-total { background: #ccfbf1; color: #064e3b; font-size: 16px; }
        .footer {
            margin-top: 36px;
            padding-top: 14px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #4b5563;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="brand">
            ${data.company.logoUrl ? `<img class="logo" src="${escapeHtml(data.company.logoUrl)}" />` : ''}
            <div>
                <div class="company-name">${escapeHtml(data.company.name)}</div>
                <div class="muted">${escapeHtml(data.company.address)}</div>
                <div class="muted">${escapeHtml(data.company.phone)}</div>
                <div class="muted">${escapeHtml(data.company.email)}</div>
                <div class="muted">${companyMeta}</div>
            </div>
        </div>
        <div class="invoice-title">
            <h1>FACTURE</h1>
            <div class="muted">N: <strong>${escapeHtml(data.invoiceNumber)}</strong></div>
            <div class="muted">Date: ${escapeHtml(data.invoiceDate)}</div>
            ${data.dueDate ? `<div class="muted">Echeance: ${escapeHtml(data.dueDate)}</div>` : ''}
        </div>
    </div>

    <div class="section grid">
        <div class="panel">
            <div class="label">Client</div>
            <h2>${escapeHtml(data.customerName)}</h2>
            <div class="muted">${escapeHtml(data.customerAddress)}</div>
            <div class="muted">${data.customerIce ? `ICE: ${escapeHtml(data.customerIce)}` : ''}</div>
            <div class="muted">${escapeHtml(data.customerPhone)}</div>
        </div>
        <div class="panel">
            <div class="label">Informations</div>
            <div class="muted">${escapeHtml(data.notes)}</div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Description</th>
                <th class="num">Qté</th>
                <th class="num">Prix unitaire</th>
                <th class="num">Total</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>

    <div class="total-box">
        <div class="total-row"><span>Total HT/TTC</span><span>${money(subtotal)}</span></div>
        <div class="total-row grand-total"><span>Total à payer</span><span>${money(subtotal)}</span></div>
    </div>

    <div class="footer">${escapeHtml(data.company.footer || 'Merci pour votre confiance.')}</div>
</body>
</html>
`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';

    iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => iframe.remove(), 4000);
    };

    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
}
