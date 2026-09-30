/** Hermetic release smoke tests. Never reads production env or reuses a database. */
import {mkdtempSync, mkdirSync, openSync, closeSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=mkdtempSync(path.join(tmpdir(),'jjd-release-api-'));
mkdirSync(path.join(root,'uploads'));
const env={PATH:process.env.PATH,HOME:process.env.HOME,DATABASE_URL:'file:'+path.join(root,'test.db'),JJD_SKIP_ENV_FILE:'1',JWT_SECRET:'isolated-release-tests-only',NODE_ENV:'test',UPLOADS_DIR:path.join(root,'uploads'),PRISMA_HIDE_UPDATE_MESSAGE:'1'};
const tests=['documents','buildings','contacts','people','planning-vehicles','timesheet','worksites-worker-access','portal','thread-client','messagerie','stock','stock-orders','purchasing','expenses','bank-reconcile'];
const seed=`import {PrismaClient} from '@prisma/client';const p=new PrismaClient();
const person=await p.person.create({data:{firstName:'David',displayName:'David',normalizedName:'release david',role:'foreman',source:'test'}});
await p.user.update({where:{email:'david@jjd-consult.be'},data:{personId:person.id}});
const syndic=await p.syndic.create({data:{name:'Syndic recette',normalizedName:'syndic recette'}});
await p.contact.create({data:{name:'ACP recette',normalizedName:'acp recette',kind:'acp',syndicId:syndic.id,source:'test'}});
await p.$disconnect();`;
const commands=[['node_modules/prisma/build/index.js','db','push','--schema','apps/api/prisma/schema.prisma','--skip-generate'],['--import','tsx','apps/api/prisma/seed.ts'],['--input-type=module','-e',seed],['--test','--test-force-exit','--import','tsx','--experimental-test-isolation=none',...tests.map(x=>'apps/api/test/'+x+'.test.ts')]];
console.log('Base temporaire isolée : '+root);
for(let i=0;i<commands.length;i++){
 const filename=path.join(root,'step'+i+'.log'),fd=openSync(filename,'w');
 const result=spawnSync(process.execPath,commands[i],{env,stdio:['ignore',fd,fd]});closeSync(fd);
 console.log('Étape '+i+' : '+result.status);
 if(result.status!==0){console.error(readFileSync(filename,'utf8').slice(-8000));process.exitCode=1;break;}
 if(i===commands.length-1)console.log(readFileSync(filename,'utf8').slice(-700));
}
