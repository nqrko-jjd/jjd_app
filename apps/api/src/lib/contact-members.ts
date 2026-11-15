/**
 * Gestionnaires d'un syndic (ou d'un promoteur) = de vraies fiches Contact (kind « individual ») rattachées à la
 * société par `syndicId` / `promoterId`, avec leur fonction (`jobTitle`). Chacun peut ainsi être choisi partout
 * (chantiers, immeubles, mails) et recevoir son propre accès au portail, limité à SES dossiers.
 *
 * Avant, ils étaient de simples « personnes de contact » (ContactPerson) de la fiche du syndic : une reprise,
 * une seule fois, les transforme en fiches (sans doublon : même e-mail ou même nom chez le même syndic).
 */
import { prisma } from '../db.js';
import { normalizeName } from '@jjd/shared';

const NOT_PEOPLE = ['acp', 'developer', 'syndic', 'promoter'];

/** Les fiches « membres » d'une société syndic / promoteur. */
export function membersWhere(c: { id: string; kind: string | null; syndicId: string | null; promoterId: string | null }) {
  if (c.kind === 'syndic' && c.syndicId) return { syndicId: c.syndicId, id: { not: c.id }, OR: [{ kind: null }, { kind: { notIn: NOT_PEOPLE } }] };
  if (c.kind === 'promoter' && c.promoterId) return { promoterId: c.promoterId, id: { not: c.id }, OR: [{ kind: null }, { kind: { notIn: NOT_PEOPLE } }] };
  return null;
}

/** Les chantiers d'une personne : listée comme contact du chantier, ou comme contact (gestionnaire…) de l'immeuble. */
export function personWorksitesWhere(contactId: string) {
  return { OR: [{ contacts: { some: { contactId } } }, { acp: { acpKeyContacts: { some: { contactId } } } }] };
}

export async function migrateCompanyPersonsToContacts(): Promise<{ created: number; reused: number; relinked: number } | null> {
  const flag = await prisma.setting.findUnique({ where: { key: 'companyPersonsToContacts' } });
  if (flag) return null;
  const persons = await prisma.contactPerson.findMany({
    where: { contact: { OR: [{ kind: 'syndic', syndicId: { not: null } }, { kind: 'promoter', promoterId: { not: null } }] } },
    include: { contact: { select: { id: true, kind: true, syndicId: true, promoterId: true } } },
    orderBy: [{ contactId: 'asc' }, { position: 'asc' }],
  });
  let created = 0, reused = 0, relinked = 0;
  for (const p of persons) {
    const company = p.contact;
    const link = company.kind === 'syndic' ? { syndicId: company.syndicId } : { promoterId: company.promoterId };
    const email = p.email?.trim().toLowerCase() || null;
    const existing = await prisma.contact.findFirst({
      where: { ...link, OR: [...(email ? [{ email: { equals: email } }] : []), { normalizedName: normalizeName(p.name) }], kind: { notIn: NOT_PEOPLE } },
    });
    const person = existing ?? await prisma.contact.create({
      data: { name: p.name.trim(), normalizedName: normalizeName(p.name), type: 'client', kind: 'individual', email, phone: p.phone, jobTitle: p.role, ...link, source: 'company-person' },
    });
    if (existing) {
      reused++;
      await prisma.contact.update({ where: { id: existing.id }, data: { jobTitle: existing.jobTitle ?? p.role, email: existing.email ?? email, phone: existing.phone ?? p.phone } });
    } else created++;
    // les liens déjà faits vers la société « pour » cette personne (même nom) pointent désormais vers sa fiche
    const sameName = { contactId: company.id, name: { equals: p.name.trim() } };
    relinked += (await prisma.worksiteContact.updateMany({ where: sameName, data: { contactId: person.id } })).count;
    relinked += (await prisma.buildingContact.updateMany({ where: sameName, data: { contactId: person.id } })).count;
    await prisma.contactPerson.delete({ where: { id: p.id } });
  }
  await prisma.setting.create({ data: { key: 'companyPersonsToContacts', value: { at: new Date().toISOString(), created, reused, relinked } } });
  return { created, reused, relinked };
}
