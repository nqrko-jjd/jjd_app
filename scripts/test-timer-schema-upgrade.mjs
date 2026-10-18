// Prove that the additive timer migration preserves an existing time entry.
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
const dir=mkdtempSync(path.join(tmpdir(),'jjd-timer-upgrade-'));
const url='file:'+path.join(dir,'upgrade.db');
const schema=readFileSync('apps/api/prisma/schema.prisma','utf8').replace(/provider = "postgresql"/,'provider = "sqlite"');
const previous=schema.split('\n').filter(line=>!line.includes('startRequestId') && !line.includes('stopRequestId')).join('\n');
function push(content) {
  const file=path.join(dir,'schema.prisma');writeFileSync(file,content);
  const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--schema',file,'--skip-generate'],{env:{...process.env,DATABASE_URL:url},encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
}
push(previous);
const p=new PrismaClient({datasources:{db:{url}}});
const person=await p.person.create({data:{firstName:'Upgrade',normalizedName:'upgrade test'}});
await p.$executeRaw`INSERT INTO "TimeEntry" ("id", "personId", "hours", "amount", "updatedAt") VALUES ('existing', ${person.id}, 2, 40, ${new Date()})`;
await p.$disconnect();
push(schema);
const next=new PrismaClient({datasources:{db:{url}}});
const entry=await next.timeEntry.findUniqueOrThrow({where:{id:'existing'}});
assert.equal(entry.hours,2);assert.equal(entry.amount,40);
assert.equal(entry.startRequestId,null);assert.equal(entry.stopRequestId,null);
await next.$disconnect();
console.log('TIMER_SCHEMA_UPGRADE_OK: existing hours and amount preserved without accept-data-loss');
