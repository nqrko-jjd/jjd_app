import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const envPath = path.join(root, '.env');
if (!existsSync(envPath) && existsSync(path.join(root, '.env.example'))) {
  copyFileSync(path.join(root, '.env.example'), envPath);
}
if (existsSync(envPath)) {
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

  google: {
    saKeyFile: process.env.GOOGLE_SA_KEY_FILE ?? './secrets/google-sa.json',
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? '',
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
  },
};
