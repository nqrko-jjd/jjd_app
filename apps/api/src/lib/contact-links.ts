import { prisma } from '../db.js';
import { contactReferences } from './contact-merge.js';

/**
 * À quoi une fiche Contact est rattachée : chantiers, devis/factures, grand livre, virements, opportunités, commandes… Lu dans le schéma
 * (comme la fusion, voir contact-merge.ts) : une relation ajoutée plus tard apparaît ici sans rien modifier. Sert à
 *  - afficher « Rattachements » sur la fiche,
 *  - dire PRÉCISÉMENT pourquoi une suppression est refusée,
 *  - prévisualiser une fusion (ce qui sera déplacé) avant de la lancer.
 */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const LABEL: Record<string, string> = {
  'Worksite.clientId': 'Chantiers (client)',
  'Worksite.acpId': 'Chantiers (immeuble / ACP)',
  'Worksite.billToContactId': 'Chantiers (facturé à)',
  'CrmOpportunity.contactId': 'Opportunités CRM',
  'CrmOpportunity.acpId': 'Opportunités CRM (immeuble)',
  'Document.contactId': 'Devis et factures',
  'LedgerEntry.contactId': 'Grand livre (achats et ventes)',
  'BankTransaction.contactId': 'Virements affectés au compte client',
  'Contact.linkedAcpId': 'Contacts rattachés à cet immeuble',
  'BuildingContact.contactId': 'Personnes clés d’immeuble',
  'BuildingContact.acpId': 'Personnes clés de cet immeuble',
  'BuildingUnit.contactId': 'Lots occupés',
  'BuildingUnit.acpId': 'Lots de cet immeuble',
  'User.residentOfId': 'Comptes résidents',
  'User.contactId': 'Accès portail client',
  'WorksiteContact.contactId': 'Contacts de chantier',
  'ContactPerson.contactId': 'Personnes de contact',
  'PurchaseOrder.contactId': 'Commandes fournisseur',
  'StockSupplier.contactId': 'Fournisseur du stock',
  'StockMovement.contactId': 'Mouvements de stock',
  'SupplierProduct.contactId': 'Articles et tarifs fournisseur',
};

/** Ne bloquent pas la suppression : l'accès portail et les personnes de contact partent avec la fiche, lots / personnes clés d'un immeuble suivent l'immeuble. */
const NON_BLOCKING = new Set(['User.contactId', 'ContactPerson.contactId', 'BuildingContact.acpId', 'BuildingUnit.acpId']);

