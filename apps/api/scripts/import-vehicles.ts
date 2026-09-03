/**
 * Import du registre véhicules JJD (fichier « JJD_vehicule.xlsx »).
 * Source de vérité pour la flotte — remplace les données véhicules/assurances
 * sommaires venues du fichier de rentabilité.
 *
 *   npm run import:vehicles -- "data-import/JJD_vehicule.xlsx"
 *   npm run import:vehicles            (cherche un fichier *vehicule* dans data-import/)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { parseLooseDate, parseAmount } from '@jjd/shared';
import { readXlsx } from './lib/xlsx-read.js';

const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../../data-import');

function findFile(): string | null {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  if (!existsSync(dataDir)) return null;
  const f = readdirSync(dataDir).find((n) => /vehicul/i.test(n) && /\.xlsx$/i.test(n));
  return f ? path.join(dataDir, f) : null;
}

const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s === '' || s === '-' || s === '?' || s === '/' || s === 'A verif' ? null : s;
};
const plateKey = (p: string | null) => (p ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase();

async function main() {
  const file = findFile();
  if (!file) {
    console.error('Fichier véhicules introuvable. Dépose-le dans data-import/ (nom contenant « vehicule »).');
    process.exit(1);
  }
  console.log('Import véhicules —', path.basename(file));
  const sheets = readXlsx(file);
  const data = sheets.find((s) => s.name.trim().toLowerCase() === 'data');
  const pay = sheets.find((s) => s.name.trim().toLowerCase() === 'paiements');
  if (!data) throw new Error('Feuille « Data » introuvable');

  // purge : on délie les PV, on remet la flotte à zéro
  await prisma.fine.updateMany({ data: { vehicleId: null } });
  await prisma.$transaction([
    prisma.vehiclePayment.deleteMany({}),
    prisma.insurance.deleteMany({}),
    prisma.vehicle.deleteMany({}),
  ]);

  const byCode = new Map<string, string>();
  const byPlate = new Map<string, string>();
  let n = 0;

  for (const row of data.rows) {
    if (row.r < 2) continue;
    const c = row.cells;
    const code = str(c.B);
    const brand = str(c.C);
    if (!code && !brand) continue;

    const v = await prisma.vehicle.create({
      data: {
        code,
        plate: str(c.E),
        brand,
        model: str(c.D),
        name: [brand, str(c.D)].filter(Boolean).join(' ') || code,
        type: str(c.G),
        km: str(c.H),
        circulationTax: parseAmount(c.I),
        biv: parseAmount(c.J),
        nextInspection: parseLooseDate(c.R),
        vin: str(c.S),
        fuel: str(c.T),
        firstRegistration: parseLooseDate(c.F),
        status: (str(c.U) ?? 'active').toLowerCase(),
        acquisitionMode: str(c.W),
        purchaseDate: parseLooseDate(c.V),
        purchasePriceHt: parseAmount(c.AA),
        financedAmount: parseAmount(c.X),
        monthlyPayment: parseAmount(c.AB),
        downPayment: parseAmount(c.AC),
        residualValue: parseAmount(c.AD),
        financeMonths: parseAmount(c.Y) ? Math.round(parseAmount(c.Y)!) : null,
        financeEndOn: parseLooseDate(c.Z),
        financeCompany: str(c.AE),
        financeContract: str(c.AF),
        driver: str(c.AG),
        equipment: str(c.AH),
        depot: str(c.AI),
        source: 'vehicle-file',
      },
    });
    n++;
    if (code) byCode.set(code, v.id);
    if (v.plate) byPlate.set(plateKey(v.plate), v.id);

    // assurance
    if (str(c.K) || parseAmount(c.M) || parseAmount(c.N)) {
      await prisma.insurance.create({
        data: {
          vehicleId: v.id,
          provider: str(c.K),
          contractNumber: str(c.L),
          annualAmount: parseAmount(c.M),
          monthlyAmount: parseAmount(c.N),
          paymentMode: str(c.O),
          note: str(c.P),
        },
      });
    }
  }

  // échéancier de financement
  let payN = 0;
  for (const row of pay?.rows ?? []) {
    if (row.r < 2) continue;
    const vid = byCode.get(str(row.cells.A) ?? '');
    if (!vid) continue;
    await prisma.vehiclePayment.create({
      data: {
        vehicleId: vid,
        dueOn: parseLooseDate(row.cells.B),
        amount: parseAmount(row.cells.C),
        principal: parseAmount(row.cells.D),
        interest: parseAmount(row.cells.E),
        balance: parseAmount(row.cells.F),
      },
    });
    payN++;
  }

  // re-lier les PV par plaque
  let fineN = 0;
  const fines = await prisma.fine.findMany({ where: { plateRaw: { not: null } } });
  for (const f of fines) {
    const m = (f.plateRaw ?? '').match(/[0-9][- ]?[A-Z]{3}[- ]?[0-9]{3}/i);
    const vid = m ? byPlate.get(plateKey(m[0])) : undefined;
    if (vid) {
      await prisma.fine.update({ where: { id: f.id }, data: { vehicleId: vid } });
      fineN++;
    }
  }

  console.log(`  ${n} véhicules, ${payN} échéances de financement, ${fineN} PV re-liés`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
