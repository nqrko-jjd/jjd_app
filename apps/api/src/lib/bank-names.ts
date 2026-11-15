/**
 * Nom lisible d'un compte bancaire : « Belfius ••4521 », « ING ••7810 ». Le libellé donné par Ponto est souvent le
 * même pour toutes les banques (« Compte à vue », « Business Account »…) : on reconnaît la banque à son code dans
 * l'IBAN belge (3 premiers chiffres du n° de compte, protocole Febelfin).
 */
const RANGES: [number, number, string][] = [
  [0, 49, 'BNP Paribas Fortis'], [50, 99, 'Belfius'], [103, 108, 'Crelan'], [140, 149, 'BNP Paribas Fortis'],
  [200, 299, 'BNP Paribas Fortis'], [300, 399, 'ING'], [400, 499, 'KBC'], [550, 560, 'Belfius'],
  [630, 631, 'Bpost Bank'], [645, 645, 'Bank J. Van Breda'], [730, 739, 'CBC'], [700, 799, 'KBC'],
  [850, 853, 'Crelan'], [860, 863, 'Crelan'], [880, 881, 'Beobank'], [950, 959, 'Beobank'], [973, 980, 'Argenta'],
];

export function bankNameFromIban(iban: string | null | undefined): string | null {
  const s = (iban ?? '').replace(/\s/g, '').toUpperCase();
  if (!/^BE\d{14}$/.test(s)) return null;
  const code = Number(s.slice(4, 7));
  return RANGES.find(([a, b]) => code >= a && code <= b)?.[2] ?? null;
}

export function accountDisplayName(acc: { iban: string | null; label: string | null }): string | null {
  const iban = (acc.iban ?? '').replace(/\s/g, '');
  const last4 = iban.length >= 4 ? iban.slice(-4) : '';
  const bank = bankNameFromIban(iban);
  if (bank) return `${bank}${last4 ? ` ••${last4}` : ''}`;
  if (acc.label && last4 && !acc.label.includes(last4)) return `${acc.label} ••${last4}`;
  return acc.label ?? (iban || null);
}
