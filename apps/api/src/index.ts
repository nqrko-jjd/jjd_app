import os from 'node:os';
import { createApp } from './app.js';
import { env } from './env.js';
import { prisma } from './db.js';

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

/**
 * Rattrapage messagerie interne/client : avant la séparation par `audience`,
 * le fil client et le fil interne partageaient les mêmes messages. Seul un
 * message texte posté par le client via le portail n'a ni `authorId` (aucun
 * compte User) ni `source` (pas un import WhatsApp) — bascule ces messages
 * historiques en `audience: 'client'`. Idempotent : les messages créés après
 * ce changement posent déjà leur `audience` explicitement, donc plus rien ne
 * matche ce filtre une fois le rattrapage fait — sûr à rejouer à chaque démarrage.
 */
async function backfillMessageAudience() {
  const r = await prisma.message.updateMany({
    where: { audience: 'internal', authorId: null, source: null, kind: 'text' },
    data: { audience: 'client' },
  });
  if (r.count) {
    // eslint-disable-next-line no-console
    console.log(`[backfill] ${r.count} message(s) historique(s) du portail basculé(s) en audience "client"`);
  }
}

await backfillMessageAudience();

createApp().listen(env.port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log('JJD API');
  console.log(`  local  : http://localhost:${env.port}   (health: /health)`);
  for (const ip of lanAddresses()) {
    // eslint-disable-next-line no-console
    console.log(`  réseau : http://${ip}:${env.port}`);
  }
});
