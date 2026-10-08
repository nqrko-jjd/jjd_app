import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { env } from '../src/env.js';
import { receiptToExtraction } from '../src/lib/ai-receipt.js';

let server: Server; let base = ''; let token = '';
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json() as { token: string }).token;
});
after(() => { server.close(); });

test('ticket lu → même forme que l’extraction des PDF : TTC arrondi, HT déduit de la TVA, TVA inconnue ignorée', () => {
  const e = receiptToExtraction({ supplier: ' Brico Drogenbos ', date: '2026-10-07', totalTtc: 24.6, vatRate: 0.21 });
  assert.equal(e.supplierName, 'Brico Drogenbos'); assert.equal(e.totalTtc, 24.6); assert.equal(e.totalHt, 20.33); assert.equal(e.totalVat, 4.27); assert.equal(e.vatRate, 0.21);
  const odd = receiptToExtraction({ totalTtc: 10, vatRate: 0.17 });
  assert.equal(odd.vatRate, null); assert.equal(odd.totalHt, null);
  assert.equal(receiptToExtraction({ totalTtc: -5, totalHt: 0 }).totalTtc, null);
});

test('photo de ticket sans IA disponible : réponse claire, rien de bloquant (saisie à la main possible)', async () => {
  const saved = env.anthropicApiKey; env.anthropicApiKey = '';
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'ticket.png');
    const r = await fetch(`${base}/api/finance/expenses/extract`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    assert.equal(r.status, 200);
    const j = await r.json() as { extraction: unknown; note?: string };
    assert.equal(j.extraction, null); assert.match(j.note ?? '', /IA/);
  } finally { env.anthropicApiKey = saved; }
});
