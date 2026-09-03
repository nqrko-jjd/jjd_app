/**
 * Import de l'historique JJD depuis le fichier de rentabilité Excel.
 *
 *   npm run import                       -> data-import/calculs-rentabilite.xlsx
 *   npm run import -- chemin/vers.xlsx
 *
 * Idempotent : purge d'abord tout ce qui a source = "xlsx", puis réimporte.
 * Tout ce qui est douteux part dans ImportIssue (la « file de contrôle »).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  parseLooseDate, parseAmount, guessWorksiteStatus, parseStatusTags, normalizeName,
} from '@jjd/shared';
import { readXlsx, cell, type SheetData } from './lib/xlsx-read.js';
import { extractSyndic, guessClientKind, DedupeMap, str, num, looksLikeRef } from './lib/import-helpers.js';

const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultFile = path.resolve(here, '../../../data-import/calculs-rentabilite.xlsx');
const file = process.argv[2] ? path.resolve(process.argv[2]) : defaultFile;

type Sev = 'info' | 'warning' | 'error';
const issues: { entity: string; sheet: string; rowRef: string; severity: Sev; message: string; rawData?: unknown }[] = [];
function issue(entity: string, sheet: string, rowRef: string, severity: Sev, message: string, rawData?: unknown) {
  issues.push({ entity, sheet, rowRef, severity, message, rawData });
}

const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

// caches de dédoublonnage
const syndics = new DedupeMap();
const contacts = new DedupeMap();
const people = new DedupeMap();
const buildings = new DedupeMap();
const worksiteByRef = new Map<string, string>(); // "R-523" -> id

async function getSyndic(name: string): Promise<string> {
  const existing = syndics.get(name);
  if (existing) return existing;
  const row = await prisma.syndic.create({
    data: { name: name.trim(), normalizedName: normalizeName(name) },
  });
  syndics.set(name, row.id);
  bump('syndics');
  return row.id;
}

async function getContact(rawName: string, type: 'client' | 'supplier'): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;
  const existing = contacts.get(name);
  if (existing) {
    // si on le connaissait comme client et qu'il est aussi fournisseur -> both
    return existing;
  }
  const { base, syndic } = extractSyndic(name);
  const syndicId = syndic ? await getSyndic(syndic) : null;
  const row = await prisma.contact.create({
    data: {
      name,
      normalizedName: normalizeName(name),
      type,
      kind: type === 'client' ? guessClientKind(name) : null,
      syndicId,
      source: 'xlsx',
    },
  });
  contacts.set(name, row.id);
  bump(type === 'client' ? 'contacts_client' : 'contacts_supplier');
  // un ACP => aussi un immeuble
  if (type === 'client' && (row.kind === 'acp')) {
    await getBuilding(base || name, { syndicId, clientId: row.id });
  }
  return row.id;
}

async function getBuilding(
  rawName: string,
  opts: { syndicId?: string | null; clientId?: string | null; address?: string | null; city?: string | null } = {},
): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;
  const existing = buildings.get(name);
  if (existing) return existing;
  const row = await prisma.building.create({
    data: {
      name,
      normalizedName: normalizeName(name),
      syndicId: opts.syndicId ?? null,
      clientId: opts.clientId ?? null,
      address: opts.address ?? null,
      city: opts.city ?? null,
    },
  });
  buildings.set(name, row.id);
  bump('buildings');
  return row.id;
}

async function getPerson(rawName: string, role: 'foreman' | 'worker'): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;
  const existing = people.get(name);
  if (existing) return existing;
  const [first, ...rest] = name.split(/\s+/);
  const row = await prisma.person.create({
    data: {
      firstName: first ?? name,
      lastName: rest.join(' ') || null,
      displayName: name,
      normalizedName: normalizeName(name),
      role,
      source: 'xlsx',
    },
  });
  people.set(name, row.id);
  bump('people');
  if (/[/+&]|\bet\b/i.test(name) || name.length > 22) {
    issue('person', 'Main doeuvre', name, 'warning', `Nom d'ouvrier à vérifier / scinder : « ${name} »`, { name });
  }
  return row.id;
}

// ─────────────────────────────────────────────────────── purge

async function purge() {
  await prisma.$transaction([
    prisma.timeEntry.deleteMany({ where: { source: 'xlsx' } }),
    prisma.ledgerEntry.deleteMany({ where: { source: 'xlsx' } }),
    prisma.bankTransaction.deleteMany({ where: { source: 'xlsx' } }),
    prisma.fine.deleteMany({}),
    prisma.insurance.deleteMany({}),
    prisma.worksite.deleteMany({ where: { source: 'xlsx' } }),
    prisma.person.deleteMany({ where: { source: 'xlsx', user: { is: null } } }),
    prisma.building.deleteMany({}),
    prisma.contact.deleteMany({ where: { source: 'xlsx', user: { is: null } } }),
    prisma.syndic.deleteMany({}),
    prisma.vehicle.deleteMany({}),
    prisma.importIssue.deleteMany({}),
    prisma.importBatch.deleteMany({}),
  ]);
}

// ─────────────────────────────────────────────────────── Data Projets -> chantiers

async function importWorksites(sh: SheetData) {
  for (const row of sh.rows) {
    if (row.r < 26) continue; // lignes 2-25 = légende
    const ref = str(row.cells.A);
    if (!ref || !/^(R-|E-)/i.test(ref)) continue;
    const rowRef = `${sh.name}!A${row.r}`;

    if (worksiteByRef.has(ref)) {
      issue('worksite', sh.name, rowRef, 'warning', `Référence ${ref} en double dans le fichier`, { ref });
      bump('worksite_dupes');
      continue;
    }

    const isOverhead = /^E-/i.test(ref);
    const title = str(row.cells.B) ?? ref;
    const managerName = str(row.cells.C);
    const address = str(row.cells.D);
    const clientName = str(row.cells.E);
    const billTo = str(row.cells.F);
    const statusRaw = str(row.cells.G);
    const attribution = (str(row.cells.H) ?? '').toLowerCase();
    const startedOn = parseLooseDate(row.cells.L);
    const endedOn = parseLooseDate(row.cells.M);
    const quoted = parseAmount(row.cells.P);

    const entity = attribution.includes('tonton') ? 'tonton' : attribution.includes('m7') ? 'm7' : 'jjd';
    const clientId = clientName ? await getContact(clientName, 'client') : null;

    // immeuble : si le client est un ACP, getContact l'a déjà créé ; on le relie
    let buildingId: string | null = null;
    if (clientName) {
      const { base } = extractSyndic(clientName);
      buildingId = buildings.get(base) ?? buildings.get(clientName);
    }

    const managerId = managerName ? await getPerson(managerName, 'foreman') : null;

    const ws = await prisma.worksite.create({
      data: {
        ref: ref.toUpperCase(),
        title,
        kind: isOverhead ? 'overhead' : 'project',
        entity,
        status: isOverhead ? 'in_progress' : guessWorksiteStatus(statusRaw),
        statusRaw,
        statusTags: statusRaw ? parseStatusTags(statusRaw) : undefined,
        clientId,
        buildingId,
        managerId,
        billTo,
        address,
        startedOn,
        endedOn,
        quotedHt: quoted,
        source: 'xlsx',
      },
    });
    worksiteByRef.set(ref.toUpperCase(), ws.id);
    bump(isOverhead ? 'worksites_overhead' : 'worksites');

    if (!isOverhead && !clientName) issue('worksite', sh.name, rowRef, 'info', `${ref} sans client`, { ref, title });
    if (!isOverhead && !statusRaw) issue('worksite', sh.name, rowRef, 'info', `${ref} sans statut`, { ref });
  }
}

// ─────────────────────────────────────────────────────── Main doeuvre -> pointage

async function insertChunked<T>(model: { createMany: (a: { data: T[] }) => Promise<unknown> }, rows: T[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await model.createMany({ data: rows.slice(i, i + 500) });
  }
}

async function importTime(sh: SheetData) {
  const batchRows: Prisma.TimeEntryCreateManyInput[] = [];
  for (const row of sh.rows) {
    if (row.r < 2) continue;
    const workerName = str(cell(sh, row, 'Ouvrier'));
    const ref = str(cell(sh, row, 'Réf'));
    if (!workerName && !ref) continue;
    const rowRef = `${sh.name}!${row.r}`;

    const date = parseLooseDate(cell(sh, row, 'Date'));
    const hours = num(cell(sh, row, 'Heures'));
    const amount = parseAmount(cell(sh, row, 'Montant Payé'));
    const task = str(cell(sh, row, 'Tâches'));
    const sub = str(cell(sh, row, 'Sous-taitant')) ?? str(cell(sh, row, 'Sous-traitant'));

    if (!workerName) {
      issue('time_entry', sh.name, rowRef, 'warning', 'Pointage sans ouvrier', { ref, amount });
      continue;
    }
    // ligne vide / gabarit (ni heures, ni montant, ni tâche) -> ignorée
    if ((amount === null || amount === 0) && hours === null && !task) continue;
    const personId = await getPerson(workerName, 'worker');
    if (!personId) continue;

    let worksiteId: string | null = null;
    if (looksLikeRef(ref)) {
      worksiteId = worksiteByRef.get(ref!.toUpperCase()) ?? null;
      if (!worksiteId) {
        issue('time_entry', sh.name, rowRef, 'warning', `Pointage sur chantier inconnu ${ref}`, { workerName, ref, amount });
        bump('time_orphan');
      }
    } else if (ref) {
      issue('time_entry', sh.name, rowRef, 'info', `Pointage avec réf non standard « ${ref} »`, { workerName, ref });
    }
    if (amount === null) {
      issue('time_entry', sh.name, rowRef, 'warning', `Pointage sans montant (${workerName}, ${ref ?? '?'})`, { workerName, ref, hours });
    }

    batchRows.push({
      personId,
      worksiteId,
      worksiteRef: ref,
      date,
      hours,
      amount,
      rateUsed: hours && amount ? Number((amount / hours).toFixed(2)) : null,
      task,
      status: 'approved',
      subcontractor: sub,
      source: 'xlsx',
    });
    bump('time_entries');
  }
  await insertChunked(prisma.timeEntry, batchRows);
}

// ─────────────────────────────────────────────────────── Facture -> grand livre

/**
 * Onglet « Facture » — colonnes mappées par lettre (les en-têtes du fichier
 * sont décalés / vides pour certaines colonnes).
 *   A Date · B Année · C Mois · D Type · E N° Doc · F Réf (R-/E-) · G Projet
 *   H Fournisseur · I Catégorie · J Prix HT · K TVA Récup · L TVA Due
 *   M Montant TTC · P TVA(taux) · Q Trim · R Statut · S Communication bancaire
 */
