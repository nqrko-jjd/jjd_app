import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

const TOKEN = 'test-claude-mcp-token-0123456789abcdef';
process.env.CLAUDE_MCP_TOKEN = TOKEN;

let server: Server;
let base = '';
let worksiteId = '';
let prisma: typeof import('../src/db.js').prisma;

async function rpc(body: unknown, token = TOKEN) {
  const r = await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

before(async () => {
  const { createApp } = await import('../src/app.js');
  ({ prisma } = await import('../src/db.js'));
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const ws = await prisma.worksite.create({ data: { ref: 'R-MCP-TEST', title: 'Connecteur Claude — test', status: 'in_progress', source: 'test' } });
  worksiteId = ws.id;
  await prisma.worksiteTask.create({ data: { worksiteId, title: 'Vérifier la chape', priority: 'urgent' } });
});

after(async () => {
  await prisma.worksiteTask.deleteMany({ where: { worksiteId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  server.close();
});

test('mauvais jeton : 404, rien ne fuit', async () => {
  const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'x'.repeat(40));
  assert.equal(r.status, 404);
});

test('initialize puis tools/list : outils en lecture seule uniquement', async () => {
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  const notif = await fetch(`${base}/mcp/${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(notif.status, 202);
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names: string[] = list.body.result.tools.map((t: { name: string }) => t.name);
  assert.ok(names.includes('search_worksites') && names.includes('business_summary') && names.includes('mail_suggestions'));
  assert.ok(!names.some((n) => n.startsWith('create_')), 'aucun outil de création exposé');
  assert.ok(names.includes('inbox_recent') && names.includes('save_mail_draft'));
  const writers = list.body.result.tools.filter((t: { annotations: { readOnlyHint: boolean } }) => !t.annotations.readOnlyHint).map((t: { name: string }) => t.name);
  assert.deepEqual(writers, ['save_mail_draft'], 'seul le brouillon de mail écrit quelque chose');
});

test('tools/call : recherche, chantiers en cours, tâches ouvertes', async () => {
  const s = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_worksites', arguments: { query: 'R-MCP-TEST' } } });
  assert.match(s.body.result.content[0].text, /R-MCP-TEST/);
  const l = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_worksites', arguments: { query: 'MCP-TEST' } } });
  assert.equal(JSON.parse(l.body.result.content[0].text).chantiers[0].ref, 'R-MCP-TEST');
  const t = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'open_tasks', arguments: { worksiteId } } });
  assert.equal(JSON.parse(t.body.result.content[0].text).taches[0].priorite, 'urgent');
});

test('paramètres invalides : erreur lisible, pas de plantage', async () => {
  const r = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'worksite_mails', arguments: {} } });
  assert.equal(r.body.result.isError, true);
  const u = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'create_devis_draft', arguments: {} } });
  assert.equal(u.body.error.code, -32602);
});

test('mails : boîte non configurée en test, réponse claire sans plantage', async () => {
  const r = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'inbox_recent', arguments: {} } });
  assert.match(r.body.result.content[0].text, /pas configurée/);
  const d = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'save_mail_draft', arguments: { body: 'x' } } });
  assert.ok(r.status === 200 && d.status === 200);
});
