/**
 * Envoi d'e-mails. En dev : on logue le contenu (et le lien magique) dans la
 * console. En prod : brancher un SMTP transactionnel (lot 7).
 */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\n─── E-MAIL ──────────────────────────────\n  À      : ${to}\n  Sujet  : ${subject}\n${body}\n─────────────────────────────────────────\n`);
}
