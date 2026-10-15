import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { createApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/db.js';

const server = createApp().listen(4100);
await new Promise(resolve => server.once('listening', resolve));
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: true });
const page = await browser.newPage();
const failures = [];
page.on('pageerror', error => failures.push(String(error)));
try {
  const login = await fetch('http://127.0.0.1:4100/api/auth/login', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email:'david@jjd-consult.be',password:'jjd'})}).then(r=>r.json());
  assert.ok(login.token);
  await page.evaluateOnNewDocument(token => localStorage.setItem('jjd_token', token), login.token);
  await mkdir('tmp/ux-preview', {recursive:true});
  for (const width of [1440, 390]) {
    await page.setViewport({width, height:950, deviceScaleFactor:1});
    for (const route of ['/app','/app/chantiers','/app/equipe','/app/planning','/app/pointage','/app/documents','/app/achats','/app/contacts','/app/immeubles','/app/finances','/app/finances/fournisseurs','/app/finances/banque','/app/stock','/app/parametres','/app/profil']) {
      await page.goto('http://127.0.0.1:3100'+route, {waitUntil:'networkidle2'});
      await page.waitForSelector('.ux-shell #app-content', {timeout:20000});
      const overflows = await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(overflows.scroll <= overflows.width + 2, route+' overflows at '+width+': '+JSON.stringify(overflows));
      assert.equal(failures.length,0,route+': '+failures.join('\n'));
      console.log('UX_ROUTE_OK',width,route);
      if (['/app/equipe','/app/achats'].includes(route)) await page.screenshot({path:'tmp/ux-preview/'+width+'-'+route.split('/').at(-1)+'.jpg',type:'jpeg',quality:75});
    }
    if(width===390) await page.click('.burger');
    await page.waitForSelector('#app-navigation', {visible:true});
    await page.type('.nav-search input','ouvriers');
    assert.equal(await page.$eval('a[href="/app/equipe"].navlink',el=>el.getBoundingClientRect().height>0),true);
    await page.$eval('.nav-search input',el=>{el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));});
    // Reload also verifies that persisted desktop collapse does not hide mobile navigation.
    await page.goto('http://127.0.0.1:3100/app/equipe',{waitUntil:'networkidle2'});
    if(width===1440) {
      await page.click('.nav-collapse');
      await page.waitForSelector('body.nav-collapsed');
      const group = await page.$('.nav-group.current .nav-group-toggle');
      await group.click();
      await page.waitForFunction(()=>!document.body.classList.contains('nav-collapsed'));
    } else {
      await page.click('.burger');
      await page.waitForFunction(()=>Math.abs(document.querySelector('.sidebar').getBoundingClientRect().left)<1);
      await page.screenshot({path:'tmp/ux-preview/mobile-menu.jpg',type:'jpeg',quality:75});
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.querySelector('.sidebar').classList.contains('open'));
    }
  }
  await page.setViewport({width:390,height:844});
  await page.goto('http://127.0.0.1:3100/app/achats',{waitUntil:'networkidle2'});
  await page.click('.page-tools summary');
  assert.equal(await page.$eval('.page-tools',el=>el.open),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('.page-tools',el=>el.open),false);
  await page.click('.burger');
  await page.waitForFunction(()=>Math.abs(document.querySelector('.sidebar').getBoundingClientRect().left)<1);
  const launcher = await page.$('button[aria-controls="jjd-companion"]');
  if (launcher) {
    assert.equal(await page.$('#jjd-companion'), null);
    await launcher.click();
    await page.waitForSelector('#jjd-companion:not([hidden])');
    await page.click('#jjd-companion button[aria-label="Fermer le chat"]');
    await page.waitForSelector('#jjd-companion[hidden]');
  }

  // Isolated fixtures only: no real Peppol transmission is performed.
  const fixtureIds = [];
  try {
    for (const [key, peppolId, peppolStatus] of [
      ['pending','test-pending','sent'], ['delivered','test-delivered','delivered'],
      ['error','test-error','error'], ['none',null,null],
      ['queued',null,'queued'], ['unverified',null,'delivered'],
    ]) {
      const d = await prisma.document.create({data:{kind:'invoice',status:'overdue',title:'Peppol UX '+key,number:'UX-'+key,lockedAt:new Date(),issuedOn:new Date(),peppolId,peppolStatus,totalTtc:121,totalHt:100,totalVat:21}});
      fixtureIds.push(d.id);
    }
    for (const width of [1440,390]) {
      await page.setViewport({width,height:950});
      await page.goto('http://127.0.0.1:3100/app/documents?kind=invoice',{waitUntil:'networkidle2'});
      const states = await page.$eval('.peppol-status.compact',els=>els.map(el=>({label:el.getAttribute('aria-label'),className:el.className,href:el.getAttribute('href')})));
      assert.equal(states.length,5);
      assert.equal(states.filter(s=>s.className.includes('peppol-delivered')).length,1);
      assert.equal(states.filter(s=>s.className.includes('peppol-error')).length,1);
      assert.equal(states.filter(s=>s.className.includes('peppol-pending')).length,3);
      assert.ok(states.every(s=>s.label?.includes('Peppol') && s.href?.endsWith('#document-delivery')));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
      await page.screenshot({path:'tmp/ux-preview/peppol-'+width+'.jpg',type:'jpeg',quality:80});
    }
    await page.click('.peppol-delivered.compact');
    await page.waitForSelector('#document-delivery-content:not([hidden]) .peppol-delivered',{visible:true});
    assert.equal(await page.$eval('#document-delivery',els=>els.length),1);
    assert.ok((await page.$eval('.peppol-summary',el=>el.textContent)).includes('réception confirmée'));
    console.log('PEPPOL_STATUS_CHECKS_OK: pending, delivered, error, no-send, queued, unverified, mobile and deep link');
    for (const name of ['peppol-1440.jpg','peppol-390.jpg']) console.log('PEPPOL_PREVIEW_'+name+':'+(await readFile('tmp/ux-preview/'+name)).toString('base64'));
  } finally { await prisma.document.deleteMany({where:{id:{in:fixtureIds}}}); }

  console.log('UX_INTERACTIONS_OK');
  for (const name of ['1440-equipe.jpg','390-achats.jpg','mobile-menu.jpg']) console.log('UX_PREVIEW_'+name+':'+(await readFile('tmp/ux-preview/'+name)).toString('base64'));
} finally { await browser.close(); server.close(); await prisma.$disconnect(); }