export interface LinkItem { label: string; href?: string }
export interface LinkGroup { key: string; label: string; count: number; blocking: boolean; items: LinkItem[] }

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('fr-BE') : '');
const fmtEur = (n: number | null) => (n == null ? '' : n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' }));
const KIND_FR: Record<string, string> = { quote: 'devis', invoice: 'facture', deposit_invoice: 'acompte', credit_note: 'note de crédit' };

async function samples(model: string, field: string, id: string, take: number): Promise<LinkItem[]> {
  const where = { [field]: id };
  switch (model) {
    case 'Worksite':
      return (await prisma.worksite.findMany({ where, take, orderBy: { ref: 'desc' }, select: { id: true, ref: true, title: true } }))
        .map((w) => ({ label: `${w.ref} · ${w.title}`, href: `/app/chantiers/${w.id}` }));
    case 'Document':
      return (await prisma.document.findMany({ where, take, orderBy: { issuedOn: 'desc' }, select: { id: true, number: true, kind: true, totalTtc: true, status: true, worksite: { select: { ref: true } } } }))
        .map((d) => ({ label: `${d.number ?? 'brouillon'} · ${KIND_FR[d.kind] ?? d.kind} · ${fmtEur(d.totalTtc)}${d.worksite ? ` · ${d.worksite.ref}` : ''}`, href: `/app/documents/${d.id}` }));
    case 'LedgerEntry':
      return (await prisma.ledgerEntry.findMany({ where, take, orderBy: { date: 'desc' }, select: { docNumber: true, date: true, ttc: true, ht: true, direction: true, worksite: { select: { ref: true } } } }))
        .map((e) => ({ label: `${fmtDate(e.date)} · ${e.docNumber ?? (e.direction === 'purchase' ? 'achat' : 'vente')} · ${fmtEur(e.ttc ?? e.ht)}${e.worksite ? ` · ${e.worksite.ref}` : ''}` }));
    case 'BankTransaction':
      return (await prisma.bankTransaction.findMany({ where, take, orderBy: { bookingDate: 'desc' }, select: { bookingDate: true, amount: true, counterpartyName: true, description: true } }))
        .map((t) => ({ label: `${fmtDate(t.bookingDate)} · ${fmtEur(t.amount)} · ${(t.counterpartyName ?? t.description ?? '').slice(0, 50)}` }));
    case 'CrmOpportunity':
      return (await prisma.crmOpportunity.findMany({ where, take, orderBy: { createdAt: 'desc' }, select: { title: true } })).map((o) => ({ label: o.title, href: '/app/crm' }));
    case 'PurchaseOrder':
      return (await prisma.purchaseOrder.findMany({ where, take, orderBy: { createdAt: 'desc' }, select: { ref: true, status: true } })).map((o) => ({ label: `${o.ref} · ${o.status}` }));
    case 'Contact':
      return (await prisma.contact.findMany({ where, take, orderBy: { name: 'asc' }, select: { id: true, name: true } })).map((c) => ({ label: c.name, href: `/app/contacts/${c.id}` }));
    default:
      return [];
  }
}

export async function contactLinks(id: string, take = 6): Promise<{ total: number; blocking: number; groups: LinkGroup[] }> {
  const db = prisma as unknown as Record<string, { count: (a: unknown) => Promise<number> }>;
  const groups: LinkGroup[] = [];
  for (const ref of contactReferences()) {
    const key = `${ref.model}.${ref.field}`;
    const count = await db[lower(ref.model)]!.count({ where: { [ref.field]: id } });
    if (!count) continue;
    groups.push({ key, label: LABEL[key] ?? ref.model, count, blocking: !NON_BLOCKING.has(key), items: await samples(ref.model, ref.field, id, take) });
  }
  return { total: groups.reduce((s, g) => s + g.count, 0), blocking: groups.filter((g) => g.blocking).reduce((s, g) => s + g.count, 0), groups };
}

/** « 3 chantiers (client), 12 devis et factures… » */
export const describeLinks = (groups: LinkGroup[]) => groups.filter((g) => g.blocking).map((g) => `${g.label} : ${g.count}`).join(' · ');

// ------------------------------------------------------------------ aperçu d'une fusion
const FIELD_LABEL: Record<string, string> = {
  vat: 'N° de TVA', email: 'E-mail', phone: 'Téléphone', address: 'Adresse', box: 'Boîte', postalCode: 'Code postal', city: 'Ville',
  customerNumber: 'N° de client chez lui', kind: 'Type de client', reference: 'Référence', note: 'Note', type: 'Client / fournisseur',
};
/** Seuls ces champs sont complétés par la fusion (voir contact-merge.ts) ; les autres champs de la fiche supprimée ne sont pas repris. */
const FILL = ['vat', 'email', 'phone', 'address', 'box', 'postalCode', 'city', 'customerNumber', 'kind', 'reference'];
const COMPARE = [...FILL, 'note'];

export async function mergePreview(keepId: string, removeId: string) {
  const [keep, remove] = await Promise.all([prisma.contact.findUnique({ where: { id: keepId } }), prisma.contact.findUnique({ where: { id: removeId } })]);
  if (!keep || !remove) return null;
  const k = keep as unknown as Record<string, unknown>;
  const r = remove as unknown as Record<string, unknown>;
  const fill: { field: string; label: string; value: string }[] = [];
  const kept: { field: string; label: string; keepValue: string; removedValue: string; lost: boolean }[] = [];
  for (const f of COMPARE) {
    const kv = k[f] ? String(k[f]) : '';
    const rv = r[f] ? String(r[f]) : '';
    if (!rv) continue;
    if (f === 'note' && kv === rv) continue;
    if (!kv && FILL.includes(f)) fill.push({ field: f, label: FIELD_LABEL[f] ?? f, value: rv });
    else if (f === 'note') fill.push({ field: f, label: kv ? 'Note (ajoutée à la suite de la note existante)' : 'Note', value: rv });
    else if (kv !== rv) kept.push({ field: f, label: FIELD_LABEL[f] ?? f, keepValue: kv, removedValue: rv, lost: true });
  }
  const portalUsers = await prisma.user.count({ where: { contactId: { in: [keepId, removeId] } } });
  const bothPortal = portalUsers > 1;
  const [keepLinks, removeLinks] = await Promise.all([contactLinks(keepId, 0), contactLinks(removeId, 5)]);
  return {
    keep: { id: keep.id, name: keep.name, type: keep.type, links: keepLinks.groups.map((g) => ({ label: g.label, count: g.count })) },
    remove: { id: remove.id, name: remove.name, type: remove.type },
    /** ce qui sera déplacé vers la fiche conservée */
    moves: removeLinks.groups,
    /** champs vides de la fiche conservée qui seront complétés */
    fill,
    /** champs renseignés des DEUX côtés avec des valeurs différentes : la fiche conservée garde la sienne, l'autre valeur disparaît */
    differing: kept,
    warnings: [
      ...(bothPortal ? ['Les deux fiches ont un accès portail : la fusion sera refusée.'] : []),
      ...(keep.type !== remove.type ? [`Une fiche est « ${keep.type} », l'autre « ${remove.type} » : la fiche conservée deviendra « client + fournisseur ».`] : []),
    ],
  };
}
