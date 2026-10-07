/**
 * Envoi des factures de vente / notes de crédit sur le réseau Peppol via Recommand (point d'accès certifié, API JSON).
 *
 * ENVOI SEULEMENT : la réception des factures fournisseurs reste gérée par le comptable (son propre point d'accès).
 * JJD n'enregistre donc pas d'adresse de réception ici et ne lit jamais la boîte de réception Recommand.
 *
 * Fail-closed : sans clé configurée, rien n'est envoyé ; en cas d'erreur du point d'accès, le document n'est PAS marqué envoyé.
 */
import { computeDocTotals, round2 } from '@jjd/shared';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { HttpError } from './http.js';
import { docInclude, getCompany, type Company } from './documents.js';
import { externalDeliveryState } from './document-delivery.js';

export const PEPPOL_KINDS = ['invoice', 'deposit_invoice', 'credit_note'];
export const peppolConfigured = () => !!(env.peppol.apiKey && env.peppol.apiSecret && env.peppol.companyId);

const authHeader = () => `Basic ${Buffer.from(`${env.peppol.apiKey}:${env.peppol.apiSecret}`).toString('base64')}`;
async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let r: Response;
  try {
    r = await fetch(`${env.peppol.baseUrl}${path}`, {
      method,
      headers: { authorization: authHeader(), ...(body ? { 'content-type': 'application/json' } : {}), accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new HttpError(502, 'Le point d’accès Peppol ne répond pas. Aucun document transmis, réessayez dans un instant.');
  }
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
}

/** « BE 1003.823.997 » -> « 0208:1003823997 » (adresse Peppol d'une entreprise belge). Autre pays : null. */
export function peppolAddressFromVat(vat: string | null | undefined): string | null {
  const v = (vat ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!v.startsWith('BE')) return null;
  let digits = v.slice(2);
  if (/^\d{9}$/.test(digits)) digits = `0${digits}`;
  return /^\d{10}$/.test(digits) ? `0208:${digits}` : null;
}
export const vatForPeppol = (vat: string | null | undefined) => {
  const a = peppolAddressFromVat(vat);
  return a ? `BE${a.slice(5)}` : null;
};

const ymd = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const dec = (n: number, places = 2) => n.toFixed(places);
const plain = (html: string) => html
  .replace(/<br\s*\/?>/gi, ' ').replace(/<\/(li|p|div)>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** « Rue du Pont 12 bte 3, 1000 Bruxelles » -> rue / code postal / ville ; null si le format n'est pas reconnu. */
export function splitAddress(raw: string | null | undefined): { street: string; postalZone: string; city: string } | null {
  const m = /^(.*?),?\s*(\d{4})\s+([^,]+?)\s*$/.exec((raw ?? '').trim());
  return m && m[1]!.trim() ? { street: m[1]!.trim(), postalZone: m[2]!, city: m[3]!.trim() } : null;
}

interface PeppolDoc {
  kind: string; number: string | null; issuedOn: Date | null; dueOn: Date | null; structuredComm: string | null; customerRef: string | null;
  billingName: string | null; billingVat: string | null; billingAddress: string | null; totalHt?: number; totalTtc?: number;
  contact: { name: string; vat: string | null; address: string | null; box: string | null; postalCode: string | null; city: string | null } | null;
  worksite?: { ref: string } | null;
  lines: { kind: string; label: string; qty: number; unitPriceHt: number; discountPct: number; vatRate: number }[];
}

/** Lignes au format Peppol : prix net unitaire APRÈS remise ; si l'arrondi ne retombe pas exactement sur le total de la ligne, on envoie 1 × total. */
export function peppolLines(d: Pick<PeppolDoc, 'lines'>) {
  return d.lines.filter((l) => l.kind === 'item').map((l) => {
    const qty = Math.abs(l.qty);
    const lineTotal = round2(qty * Math.abs(l.unitPriceHt) * (1 - Math.min(Math.max(l.discountPct ?? 0, 0), 100) / 100));
    let netUnit = round2(Math.abs(l.unitPriceHt) * (1 - Math.min(Math.max(l.discountPct ?? 0, 0), 100) / 100));
    let quantity = qty;
    let name = plain(l.label).slice(0, 200) || 'Prestation';
    if (round2(qty * netUnit) !== lineTotal) { quantity = 1; netUnit = lineTotal; name = `${name} (${qty} × ${round2(Math.abs(l.unitPriceHt))} €)`.slice(0, 200); }
    const vat = l.vatRate === 0 ? { category: 'AE', percentage: '0.00' } : { category: 'S', percentage: dec(l.vatRate * 100) };
    return { name, quantity: dec(quantity, 2), netPriceAmount: dec(netUnit), vat, _total: lineTotal, _rate: l.vatRate };
  });
}

/** Totaux tels que le réseau les recalculera (TVA arrondie par taux) — pour refuser d'envoyer un document dont les totaux divergent. */
export function peppolExpectedTotals(lines: ReturnType<typeof peppolLines>) {
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l._rate, round2((byRate.get(l._rate) ?? 0) + l._total));
  let ht = 0, vat = 0;
  for (const [rate, base] of byRate) { ht += base; vat += round2(base * rate); }
  return { ht: round2(ht), ttc: round2(ht + vat) };
}

export function buildPeppolPayload(d: PeppolDoc, co: Pick<Company, 'iban'>) {
  const vat = vatForPeppol(d.billingVat ?? d.contact?.vat);
  const recipient = peppolAddressFromVat(d.billingVat ?? d.contact?.vat);
  if (!d.billingVat && !d.contact?.vat) throw new HttpError(422, 'Numéro de TVA du client manquant : Peppol est réservé aux clients professionnels (les particuliers reçoivent le PDF par e-mail).');
  if (!vat || !recipient) throw new HttpError(422, 'Le numéro de TVA du client n’est pas un numéro belge valide (BE + 10 chiffres) : envoi Peppol impossible depuis JJD.');

  const name = d.billingName ?? d.contact?.name ?? '';
  const addr = splitAddress(d.billingAddress)
    ?? (d.contact?.address && d.contact.postalCode && d.contact.city
      ? { street: [d.contact.address, d.contact.box && `bte ${d.contact.box}`].filter(Boolean).join(' '), postalZone: d.contact.postalCode, city: d.contact.city }
      : null);
  if (!name || !addr) throw new HttpError(422, 'Adresse du client incomplète (rue, code postal et ville) : complétez la fiche du client ou l’adresse de facturation.');
  if (!d.number) throw new HttpError(422, 'Document sans numéro : émettez-le avant de l’envoyer.');

  const lines = peppolLines(d);
  if (!lines.length) throw new HttpError(422, 'Aucune ligne facturable sur ce document.');
  const exp = peppolExpectedTotals(lines);
  if (d.totalTtc !== undefined && Math.abs(exp.ttc - Math.abs(d.totalTtc)) > 0.01) {
    throw new HttpError(422, `Totaux incohérents (${exp.ttc} € recalculés pour Peppol contre ${Math.abs(d.totalTtc)} € sur le document). Aucun envoi : corrigez les lignes.`);
  }

  const iban = (co.iban ?? '').replace(/\s+/g, '');
  const note = [d.customerRef && `Réf. client : ${d.customerRef}`, d.worksite?.ref && `Chantier ${d.worksite.ref}`].filter(Boolean).join(' · ');
  const issue = ymd(d.issuedOn ?? new Date());
  const common = {
    issueDate: issue,
    currency: 'EUR',
    buyer: { vatNumber: vat, name, street: addr.street, city: addr.city, postalZone: addr.postalZone, country: 'BE' },
    ...(iban ? { paymentMeans: [{ paymentMethod: 'credit_transfer', reference: d.structuredComm ?? d.number, iban }] } : {}),
    lines: lines.map(({ _total, _rate, ...l }) => l), // eslint-disable-line @typescript-eslint/no-unused-vars
    ...(note ? { note } : {}),
  };
  if (d.kind === 'credit_note') return { recipient, documentType: 'creditNote' as const, document: { creditNoteNumber: d.number, ...common } };
  const due = d.dueOn ?? new Date(new Date(issue).getTime() + 30 * 86_400_000);
  return { recipient, documentType: 'invoice' as const, document: { invoiceNumber: d.number, dueDate: ymd(due), ...common } };
}

const flattenErrors = (j: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!j) return 'réponse illisible';
  if (j.errors && typeof j.errors === 'object') return Object.entries(j.errors).map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' ; ');
  return String(j.message ?? j.error ?? 'erreur inconnue');
};

