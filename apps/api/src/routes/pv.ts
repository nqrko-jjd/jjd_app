import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, FIELD_OFFICE } from '../lib/auth.js';
import { storeImage } from '../lib/media.js';
import { getCompany } from '../lib/documents.js';
import { renderHtmlPdf } from '../lib/pdf.js';
import { formatDateBE } from '@jjd/shared';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from '../lib/media.js';

/**
 * PV de réception des travaux (rapport « à la demande » pour valider une prestation avec le client) : réserves, personnes présentes,
 * signature du client, PDF ; puis PV de levée des réserves quand le travail est repris. Le rapport quotidien, lui, n'existe plus que comme
 * mot et photos dans le fil du chantier (voir app mobile).
 */
export const pvRouter = Router();

const include = {
  reserves: { orderBy: { position: 'asc' } },
  photos: true,
  worksite: { select: { id: true, ref: true, title: true, address: true, box: true, postalCode: true, city: true, client: { select: { name: true, address: true, postalCode: true, city: true } } } },
} as const;

async function authorName(userId: string | undefined): Promise<string> {
  if (!userId) return 'Bureau';
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { person: true } });
  return u?.person?.displayName || u?.person?.firstName || u?.email || 'Bureau';
}
async function getPv(id: string) {
  const r = await prisma.worksiteReport.findUnique({ where: { id }, include });
  if (!r || r.kind !== 'reception') throw new HttpError(404, 'PV de réception introuvable');
  return r;
}

pvRouter.post(
  '/',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const i = z.object({ worksiteId: z.string(), quoteRef: z.string().trim().max(80).nullish() }).parse(req.body);
    const ws = await prisma.worksite.findUnique({ where: { id: i.worksiteId }, select: { id: true } });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');
    const quote = i.quoteRef ? null : await prisma.document.findFirst({ where: { worksiteId: ws.id, kind: 'quote', status: 'accepted' }, orderBy: { createdAt: 'desc' }, select: { number: true } });
    const r = await prisma.worksiteReport.create({
      data: { worksiteId: ws.id, kind: 'reception', authorId: req.user!.id, authorName: await authorName(req.user!.id), quoteRef: i.quoteRef ?? quote?.number ?? null, receptionResult: 'none' },
      include,
    });
    res.status(201).json({ report: r });
  }),
);

pvRouter.get('/:id', requireAuth(...FIELD_OFFICE), asyncHandler(async (req, res) => { res.json({ report: await getPv(req.params.id!) }); }));

const patchInput = z.object({
  receptionResult: z.enum(['none', 'with_reserves', 'refused']).optional(),
  presentParties: z.string().trim().max(500).nullish(),
  quoteRef: z.string().trim().max(80).nullish(),
  placeSigned: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(3000).nullish(),
  date: z.coerce.date().optional(),
  clientName: z.string().trim().max(120).nullish(),
});
pvRouter.patch(
  '/:id',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const pv = await getPv(req.params.id!);
    if (pv.status === 'signed') throw new HttpError(409, 'PV déjà signé : il ne se modifie plus (les réserves se lèvent séparément).');
    const d = patchInput.parse(req.body);
    const r = await prisma.worksiteReport.update({
      where: { id: pv.id },
      data: {
        receptionResult: d.receptionResult, presentParties: d.presentParties === undefined ? undefined : d.presentParties, quoteRef: d.quoteRef === undefined ? undefined : d.quoteRef,
        placeSigned: d.placeSigned === undefined ? undefined : d.placeSigned, notes: d.notes === undefined ? undefined : d.notes, date: d.date, clientName: d.clientName === undefined ? undefined : d.clientName,
      },
      include,
    });
    res.json({ report: r });
  }),
);

pvRouter.post(
  '/:id/reserves',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const pv = await getPv(req.params.id!);
    if (pv.status === 'signed') throw new HttpError(409, 'PV déjà signé.');
    const { description } = z.object({ description: z.string().trim().min(3).max(600) }).parse(req.body);
    await prisma.reportReserve.create({ data: { reportId: pv.id, description, position: pv.reserves.length } });
    await prisma.worksiteReport.update({ where: { id: pv.id }, data: { receptionResult: pv.receptionResult === 'refused' ? 'refused' : 'with_reserves' } });
    res.status(201).json({ report: await getPv(pv.id) });
  }),
);

