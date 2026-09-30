import { prisma } from '../db.js';
import { HttpError } from './http.js';
/** Linked records use current directory data. Original snapshots survive unlink/deletion. */
export function currentContact<T extends { name: string; phone?: string | null; email?: string | null; contact?: { name: string; phone: string | null; email: string | null } | null }>(row: T): T {
  return row.contact ? { ...row, name: row.contact.name, phone: row.contact.phone, email: row.contact.email } : row;
}
export async function contactSnapshot<T extends { contactId?: string | null; name?: string; phone?: string | null; email?: string | null }>(row: T): Promise<T> {
  if (!row.contactId) return row;
  const person = await prisma.contact.findUnique({ where: { id: row.contactId }, select: { name: true, phone: true, email: true } });
  if (!person) throw new HttpError(400, 'Ce contact n’existe plus. Sélectionnez une autre fiche.');
  return { ...row, ...person };
}