/** Envoie un document émis sur Peppol. Ne marque « envoyé » que si le point d'accès a accepté le document. */
export async function sendViaPeppol(documentId: string, userId: string) {
  if (!peppolConfigured()) throw new HttpError(503, 'Envoi Peppol non connecté à JJD. Aucun document transmis. Utilisez TrustUp tant que la clé du point d’accès n’est pas installée.');
  const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { lines: { orderBy: { position: 'asc' } }, contact: true, worksite: { select: { ref: true } } } });
  if (!doc) throw new HttpError(404, 'Document introuvable');
  if (!PEPPOL_KINDS.includes(doc.kind) || doc.direction === 'purchase') throw new HttpError(422, 'Seuls les factures, factures d’acompte et notes de crédit de vente passent par Peppol.');
  const delivery = externalDeliveryState(doc);
  if (doc.peppolId && ['sent', 'delivered'].includes(doc.peppolStatus ?? '')) throw new HttpError(409, 'Ce document a déjà été transmis par Peppol.');
  const payload = buildPeppolPayload({ ...doc, totalTtc: computeDocTotals(doc.lines).totalTtc }, await getCompany());

  const v = await call('POST', '/verify', { peppolAddress: payload.recipient });
  if (v.status === 401 || v.status === 403) throw new HttpError(502, 'Clé Peppol refusée par le point d’accès. Vérifiez la configuration.');
  if (!v.ok) throw new HttpError(502, 'Vérification du destinataire Peppol impossible pour le moment. Aucun document transmis.');
  if (!v.json?.isValid) throw new HttpError(422, `Ce client n’est pas joignable sur Peppol (${payload.recipient}). Envoyez-lui le PDF par e-mail.`);

  const r = await call('POST', `/${encodeURIComponent(env.peppol.companyId)}/send`, payload);
  if (!r.ok || r.json?.success === false || !r.json?.id) throw new HttpError(422, `Peppol a refusé le document : ${flattenErrors(r.json)}. Aucun envoi.`);

  const failed = r.json.deliveryStatus === 'failed';
  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: { peppolId: String(r.json.id), peppolStatus: failed ? 'error' : r.json.deliveryStatus === 'delivered' ? 'delivered' : 'sent', ...(failed ? {} : { sentAt: doc.sentAt ?? new Date(), status: delivery.status }) },
    include: docInclude,
  });
  await prisma.auditLog.create({ data: { actorId: userId, action: 'send', entity: 'document', entityId: doc.id, meta: { channel: 'peppol', recipient: payload.recipient, peppolId: String(r.json.id) } } });
  return { document: updated, note: failed ? 'Peppol a signalé un échec de livraison. Aucun envoi enregistré.' : `Transmis au réseau Peppol (${payload.recipient}). Le statut de livraison se met à jour automatiquement.` };
}

