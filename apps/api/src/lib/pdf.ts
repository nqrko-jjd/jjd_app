/**
 * Génération PDF côté serveur pour les devis/factures créés dans l'app
 * (les documents importés de TrustUp ont déjà leur PDF d'origine, cf.
 * `originalPdf` dans routes/documents.ts — ce module ne sert que pour les
 * documents JJD natifs). Reprend la mise en page de la page d'impression web
 * (apps/web/src/app/imprimer/[id]/page.tsx), rendue en HTML autonome (pas de
 * dépendance à l'app web ni à l'authentification) puis imprimée en PDF via
 * Chromium headless (puppeteer-core, pointant sur le Chromium installé par
 * apt dans l'image Docker — voir apps/api/Dockerfile).
 */
import puppeteer from 'puppeteer-core';
import { computeDocTotals, formatEur, formatDateBE, DOC_KIND_LABEL, type DocLineLike } from '@jjd/shared';
import type { Company } from './documents.js';
import { renderEpcQrDataUrl, isValidBelgianIban } from './epc-qr.js';

export interface PdfDocLine extends DocLineLike {
  label: string;
  description: string | null;
  unit: string | null;
}
export interface PdfDoc {
  kind: string;
  number: string | null;
  draftRef: string | null;
  title: string | null;
  intro: string | null;
  terms: string | null;
  issuedOn: Date | string | null;
  dueOn: Date | string | null;
  validUntil: Date | string | null;
  structuredComm: string | null;
  billingName: string | null;
  billingAddress: string | null;
  billingVat: string | null;
  worksite: { ref: string } | null;
  contact: { name: string; vat: string | null; address: string | null; postalCode: string | null; city: string | null } | null;
  lines: PdfDocLine[];
}

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Construit le HTML imprimable d'un devis/facture/avoir — inspiré de la présentation TrustUp
 *  (bandeau de marque, bloc "Émetteur"/"Adressé à" en 2 colonnes, en-tête de tableau et total
 *  TTC en couleur pleine) mais avec la charte JJD (vert `#173f34` / or `#c5a35d`). */
