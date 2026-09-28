import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { screenshotImportAvailable, parseScreenshots } from '../src/lib/bank-screenshot.js';

test('screenshotImportAvailable : false sans clé Anthropic (ni en local ni en prod actuellement)', () => {
  assert.equal(screenshotImportAvailable(), false);
});

test('parseScreenshots : dégradation silencieuse sans clé Anthropic -> tableau vide, pas d’erreur', async () => {
  const rows = await parseScreenshots([{ buffer: Buffer.from('fake image bytes'), mimetype: 'image/png' }]);
  assert.deepEqual(rows, []);
});

/* ----------------------------------------------------------------- route HTTP */

let server: Server;
let base = '';
let token = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  token = (await login.json()).token;
});

after(() => { server.close(); });

test('POST /bank/import-screenshot : refuse clairement (503) tant que la clé Anthropic n’est pas configurée', async () => {
  const form = new FormData();
  form.append('files', new Blob([Buffer.from('fake')], { type: 'image/png' }), 'capture.png');
  const r = await fetch(`${base}/api/finance/bank/import-screenshot`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.match(body.error, /Anthropic/i);
});
