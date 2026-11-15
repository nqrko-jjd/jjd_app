/**
 * Domiciliations (SEPA Direct Debit) lues sur le libellé bancaire : créancier et n° de mandat, qui reste le même
 * d'un prélèvement à l'autre — la clé idéale pour une règle « toujours ce poste / ce fournisseur ».
 *  - Belfius : « VOTRE DOMICILIATION EUROPEENNE <mandat> POUR <créancier> COMMUNICATION : … »
 *  - ING : « DEBET VOOR EEN DOMICILIERING … Mandaat: <mandat> … » (créancier = contrepartie)
 */
export interface DirectDebitInfo { mandate: string | null; creditor: string | null }

export function isDirectDebit(text: string): boolean {
  return /domiciliation|domicili[eë]ring|direct debit|\bmandaat\s*:/i.test(text);
}

export function parseDirectDebit(tx: { counterpartyName: string | null; description: string | null; communication: string | null }): DirectDebitInfo | null {
  const text = [tx.description, tx.communication].filter(Boolean).join('\n');
  if (!isDirectDebit(text)) return null;
  const be = /DOMICILIATION\s+EUROPEENNE\s+(\S+)\s+POUR\s+([\s\S]{1,80}?)\s+COMMUNICATION/i.exec(text);
  const ing = /Mandaat\s*:\s*(\S+)/i.exec(text);
  const mandate = (be?.[1] ?? ing?.[1] ?? null)?.trim() || null;
  const ingCreditor = /rekening voor\s*:\s*\r?\n?\s*([^\r\n]+)/i.exec(text)?.[1];
  const fromText = (be?.[2] ?? ingCreditor)?.replace(/\s+/g, ' ').trim() || null;
  const cp = tx.counterpartyName && !/^domicili/i.test(tx.counterpartyName) ? tx.counterpartyName.trim() : null;
  return { mandate, creditor: cp || fromText };
}
