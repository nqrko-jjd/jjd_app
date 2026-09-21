import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';

let server: Server;
let base = '';
let token = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  token = (await r.json()).token;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test('GET /api/worksites/counts : total = somme par statut = liste « Tous » (archivés compris)', async () => {
  const headers = { authorization: `Bearer ${token}` };
  const counts = await (await fetch(`${base}/api/worksites/counts`, { headers })).json() as { total: number; byStatus: Record<string, number> };
  const sum = Object.values(counts.byStatus).reduce((a, b) => a + b, 0);
  assert.equal(counts.total, sum);

  const list = await (await fetch(`${base}/api/worksites?archived=all&page=1&pageSize=20`, { headers })).json() as { totalCount: number };
  assert.equal(list.totalCount, counts.total);
});
