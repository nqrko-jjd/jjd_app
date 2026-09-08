/**
 * QR code de paiement (EPC069-12 / « SEPA credit transfer QR code », alias
 * GiroCode/Payconiq-compatible) : le client scanne depuis son appli bancaire
 * (KBC, Belfius, BNP Paribas Fortis, ING…) et le virement est pré-rempli
 * (IBAN, montant, communication) — il ne reste qu'à confirmer.
 *
 * Norme officielle : European Payments Council, "Quick Response Code —
 * Guidelines to Enable Data Capture for the Initiation of a SEPA Credit
 * Transfer" (EPC069-12). 11 lignes texte séparées par \n (LF strict, jamais
 * CRLF), encodées dans un QR code.
 *
 * Point d'attention Belgique : la communication structurée belge
 * (+++XXX/XXXX/XXXXX+++) n'est PAS une référence ISO 11649 (« RF… »), qui est
 * le seul format accepté par le champ « référence structurée » (ligne 10) de
 * la norme EPC. On la met donc en ligne 11 (texte libre) — c'est ainsi que
 * les banques belges la reconnaissent et la reproposent comme communication
 * structurée côté virement, plutôt que dans un champ RF qui la rejetterait.
 */
import QRCode from 'qrcode';

export interface EpcQrInput {
  beneficiaryName: string;
  iban: string;
  amount: number; // TTC, en euros
  structuredComm?: string | null; // belge, format +++XXX/XXXX/XXXXX+++
}

/** IBAN belge valide (BE + 14 chiffres), espaces tolérées en entrée. */
export function isValidBelgianIban(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /^BE\d{14}$/.test(raw.replace(/\s+/g, '').toUpperCase());
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Construit le payload texte EPC069-12 (avant encodage QR). */
export function buildEpcQrPayload(d: EpcQrInput): string {
  const iban = d.iban.replace(/\s+/g, '').toUpperCase();
  const amount = `EUR${d.amount.toFixed(2)}`;
  const lines = [
    'BCD', // 1. balise de service
    '002', // 2. version (BIC facultatif depuis la fin de la migration SEPA)
    '1', // 3. jeu de caractères : 1 = UTF-8
    'SCT', // 4. identification : virement SEPA
    '', // 5. BIC (facultatif en version 002 pour un IBAN SEPA)
    truncate(d.beneficiaryName, 70), // 6. bénéficiaire
    iban, // 7. IBAN
    amount, // 8. montant
    '', // 9. motif (non utilisé)
    '', // 10. référence structurée ISO 11649 (pas notre cas, voir en-tête)
    d.structuredComm ? truncate(d.structuredComm, 140) : '', // 11. texte libre
  ];
  return lines.join('\n');
}

/** PNG (data URI base64) prêt à insérer dans un <img src="…">. */
export async function renderEpcQrDataUrl(d: EpcQrInput): Promise<string> {
  const payload = buildEpcQrPayload(d);
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
}
