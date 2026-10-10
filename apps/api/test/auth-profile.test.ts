import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { signToken } from '../src/lib/auth.js';
import { translateUi } from '../../web/src/lib/ui-language.js';

test('UI language uses existing translations and preserves dynamic names', () => {
  assert.equal(translateUi('Mon profil', 'fr'), 'Mon profil');
  assert.equal(translateUi('Mon profil', 'en'), 'My profile');
  assert.equal(translateUi('Mon profil', 'pt-BR'), 'Meu perfil');
  assert.equal(translateUi('Bonjour Accueil,', 'en'), 'Hello Accueil,');
  assert.equal(translateUi('FV760010840', 'pt-BR'), 'FV760010840');
});

test('worker can persist locale and edit own details without changing roles, payroll or another person', async () => {
  const stamp=Date.now();
  const p=await prisma.person.create({data:{firstName:'Worker',normalizedName:'worker profile test',hourlyRate:19}});
  const other=await prisma.person.create({data:{firstName:'Other',normalizedName:'other profile test'}});
  const u=await prisma.user.create({data:{email:`profile-${stamp}@test.local`,passwordHash:'unused',role:'worker',personId:p.id}});
  const server=createApp().listen(0);
  await new Promise(resolve=>server.once('listening',resolve));
  const address=server.address();
  const base=`http://127.0.0.1:${typeof address==='object'&&address?address.port:0}`;
  const headers={authorization:'Bearer '+signToken(u.id),'content-type':'application/json'};
  const send=(route:string,body:unknown)=>fetch(base+route,{method:'PATCH',headers,body:JSON.stringify(body)});
  try {
    assert.equal((await send('/api/auth/locale',{locale:'pt-BR'})).status,200);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:u.id}})).locale,'pt-BR');
    assert.equal((await send('/api/auth/locale',{locale:'unsupported'})).status,422);
    const fields={firstName:'João',lastName:'Silva',phone:'+32470000000',email:'joao@example.test'};
    assert.equal((await send('/api/auth/profile',fields)).status,200);
    assert.equal((await send('/api/auth/profile',{...fields,personId:other.id,role:'admin',hourlyRate:500})).status,422);
    const actual=await prisma.person.findUniqueOrThrow({where:{id:p.id}});
    assert.equal(actual.firstName,'João'); assert.equal(actual.phone,fields.phone); assert.equal(actual.hourlyRate,19);
    assert.equal((await prisma.person.findUniqueOrThrow({where:{id:other.id}})).firstName,'Other');
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:u.id}})).role,'worker');
    const me=await fetch(base+'/api/auth/me',{headers}); const body=await me.json();
    assert.equal(body.user.locale,'pt-BR'); assert.equal(body.person.lastName,'Silva');
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    await prisma.user.delete({where:{id:u.id}});
    await prisma.person.deleteMany({where:{id:{in:[p.id,other.id]}}});
  }
});
