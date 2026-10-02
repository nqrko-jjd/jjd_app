import { randomInt } from 'node:crypto';
import { HttpError } from './http.js';
import { isPhoneLogin, loginLabel, normalizePhone, phoneLoginEmail } from '@jjd/shared';

/** Identifiant saisi à la création d'un compte : e-mail, ou n° de GSM (sans boîte mail). */
export function parseNewLogin(raw: unknown): { email: string; phone: boolean } {
  const v = String(raw ?? '').trim();
  if (v.includes('@')) {
    const email = v.toLowerCase();
    if (!/.+@.+\..+/.test(email)) throw new HttpError(422, 'E-mail invalide');
    return { email, phone: false };
  }
  const phone = normalizePhone(v);
  if (!phone) throw new HttpError(422, 'E-mail ou numéro de GSM invalide (ex. 0475 12 34 56)');
  return { email: phoneLoginEmail(phone), phone: true };
}

/** Code provisoire : 6 chiffres pour un compte GSM (saisi au clavier numérique), sinon mot de passe court. */
export function newSecret(phone: boolean): string {
  return phone ? String(randomInt(100000, 1000000)) : Math.random().toString(36).slice(2, 8);
}

export const accountLogin = (email: string) => ({ email, login: loginLabel(email), phone: isPhoneLogin(email) });
