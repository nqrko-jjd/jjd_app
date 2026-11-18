/**
 * Reconnaît la carte utilisée pour une opération bancaire, d'après le texte du relevé :
 *  - Belfius Bancontact : « … MCC5046 525506XXXXXX6094Sweert Julien »
 *  - ING Bancontact     : « … Kaartnummer 5244 35XX XXXX 4361 »
 *  - Visa               : la ligne vient du relevé de la carte (bank = « VISA ••7639 »)
 */
export interface CardHit { network: 'bancontact' | 'visa'; last4: string; prefix: string | null; holderName: string | null; bank: string | null }

export function detectCard(tx: { bank?: string | null; communication?: string | null; description?: string | null }): CardHit | null {
  const bank = tx.bank ?? '';
  const visa = bank.match(/^visa\s*(?:••|\*+|x+)?\s*(\d{4})\b/i);
  if (visa) return { network: 'visa', last4: visa[1]!, prefix: null, holderName: null, bank: null };
  const text = `${tx.communication ?? ''} ${tx.description ?? ''}`;
  const belfius = text.match(/\b(\d{6})X{6}(\d{4})([A-Za-zÀ-ÿ'’\- ]{2,40})?/);
  if (belfius) {
    // le nom suit les chiffres, puis le libellé (« … 3734Scott David BANCONTACT - ACHAT CARBURANT ») : on s'arrête avant
    const holder = (belfius[3] ?? '').split(/\s{2,}|\s(?:BANCONTACT|ACHAT|PAIEMENT|BETALING|RETRAIT|VISA)\b|\s-\s/i)[0]!.replace(/\s+/g, ' ').trim();
    return { network: 'bancontact', last4: belfius[2]!, prefix: belfius[1]!, holderName: holder || null, bank: bank || 'Belfius' };
  }
  const ing = text.match(/Kaartnummer\s+(\d{4})\s?(\d{2})XX\s?XXXX\s?(\d{4})/i);
  if (ing) return { network: 'bancontact', last4: ing[3]!, prefix: `${ing[1]}${ing[2]}`, holderName: null, bank: bank || 'ING' };
  return null;
}

/** Filtre « texte » à appliquer en base pour retrouver les opérations d'une carte (affiné ensuite par detectCard). */
export function cardTextNeedles(network: string, last4: string): { bankStartsWith?: string; contains?: string[] } {
  if (network === 'visa') return { bankStartsWith: 'VISA' };
  return { contains: [`XXXXXX${last4}`, `XXXX ${last4}`, `XXXX${last4}`] };
}

/** Prélèvement du relevé d'une carte de crédit (« VISA RELEVE ») ou chargement d'une prépayée : justifié par les achats de la carte. */
export function isCardSettlement(tx: { description?: string | null; communication?: string | null }): boolean {
  const t = `${tx.description ?? ''} ${tx.communication ?? ''}`;
  return /VISA RELEVE|RELEVE NUMERO|Relev. VISA|(?:D.)?CHARGEMENT.{0,40}(?:\*{4}|VISA|CARTE)/i.test(t);
}
