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

test('textes d’interface : traduits une seule fois par langue (DeepL simulé), puis lus en cache', async () => {
  const { env } = await import('../src/env.js');
  const realFetch = globalThis.fetch; let deeplCalls = 0;
  const keyBefore = env.deeplApiKey; env.deeplApiKey = 'test-key';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/v2/translate')) {
      deeplCalls++;
      const texts = new URLSearchParams(String(init?.body)).getAll('text');
      return new Response(JSON.stringify({ translations: texts.map((t) => ({ text: `PT:${t}` })) }), { status: 200 });
    }
    return realFetch(input as never, init);
  }) as typeof fetch;
  try {
    const post = (locale: string, strings: string[]) => fetch(`${base}/api/translate/ui`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ locale, strings }) }).then(async (r) => ({ status: r.status, body: await r.json() as { translations: Record<string, string> } }));
    const a = await post('pt-BR', ['Texte test interface un', 'Texte test interface deux']);
    assert.equal(a.body.translations['Texte test interface un'], 'PT:Texte test interface un');
    assert.equal(deeplCalls, 1);
    const b = await post('pt-BR', ['Texte test interface un']);
    assert.equal(b.body.translations['Texte test interface un'], 'PT:Texte test interface un');
    assert.equal(deeplCalls, 1, 'lu en cache : DeepL pas rappelé');
    assert.deepEqual((await post('fr', ['Bonjour'])).body.translations, {}, 'le français n’est pas traduit');
    assert.equal((await post('de', ['x'])).status, 422);
  } finally {
    globalThis.fetch = realFetch; env.deeplApiKey = keyBefore;
    await prisma.uiTranslation.deleteMany({ where: { source: { startsWith: 'Texte test interface' } } });
  }
});
