
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.WAREHOUSE_TEST_URL || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ headless: true });
const output = 'artifacts/warehouse';
await mkdir(output, { recursive: true });
const item = (id, name) => ({ id, name, ref: id.toUpperCase(), unit: 'pièce', qty: 50, units: [], photoThumbUrl: null, category: 'Dépôt' });
const items = [item('s1', 'Raccord cuivre'), item('s2', 'Sac de mortier')];
const prepSeed = () => ({
  id: 'prep1', ref: 'PREP-001', status: 'to_prepare', neededOn: null, note: null, preparedBy: null, preparedAt: null,
  worksite: { id: 'w1', ref: 'CH-001', title: 'Chantier test', city: 'Bruxelles' },
  lines: items.map((it, i) => ({ id: 'l' + i, stockItemId: it.id, unitName: null, qty: i ? 1 : 2, pickedQty: 0, note: null, stockItem: it })),
});
const poSeed = () => ({
  id: 'po1', ref: 'CMD-001', status: 'ordered', expectedOn: null, orderedOn: null, supplierRef: null, note: null,
  contact: { id: 'c1', name: 'Fournisseur test', customerNumber: null, onAccount: false, phone: null, email: null },
  worksite: null,
  lines: items.map((it, i) => ({ id: 'l' + i, stockItemId: it.id, unitName: null, qty: i ? 1 : 2, price: 12, receivedQty: 0, stockItem: it })),
});
let checked = 0;
async function setup(width, role = 'storekeeper', toolsEnabled = false) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600, hasTouch: width < 1000 });
  const page = await context.newPage();
  const state = { movements: [], movementAttempts: 0, failAt: 0, prep: prepSeed(), po: poSeed(), receiving: [], prepWrites: 0, inFlight: 0, maxInFlight: 0, errors: [], loans: [], returns: [], toolState: 'AVAILABLE' };
  page.on('pageerror', e => state.errors.push(e.message));
  await context.route('https://fonts.**', route => route.abort());
  await context.route('**/jjd-api/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/jjd-api', '');
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    let data = { items: [] }, status = 200;
    if (path === '/api/auth/me') data = { user: { id: 'u1', email: 'warehouse@example.test', role, isPartner: false, locale: 'fr', personId: null }, person: null };
    else if (path === '/api/assistant/status') data = { enabled: false, previewAllowed: false };
    else if (path === '/api/materiel/status') data = { enabled: toolsEnabled };
    else if (path === '/api/materiel/stock') data = { products: [{ id: 't1', name: 'Perceuse', brand: null, model: null, image: null, total: 1, available: 1, onSite: 0, units: [{ assetTag: 'TOOL-001', state: state.toolState, storageLocation: 'A01', chantier: null }] }] };
    else if (path === '/api/materiel/consumables') data = { consumables: [] };
    else if (path === '/api/materiel/units/TOOL-001') data = { unit: { assetTag: 'TOOL-001', state: state.toolState }, product: { id: 't1', name: 'Perceuse' } };
    else if (path === '/api/materiel/loans') { state.loans.push(body); state.toolState = 'ON_SITE'; data = { ok: true }; }
    else if (path === '/api/materiel/returns') { state.returns.push(body); state.toolState = 'AVAILABLE'; data = { ok: true }; }
    else if (path === '/api/stock/meta') data = { worksites: [{ id: 'w1', name: 'Chantier test' }], categories: [] };
    else if (path === '/api/stock/items') data = { items };
    else if (path === '/api/stock/locations') data = { items: [{ code: 'A01' }, { code: 'B02' }] };
    else if (path.startsWith('/api/stock/scan/')) {
      const code = decodeURIComponent(path.split('/').at(-1));
      const it = code === 'ART-001' ? items[0] : (code === 'ART-002' || code === '5412345678908') ? items[1] : null;
      if (code === 'ZONE-CUSTOM') data = { kind: 'rack', code: 'C03' };
      else if (it) data = { kind: 'stock', item: it, unitName: null };
      else { status = 404; data = { error: 'Code inconnu' }; }
    } else if (path === '/api/stock/movements') {
      state.movementAttempts++;
      await new Promise(resolve => setTimeout(resolve, 120));
      if (state.failAt === state.movementAttempts) { status = 500; data = { error: 'Erreur simulée' }; }
      else { state.movements.push(body); data = { ok: true }; }
    } else if (path === '/api/stock-orders/prep1') data = { order: state.prep };
    else if (path === '/api/stock-orders/prep1/scan') {
      state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise(resolve => setTimeout(resolve, 70));
      const index = body.code === 'ART-001' ? 0 : 1;
      state.prep.lines[index].pickedQty++;
      state.prep.status = 'preparing';
      state.inFlight--;
      data = { order: state.prep, itemName: state.prep.lines[index].stockItem.name };
    } else if (/\/api\/stock-orders\/prep1\/lines\/.+\/picked/.test(path)) {
      const line = state.prep.lines.find(l => l.id === path.split('/').at(-2));
      line.pickedQty = body.pickedQty;
      state.prep.status = 'preparing';
      data = { order: state.prep };
    } else if (path === '/api/stock-orders/prep1/complete') {
      state.prepWrites++;
      state.prep.status = 'prepared';
      data = { order: state.prep };
    } else if (path === '/api/purchasing/orders/po1') data = { order: state.po };
    else if (path === '/api/purchasing/orders/po1/receive') {
      state.receiving.push(body);
      for (const l of body.lines) state.po.lines.find(x => x.id === l.lineId).receivedQty += l.qty;
      state.po.status = state.po.lines.every(l => l.receivedQty >= l.qty) ? 'received' : 'partial';
      data = { order: state.po };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return { page, context, state };
}
async function scan(page, code) {
  const field = page.getByRole('textbox', { name: 'Champ de scan' });
  await field.fill(code);
  await field.press('Enter');
}
async function waitFor(fn, message) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > 12000) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  checked++;
}
try {
  for (const width of [390, 768, 1440]) {
    const { page, context, state } = await setup(width);
    await page.goto(base + '/app/stock/scan');
    await page.getByRole('button', { name: 'Réceptionner', exact: true }).click();
    await scan(page, 'BRZ-A01');
    await scan(page, 'ART-001');
    await page.getByRole('spinbutton', { name: 'Quantité de Raccord cuivre' }).waitFor();
    assert.equal(await page.locator('.modal-scrim').count(), 0, 'continuous scan must not open quantity dialog'); checked++;
    await page.waitForTimeout(750);
    await scan(page, 'ART-001');
    await page.waitForFunction(() => document.querySelector('input[aria-label="Quantité de Raccord cuivre"]')?.value === '2');
    assert.equal(state.movements.length, 0); checked++;
    await noOverflow(page);
    await page.screenshot({ path: output + '/scan-' + width + '.png', fullPage: true });
    await page.getByRole('button', { name: /Valider l’entrée/ }).click();
    await waitFor(() => state.movements.length === 1, 'movement missing');
    await page.getByText('1 mouvement enregistré.', { exact: true }).waitFor();
    assert.equal(state.movements[0].qty, 2);
    assert.equal(state.movements[0].location, 'A01');
    assert.ok(await page.locator('.rack-bar').innerText().then(t => t.includes('A01')), 'rack must survive confirmation');
    assert.deepEqual(state.errors, []); checked += 4;
    await context.close();
  }
  {
    const { page, context, state } = await setup(768);
    await page.goto(base + '/app/stock/scan');
    await page.getByRole('button', { name: 'Réceptionner', exact: true }).click();
    await scan(page, 'BRZ-A01'); await scan(page, 'ART-001');
    await page.getByRole('spinbutton', { name: 'Quantité de Raccord cuivre' }).waitFor();
    await scan(page, 'RACK-B02'); await page.waitForTimeout(750); await scan(page, 'ART-001');
    await page.waitForFunction(() => document.querySelectorAll('.stock-basket-line').length === 2);
    assert.equal(await page.getByRole('spinbutton', { name: 'Quantité de Raccord cuivre' }).count(), 2); checked++;
    await page.getByRole('button', { name: /Valider l’entrée/ }).click();
    await waitFor(() => state.movements.length === 2, 'two rack movements missing');
    assert.deepEqual(state.movements.map(m => m.location).sort(), ['A01', 'B02']); checked++;
    await page.getByText('2 mouvements enregistrés.', { exact: true }).waitFor();
    await scan(page, 'ZONE-CUSTOM');
    await page.waitForFunction(() => document.querySelector('.rack-bar')?.textContent.includes('C03')); checked++;
    await scan(page, 'ART-001'); await scan(page, 'ART-002');
    await page.getByRole('spinbutton', { name: 'Quantité de Sac de mortier' }).waitFor();
    state.failAt = state.movementAttempts + 2;
    await page.getByRole('button', { name: /Valider l’entrée/ }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Champ de scan' }).getAttribute('readonly'), '');
    await page.getByText(/Les lignes restantes sont conservées/).waitFor();
    assert.equal(await page.locator('.stock-basket-line').count(), 1);
    assert.equal(state.movements.length, 3); checked += 3;
    await page.getByRole('button', { name: /Valider l’entrée/ }).click();
    await waitFor(() => state.movements.length === 4, 'retry movement missing');
    assert.equal(state.movements.filter(m => m.stockItemId === 's2').length, 1, 'confirmed line must not be replayed'); checked++;
    assert.deepEqual(state.errors, []);
    await context.close();
  }
  {
    const { page, context, state } = await setup(390, 'foreman');
    await page.goto(base + '/app/stock/scan');
    await page.getByRole('textbox', { name: 'Champ de scan' }).waitFor();
    await scan(page, 'ART-001');
    await page.getByRole('spinbutton', { name: 'Quantité de Raccord cuivre' }).waitFor();
    const destination = page.getByPlaceholder('chercher un chantier');
    assert.equal(await destination.isDisabled(), false, 'destination must remain selectable after a scan');
    await destination.fill('Chantier test');
    const quantity = page.getByRole('spinbutton', { name: 'Quantité de Raccord cuivre' });
    await quantity.fill('0.5');
    await page.getByRole('button', { name: /Valider la sortie/ }).click();
    await waitFor(() => state.movements.length === 1, 'departure missing');
    assert.equal(state.movements[0].qty, 0.5);
    assert.equal(state.movements[0].worksiteId, 'w1');
    assert.equal(state.movements[0].type, 'out');
    assert.deepEqual(state.errors, []); checked += 5;
    await context.close();
  }

  {
    const { page, context, state } = await setup(390);
    await page.goto(base + '/app/stock/scan');
    await page.getByRole('button', { name: 'Réceptionner', exact: true }).click();
    await scan(page, 'ART-001');
    const quantity = page.getByRole('spinbutton', { name: 'Quantité de Raccord cuivre' });
    await quantity.waitFor(); await quantity.focus();
    await quantity.pressSequentially('ART-002', { delay: 5 }); await quantity.press('Enter');
    await page.getByRole('spinbutton', { name: 'Quantité de Sac de mortier' }).waitFor();
    assert.equal(await quantity.inputValue(), '1', 'barcode must not overwrite the focused quantity');
    assert.equal(state.movements.length, 0);
    assert.equal(await page.getByRole('textbox', { name: 'Champ de scan' }).evaluate(el => el === document.activeElement), true);
    await quantity.fill('5412345678908');
    await page.waitForFunction(() => document.querySelector('input[aria-label="Quantité de Sac de mortier"]')?.value === '2');
    assert.equal(await quantity.inputValue(), '1', 'IME barcode without keydown must not become a quantity');
    assert.equal(state.movements.length, 0);
    checked += 5;
    await context.close();
  }
  for (const width of [390, 768, 1440]) {
    const { page, context, state } = await setup(width);
    await page.goto(base + '/app/stock/preparations/prep1');
    await page.getByRole('textbox', { name: 'Champ de scan' }).waitFor();
    assert.equal(await page.getByRole('spinbutton').count(), 0, 'manual fields should be collapsed');
    await scan(page, 'ART-001'); await scan(page, 'ART-002');
    await waitFor(() => state.prep.lines[1].pickedQty === 1, 'preparation scan missing');
    await page.getByRole('button', { name: /Voir les 1 prêts/ }).waitFor();
    assert.equal(state.maxInFlight, 1, 'scan mutations must be sequential');
    assert.equal(state.prepWrites, 0, 'scans must not commit stock departure');
    await noOverflow(page);
    await page.screenshot({ path: output + '/preparation-' + width + '.png', fullPage: true });
    await page.getByRole('button', { name: 'Tout préparer', exact: true }).click();
    await page.getByText('✓ Tous les articles sont préparés. Validez le départ chantier.').waitFor();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Terminer la préparation', exact: true }).click();
    await waitFor(() => state.prepWrites === 1, 'preparation completion missing');
    assert.deepEqual(state.errors, []); checked += 5;
    await context.close();
  }
  for (const width of [390, 768, 1440]) {
    const { page, context, state } = await setup(width);
    await page.goto(base + '/app/stock/commandes/po1');
    await page.getByRole('textbox', { name: 'Champ de scan' }).waitFor();
    assert.equal(await page.getByRole('spinbutton').count(), 0);
    await scan(page, 'ZONE-CUSTOM'); await scan(page, 'ART-001'); await scan(page, 'ART-002');
    await page.getByRole('button', { name: 'Valider la réception (2 lignes)', exact: true }).waitFor();
    assert.equal(state.receiving.length, 0);
    await noOverflow(page);
    await page.screenshot({ path: output + '/reception-' + width + '.png', fullPage: true });
    await page.getByRole('button', { name: 'Valider la réception (2 lignes)', exact: true }).click();
    await waitFor(() => state.receiving.length === 1, 'receipt missing');
    await page.getByText('Réception enregistrée : le stock est à jour.').waitFor();
    assert.equal(state.receiving[0].location, 'C03');
    assert.equal(state.receiving[0].lines.length, 2);
    assert.ok(await page.locator('.rack-bar').innerText().then(t => t.includes('C03')));
    assert.deepEqual(state.errors, []); checked += 6;
    await context.close();
  }

  {
    const { page, context, state } = await setup(768, 'storekeeper', true);
    await page.goto(base + '/app/stock/scan');
    await page.getByRole('textbox', { name: 'Champ de scan' }).waitFor();
    await page.waitForTimeout(200);
    await scan(page, 'TOOL-001');
    await page.locator('.stock-basket-line').filter({ hasText: 'Perceuse' }).waitFor();
    await page.waitForTimeout(750); await scan(page, 'TOOL-001');
    await page.getByText('Cet exemplaire est déjà dans le panier.', { exact: true }).waitFor();
    assert.equal(await page.locator('.stock-basket-line').count(), 1, 'a physical tool must not be duplicated');
    await page.getByPlaceholder('chercher un chantier').fill('Chantier test');
    await page.getByRole('button', { name: /Valider la sortie/ }).click();
    await waitFor(() => state.loans.length === 1, 'tool loan missing');
    await page.getByText('1 mouvement enregistré.', { exact: true }).waitFor();
    assert.equal(state.loans[0].worksiteId, 'w1');
    await page.getByRole('button', { name: 'Retourner', exact: true }).click();
    await scan(page, 'BRZ-A01'); await scan(page, 'TOOL-001');
    await page.locator('.stock-basket-line').filter({ hasText: 'Perceuse' }).waitFor();
    await page.getByRole('button', { name: /Valider le retour/ }).click();
    await waitFor(() => state.returns.length === 1, 'tool return missing');
    assert.equal(state.returns[0].storageLocation, 'A01');
    assert.deepEqual(state.errors, []); checked += 4;
    await context.close();
  }
  console.log('Warehouse workflow: ' + checked + ' checks passed (390px / 768px / 1440px, mocked API only).');
} finally { await browser.close(); }
