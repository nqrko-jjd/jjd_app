/**
 * Planning prévisionnel déduit du BUDGET d'un devis : pour chaque lot, la part main-d'œuvre du montant donne un nombre de journées d'ouvrier,
 * réparties sur l'équipe, puis posées à la suite sur les jours ouvrables (hors week-ends et jours fériés belges). C'est une première proposition
 * transparente — créneaux « à confirmer » à ajuster —, pas un calcul d'ingénieur : les hypothèses (prix d'une journée, part de main-d'œuvre,
 * taille d'équipe) sont affichées et modifiables avant création.
 */
export interface QuoteLine { kind: string; label: string; description?: string | null; qty: number; unit: string | null; totalHt: number; category?: string | null }
export interface PlanParams { startDate: string; teamSize: number; dayRate: number; labourShare: number }
export interface LotEstimate { title: string; budgetHt: number; labourHt: number; materialHt: number; manDays: number; days: number; items: string[] }
export interface PlanSlot { lot: number; title: string; date: string; start: string; end: string; half: 'am' | 'pm' | null; items: string[] }

export const DEFAULT_PLAN: Omit<PlanParams, 'startDate'> = { teamSize: 2, dayRate: 380, labourShare: 0.5 };
const HOURS_PER_DAY = 8;
const MAX_LOT_DAYS = 90;

const isOption = (l: string) => /^\s*(option|variante)\b/i.test(l);
/** Ligne de pure main-d'œuvre (heures, déplacement, journée d'ouvrier) : 100 % main-d'œuvre. */
const isLabourLine = (l: QuoteLine) => (l.unit ?? '').toLowerCase().replace(/\./g, '') === 'h' || /main d['’]œuvre|main d['’]oeuvre|heures? de|journée|déplacement|deplacement/i.test(l.label) || /main d['’]œuvre|main d['’]oeuvre/i.test(l.category ?? '');
const hoursOf = (l: QuoteLine) => ((l.unit ?? '').toLowerCase().replace(/\./g, '') === 'h' ? l.qty : null);

interface RawLot { title: string; items: QuoteLine[] }
function groupLots(lines: QuoteLine[]): RawLot[] {
  const lots: RawLot[] = [];
  let cur: RawLot | null = null;
  for (const l of lines) {
    if (l.kind === 'section') { cur = { title: l.label.trim(), items: [] }; lots.push(cur); continue; }
    if (l.kind !== 'item') continue;
    if (!cur) { cur = { title: 'Travaux', items: [] }; lots.push(cur); }
    cur.items.push(l);
  }
  return lots.filter((l) => l.items.length > 0);
}

export function estimateLots(lines: QuoteLine[], p: PlanParams): LotEstimate[] {
  return groupLots(lines).map((lot) => {
    const items = lot.items.filter((i) => !isOption(i.label));
    let labourHt = 0; let materialHt = 0; let manDays = 0;
    for (const i of items) {
      if (isLabourLine(i)) {
        labourHt += i.totalHt;
        const h = hoursOf(i);
        manDays += h != null ? h / HOURS_PER_DAY : i.totalHt / p.dayRate;
      } else {
        const lab = i.totalHt * p.labourShare;
        labourHt += lab; materialHt += i.totalHt - lab;
        manDays += lab / p.dayRate;
      }
    }
    const budgetHt = items.reduce((s, i) => s + i.totalHt, 0);
    const raw = (manDays / Math.max(1, p.teamSize)) * 2; // en demi-journées
    const days = budgetHt > 0 ? Math.min(MAX_LOT_DAYS, Math.max(0.5, Math.ceil(raw - 1e-9) / 2)) : 0;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return { title: lot.title, budgetHt: r2(budgetHt), labourHt: r2(labourHt), materialHt: r2(materialHt), manDays: r2(manDays), days, items: items.map((i) => i.label.trim()) };
  }).filter((l) => l.days > 0);
}

// -------------------------------------------------------------------- calendrier
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDaysIso = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
/** Jours fériés légaux belges d'une année (AAAA-MM-JJ). */
export function belgianHolidays(year: number): Set<string> {
  const e = easter(year);
  const plus = (n: number) => { const d = new Date(e); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  return new Set([`${year}-01-01`, `${year}-05-01`, `${year}-07-21`, `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`, plus(1), plus(39), plus(50)]);
}
export function isWorkingDay(day: string): boolean {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !belgianHolidays(Number(day.slice(0, 4))).has(day);
}
export function nextWorkingDay(day: string): string { let d = day; while (!isWorkingDay(d)) d = addDaysIso(d, 1); return d; }

/**
 * Pose les lots à la suite, en demi-journées (matin 08:30–12:30, après-midi 13:00–17:00). Les demi-journées successives d'un même lot sur un même jour
 * forment un seul créneau (08:30–17:00) ; le lot suivant reprend l'après-midi même si le précédent s'est arrêté à midi.
 */
export function scheduleLots(lots: LotEstimate[], startDate: string): PlanSlot[] {
  const out: PlanSlot[] = [];
  let day = nextWorkingDay(startDate);
  let half = 0; // 0 = matin, 1 = après-midi
  lots.forEach((lot, li) => {
    let units = Math.round(lot.days * 2);
    while (units > 0) {
      const take = half === 0 ? Math.min(2, units) : 1; // matin + après-midi d'un coup, ou l'après-midi seul
      const am = half === 0;
      out.push({
        lot: li + 1, title: lot.title, date: day, items: lot.items,
        start: am ? '08:30' : '13:00', end: take === 2 ? '17:00' : am ? '12:30' : '17:00', half: take === 2 ? null : am ? 'am' : 'pm',
      });
      units -= take;
      if (am && take === 2) { day = nextWorkingDay(addDaysIso(day, 1)); half = 0; }
      else if (am) { half = 1; }
      else { day = nextWorkingDay(addDaysIso(day, 1)); half = 0; }
    }
  });
  return out;
}

/** Date + heure locales de Bruxelles -> instant UTC (gère l'heure d'été). */
export function brusselsToDate(day: string, hhmm: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess - (asUtc - guess));
}
