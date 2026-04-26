export interface InvoiceLine {
    description: string;
    quantity: number;
    unitPrice: number;
    tvaRate: number;
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
    const subtotalHt = data.lines.reduce((sum, line) => (
        sum + (line.quantity * line.unitPrice)
    ), 0);
    const totalTva = data.lines.reduce((sum, line) => (
        sum + (line.quantity * line.unitPrice * (line.tvaRate / 100))
    ), 0);
    const totalTtc = subtotalHt + totalTva;

    const rows = data.lines.map(line => {
        const total = line.quantity * line.unitPrice;
        return `
            <tr>
                <td>${escapeHtml(line.description)}</td>
                <td class="num">${line.quantity}</td>
                <td class="num">${money(line.unitPrice)}</td>
                <td class="num">${line.tvaRate.toFixed(2)}%</td>
                <td class="num">${money(total * (1 + line.tvaRate / 100))}</td>
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
        @page { size: A4; margin: 18mm; }
        * { box-sizing: border-box; }
        body {
            font-family: Arial, Helvetica, sans-serif;
            color: #111;
            margin: 0;
            background: #fff;
            font-size: 12.5px;
        }
        .header {
            display: flex;
            justify-content: space-between;
            gap: 24px;
            min-height: 96px;
            padding-bottom: 18px;
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
        .company-name { font-size: 18px; font-weight: 800; color: #111; }
        .muted { color: #4b5563; line-height: 1.45; }
        .invoice-title { text-align: right; }
        .invoice-title h1 { margin: 0 0 18px; font-size: 22px; letter-spacing: 0; }
        .section { margin-top: 28px; }
        .panel {
            padding: 0;
        }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        .label { color: #111; font-size: 12px; font-weight: 700; margin-bottom: 6px; }
        table { width: 100%; border-collapse: collapse; margin-top: 34px; }
        th {
            background: #fff;
            color: #111;
            text-align: left;
            padding: 8px 6px;
            font-size: 12px;
            border-bottom: 1px solid #111;
        }
        td { padding: 9px 6px; border-bottom: 1px solid #f1f1f1; }
        .num { text-align: right; white-space: nowrap; }
        .total-box {
            margin-left: auto;
            margin-top: 28px;
            width: 310px;
        }
        .total-row {
            display: flex;
            justify-content: space-between;
            padding: 7px 0;
            font-weight: 700;
        }
        .grand-total { border-top: 1px solid #111; font-size: 16px; }
        .amount-words { margin-top: 24px; font-weight: 700; }
        .provider {
            margin-top: 74px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
        }
        .footer {
            margin-top: 24px;
            padding-top: 14px;
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
            </div>
        </div>
        <div class="invoice-title">
            <h1>Facture N° ${escapeHtml(data.invoiceNumber)}</h1>
            <div class="muted">Date: ${escapeHtml(data.invoiceDate)}</div>
            ${data.dueDate ? `<div class="muted">Echeance: ${escapeHtml(data.dueDate)}</div>` : ''}
        </div>
    </div>

    <div class="section grid">
        <div class="panel">
            <div class="label">Client : ${escapeHtml(data.customerName)}</div>
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
                <th class="num">Prix unitaire HT</th>
                <th class="num">TVA</th>
                <th class="num">Total</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>

    <div class="total-box">
        <div class="total-row"><span>Montant HT</span><span>${money(subtotalHt)}</span></div>
        <div class="total-row"><span>TVA</span><span>${money(totalTva)}</span></div>
        <div class="total-row grand-total"><span>Total Net à payer</span><span>${money(totalTtc)}</span></div>
    </div>

    <div class="amount-words">
        ARRETE LA PRESENTE FACTURE A LA SOMME DE : # ${money(totalTtc)} #
    </div>

    <div class="provider">
        <div>
            <strong>Prestataire : ${escapeHtml(data.company.name)}</strong><br />
            Adresse : ${escapeHtml(data.company.address)}<br />
            Tel : ${escapeHtml(data.company.phone)}<br />
            Email : ${escapeHtml(data.company.email)}
        </div>
        <div class="muted">
            ${companyMeta}
        </div>
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
