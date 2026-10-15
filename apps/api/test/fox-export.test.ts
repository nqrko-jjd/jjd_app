import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { storeFile, UPLOADS_DIR } from '../src/lib/media.js';
let server: Server, base = '', token = '';
const ids: string[] = [], files: string[] = [];
let first = '', second = '', missing = '', duplicate = '', slip = '';
before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  const address = server.address();
  base = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0);
  token = (await (await fetch(base + '/api/auth/login', {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify({email:'david@jjd-consult.be',password:'jjd'})})).json()).token;
  assert.ok(token);
  async function entry(number: string, direction = 'purchase', pdf = true, bytes = number) {
    const pdfPath = pdf ? storeFile(Buffer.from('%PDF-1.4\n' + bytes + '\n%%EOF'), 'fox-test.pdf', 'expenses') : null;
    if (pdfPath) files.push(pdfPath);
    const e = await prisma.ledgerEntry.create({data:{direction, docNumber:number, supplierName:'Fox test supplier', ht:100, ttc:121, paymentStatus:'Non payé', pdfPath}});
    ids.push(e.id); return e.id;
  }
  first = await entry('FOX-A');
  second = await entry('FOX-B', 'credit_note');
  missing = await entry('FOX-MISSING', 'purchase', false);
  duplicate = await entry('FOX-A', 'purchase', true, 'Different file, same invoice');
  slip = await entry('FOX-SLIP','delivery_slip');
});
after(async () => {
  await prisma.auditLog.deleteMany({where:{entity:'ledgerEntry',action:{in:['fox_export','fox_transmitted','fox_reset']}}});
  await prisma.ledgerEntry.deleteMany({where:{id:{in:ids}}});
  for (const file of files) await unlink(path.join(UPLOADS_DIR,file.replace(/^\/?uploads\//,''))).catch(()=>{});
  server.close();
});
function post(route: string, body: unknown, auth = true) {
  return fetch(base + '/api/finance/expenses/' + route, {method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
}
test('Fox export keeps PDFs intact, persists preparation only, confirms separately and supports reset', async () => {
  const r = await post('fox-export',{ids:[first,second]});
  assert.equal(r.status,200);
  const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
  assert.equal(Object.keys(zip).length,2);
  assert.ok(Object.keys(zip).every(name => name.endsWith('.pdf')));
  const row = await prisma.ledgerEntry.findUniqueOrThrow({where:{id:first}});
  assert.ok(row.foxExportedAt); assert.equal(row.foxTransmittedAt,null); assert.equal(row.paymentStatus,'Non payé');
  assert.equal((await post('fox-transmission',{ids:[first],transmitted:true})).status,200);
  const sent = await prisma.ledgerEntry.findUniqueOrThrow({where:{id:first}});
  assert.ok(sent.foxTransmittedAt);
  await post('fox-transmission',{ids:[first],transmitted:true});
  assert.equal((await prisma.ledgerEntry.findUniqueOrThrow({where:{id:first}})).foxTransmittedAt?.toISOString(),sent.foxTransmittedAt?.toISOString());
  const list = await (await fetch(base + '/api/finance/expenses?fox=sent&q=FOX-A',{headers:{authorization:'Bearer '+token}})).json();
  assert.deepEqual(list.items.map((e: {id:string})=>e.id),[first]);
  await post('fox-transmission',{ids:[first],transmitted:false});
  assert.equal((await prisma.ledgerEntry.findUniqueOrThrow({where:{id:first}})).foxTransmittedAt,null);
});
test('Fox refuses missing files, duplicates and delivery slips without partially marking exports', async () => {
  assert.equal((await post('fox-export',{ids:[second,missing]})).status,422);
  assert.equal((await post('fox-export',{ids:[first,duplicate]})).status,409);
  assert.equal((await post('fox-export',{ids:[slip]})).status,422);
  assert.equal((await post('fox-export',{ids:['does-not-exist']})).status,404);
  assert.equal((await post('fox-export',{ids:[first]},false)).status,401);
  assert.equal((await post('fox-transmission',{ids:[first],transmitted:true},false)).status,401);
  assert.equal((await prisma.ledgerEntry.findUniqueOrThrow({where:{id:duplicate}})).foxExportedAt,null);
});
