import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { rawPrisma as prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/auth.js';
import { translateFor, normalizeLocale } from '../src/lib/translate.js';

let server: Server; let base = ''; let token = ''; let uid = '';
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  uid = (await prisma.user.create({ data: { email: 'lang-test@jjd-consult.be', passwordHash: await hashPassword('jjd'), role: 'office' } })).id;
  token = ((await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'lang-test@jjd-consult.be', password: 'jjd' }) })).json()) as { token: string }).token;
});
after(async () => { await prisma.messageTranslation.deleteMany({ where: { messageId: { startsWith: 'tr-test-' } } }); await prisma.user.delete({ where: { id: uid } }); server.close(); });

test('la langue se choisit dans le compte (fr | en | pt-BR), le reste est refusé', async () => {
  const call = (locale: string) => fetch(`${base}/api/auth/locale`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ locale }) });
  assert.equal((await call('pt-BR')).status, 200);
  assert.equal((await prisma.user.findUnique({ where: { id: uid } }))?.locale, 'pt-BR');
  assert.equal((await call('de')).status, 422);
  assert.equal(normalizeLocale('xx'), 'fr');
});

test('traductions : lues en cache, messages déjà dans la langue du lecteur laissés tels quels', async () => {
  await prisma.messageTranslation.create({ data: { messageId: 'tr-test-1', locale: 'fr', body: 'Bonjour à tous' } });
  const rows = [
    { id: 'tr-test-1', kind: 'text', body: 'Bom dia a todos', author: { locale: 'pt-BR' } },
    { id: 'tr-test-2', kind: 'text', body: 'Salut', author: { locale: 'fr' } },
    { id: 'tr-test-3', kind: 'photo', body: 'x', author: { locale: 'pt-BR' } },
  ];
  const out = await translateFor(rows, 'fr');
  assert.equal(out['tr-test-1'], 'Bonjour à tous');
  assert.ok(!('tr-test-2' in out) && !('tr-test-3' in out));
});
