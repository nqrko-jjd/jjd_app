/**
 * PDF d'un rapport d'intervention signé (bon de travail) — joint à l'e-mail d'une facture ACP : les syndics le
 * demandent pour valider la facture (Baltimo). Photos et signature incorporées en data URI (rendu sans base URL).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatDateBE } from '@jjd/shared';
import { prisma } from '../db.js';
import { UPLOADS_DIR } from './media.js';
import { renderHtmlPdf } from './pdf.js';
import { getCompany } from './documents.js';

const esc = (s: string | null | undefined) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function dataUri(rel: string | null | undefined): string | null {
  if (!rel) return null;
  try {
    const file = path.join(UPLOADS_DIR, rel.replace(/^\/?uploads\//, ''));
    const ext = path.extname(file).toLowerCase();
    return `data:image/${ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg'};base64,${readFileSync(file).toString('base64')}`;
  } catch { return null; }
}

export async function renderReportPdf(reportId: string): Promise<{ buffer: Buffer; filename: string }> {
  const r = await prisma.worksiteReport.findUniqueOrThrow({
    where: { id: reportId },
    include: { photos: true, worksite: { select: { ref: true, title: true, address: true, box: true, postalCode: true, city: true, unitLabel: true, acp: { select: { name: true } } } } },
  });
  const co = await getCompany();
  const w = r.worksite;
  const addr = [[w.address, w.box && `bte ${w.box}`].filter(Boolean).join(' '), [w.postalCode, w.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const photos = r.photos.slice(0, 6).map((p) => dataUri(p.thumbUrl ?? p.url)).filter(Boolean) as string[];
  const sig = dataUri(r.signatureUrl);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1f2b26; font-size: 12px; line-height: 1.5; }
    h1 { color: #173f34; font-size: 19px; margin: 0 0 2px; } .muted { color: #6b776f; }
    .head { display: flex; justify-content: space-between; gap: 20px; border-bottom: 3px solid #c5a35d; padding-bottom: 10px; margin-bottom: 14px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .card { border: 1px solid #e5e7df; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; }
    .lbl { font-weight: 700; color: #173f34; margin-bottom: 3px; } .txt { white-space: pre-wrap; }
    .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; } .photos img { width: 100%; height: 120px; object-fit: cover; border-radius: 6px; }
    .sig { max-height: 70px; }
  </style></head><body>
    <div class="head"><div><h1>Rapport d’intervention</h1><div class="muted">${esc(w.ref)} — ${esc(w.title)}</div></div>
    <div style="text-align:right"><strong>${esc(co.name)}</strong><br>${esc(co.vat)}<br>${esc(co.email)}</div></div>
    <div class="grid">
      <div class="card"><div class="lbl">Lieu</div>${esc(w.acp?.name ?? '')}${w.acp ? '<br>' : ''}${esc(addr)}${w.unitLabel ? `<br>${esc(w.unitLabel)}` : ''}</div>
      <div class="card"><div class="lbl">Intervention</div>Le ${formatDateBE(r.date)}<br>Par ${esc(r.authorName)}</div>
    </div>
    ${r.workDone ? `<div class="card"><div class="lbl">Travaux réalisés</div><div class="txt">${esc(r.workDone)}</div></div>` : ''}
    ${r.notes ? `<div class="card"><div class="lbl">Remarques</div><div class="txt">${esc(r.notes)}</div></div>` : ''}
    ${photos.length ? `<div class="card"><div class="lbl">Photos</div><div class="photos">${photos.map((p) => `<img src="${p}">`).join('')}</div></div>` : ''}
    <div class="card"><div class="lbl">Signature</div>${r.clientName ? `${esc(r.clientName)}, ` : ''}${r.signedAt ? `le ${formatDateBE(r.signedAt)}` : ''}${sig ? `<br><img class="sig" src="${sig}">` : ''}</div>
  </body></html>`;
  return { buffer: await renderHtmlPdf(html), filename: `Rapport-${w.ref}-${new Date(r.date).toISOString().slice(0, 10)}.pdf` };
}

/** Rapports signés couverts par une facture ACP (même période que le bloc « Intervention »), au plus 5. */
export async function signedReportsForDocument(doc: { worksiteId: string | null; issuedOn: Date | null; id: string; kind: string }): Promise<string[]> {
  if (!doc.worksiteId || doc.kind === 'quote') return [];
  const until = doc.issuedOn ?? new Date();
  const previous = await prisma.document.findFirst({
    where: { worksiteId: doc.worksiteId, id: { not: doc.id }, kind: { in: ['invoice', 'deposit_invoice'] }, number: { not: null }, issuedOn: { lt: until } },
    orderBy: { issuedOn: 'desc' }, select: { issuedOn: true },
  });
  const rows = await prisma.worksiteReport.findMany({
    where: { worksiteId: doc.worksiteId, status: 'signed', date: { lte: new Date(until.getTime() + 86_400_000), ...(previous?.issuedOn ? { gt: previous.issuedOn } : {}) } },
    orderBy: { date: 'asc' }, select: { id: true }, take: 5,
  });
  return rows.map((r) => r.id);
}