/** Lever une réserve (ou la rouvrir) : permis même après signature — c'est précisément l'objet du PV de levée. */
pvRouter.patch(
  '/:id/reserves/:rid',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const pv = await getPv(req.params.id!);
    const rv = pv.reserves.find((x) => x.id === req.params.rid);
    if (!rv) throw new HttpError(404, 'Réserve introuvable');
    const d = z.object({ description: z.string().trim().min(3).max(600).optional(), lifted: z.boolean().optional(), liftedNote: z.string().trim().max(300).nullish() }).parse(req.body);
    if (d.description && pv.status === 'signed') throw new HttpError(409, 'PV signé : le texte d’une réserve ne se modifie plus.');
    await prisma.reportReserve.update({
      where: { id: rv.id },
      data: { description: d.description, liftedAt: d.lifted === undefined ? undefined : d.lifted ? new Date() : null, liftedNote: d.liftedNote === undefined ? undefined : d.liftedNote },
    });
    res.json({ report: await getPv(pv.id) });
  }),
);

pvRouter.delete(
  '/:id/reserves/:rid',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const pv = await getPv(req.params.id!);
    if (pv.status === 'signed') throw new HttpError(409, 'PV déjà signé : une réserve ne se supprime plus.');
    await prisma.reportReserve.deleteMany({ where: { id: req.params.rid, reportId: pv.id } });
    const left = await prisma.reportReserve.count({ where: { reportId: pv.id } });
    if (!left && pv.receptionResult === 'with_reserves') await prisma.worksiteReport.update({ where: { id: pv.id }, data: { receptionResult: 'none' } });
    res.json({ report: await getPv(pv.id) });
  }),
);

pvRouter.post(
  '/:id/sign',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const pv = await getPv(req.params.id!);
    if (pv.status === 'signed') throw new HttpError(409, 'Déjà signé');
    const { clientName, signature } = z.object({ clientName: z.string().trim().min(2), signature: z.string().min(20) }).parse(req.body);
    const m = /^data:image\/\w+;base64,(.+)$/.exec(signature.trim());
    if (!m) throw new HttpError(422, 'Signature illisible');
    const img = await storeImage(Buffer.from(m[1]!, 'base64'));
    const r = await prisma.worksiteReport.update({ where: { id: pv.id }, data: { clientName, signatureUrl: img.url, signedAt: new Date(), status: 'signed' }, include });
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'pv_signed', entity: 'worksite_report', entityId: pv.id, meta: { clientName, result: pv.receptionResult } } });
    const thread = await prisma.thread.upsert({ where: { worksiteId: pv.worksiteId }, create: { worksiteId: pv.worksiteId }, update: {} });
    await prisma.message.create({ data: { threadId: thread.id, authorName: r.authorName, kind: 'status', body: `PV de réception ${pv.receptionResult === 'with_reserves' ? 'avec réserves ' : pv.receptionResult === 'refused' ? 'refusé ' : 'sans réserve '}signé par ${clientName}` } });
    res.json({ report: r });
  }),
);

