/**
 * Connexion par numéro de GSM : pas de colonne dédiée, le numéro est encodé dans l'e-mail
 * technique `<chiffres>@gsm.invalid` (domaine réservé, jamais joignable). Ça évite toute
 * migration et laisse tout le code existant (unicité, jetons…) fonctionner tel quel.
 */
const PHONE_DOMAIN = 'gsm.invalid';

/** « 0475 12 34 56 », « +32 475 12 34 56 », « 0032475… » → « 32475123456 » (chiffres, indicatif inclus). */
export function normalizePhone(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.includes('@')) return null;
  const digits = s.replace(/\D/g, '');
  let intl: string;
  if (s.startsWith('+')) intl = digits;
  else if (digits.startsWith('00')) intl = digits.slice(2);
  else if (digits.startsWith('0')) intl = `32${digits.slice(1)}`;
  else return null;
  return intl.length >= 9 && intl.length <= 15 ? intl : null;
}

export const phoneLoginEmail = (intlDigits: string) => `${intlDigits}@${PHONE_DOMAIN}`;
export const isPhoneLogin = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${PHONE_DOMAIN}`);

/** Ce qu'on affiche à l'écran pour un identifiant de connexion : le GSM formaté, ou l'e-mail. */
export function loginLabel(email: string | null | undefined): string {
  if (!email) return '';
  if (!isPhoneLogin(email)) return email;
  const d = email.split('@')[0]!;
  const m = /^32(4\d\d)(\d\d)(\d\d)(\d\d)$/.exec(d);
  return m ? `+32 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : `+${d}`;
}

/** Identifiant saisi (e-mail ou GSM) → e-mail de connexion en base ; null si ni l'un ni l'autre. */
export function resolveLoginEmail(identifier: string): string | null {
  const v = String(identifier ?? '').trim();
  if (v.includes('@')) return v.toLowerCase();
  const phone = normalizePhone(v);
  return phone ? phoneLoginEmail(phone) : null;
}