async function importLedger(sh: SheetData) {
  const ledgerRows: Prisma.LedgerEntryCreateManyInput[] = [];
  for (const row of sh.rows) {
    if (row.r < 2) continue;
    const c = row.cells;
    const rowRef = `${sh.name}!${row.r}`;
    const typeRaw = str(c.D);
    const ref = str(c.F);
    const ht = parseAmount(c.J);
    const ttc = parseAmount(c.M);
    if (!typeRaw && ht === null && ttc === null) continue;

    const t = (typeRaw ?? '').toLowerCase();
    const direction = t.includes('vente')
      ? 'sale'
      : t.includes('crédit') || t.includes('credit')
        ? 'credit_note'
        : 'purchase';

    let worksiteId: string | null = null;
    if (looksLikeRef(ref)) {
      worksiteId = worksiteByRef.get(ref!.toUpperCase()) ?? null;
      if (!worksiteId) {
        issue('ledger', sh.name, rowRef, 'info', `Écriture sur réf inconnue ${ref}`, { ref, ht, typeRaw });
        bump('ledger_orphan');
      }
    }
    const supplierName = str(c.H);
    const contactId = supplierName && direction === 'purchase' ? await getContact(supplierName, 'supplier') : null;

    ledgerRows.push({
      date: parseLooseDate(c.A),
      year: num(c.B),
      month: str(c.C),
      direction,
      docType: typeRaw,
      docNumber: str(c.E),
      worksiteRef: ref,
      worksiteId,
      supplierName,
      contactId,
      categoryRaw: str(c.I),
      ht: ht ?? 0,
      vatRecup: parseAmount(c.K),
      vatDue: parseAmount(c.L),
      ttc,
      vatRate: num(c.P),
      quarter: str(c.Q),
      paymentStatus: str(c.R),
      bankComm: str(c.S),
      source: 'xlsx',
    });
    bump('ledger_entries');
    if (ht === null && ttc === null) issue('ledger', sh.name, rowRef, 'warning', 'Écriture sans montant', { ref, typeRaw });
  }
  await insertChunked(prisma.ledgerEntry, ledgerRows);
}

