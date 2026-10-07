/**
 * Cahier des charges rédigé par Claude à partir du devis (au lieu d'une simple recopie + listes d'exclusions toutes faites).
 * L'IA ne fait que PROPOSER du texte : elle ne décide ni prix, ni quantités ; labels, quantités et unités viennent toujours du devis.
 * La structure (sections, tableaux, PDF/Word, éditeur) est celle de buildCdc : si l'IA échoue, la génération de base est utilisée telle quelle.
 */
import { z } from 'zod';
import { groupLots, htmlToText, isOption, type CdcBlock, type CdcContent, type CdcInput, type CdcSection } from './cdc.js';
import { estimateLots, DEFAULT_PLAN, type QuoteLine } from './quote-plan.js';

const strs = (max: number, n: number) => z.array(z.string().trim().min(1).max(max)).max(n);
export const aiCdcSchema = z.object({
  context: z.string().trim().min(20).max(1800),
  hypotheses: strs(450, 8),
  lots: z.array(z.object({
    description: z.string().trim().max(900),
    works: z.array(z.object({ id: z.string().trim().max(12), details: strs(520, 14) })).max(60),
    products: z.array(z.object({ item: z.string().trim().min(1).max(200), spec: z.string().trim().min(1).max(600) })).max(12),
    included: strs(450, 18),
    excluded: strs(450, 10),
  })).min(1).max(30),
  generalExclusions: strs(450, 10),
  execution: strs(450, 10),
  planning: z.string().trim().max(1200),
});
export type AiCdc = z.infer<typeof aiCdcSchema>;

export const CDC_SYSTEM = `Tu es conducteur de travaux chez JJD Consult, entreprise belge de rénovation et de construction. Tu rédiges le cahier des charges d'un chantier à partir du devis fourni.
Objectif du document : cadenasser ce qui est COMPRIS, la finition attendue et le choix des produits, pour qu'il n'y ait aucune dispute plus tard. Ce n'est PAS un cahier des charges d'architecte : il doit rester simple, concret et lisible par un particulier.

Règles impératives :
- Ne décris que des travaux présents dans le devis (titres et descriptions). N'invente aucun poste, aucun prix, aucune marque, aucune quantité. Quand une information manque (teinte, modèle, format…), place-la dans les produits à faire valider par le maître d'ouvrage.
- Pour CHAQUE poste du devis (identifié par son numéro, ex. « 1.2 »), détaille l'exécution de manière concrète : étapes dans l'ordre, matériaux et types courants en Belgique, épaisseurs ou systèmes usuels, finition obtenue. Appuie-toi sur les puces du devis, précise-les, ne les recopie pas mot pour mot.
- « included » (compris) : liste détaillée et spécifique au lot, plus longue que « excluded ». Ce qui est dans le devis est compris : dis-le précisément (fournitures, pose, finition, protections, évacuation…).
- « excluded » (non compris) : seulement les exclusions réellement pertinentes pour CES travaux et susceptibles de créer un litige (3 à 8 par lot), formulées simplement. Interdit de recopier une liste générique ou d'ajouter un métier absent du devis.
- « products » : uniquement les choix concernant les postes du devis (carrelage, peinture, sanitaire, parquet…). Pour chacun, indique ce qui est déjà fixé au devis (ex. budget 50 €/m²) et ce que le maître d'ouvrage doit encore choisir. Aucun métier absent du devis.
- « generalExclusions » : 4 à 8 exclusions générales vraiment utiles pour ce chantier (permis, raccordements, éléments cachés de l'existant, désamiantage…), sans doublon avec celles des lots.
- Français de Belgique, ton professionnel, phrases courtes. Aucun engagement juridique nouveau. Cite un montant seulement s'il figure dans le devis.
- Les postes marqués [OPTION] ne sont PAS compris : mentionne-les dans « excluded » du lot.

Réponds UNIQUEMENT par un objet JSON valide (aucun texte autour) de cette forme exacte :
{
  "context": "2 à 4 phrases : nature du chantier, lieu, objectif du maître d'ouvrage, d'après le devis",
  "hypotheses": ["3 à 6 hypothèses propres à ce chantier (état de l'existant, accès, eau/électricité…)"],
  "lots": [ { "description": "1 à 2 phrases sur le lot", "works": [ { "id": "1.1", "details": ["étape ou précision d'exécution", "…"] } ], "products": [ { "item": "Carrelage sol WC", "spec": "Prévu au devis : … ; à choisir : format, teinte, joints" } ], "included": ["…"], "excluded": ["…"] } ],
  "generalExclusions": ["…"],
  "execution": ["conditions d'exécution propres à ce chantier (occupation des lieux, protections, évacuation, séchage…)"],
  "planning": "1 à 2 phrases sur l'enchaînement logique des lots (sans dates)"
}
Le tableau « lots » doit contenir exactement un élément par lot du devis, dans le même ordre.`;

