import { z } from 'zod';
import { nanoid } from 'nanoid';
import { TRADE_RULES } from './cdc.js';
import type { QuoteLine } from './quote-plan.js';

/**
 * Listes d'achats d'un chantier, tirées du devis :
 *  - INTERNE : tout le matériel à acheter pour le chantier, avec budget estimé, fournisseur et avancement (à commander / commandé / reçu) ;
 *  - CLIENT (lien public) : les produits proposés au client, qu'il valide ou conteste — jamais de prix de revient ni de fournisseur.
 */
export interface InternalItem { id: string; lot: string; label: string; qty: number; unit: string; estCostHt: number; supplier: string; status: 'todo' | 'ordered' | 'received'; note: string }
export interface ClientItem { id: string; lot: string; label: string; proposal: string; detail: string; priceTtc: number | null; url: string; clientChoice: 'ok' | 'other' | null; clientComment: string; answeredAt: string | null }

export const internalItemSchema = z.object({
  id: z.string().min(1).max(40), lot: z.string().max(300), label: z.string().max(500), qty: z.number().min(0).max(1_000_000), unit: z.string().max(30),
  estCostHt: z.number().min(0).max(10_000_000), supplier: z.string().max(200), status: z.enum(['todo', 'ordered', 'received']), note: z.string().max(1000),
});
export const clientItemSchema = z.object({
  id: z.string().min(1).max(40), lot: z.string().max(300), label: z.string().max(500), proposal: z.string().max(500), detail: z.string().max(2000),
  priceTtc: z.number().min(0).max(10_000_000).nullable(), url: z.string().max(500),
  // les réponses du client ne sont jamais modifiables depuis le bureau (voir mergeClientAnswers)
  clientChoice: z.enum(['ok', 'other']).nullable().optional(), clientComment: z.string().max(2000).optional(), answeredAt: z.string().nullable().optional(),
});

const isOption = (l: string) => /^\s*(option|variante)\b/i.test(l);
const isLabour = (l: QuoteLine) => (l.unit ?? '').toLowerCase().replace(/\./g, '') === 'h' || /main d['’]œuvre|main d['’]oeuvre|heures? de|journée|déplacement|deplacement|évacuation|evacuation|étude|etude|dossier|permis/i.test(l.label) || /main d['’]œuvre|main d['’]oeuvre/i.test(l.category ?? '');
const newId = () => nanoid(8);
const r2 = (n: number) => Math.round(n * 100) / 100;

function lotsOf(lines: QuoteLine[]): { title: string; items: QuoteLine[] }[] {
  const lots: { title: string; items: QuoteLine[] }[] = [];
  let cur: { title: string; items: QuoteLine[] } | null = null;
  for (const l of lines) {
    if (l.kind === 'section') { cur = { title: l.label.trim(), items: [] }; lots.push(cur); continue; }
    if (l.kind !== 'item') continue;
    if (!cur) { cur = { title: 'Travaux', items: [] }; lots.push(cur); }
    cur.items.push(l);
  }
  return lots.filter((l) => l.items.length);
}

/** Matériel à acheter : chaque ligne de travaux (hors main-d'œuvre pure et options) avec sa part « matériel » du montant du devis. */
export function buildInternalItems(lines: QuoteLine[], materialShare = 0.5): InternalItem[] {
  const out: InternalItem[] = [];
  for (const lot of lotsOf(lines)) {
    for (const i of lot.items) {
      if (isOption(i.label) || isLabour(i)) continue;
      out.push({ id: newId(), lot: lot.title, label: i.label.trim(), qty: i.qty || 1, unit: i.unit ?? '', estCostHt: r2(i.totalHt * materialShare), supplier: '', status: 'todo', note: '' });
    }
  }
  return out;
}

/** Produits à proposer au client : un choix par corps de métier détecté dans chaque lot (carrelage, peinture, sanitaire, châssis…). */
export function buildClientItems(lines: QuoteLine[]): ClientItem[] {
  const out: ClientItem[] = [];
  for (const lot of lotsOf(lines)) {
    const text = [lot.title, ...lot.items.map((i) => `${i.label} ${i.description ?? ''}`)].join(' ');
    for (const r of TRADE_RULES.filter((x) => x.choice && x.re.test(text))) {
      out.push({ id: newId(), lot: lot.title, label: r.trade, proposal: '', detail: r.choice, priceTtc: null, url: '', clientChoice: null, clientComment: '', answeredAt: null });
    }
  }
  return out;
}