// ─────────────────────────────────────────────────────── Belfius -> banque

async function importBank(sh: SheetData) {
  const rows: Prisma.BankTransactionCreateManyInput[] = [];
  for (const row of sh.rows) {
    if (row.r < 2) continue;
    const amount = parseAmount(cell(sh, row, 'Montant'));
    const desc = str(cell(sh, row, 'Transaction'));
    if (amount === null && !desc) continue;
    rows.push({
      bookingDate: parseLooseDate(cell(sh, row, 'Date de comptabilisation')),
      bank: str(cell(sh, row, 'Belfius/ING')),
      counterpartyAccount: str(cell(sh, row, 'Compte contrepartie')),
      counterpartyName: str(cell(sh, row, 'Nom contrepartie contient')),
      description: desc,
      valueDate: parseLooseDate(cell(sh, row, 'Date valeur')),
      amount,
      currency: str(cell(sh, row, 'Devise')) ?? 'EUR',
      communication: str(cell(sh, row, 'Communications')),
      source: 'xlsx',
    });
    bump('bank_tx');
  }
  await insertChunked(prisma.bankTransaction, rows);
}

// ─────────────────────────────────────────────────────── Charges Détail -> flotte

const vehicleByPlate = new Map<string, string>();
async function getVehicle(plate: string | null, model?: string | null): Promise<string | null> {
  if (!plate) return null;
  const key = plate.replace(/[^0-9a-z]/gi, '').toUpperCase();
  if (vehicleByPlate.has(key)) return vehicleByPlate.get(key)!;
  const v = await prisma.vehicle.create({ data: { plate: plate.trim(), model: model ?? null } });
  vehicleByPlate.set(key, v.id);
  bump('vehicles');
  return v.id;
}