const mapStatus = (s: unknown) => (s === 'delivered' ? 'delivered' : s === 'failed' ? 'error' : 'sent');

/** Relit le statut de livraison d'un document déjà transmis. */
export async function refreshPeppolStatus(documentId: string) {
  if (!peppolConfigured()) throw new HttpError(503, 'Peppol non configuré.');
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { id: true, peppolId: true, peppolStatus: true } });
  if (!doc?.peppolId) throw new HttpError(404, 'Ce document n’a pas été transmis par Peppol.');
  const r = await call('GET', `/documents/${encodeURIComponent(doc.peppolId)}`);
  if (!r.ok) throw new HttpError(502, 'Statut Peppol indisponible pour le moment.');
  const d = r.json?.document ?? r.json;
  const status = mapStatus(d?.deliveryStatus);
  const detail = Array.isArray(d?.deliveries) ? d.deliveries.map((x: any) => x.failureReason ?? x.error ?? x.status).filter(Boolean).join(' ; ') : null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (status !== doc.peppolStatus) await prisma.document.update({ where: { id: doc.id }, data: { peppolStatus: status } });
  return { status, detail };
}

/** Balayage régulier : les documents transmis mais pas encore confirmés « livrés » (ou en échec) sont relus. */
export async function refreshPendingPeppol(): Promise<number> {
  if (!peppolConfigured()) return 0;
  const pending = await prisma.document.findMany({ where: { peppolId: { not: null }, peppolStatus: 'sent' }, select: { id: true }, take: 50 });
  let changed = 0;
  for (const p of pending) { try { const before = await prisma.document.findUnique({ where: { id: p.id }, select: { peppolStatus: true } }); const r = await refreshPeppolStatus(p.id); if (r.status !== before?.peppolStatus) changed++; } catch { /* réessayé au prochain passage */ } }
  return changed;
}
