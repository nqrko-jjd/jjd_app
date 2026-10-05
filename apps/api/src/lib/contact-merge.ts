import { Prisma } from '@prisma/client';
import { normalizeName } from '@jjd/shared';
import { prisma } from '../db.js';
import { HttpError } from './http.js';

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Tout ce qui pointe vers un Contact, lu dans le schéma Prisma : une relation ajoutée plus tard est reprise sans rien modifier ici. */
export function contactReferences() {
  const refs: { model: string; field: string; unique: string[][] }[] = [];
  for (const m of Prisma.dmmf.datamodel.models) {
    for (const f of m.fields) {
      if (f.kind !== 'object' || f.type !== 'Contact' || f.relationFromFields?.length !== 1) continue;
      const fk = f.relationFromFields[0]!;
      const unique: string[][] = [];
      if (m.fields.find((x) => x.name === fk)?.isUnique) unique.push([fk]);
      for (const u of [...(m.uniqueFields ?? []), ...(m.uniqueIndexes ?? []).map((i) => i.fields)]) if (u.includes(fk)) unique.push([...u]);
      refs.push({ model: m.name, field: fk, unique });
    }
  }
  return refs;
}

const FILL: (keyof Prisma.ContactUncheckedCreateInput)[] = ['vat', 'email', 'phone', 'address', 'box', 'postalCode', 'city', 'customerNumber', 'kind', 'reference'];

/**
 * Fusionne des fiches Contact en doublon dans UNE seule : devis, factures, achats, chantiers, opportunités, personnes de contact,
 * commandes, etc. sont rattachés à la fiche conservée, les champs vides sont complétés, puis les doublons sont supprimés.
 * Atomique : tout ou rien. Refuse si les deux fiches ont chacune un compte portail (impossible d'en garder deux).
 */
export async function mergeContacts(keepId: string, removeIds: string[], opts: { name?: string } = {}) {
  const ids = [...new Set(removeIds)].filter((x) => x !== keepId);
  if (!ids.length) throw new HttpError(422, 'Choisis au moins une autre fiche à fusionner.');
  const keep = await prisma.contact.findUnique({ where: { id: keepId } });
  const removed = await prisma.contact.findMany({ where: { id: { in: ids } } });
  if (!keep || removed.length !== ids.length) throw new HttpError(404, 'Fiche introuvable.');

  return prisma.$transaction(async (tx) => {
    const db = tx as unknown as Record<string, any>;
    const moved: Record<string, number> = {};
    for (const ref of contactReferences()) {
      const delegate = db[lower(ref.model)];
      const where = { [ref.field]: { in: ids } };
      if (!ref.unique.length) {
        const r = await delegate.updateMany({ where, data: { [ref.field]: keepId } });
        if (r.count) moved[`${ref.model}.${ref.field}`] = r.count;
        continue;
      }
      // contrainte d'unicité : une ligne qui ferait doublon avec une existante de la fiche conservée est supprimée,
      // sauf si la clé ne porte que sur le contact (ex. compte portail) : on refuse plutôt que d'effacer un accès.
      for (const row of await delegate.findMany({ where })) {
        let clash = false;
        for (const u of ref.unique) {
          const others = u.filter((c) => c !== ref.field);
          if (!others.length) { if (await delegate.findFirst({ where: { [ref.field]: keepId } })) throw new HttpError(409, `Les deux fiches ont chacune des données de type « ${ref.model} » (compte portail ?) : impossible de n'en garder qu'une.`); continue; }
          if (await delegate.findFirst({ where: { [ref.field]: keepId, ...Object.fromEntries(others.map((c) => [c, row[c]])) } })) clash = true;
        }
        if (clash) await delegate.delete({ where: { id: row.id } });
        else await delegate.update({ where: { id: row.id }, data: { [ref.field]: keepId } });
        moved[`${ref.model}.${ref.field}`] = (moved[`${ref.model}.${ref.field}`] ?? 0) + 1;
      }
    }

    // champs vides de la fiche conservée complétés ; client + fournisseur => « both »
    const patch: Record<string, unknown> = {};
    for (const f of FILL) if (!(keep as Record<string, unknown>)[f]) { const v = removed.map((r) => (r as Record<string, unknown>)[f]).find(Boolean); if (v) patch[f] = v; }
    const types = new Set([keep.type, ...removed.map((r) => r.type)]);
    if (types.size > 1) patch.type = 'both';
    const finalName = opts.name?.trim() || keep.name;
    if (finalName !== keep.name) { patch.name = finalName; patch.normalizedName = normalizeName(finalName); }
    if (Object.keys(patch).length) await tx.contact.update({ where: { id: keepId }, data: patch });

    // le nom affiché dans le grand livre suit
    const oldNames = [...new Set([keep.name, ...removed.map((r) => r.name)])].filter((n) => n !== finalName);
    if (oldNames.length) {
      const r = await tx.ledgerEntry.updateMany({ where: { contactId: keepId, supplierName: { in: oldNames } }, data: { supplierName: finalName } });
      if (r.count) moved['LedgerEntry.supplierName'] = r.count;
    }
    await tx.contact.deleteMany({ where: { id: { in: ids } } });
    return { kept: keepId, name: finalName, removed: ids.length, moved };
  }, { timeout: 60_000, maxWait: 10_000 });
}
