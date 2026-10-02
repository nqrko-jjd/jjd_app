/** Les comptes « GSM » stockent le numéro dans un e-mail technique `<chiffres>@gsm.invalid`
 *  (voir packages/shared/src/phone.ts) : on affiche le numéro plutôt que cette adresse. */
export function loginLabel(email: string | null | undefined): string {
  if (!email) return '';
  if (!email.toLowerCase().endsWith('@gsm.invalid')) return email;
  const d = email.split('@')[0]!;
  const m = /^32(4\d\d)(\d\d)(\d\d)(\d\d)$/.exec(d);
  return m ? `+32 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : `+${d}`;
}
