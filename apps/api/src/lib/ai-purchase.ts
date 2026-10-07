/**
 * Liste d'achats rédigée par Claude : articles concrets (type, dimensions, consommables) avec quantités ESTIMÉES et prix d'achat estimés,
 * calés sur la part « fourniture » du budget du devis. Si l'IA échoue, la liste de base (une ligne par poste) est utilisée.
 */
import { z } from 'zod';
import { htmlToText } from './cdc.js';
import { buildInternalItems, lotsOf, isLabour, isOption, newId, r2, type ClientItem, type InternalItem } from './purchase-list.js';
import type { QuoteLine } from './quote-plan.js';

export const MATERIAL_SHARE = 0.5;

export const aiPurchaseSchema = z.object({
  items: z.array(z.object({
    lot: z.number().int().min(1).max(40), label: z.string().trim().min(1).max(200), qty: z.number().min(0).max(1_000_000), unit: z.string().trim().max(20),
    estCostHt: z.number().min(0).max(1_000_000), note: z.string().trim().max(300).default(''),
  })).max(300),
  client: z.array(z.object({ lot: z.number().int().min(1).max(40), label: z.string().trim().min(1).max(200), detail: z.string().trim().min(1).max(600) })).max(60),
});
export type AiPurchase = z.infer<typeof aiPurchaseSchema>;

export const PURCHASE_SYSTEM = `Tu prépares la liste d'achats d'un chantier pour JJD Consult, entreprise belge de rénovation. À partir du devis, tu établis la liste CONCRÈTE des fournitures à acheter, lot par lot, utilisable telle quelle pour passer commande chez les fournisseurs.

Règles impératives :
- Articles précis : type de produit, dimensions / épaisseur / gamme courante (ex. « Carrelage grès cérame 60×60 »), et tous les consommables nécessaires (colle, joints, enduit, sous-couche, visserie, profilés, silicone, bandes, etc.). Un article par ligne, pas de regroupement vague.
- Quantités ESTIMÉES à partir des informations du devis (surfaces, nombre de pièces pour une peinture, longueurs…). Quand une quantité ne peut pas être estimée sérieusement, mets 1 avec l'unité « forfait » et écris « quantité à confirmer sur place » dans la note. Ajoute une marge de chute raisonnable (5 à 10 %) pour les matériaux de pose.
- Prix : « estCostHt » = prix d'ACHAT HT réaliste en Belgique pour la ligne entière (pas le prix de vente au client). Pour chaque lot, la SOMME des estCostHt doit rester inférieure ou égale au budget fournitures indiqué pour le lot (c'est la part fourniture du prix du devis). Si le budget est faible, choisis des gammes courantes.
- Ne liste ni la main-d'œuvre, ni les postes marqués [OPTION], ni des travaux absents du devis. Si un lot n'a aucune fourniture à acheter (budget 0), ne renvoie aucun article pour ce lot.
- Si le devis fixe un budget ou un prix (ex. « carrelage budget 50 €/m² »), respecte-le pour l'article concerné.
- « client » : les choix de produits que le client doit valider (ex. carrelage sol WC, peinture murs, sanitaire…), un élément par choix réel présent dans le devis. « detail » = ce qui est prévu au devis (budget, format, système) et ce qu'il doit décider. Pas de prix de revient, pas de fournisseur.
- Français de Belgique, libellés courts.

Réponds UNIQUEMENT par un objet JSON valide (aucun texte autour) de cette forme exacte :
{
  "items": [ { "lot": 1, "label": "Carrelage grès cérame 60×60 (sol + bâti)", "qty": 6, "unit": "m²", "estCostHt": 300, "note": "" } ],
  "client": [ { "lot": 1, "label": "Carrelage sol WC", "detail": "Budget prévu au devis : 50 €/m² (colle et joints fournis). À choisir : format, teinte, joints." } ]
}
« lot » est le numéro du lot tel qu'indiqué ci-dessous (1, 2, 3…).`;

const eur = (n: number) => n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' });

export function lotBudgets(lines: QuoteLine[]) {
  return lotsOf(lines).map((lot) => ({
    title: lot.title,
    budget: r2(lot.items.filter((i) => !isOption(i.label) && !isLabour(i)).reduce((s, i) => s + i.totalHt * MATERIAL_SHARE, 0)),
    items: lot.items,
  }));
}

export function purchasePrompt(lines: QuoteLine[], worksite: { ref: string; title: string }): string {
  const out: string[] = [`CHANTIER : ${worksite.ref} — ${worksite.title}`];
  lotBudgets(lines).forEach((lot, li) => {
    out.push('', `LOT ${li + 1} — ${lot.title}   (budget fournitures : ${eur(lot.budget)} HT)`);
    for (const i of lot.items) {
      const d = htmlToText(i.description).replace(/\n+/g, ' ; ');
      out.push(`  - ${isOption(i.label) ? '[OPTION] ' : isLabour(i) ? '[MAIN-D\'ŒUVRE] ' : ''}${i.label.trim()} — ${i.qty || ''} ${i.unit ?? ''} — ${eur(i.totalHt)} HT${d ? `\n      Détail : ${d}` : ''}`);
    }
  });
  return out.join('\n');
}

/** Transforme la réponse de l'IA en lignes de liste ; ramène chaque lot à son budget si l'IA le dépasse. Renvoie null si inutilisable. */
export function applyAiPurchase(lines: QuoteLine[], ai: AiPurchase): { internal: InternalItem[]; client: ClientItem[] } | null {
  const lots = lotBudgets(lines);
  const base = buildInternalItems(lines, MATERIAL_SHARE);
  const internal: InternalItem[] = [];
  let used = 0;
  lots.forEach((lot, li) => {
    const mine = ai.items.filter((i) => i.lot === li + 1);
    if (!mine.length || lot.budget <= 0) { internal.push(...base.filter((b) => b.lot === lot.title)); return; }
    used++;
    const sum = mine.reduce((s, i) => s + i.estCostHt, 0);
    const factor = sum > lot.budget ? lot.budget / sum : 1;
    const rows: InternalItem[] = mine.map((i) => ({
      id: newId(), lot: lot.title, label: i.label, qty: i.qty, unit: i.unit, estCostHt: r2(i.estCostHt * factor), supplier: '', status: 'todo' as const,
      note: [i.note, factor < 1 ? 'Estimation ajustée au budget du devis' : ''].filter(Boolean).join(' — '),
    }));
    // les arrondis ligne par ligne ne doivent pas faire dépasser le budget : la dernière ligne absorbe l'écart
    if (factor < 1) { const last = rows[rows.length - 1]!; last.estCostHt = Math.max(0, r2(last.estCostHt + lot.budget - rows.reduce((s, r) => s + r.estCostHt, 0))); }
    internal.push(...rows);
  });
  if (!used) return null;
  const client: ClientItem[] = ai.client.filter((c) => c.lot <= lots.length).map((c) => ({
    id: newId(), lot: lots[c.lot - 1]!.title, label: c.label, proposal: '', detail: c.detail, priceTtc: null, url: '', clientChoice: null, clientComment: '', answeredAt: null,
  }));
  return { internal, client };
}