/** À l'enregistrement par le bureau, les réponses déjà données par le client sont conservées telles quelles (par id de ligne). */
export function mergeClientAnswers(existing: ClientItem[], incoming: z.infer<typeof clientItemSchema>[]): ClientItem[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  return incoming.map((i) => {
    const old = byId.get(i.id);
    return { id: i.id, lot: i.lot, label: i.label, proposal: i.proposal, detail: i.detail, priceTtc: i.priceTtc, url: i.url, clientChoice: old?.clientChoice ?? null, clientComment: old?.clientComment ?? '', answeredAt: old?.answeredAt ?? null };
  });
}

export const newShareToken = () => nanoid(24);

// ------------------------------------------------------------------ rendus PDF
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const eur = (n: number) => n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' });
const STATUS_FR = { todo: 'À commander', ordered: 'Commandé', received: 'Reçu' } as const;
const CSS = `@page{size:A4;margin:16mm}body{font:10pt/1.4 Arial,sans-serif;color:#1d2a25}h1{font-size:19pt;color:#173f34;margin:0 0 2mm}h2{font-size:12pt;color:#173f34;border-bottom:1.5px solid #c9a24b;padding-bottom:1mm;margin:7mm 0 2mm}.sub{color:#4a5a54;margin-bottom:5mm}table{width:100%;border-collapse:collapse;font-size:9pt}th,td{border:1px solid #b9c4be;padding:1.5mm 2mm;text-align:left;vertical-align:top}th{background:#eef2ef}td.r,th.r{text-align:right}tr{page-break-inside:avoid}.tot{font-weight:700;background:#f6f1e2}`;

export function internalListHtml(title: string, ref: string, items: InternalItem[], spentHt: number): string {
  const lots = [...new Set(items.map((i) => i.lot))];
  const total = items.reduce((s, i) => s + i.estCostHt, 0);
  const body = lots.map((lot) => {
    const rows = items.filter((i) => i.lot === lot);
    return `<h2>${esc(lot)}</h2><table><thead><tr><th>Article</th><th class="r">Qté</th><th>Unité</th><th>Fournisseur</th><th class="r">Budget HT</th><th>Statut</th><th>Note</th></tr></thead><tbody>${rows.map((i) => `<tr><td>${esc(i.label)}</td><td class="r">${i.qty}</td><td>${esc(i.unit)}</td><td>${esc(i.supplier)}</td><td class="r">${eur(i.estCostHt)}</td><td>${STATUS_FR[i.status]}</td><td>${esc(i.note)}</td></tr>`).join('')}<tr class="tot"><td colspan="4">Sous-total</td><td class="r">${eur(rows.reduce((s, i) => s + i.estCostHt, 0))}</td><td colspan="2"></td></tr></tbody></table>`;
  }).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${CSS}</style></head><body><h1>Liste d’achats — ${esc(ref)}</h1><div class="sub">${esc(title)} · document interne</div>${body}<h2>Synthèse</h2><table><tr><td>Budget matériel estimé</td><td class="r">${eur(total)}</td></tr><tr><td>Déjà acheté (grand livre)</td><td class="r">${eur(spentHt)}</td></tr><tr class="tot"><td>Reste estimé</td><td class="r">${eur(total - spentHt)}</td></tr></table></body></html>`;
}

export function clientListHtml(title: string, ref: string, items: ClientItem[]): string {
  const lots = [...new Set(items.map((i) => i.lot))];
  const body = lots.map((lot) => `<h2>${esc(lot)}</h2><table><thead><tr><th>Poste</th><th>Produit proposé</th><th>Détail</th><th class="r">Prix TTC</th></tr></thead><tbody>${items.filter((i) => i.lot === lot).map((i) => `<tr><td>${esc(i.label)}</td><td>${esc(i.proposal || 'À proposer')}${i.url ? `<br><small>${esc(i.url)}</small>` : ''}</td><td>${esc(i.detail)}</td><td class="r">${i.priceTtc != null ? eur(i.priceTtc) : '—'}</td></tr>`).join('')}</tbody></table>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${CSS}</style></head><body><h1>Produits proposés — ${esc(ref)}</h1><div class="sub">${esc(title)}</div>${body}</body></html>`;
}