async function importFleet(charges: SheetData | undefined, pv: SheetData | undefined) {
  if (charges) {
    for (const row of charges.rows) {
      if (row.r < 3) continue;
      const provider = str(row.cells.A);
      const model = str(row.cells.C);
      const plate = str(row.cells.D);
      if (!provider && !plate) continue;
      if (!/^\s*(axa|allianz|belfius|ag|p&v|baloise|generali|assur)/i.test(provider ?? '')) {
        // en-têtes / sous-totaux
        if (!plate) continue;
      }
      const vehicleId = await getVehicle(plate, model);
      await prisma.insurance.create({
        data: {
          vehicleId,
          provider,
          contractNumber: str(row.cells.B),
          monthlyAmount: parseAmount(row.cells.H),
          annualAmount: parseAmount(row.cells.I),
          effectiveOn: parseLooseDate(row.cells.E),
          renewalOn: parseLooseDate(row.cells.F),
          paymentMode: str(row.cells.G),
          note: str(row.cells.J) ?? str(row.cells.K),
        },
      });
      bump('insurances');
    }
  }
  if (pv) {
    for (const row of pv.rows) {
      if (row.r < 2) continue;
      const plateRaw = str(cell(pv, row, 'Plaque'));
      const ref = str(cell(pv, row, 'Référence'));
      if (!plateRaw && !ref) continue;
      const plateClean = plateRaw?.match(/[0-9]-?[A-Z]{3}-?[0-9]{3}/i)?.[0] ?? null;
      const vehicleId = plateClean ? await getVehicle(plateClean) : null;
      await prisma.fine.create({
        data: {
          vehicleId,
          plateRaw,
          date: parseLooseDate(cell(pv, row, 'Date infraction')),
          time: str(cell(pv, row, 'Heure')),
          reference: ref,
          payTo: str(cell(pv, row, 'A payer à')),
          street: str(cell(pv, row, 'Rue')),
          postalCode: str(cell(pv, row, 'Code Postal')),
          type: str(cell(pv, row, 'Type infraction')),
          amount: parseAmount(cell(pv, row, 'Montant')),
          reminder1On: parseLooseDate(cell(pv, row, 'Rappel 1')),
          reminder2On: parseLooseDate(cell(pv, row, 'Rappel 2')),
          status: str(cell(pv, row, 'Statut')),
        },
      });
      bump('fines');
    }
  }
}