const eur = (n: number) => n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' });
const qtyTxt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace('.', ','));

export function cdcPrompt(input: CdcInput): string {
  const { worksite: w, client, quote } = input;
  const lots = groupLots(quote.lines);
  const out: string[] = [];
  out.push(`CHANTIER : ${w.ref} — ${w.title}${w.city ? ` (${w.city})` : ''}`);
  if (client) out.push(`MAÎTRE D'OUVRAGE : ${client.name}`);
  out.push(`DEVIS : ${quote.number ?? 'brouillon'}${quote.title ? ` — ${quote.title}` : ''} — total ${eur(quote.totalHt)} HTVA`);
  lots.forEach((lot, li) => {
    out.push('', `LOT ${li + 1} — ${lot.title}`);
    if (lot.intro) out.push(`  Introduction du lot : ${lot.intro}`);
    lot.items.forEach((i, k) => {
      const d = htmlToText(i.description).replace(/\n+/g, ' ; ');
      out.push(`  ${li + 1}.${k + 1} ${isOption(i.label) ? '[OPTION] ' : ''}${i.label.trim()} — ${i.qty ? qtyTxt(i.qty) : ''} ${i.unit ?? ''} — ${eur(i.totalHt)} HT${d ? `\n      Détail du devis : ${d}` : ''}`);
    });
    for (const t of lot.texts) out.push(`  Note du devis : ${t}`);
  });
  return out.join('\n');
}

const TODO = '[À compléter';
const text = (t: string): CdcBlock[] => t.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => ({ type: 'p' as const, text: x }));