const esc = (s: string | null | undefined) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** PDF du PV de réception ; `?lifted=1` : PV de levée des réserves (état de chaque réserve). */
pvRouter.get(
  '/:id/pdf',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const pv = await getPv(req.params.id!);
    const co = await getCompany();
    const lifted = req.query.lifted === '1';
    const client = pv.worksite.client;
    const addr = (x: { address?: string | null; postalCode?: string | null; city?: string | null } | null | undefined) => [x?.address, [x?.postalCode, x?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const result = pv.receptionResult ?? 'none';
    const box = (on: boolean, label: string) => `<span class="box">${on ? '☒' : '☐'} ${label}</span>`;
    // signature incorporée en data URI : le PDF est rendu sans adresse de base, un chemin /uploads relatif ne se chargerait pas
    let sigImg = '';
    if (pv.signatureUrl) {
      try {
        const file = path.join(UPLOADS_DIR, pv.signatureUrl.replace(/^\/uploads\//, ''));
        const ext = path.extname(file).toLowerCase();
        sigImg = `<img class="sig" src="data:image/${ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg'};base64,${readFileSync(file).toString('base64')}" alt="signature">`;
      } catch { /* signature illisible : le PDF reste généré sans l'image */ }
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 16mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #1f2b26; font-size: 12px; line-height: 1.5; }
      h1 { color: #173f34; font-size: 19px; margin: 0 0 2px; } .muted { color: #6b776f; }
      .head { display: flex; justify-content: space-between; gap: 20px; border-bottom: 3px solid #c5a35d; padding-bottom: 10px; margin-bottom: 14px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .card { border: 1px solid #e5e7df; border-radius: 8px; padding: 8px 12px; }
      .card .lbl { font-weight: 700; color: #173f34; margin-bottom: 3px; } .box { margin-right: 18px; font-weight: 600; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; } th { background: #173f34; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; }
      td { padding: 6px 8px; border-bottom: 1px solid #e5e7df; vertical-align: top; } .ok { color: #2f8f5b; font-weight: 700; } .todo { color: #b45309; font-weight: 700; }
      .sign { margin-top: 22px; display: flex; gap: 30px; } .signbox { flex: 1; border: 1px solid #cfd5cc; border-radius: 8px; padding: 8px 12px; min-height: 90px; } .sig { max-height: 70px; }
    </style></head><body>
      <div class="head"><div><h1>${lifted ? 'Procès-verbal de levée des réserves' : 'Procès-verbal de réception des travaux'}</h1><div class="muted">${esc(pv.worksite.ref)} — ${esc(pv.worksite.title)}</div></div>
      <div style="text-align:right"><strong>${esc(co.name)}</strong><br>${esc(co.vat)}<br>${esc(co.email)}</div></div>
      <div class="grid">
        <div class="card"><div class="lbl">Maître d’ouvrage</div>${esc(pv.clientName ?? client?.name ?? '—')}<br><span class="muted">${esc(addr(client))}</span></div>
        <div class="card"><div class="lbl">Ouvrage</div>${esc(pv.worksite.title)}<br><span class="muted">${esc(addr(pv.worksite))}</span>${pv.quoteRef ? `<br>Réf. devis / marché : <strong>${esc(pv.quoteRef)}</strong>` : ''}</div>
      </div>
      <div class="card" style="margin-top:12px"><div class="lbl">Réception du ${formatDateBE(pv.date)}</div>
        ${pv.presentParties ? `<div>Personnes présentes : ${esc(pv.presentParties)}</div>` : ''}
        <div style="margin-top:6px">${box(result === 'none', 'Réception sans réserve')}${box(result === 'with_reserves', 'Réception avec réserve(s)')}${box(result === 'refused', 'Réception refusée')}</div></div>
      ${pv.reserves.length ? `<table><thead><tr><th style="width:30px">N°</th><th>Réserve</th><th style="width:150px">${lifted ? 'Levée' : 'État'}</th></tr></thead><tbody>${pv.reserves.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.description)}</td><td>${r.liftedAt ? `<span class="ok">Levée le ${formatDateBE(r.liftedAt)}</span>${r.liftedNote ? `<div class="muted">${esc(r.liftedNote)}</div>` : ''}` : '<span class="todo">À lever</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucune réserve émise.</p>'}
      ${pv.notes ? `<p><strong>Remarques :</strong> ${esc(pv.notes)}</p>` : ''}
      <div class="sign"><div class="signbox"><div class="muted">Fait à ${esc(pv.placeSigned ?? '……………………')}, le ${pv.signedAt ? formatDateBE(pv.signedAt) : '……/……/………'}</div><div style="margin-top:4px">Le maître d’ouvrage${pv.clientName ? ` — ${esc(pv.clientName)}` : ''}</div>${sigImg}</div><div class="signbox"><div class="muted">L’entreprise</div><div style="margin-top:4px">${esc(co.name)}</div></div></div>
    </body></html>`;
    const pdf = await renderHtmlPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${lifted ? 'PV-levee-reserves' : 'PV-reception'}-${pv.worksite.ref}.pdf"`);
    res.send(pdf);
  }),
);