// ─────────────────────────────────────────────────── comptes de démonstration

/**
 * Lie les comptes seed (chef@ / ouvrier@ / david@ / julien@) à une vraie fiche
 * personne, et crée quelques affectations de planning cette semaine — sinon
 * l'appli mobile n'a rien à afficher.
 */
async function linkDemoAccounts() {
  const demoEmails = ['ouvrier@jjd-consult.be', 'chef@jjd-consult.be', 'david@jjd-consult.be', 'julien@jjd-consult.be'];
  // repartir propre : délier les comptes seed + supprimer les fiches "demo"
  await prisma.user.updateMany({ where: { email: { in: demoEmails } }, data: { personId: null } });
  await prisma.planningEvent.deleteMany({ where: { title: { startsWith: '(démo)' } } });
  await prisma.person.deleteMany({ where: { source: 'demo' } });

  async function link(email: string, where: object, fallback: { firstName: string; role: string }) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    let person = await prisma.person.findFirst({ where: { ...where, user: { is: null } } });
    if (!person) {
      person = await prisma.person.create({
        data: {
          firstName: fallback.firstName,
          displayName: fallback.firstName,
          normalizedName: normalizeName(fallback.firstName),
          role: fallback.role,
          hourlyRate: fallback.role === 'foreman' ? 25 : 16.66,
          source: 'demo',
        },
      });
    }
    if (person.hourlyRate == null) {
      await prisma.person.update({ where: { id: person.id }, data: { hourlyRate: person.role === 'foreman' ? 25 : 16.66 } });
    }
    await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
    return person.id;
  }

  const ouvrierId = await link(
    'ouvrier@jjd-consult.be',
    { role: 'worker', timeEntries: { some: {} } },
    { firstName: 'Ouvrier démo', role: 'worker' },
  );
  const chefId = await link(
    'chef@jjd-consult.be',
    { role: 'foreman' },
    { firstName: 'Chef démo', role: 'foreman' },
  );
  await link('david@jjd-consult.be', { normalizedName: 'david' }, { firstName: 'David', role: 'foreman' });
  await link('julien@jjd-consult.be', { normalizedName: 'julien' }, { firstName: 'Julien', role: 'foreman' });

  // Affectations de démo cette semaine si le planning est vide
  if ((await prisma.planningEvent.count()) === 0 && ouvrierId) {
    const chantiers = await prisma.worksite.findMany({
      where: { kind: 'project', status: { in: ['in_progress', 'scheduled', 'to_plan'] } },
      take: 4,
      orderBy: { updatedAt: 'desc' },
    });
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    for (let i = 0; i < chantiers.length; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      await prisma.planningEvent.create({
        data: {
          worksiteId: chantiers[i]!.id,
          title: '(démo) intervention',
          startAt: new Date(day.getTime() + 8 * 3600_000),
          endAt: new Date(day.getTime() + 17 * 3600_000),
          materialsNote: i === 0 ? 'échafaudage' : null,
          assignments: {
            create: [{ personId: ouvrierId }, ...(chefId ? [{ personId: chefId }] : [])],
          },
        },
      });
    }
    console.log('  planning   ', chantiers.length, 'affectations de démo (cette semaine)');
  }
  console.log('  comptes    ', 'chef@ / ouvrier@ / david@ / julien@ liés à une fiche');
}