/** Fusionne la réponse de l'IA dans le cahier des charges de base ; renvoie null si elle ne correspond pas au devis (nombre de lots différent). */
export function applyAiToCdc(base: CdcContent, ai: AiCdc, input: CdcInput): CdcContent | null {
  const lots = groupLots(input.quote.lines);
  if (ai.lots.length !== lots.length) return null;
  const sections: CdcSection[] = base.sections.map((s) => ({ ...s, blocks: [...s.blocks] }));
  const find = (title: string) => sections.find((s) => s.title === title);

  const ctx = sections[0];
  if (ctx) ctx.blocks = [...ctx.blocks.filter((b) => !(b.type === 'p' && b.text.startsWith(TODO))), ...text(ai.context)];

  const hyp = find('Prise en compte de l’existant et hypothèses');
  if (hyp && ai.hypotheses.length) hyp.blocks = hyp.blocks.map((b) => (b.type === 'ul' ? { type: 'ul' as const, items: ai.hypotheses } : b));

  const products: string[][] = [];
  lots.forEach((lot, li) => {
    const a = ai.lots[li]!;
    const idx = sections.findIndex((s) => s.title.startsWith(`Lot ${li + 1} — `));
    if (idx < 0) return;
    const included = lot.items.filter((i) => !isOption(i.label));
    const blocks: CdcBlock[] = [...text(a.description || '')];
    for (const t of lot.texts) blocks.push({ type: 'p', text: t });
    if (included.length) {
      blocks.push({ type: 'table', head: ['N°', 'Désignation', 'Quantité', 'Unité'], rows: included.map((i) => {
        const k = lot.items.indexOf(i) + 1;
        return [`${li + 1}.${k}`, i.label.trim(), i.qty ? qtyTxt(i.qty) : '', i.unit ?? ''];
      }) });
      const works = included.map((i) => {
        const id = `${li + 1}.${lot.items.indexOf(i) + 1}`;
        const d = a.works.find((w) => w.id === id)?.details ?? [];
        return { label: i.label.trim(), details: d };
      }).filter((w) => w.details.length);
      if (works.length) {
        blocks.push({ type: 'p', text: 'Exécution détaillée :' });
        for (const w of works) { blocks.push({ type: 'p', text: w.label }); blocks.push({ type: 'ul', items: w.details }); }
      }
    }
    if (a.products.length) {
      blocks.push({ type: 'p', text: 'Produits, teintes et finitions (à faire valider par le maître d’ouvrage avant commande) :' });
      blocks.push({ type: 'table', head: ['Poste', 'Prévu / à décider', 'Retenu'], rows: a.products.map((p) => [p.item, p.spec, `${TODO} : produit, référence, teinte]`]) });
      a.products.forEach((p) => products.push([lot.title, p.item]));
    }
    if (a.included.length) { blocks.push({ type: 'p', text: 'Compris dans le prix du lot :' }); blocks.push({ type: 'ul', items: a.included }); }
    if (a.excluded.length) { blocks.push({ type: 'p', text: 'Non compris dans ce lot :' }); blocks.push({ type: 'ul', items: a.excluded }); }
    sections[idx] = { ...sections[idx]!, blocks };
  });

  const gen = find('Ce qui n’est pas compris dans l’offre');
  if (gen && ai.generalExclusions.length) {
    gen.blocks = gen.blocks.map((b) => {
      if (b.type !== 'ul') return b;
      const options = b.items.filter((x) => x.startsWith('Option non retenue'));
      return { type: 'ul' as const, items: [...ai.generalExclusions, ...options] };
    });
  }

  const choix = find('Choix des produits et finitions à valider');
  if (choix) choix.blocks = choix.blocks.map((b) => (b.type === 'table'
    ? { ...b, rows: products.length ? products.map((p) => [p[0]!, p[1]!, `${TODO} : produit, référence, teinte]`, '']) : [['—', 'Aucun choix particulier identifié dans le devis', '', '']] }
    : b));

  const cond = find('Conditions d’exécution et limites');
  if (cond && ai.execution.length) cond.blocks = cond.blocks.map((b) => (b.type === 'ul' ? { type: 'ul' as const, items: [...b.items.filter((x) => !x.startsWith(TODO)), ...ai.execution] } : b));

  const plan = find('Planning prévisionnel');
  if (plan) {
    const quoteLines: QuoteLine[] = input.quote.lines.map((l) => ({ kind: l.kind, label: l.label, description: l.description, qty: l.qty, unit: l.unit, totalHt: l.totalHt }));
    const est = estimateLots(quoteLines, { startDate: '2026-01-05', ...DEFAULT_PLAN });
    const blocks: CdcBlock[] = [plan.blocks[0] ?? { type: 'p', text: 'Le planning prévisionnel est ajusté selon les conditions réelles du chantier.' }];
    if (ai.planning) blocks.push({ type: 'p', text: ai.planning });
    if (est.length) {
      blocks.push({ type: 'table', head: ['Lot', 'Durée estimée (équipe de 2 personnes)'], rows: [...est.map((l) => [l.title, `${qtyTxt(l.days)} jour${l.days > 1 ? 's' : ''} ouvrable${l.days > 1 ? 's' : ''}`]), ['Total', `${qtyTxt(est.reduce((s, l) => s + l.days, 0))} jours ouvrables`]] });
    }
    blocks.push({ type: 'p', text: '[À compléter : date de démarrage souhaitée et jalons importants]' });
    plan.blocks = blocks;
  }

  return { meta: base.meta, sections };
}
