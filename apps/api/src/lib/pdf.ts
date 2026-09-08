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

async function buildHtml(d: PdfDoc, co: Company): Promise<string> {
  const totals = computeDocTotals(d.lines);
  const title = DOC_KIND_LABEL[d.kind] ?? d.kind;
  const ref = d.number ?? d.draftRef ?? '';
  const clientName = d.billingName ?? d.contact?.name ?? '';
  const clientAddr = d.billingAddress ?? [d.contact?.address, [d.contact?.postalCode, d.contact?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const clientVat = d.billingVat ?? d.contact?.vat;

  const rows = d.lines.map((l) => {
    if (l.kind === 'section') return `<tr class="ln-section"><td colspan="7">${esc(l.label)}</td></tr>`;
    if (l.kind === 'text') return `<tr class="ln-text"><td colspan="7">${esc(l.label)}</td></tr>`;
    const qty = l.qty ?? 0;
    const pu = l.unitPriceHt ?? 0;
    const disc = l.discountPct ?? 0;
    const vat = l.vatRate ?? 0;
    const ht = qty * pu * (1 - disc / 100);
    return `<tr>
      <td><div>${esc(l.label)}</div>${l.description ? `<div class="desc">${esc(l.description)}</div>` : ''}</td>
      <td class="c-num">${qty}</td>
      <td class="c-unit">${esc(l.unit)}</td>
      <td class="c-num">${formatEur(pu)}</td>
      <td class="c-num">${disc ? `${disc}%` : ''}</td>
      <td class="c-num">${Math.round(vat * 100)}%</td>
      <td class="c-num">${formatEur(ht)}</td>
    </tr>`;
  }).join('');

  const vatRows = Object.entries(totals.vatBreakdown)
    .map(([rate, b]) => `<tr><td>TVA ${Math.round(Number(rate) * 100)}%</td><td>${formatEur(b.vat)}</td></tr>`)
    .join('');

  const dateRows = [
    d.issuedOn ? `<tr><td>Date</td><td>${formatDateBE(d.issuedOn)}</td></tr>` : '',
    d.kind === 'quote' && d.validUntil ? `<tr><td>Validité</td><td>${formatDateBE(d.validUntil)}</td></tr>` : '',
    d.dueOn ? `<tr><td>Échéance</td><td>${formatDateBE(d.dueOn)}</td></tr>` : '',
    d.worksite ? `<tr><td>Chantier</td><td>${esc(d.worksite.ref)}</td></tr>` : '',
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
        <div>
          <div class="co-name">${esc(co.name)}</div>
          <div class="co-meta">
            ${co.address ? `<div>${esc(co.address)}</div>` : ''}
            ${co.postalCode || co.city ? `<div>${esc([co.postalCode, co.city].filter(Boolean).join(' '))}</div>` : ''}
            ${co.vat ? `<div>TVA ${esc(co.vat)}</div>` : ''}
            ${co.phone ? `<div>${esc(co.phone)}</div>` : ''}
            ${co.email ? `<div>${esc(co.email)}</div>` : ''}
          </div>
        </div>
        <div class="doc-box">
          <div class="doc-title">${esc(title)}</div>
          <div class="doc-ref">${esc(ref)}</div>
          <table class="doc-dates"><tbody>${dateRows}</tbody></table>
        </div>
      </header>
      <section class="parties">
        <div class="bill-to">
          <div class="lbl">Adressé à</div>
          <div class="client-name">${esc(clientName) || '—'}</div>
          ${clientAddr ? `<div>${esc(clientAddr)}</div>` : ''}
          ${clientVat ? `<div>TVA ${esc(clientVat)}</div>` : ''}
        </div>
      </section>
      ${d.title ? `<h1 class="object">${esc(d.title)}</h1>` : ''}
      ${d.intro ? `<p class="intro">${esc(d.intro)}</p>` : ''}
      <table class="lines">
        <thead><tr><th class="c-desc">Désignation</th><th class="c-num">Qté</th><th class="c-unit">Unité</th><th class="c-num">P.U. HT</th><th class="c-num">Rem.</th><th class="c-num">TVA</th><th class="c-num">Total HT</th></tr></thead>
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
  .sheet { max-width: 780px; margin: 0 auto; padding: 24px; font: 12px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b2430; }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #294a70; padding-bottom: 14px; }
  .co-name { font-size: 17px; font-weight: 800; color: #294a70; }
  .co-meta { margin-top: 4px; color: #55606e; font-size: 11px; }
  .doc-box { text-align: right; min-width: 200px; }
  .doc-title { font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #294a70; }
  .doc-ref { font-size: 14px; font-weight: 700; margin-top: 2px; }
  .doc-dates { margin-left: auto; margin-top: 8px; font-size: 11px; }
  .doc-dates td { padding: 1px 0 1px 12px; }
  .doc-dates td:first-child { color: #55606e; }
  .parties { margin: 18px 0; }
  .bill-to .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #8a95a3; font-weight: 700; }
  .client-name { font-weight: 700; font-size: 13px; margin-top: 2px; }
  .object { font-size: 14px; margin: 16px 0 6px; }
  .intro { margin: 0 0 12px; color: #3a4351; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.lines th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #55606e; border-bottom: 1.5px solid #c9d2de; padding: 6px 6px; }
  table.lines td { padding: 6px 6px; border-bottom: 1px solid #e6eaf0; vertical-align: top; }
  .c-num { text-align: right; white-space: nowrap; }
  .c-unit { text-align: center; }
  td.desc, .desc { color: #6a7482; font-size: 11px; }
  .ln-section td { background: #f2f5f9; font-weight: 700; border-bottom: 1px solid #c9d2de; }
  .ln-text td { color: #3a4351; font-style: italic; border-bottom: none; }
  .totals { display: flex; justify-content: flex-end; margin-top: 14px; }
  .totals table { border-collapse: collapse; min-width: 260px; }
  .totals td { padding: 4px 8px; }
  .totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .totals tr.grand td { border-top: 2px solid #294a70; font-weight: 800; font-size: 13px; padding-top: 6px; }
  .pay { margin-top: 18px; padding: 10px 12px; background: #f2f5f9; border-radius: 6px; font-size: 11px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .pay-text { flex: 1; }
  .pay-qr { text-align: center; flex: none; }
  .pay-qr img { width: 84px; height: 84px; display: block; }
  .pay-qr span { display: block; font-size: 9px; color: #6a7482; margin-top: 2px; }
  .terms { margin-top: 22px; padding-top: 10px; border-top: 1px solid #e6eaf0; color: #6a7482; font-size: 10px; white-space: pre-wrap; }
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
