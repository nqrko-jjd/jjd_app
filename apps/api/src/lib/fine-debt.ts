/**
 * Un PV avec un conducteur identifié devient une dette « à déduire » sur sa fiche (même circuit que les dettes :
 * colonne « À retenir » du décompte, puis « Réglé » une fois retenue sur la paie).
 * Le lien est PersonAdjustment.fineId (simple index, pas de contrainte unique : on garde une seule dette par PV dans le code).
 * Une dette déjà réglée n'est plus jamais modifiée ni supprimée.
 */
import { prisma } from '../db.js';

interface FineLike { id: string; reference: string | null; plateRaw: string | null; date: Date | null; amount: number | null; driverPersonId: string | null; vehicle?: { plate: string | null } | null }

const dayFr = (d: Date) => new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels' }).format(d);

export function fineDebtNote(f: FineLike): string {
  const plate = f.vehicle?.plate ?? f.plateRaw;
  return ['PV', f.reference, plate && `(${plate})`, f.date && `du ${dayFr(f.date)}`].filter(Boolean).join(' ');
}

/** Crée, met à jour ou retire la dette liée au PV selon son conducteur et son montant. */
export async function syncFineDebt(fineId: string): Promise<void> {
  const fine = await prisma.fine.findUnique({ where: { id: fineId }, include: { vehicle: { select: { plate: true } } } });
  const existing = await prisma.personAdjustment.findFirst({ where: { fineId }, orderBy: { createdAt: 'asc' } });
  if (existing?.settled) return;
  const wanted = fine && fine.driverPersonId && fine.amount != null && fine.amount > 0;
  if (!wanted) {
    if (existing) await prisma.personAdjustment.delete({ where: { id: existing.id } });
    return;
  }
  const data = { personId: fine.driverPersonId!, type: 'debt', amount: fine.amount!, date: fine.date ?? new Date(), note: fineDebtNote(fine) };
  if (existing) await prisma.personAdjustment.update({ where: { id: existing.id }, data });
  else await prisma.personAdjustment.create({ data: { ...data, fineId } });
}

/** À appeler avant de supprimer le PV : retire la dette encore à déduire (une dette réglée reste, détachée du PV). */
export async function dropFineDebt(fineId: string): Promise<void> {
  const existing = await prisma.personAdjustment.findFirst({ where: { fineId } });
  if (!existing) return;
  if (existing.settled) await prisma.personAdjustment.update({ where: { id: existing.id }, data: { fineId: null } });
  else await prisma.personAdjustment.delete({ where: { id: existing.id } });
}