// ─────────────────────────────────────────────────────── run

async function main() {
  console.log(`Import depuis ${file}`);
  const sheets = readXlsx(file);
  const byName = (n: string) => sheets.find((s) => s.name.trim().toLowerCase() === n.toLowerCase());

  await purge();
  const batch = await prisma.importBatch.create({ data: { source: 'xlsx', label: path.basename(file) } });

  // Codes E-xx = postes de frais sans chantier -> chantiers "overhead"
  const eCats = await prisma.category.findMany({ where: { code: { startsWith: 'E-' } } });
  for (const c of eCats) {
    const ws = await prisma.worksite.upsert({
      where: { ref: c.code },
      create: { ref: c.code, title: c.label, kind: 'overhead', status: 'in_progress', source: 'xlsx' },
      update: {},
    });
    worksiteByRef.set(c.code.toUpperCase(), ws.id);
    bump('worksites_overhead');
  }

  const dataProjets = byName('Data Projets');
  if (!dataProjets) throw new Error('Feuille « Data Projets » introuvable');
  await importWorksites(dataProjets);
  console.log('  chantiers  ', stats.worksites ?? 0, '(+', stats.worksites_overhead ?? 0, 'frais généraux)');

  const main = byName('Main doeuvre');
  if (main) await importTime(main);
  console.log('  pointages  ', stats.time_entries ?? 0);

  const facture = byName('Facture');
  if (facture) await importLedger(facture);
  console.log('  grand livre', stats.ledger_entries ?? 0);

  const belfius = byName('Belfius');
  if (belfius) await importBank(belfius);
  console.log('  banque     ', stats.bank_tx ?? 0);

  await importFleet(byName('Charges Détail'), byName('Détail PV'));
  console.log('  flotte     ', stats.vehicles ?? 0, 'véhicules,', stats.insurances ?? 0, 'assurances,', stats.fines ?? 0, 'PV');

  await linkDemoAccounts();

  // écriture des issues
  for (let i = 0; i < issues.length; i += 200) {
    await prisma.importIssue.createMany({
      data: issues.slice(i, i + 200).map((x) => ({
        batchId: batch.id,
        entity: x.entity,
        sheet: x.sheet,
        rowRef: x.rowRef,
        severity: x.severity,
        message: x.message,
        rawData: x.rawData === undefined ? undefined : (x.rawData as object),
      })),
    });
  }

  const bySeverity = issues.reduce<Record<string, number>>((a, x) => ((a[x.severity] = (a[x.severity] ?? 0) + 1), a), {});
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { finishedAt: new Date(), stats: { ...stats, issues: bySeverity } },
  });

  console.log('\nDédoublonnage :');
  console.log('  contacts   ', (stats.contacts_client ?? 0) + (stats.contacts_supplier ?? 0),
    `(${stats.contacts_client ?? 0} clients, ${stats.contacts_supplier ?? 0} fournisseurs)`);
  console.log('  syndics    ', stats.syndics ?? 0);
  console.log('  immeubles  ', stats.buildings ?? 0);
  console.log('  personnes  ', stats.people ?? 0);
  console.log('\nFile de contrôle :', issues.length, 'points —', JSON.stringify(bySeverity));
  console.log('  -> visibles dans /api/imports/issues (interface bureau)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