async function buildHtml(d: PdfDoc, co: Company): Promise<string> {
  const totals = computeDocTotals(d.lines);
  const title = DOC_KIND_LABEL[d.kind] ?? d.kind;
  const ref = d.number ?? d.draftRef ?? '';
  const clientName = d.billingName ?? d.contact?.name ?? '';
  const clientAddr = d.billingAddress ?? [d.contact?.address, [d.contact?.postalCode, d.contact?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const clientVat = d.billingVat ?? d.contact?.vat;
  const hasDiscount = d.lines.some((l) => l.kind === 'item' && (l.discountPct ?? 0) > 0);
  const colspan = hasDiscount ? 6 : 5;

  const rows = d.lines.map((l) => {
    if (l.kind === 'section') return `<tr class="ln-section"><td colspan="${colspan}">${esc(l.label)}</td></tr>`;
    if (l.kind === 'text') return `<tr class="ln-text"><td colspan="${colspan}">${esc(l.label)}</td></tr>`;
    const qty = l.qty ?? 0;
    const pu = l.unitPriceHt ?? 0;
    const disc = l.discountPct ?? 0;
    const vat = l.vatRate ?? 0;
    const ht = qty * pu * (1 - disc / 100);
    return `<tr>
      <td><div class="ln-label">${esc(l.label)}</div>${l.description ? `<div class="desc">${esc(l.description)}</div>` : ''}</td>
      <td class="c-num c-qty">${qty}${l.unit ? ` <span class="unit">${esc(l.unit)}</span>` : ''}</td>
      <td class="c-num">${formatEur(pu)}</td>
      ${hasDiscount ? `<td class="c-num">${disc ? `${disc}%` : '—'}</td>` : ''}
      <td class="c-num">${Math.round(vat * 100)}%</td>
      <td class="c-num">${formatEur(ht)}</td>
    </tr>`;
  }).join('');

  const vatRows = Object.entries(totals.vatBreakdown)
    .map(([rate, b]) => `<tr><td>TVA ${Math.round(Number(rate) * 100)}%</td><td>${formatEur(b.vat)}</td></tr>`)
    .join('');

  const dateLines = [
    d.issuedOn ? `<div class="date-line"><span>Date du document</span><strong>${formatDateBE(d.issuedOn)}</strong></div>` : '',
    d.kind === 'quote' && d.validUntil ? `<div class="date-line"><span>Valable jusqu’au</span><strong>${formatDateBE(d.validUntil)}</strong></div>` : '',
    d.dueOn ? `<div class="date-line"><span>Date d’échéance</span><strong>${formatDateBE(d.dueOn)}</strong></div>` : '',
    d.worksite ? `<div class="date-line"><span>Chantier</span><strong>${esc(d.worksite.ref)}</strong></div>` : '',
  ].join('');

  const isInvoiceLike = d.kind === 'invoice' || d.kind === 'deposit_invoice';
  // QR de paiement (EPC069-12) : scan depuis l'appli bancaire -> virement pré-rempli.
  // Seulement si l'IBAN est valide et qu'il y a un montant réel à payer.
  const qrDataUrl = isInvoiceLike && isValidBelgianIban(co.iban) && totals.totalTtc > 0
    ? await renderEpcQrDataUrl({ beneficiaryName: co.name, iban: co.iban!, amount: totals.totalTtc, structuredComm: d.structuredComm })
    : null;

  const payBlock = isInvoiceLike
    ? `<div class="pay">
         <div class="pay-text">
           <div><strong>Paiement</strong> — ${co.iban ? `IBAN ${esc(co.iban)}` : 'coordonnées bancaires sur demande'}</div>
           ${d.structuredComm ? `<div>Communication structurée : <strong>${esc(d.structuredComm)}</strong></div>` : ''}
         </div>
         ${qrDataUrl ? `<div class="pay-qr"><img src="${qrDataUrl}" alt="QR code de paiement" /><span>à scanner pour payer</span></div>` : ''}
       </div>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
    <div class="sheet">
      <header class="head">
        <div class="brand">
          <span class="mark">J</span>
          <div class="brand-text">
            <div class="brand-name">JD Consult</div>
            <div class="brand-tag">Maintenance · Rénovation · Gestion de projets</div>
          </div>
        </div>
        <div class="doc-box">
          <div class="doc-title">${esc(title)} <span class="doc-ref">${esc(ref)}</span></div>
          <div class="doc-dates">${dateLines}</div>
        </div>
      </header>
      <section class="parties">
        <div class="from">
          <div class="lbl">Émetteur</div>
          <div class="party-name">${esc(co.name)}</div>
          ${co.address ? `<div>${esc(co.address)}</div>` : ''}
          ${co.postalCode || co.city ? `<div>${esc([co.postalCode, co.city].filter(Boolean).join(' '))}</div>` : ''}
          ${co.vat ? `<div>TVA ${esc(co.vat)}</div>` : ''}
          ${[co.phone, co.email].filter(Boolean).length ? `<div>${[co.phone, co.email].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
        </div>
        <div class="bill-to">
          <div class="lbl">Adressé à</div>
          <div class="party-name">${esc(clientName) || '—'}</div>
          ${clientAddr ? `<div>${esc(clientAddr)}</div>` : ''}
          ${clientVat ? `<div>TVA ${esc(clientVat)}</div>` : ''}
        </div>
      </section>
      ${d.title ? `<div class="object">${esc(d.title)}</div>` : ''}
      ${d.intro ? `<p class="intro">${esc(d.intro)}</p>` : ''}
      <table class="lines">
        <thead><tr>
          <th class="c-desc">Désignation</th>
          <th class="c-num">Qté</th>
          <th class="c-num">P.U. HT</th>
          ${hasDiscount ? '<th class="c-num">Rem.</th>' : ''}
          <th class="c-num">TVA</th>
          <th class="c-num">Total HT</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">
        <table><tbody>
          <tr><td>Total HT</td><td>${formatEur(totals.totalHt)}</td></tr>
          ${vatRows}
          <tr class="grand"><td>Total TTC</td><td>${formatEur(totals.totalTtc)}</td></tr>
        </tbody></table>
      </div>
      ${payBlock}
      <footer class="terms">${esc(d.terms || (d.kind === 'quote' ? co.quoteTerms : co.invoiceTerms))}</footer>
    </div>
  </body></html>`;
}

const CSS = `
  @page { size: A4; margin: 16mm; }
  body { background: #fff; margin: 0; }
  .sheet { max-width: 780px; margin: 0 auto; padding: 24px; font: 12px/1.6 "Segoe UI", -apple-system, Roboto, Arial, sans-serif; color: #26372f; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid #e5e7df; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark {
    width: 34px; height: 34px; flex-shrink: 0; border-radius: 8px; background: #c5a35d; color: #173f34;
    display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 800;
  }
  .brand-name { font-size: 16px; font-weight: 800; color: #173f34; letter-spacing: -0.01em; }
  .brand-tag { font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; color: #9aa79e; font-weight: 700; margin-top: 2px; }
  .doc-box { text-align: right; min-width: 220px; }
  .doc-title { font-size: 19px; font-weight: 700; color: #26372f; }
  .doc-ref { font-weight: 800; color: #173f34; }
  .doc-dates { margin-top: 8px; }
  .date-line { display: flex; justify-content: flex-end; gap: 10px; font-size: 11px; margin-top: 2px; }
  .date-line span { color: #788078; }
  .date-line strong { color: #26372f; min-width: 78px; text-align: right; }

  .parties { display: flex; justify-content: space-between; gap: 20px; margin: 20px 0; }
  .parties > div { flex: 1; min-width: 0; }
  .parties .lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em; color: #9aa79e; font-weight: 700; margin-bottom: 4px; }
  .parties .party-name { font-weight: 700; font-size: 13px; color: #26372f; margin-bottom: 1px; }
  .parties > div > div:not(.lbl):not(.party-name) { color: #55606e; }
  .from { padding: 2px 0; }
  .bill-to { background: #f5f5ef; border-radius: 10px; padding: 12px 14px; }

  .object { font-weight: 700; font-size: 13px; margin: 4px 0 8px; color: #26372f; }
  .intro { margin: 0 0 12px; color: #55606e; }

  table.lines { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.lines thead th {
    background: #173f34; color: #fff; text-align: left; font-size: 10px; text-transform: uppercase;
    letter-spacing: .05em; font-weight: 700; padding: 8px 10px;
  }
  table.lines thead th:first-child { border-radius: 6px 0 0 0; }
  table.lines thead th:last-child { border-radius: 0 6px 0 0; }
  table.lines td { padding: 8px 10px; border-bottom: 1px solid #e5e7df; vertical-align: top; }
  .c-num { text-align: right; white-space: nowrap; }
  .c-qty .unit { color: #9aa79e; }
  .ln-label { font-weight: 600; }
  .desc { color: #788078; font-size: 11px; margin-top: 1px; }
  .ln-section td { background: #f5f5ef; font-weight: 700; border-bottom: 1px solid #e5e7df; }
  .ln-text td { color: #55606e; font-style: italic; border-bottom: none; }

  .totals { display: flex; justify-content: flex-end; margin-top: 14px; }
  .totals table { border-collapse: collapse; min-width: 260px; }
  .totals td { padding: 5px 10px; }
  .totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .totals tr.grand td { background: #173f34; color: #fff; font-weight: 800; font-size: 13px; padding: 8px 10px; }
  .totals tr.grand td:first-child { border-radius: 6px 0 0 6px; }
  .totals tr.grand td:last-child { border-radius: 0 6px 6px 0; }

  .pay { margin-top: 18px; padding: 12px 14px; background: #e9efe9; border-radius: 10px; font-size: 11px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .pay-text { flex: 1; }
  .pay-text strong { color: #173f34; }
  .pay-qr { text-align: center; flex: none; }
  .pay-qr img { width: 84px; height: 84px; display: block; }
  .pay-qr span { display: block; font-size: 9px; color: #788078; margin-top: 2px; }

  .terms { margin-top: 22px; padding-top: 10px; border-top: 1px solid #e5e7df; color: #9aa79e; font-size: 9.5px; white-space: pre-wrap; }
`;

/** Chemin de l'exécutable Chromium (variable d'env prioritaire, sinon Chromium apt sur le VPS). */
function chromiumPath(): string {
  return process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
}

let browserPromise: ReturnType<typeof puppeteer.launch> | null = null;
/** Réutilise une seule instance Chromium headless entre les rendus (coûteuse à démarrer). */
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: chromiumPath(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    browserPromise.catch(() => { browserPromise = null; }); // permet de réessayer si le lancement échoue
  }
  return browserPromise;
}

/** Génère le PDF d'un devis/facture/avoir JJD (buffer, prêt à streamer ou zipper). */
export async function renderDocumentPdf(d: PdfDoc, co: Company): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(await buildHtml(d, co), { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' } });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
