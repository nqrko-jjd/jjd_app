import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const envPath = path.join(root, '.env');
if (process.env.JJD_SKIP_ENV_FILE !== '1' && !existsSync(envPath) && existsSync(path.join(root, '.env.example'))) {
  copyFileSync(path.join(root, '.env.example'), envPath);
}
if (process.env.JJD_SKIP_ENV_FILE !== '1' && existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      let v = (m[2] ?? '').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}

const deeplKey = process.env.DEEPL_API_KEY ?? '';
const port = Number(process.env.PORT ?? 4100);
const publicApiUrl = process.env.PUBLIC_API_URL ?? `http://localhost:${port}`;

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-jjd-secret-change-me',
  port,
  publicApiUrl,
  webUrl: process.env.WEB_URL ?? 'http://localhost:3100',
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),

  /** Traduction auto FR -> NL/EN. Clé « …:fx » = offre gratuite (api-free). */
  deeplApiKey: deeplKey,
  deeplApiHost: deeplKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com',

  /** Assistant IA (chat) — brouillons de devis/planning/tâches. Sans clé = masqué. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',

  /** Envoi de documents par e-mail (SMTP de la boîte JJD, ex. info@jjd-consult.be). Sans identifiants = envoi par e-mail désactivé. */
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 465),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? '',
  },

  /** Envoi Peppol via Recommand (point d'accès certifié). ENVOI SEULEMENT — la réception reste chez le comptable. Sans clé = envoi désactivé. */
  peppol: {
    baseUrl: process.env.RECOMMAND_API_URL ?? 'https://app.recommand.eu/api/v1',
    apiKey: process.env.RECOMMAND_API_KEY ?? '',
    apiSecret: process.env.RECOMMAND_API_SECRET ?? '',
    companyId: process.env.RECOMMAND_COMPANY_ID ?? '',
  },

  google: {
    saKeyFile: process.env.GOOGLE_SA_KEY_FILE ?? './secrets/google-sa.json',
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? '',
  },

  /**
   * Parc d'outillage partagé avec Bricoloc (API partenaire).
   * Bricoloc est la source de vérité du parc physique ; JJD sort/rentre les
   * outils sur ses chantiers via cette API. Sans clé = fonctionnalité désactivée.
   */
  bricoloc: {
    apiUrl: (process.env.BRICOLOC_API_URL ?? 'https://new.bricoloc.be/bricoloc-api').replace(/\/$/, ''),
    apiKey: process.env.BRICOLOC_API_KEY ?? '',
  },

  /**
   * Ponto Connect (Ibanity) — agrégation bancaire.
   * Tout est optionnel : sans config, la connexion bancaire est désactivée
   * (l'app fonctionne, les transactions restent celles importées du fichier).
   * Les certificats mTLS et la clé de signature vivent dans apps/api/secrets/.
   */
  ponto: {
    clientId: process.env.PONTO_CLIENT_ID ?? '',
    clientSecret: process.env.PONTO_CLIENT_SECRET ?? '',
    redirectUri: process.env.PONTO_REDIRECT_URI ?? `${publicApiUrl}/api/ponto/callback`,
    // mTLS (obligatoire côté Ibanity)
    certFile: process.env.PONTO_CERT_FILE ?? './secrets/ponto-certificate.pem',
    keyFile: process.env.PONTO_KEY_FILE ?? './secrets/ponto-private-key.pem',
    keyPassphrase: process.env.PONTO_KEY_PASSPHRASE ?? '',
    // signature des requêtes (prod uniquement)
    signKeyId: process.env.PONTO_SIGNATURE_KEY_ID ?? '',
    signKeyFile: process.env.PONTO_SIGNATURE_KEY_FILE ?? './secrets/ponto-signature-key.pem',
    sandbox: (process.env.PONTO_SANDBOX ?? '') === '1',
    /**
     * « custom » = intégration personnalisée créée dans le tableau de bord Ponto pour SA PROPRE organisation : client_id + client_secret
     * suffisent (OAuth « client credentials », API api.myponto.com), ni certificat ni écran de consentement.
     * « connect » = Ponto Connect d'éditeur (certificat mTLS + consentement). Vide = automatique : custom dès qu'il y a un secret et pas de certificat.
     */
    mode: process.env.PONTO_MODE ?? '',
    apiUrl: process.env.PONTO_API_URL ?? '',
  },

  /**
   * Boîte mail dédiée aux factures fournisseurs (ex. invoices@jjd-consult.be) — alternative
   * à Ponto pour l'automatisation : lue en IMAP, chaque PDF reçu devient une dépense
   * "à vérifier" (voir lib/invoice-mailbox.ts). Sans config = fonctionnalité désactivée.
   */
  invoicesMailbox: {
    host: process.env.INVOICES_IMAP_HOST ?? '',
    port: Number(process.env.INVOICES_IMAP_PORT ?? 993),
    user: process.env.INVOICES_IMAP_USER ?? '',
    password: process.env.INVOICES_IMAP_PASSWORD ?? '',
  },

  /**
   * Boîte mail principale (ex. info@/david@jjd-consult.be) — lue en IMAP en lecture seule
   * (jamais de \Seen, jamais de déplacement, voir lib/lead-mailbox.ts) pour repérer les
   * demandes clients et créer des pistes Pipeline "à vérifier". Sans config = désactivé.
   */
  leadsMailbox: {
    host: process.env.LEADS_IMAP_HOST ?? '',
    port: Number(process.env.LEADS_IMAP_PORT ?? 993),
    user: process.env.LEADS_IMAP_USER ?? '',
    password: process.env.LEADS_IMAP_PASSWORD ?? '',
  },

  /**
   * Notifications Web Push (navigateur) — ex. "tu es mentionné dans le fil de chantier X".
   * Paire de clés VAPID générée une fois (web-push generateVAPIDKeys()), jamais rotée sans
   * désabonner tout le monde. Sans clés = fonctionnalité désactivée (pas de notification).
   */
  webPush: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:david@jjd-consult.be',
  },
};
