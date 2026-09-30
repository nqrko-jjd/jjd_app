import { HttpError } from './http.js';

/** Fail closed before allocating a number, locking a document or writing a sent date. */
export function validateExternalDeliveryRequest(body: unknown): void {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if (input.peppol) throw new HttpError(503, 'Envoi Peppol non connecté à JJD. Aucun document transmis. Utilisez TrustUp tant que le point d’accès JJD n’est pas activé.');
  if (input.confirmedExternal !== true) throw new HttpError(422, 'Confirmez que ce document a déjà été envoyé hors de JJD.');
}
export function externalDeliveryState(doc: {lockedAt: Date | null; status: string; sentAt: Date | null}) {
  if (!doc.lockedAt) throw new HttpError(409, 'Émettez le document avant d’enregistrer son envoi.');
  if (doc.status === 'cancelled') throw new HttpError(409, 'Un document annulé ne peut pas être envoyé.');
  return {alreadyRecorded: !!doc.sentAt, status: ['paid', 'partial', 'credited', 'accepted', 'declined', 'overdue'].includes(doc.status) ? doc.status : 'sent'};
}
