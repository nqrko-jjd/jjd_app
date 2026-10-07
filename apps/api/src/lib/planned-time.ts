import { prisma } from '../db.js';
import { workforceCategory, round2 } from '@jjd/shared';

/**
 * Pointage « prévu » déduit du planning : chaque ouvrier affecté à une intervention a, ce jour-là et sur ce chantier, une proposition
 * d'heures (créneau du planning moins la pause). Rien n'est écrit tant que le bureau ou le chef de chantier ne valide pas :
 *  - « Valider » transforme la proposition en vrai pointage validé (source « planning ») ;
 *  - « N'a pas travaillé » enregistre un pointage refusé pour que la proposition ne revienne pas ;
 *  - un ouvrier qui a déjà pointé lui-même ce jour-là sur ce chantier n'a pas de proposition (jamais deux fois les mêmes heures).
 * Les heures prévues non validées apparaissent dans les décomptes à part (« prévu au planning »), sans compter dans le payé.
 */
export const DEFAULT_BREAK_MIN = 30;
export const BREAK_THRESHOLD_MIN = 6 * 60;
const ALL_DAY_HOURS = 8;
const MAX_HOURS = 16;

/** jour calendaire (AAAA-MM-JJ) à Bruxelles */
export const brusselsDay = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(d);
export const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);

export interface Slot { start: string; end: string; allDay: boolean; minutes: number }

/** Heures nettes d'une journée sur un chantier : somme des créneaux, moins la pause si la présence totale atteint 6 h. */
export function netHours(slots: { minutes: number; allDay: boolean }[]): { hours: number; pauseMinutes: number } {
  const total = slots.reduce((s, x) => s + (x.allDay ? ALL_DAY_HOURS * 60 : x.minutes), 0);
  const pause = total >= BREAK_THRESHOLD_MIN && !slots.every((s) => s.allDay) ? DEFAULT_BREAK_MIN : 0;
  return { hours: Math.min(MAX_HOURS, round2(Math.max(0, total - pause) / 60)), pauseMinutes: pause };
}

export type ProposalState = 'open' | 'covered';
export interface Proposal {
  key: string; // personne|chantier|jour
  date: string; // AAAA-MM-JJ
  personId: string;
  personName: string;
  photoThumbUrl: string | null;
  worksiteId: string;
  worksiteRef: string;
  worksiteTitle: string;
  managerId: string | null;
  eventIds: string[];
  slots: Slot[];
  hours: number;
  pauseMinutes: number;
  state: ProposalState;
  /** pointage déjà existant qui couvre cette proposition (état « covered ») */
  covered?: { hours: number | null; status: string };
}

const hhmm = (d: Date) => new Intl.DateTimeFormat('fr-BE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Brussels' }).format(d);

/** Propositions de pointage pour la période [from, to] (jours AAAA-MM-JJ inclus), à valider. */
export async function plannedProposals(fromDay: string, toDay: string, opts: { managerId?: string; worksiteId?: string; personId?: string } = {}): Promise<Proposal[]> {
  const from = new Date(dayDate(fromDay).getTime() - 86400000);
  const to = new Date(dayDate(toDay).getTime() + 2 * 86400000);
  const events = await prisma.planningEvent.findMany({
    where: {
      kind: 'intervention', status: { not: 'tentative' }, startAt: { gte: from, lt: to },
      ...(opts.worksiteId ? { worksiteId: opts.worksiteId } : {}),
      ...(opts.managerId ? { worksite: { managerId: opts.managerId } } : {}),
    },
    orderBy: { startAt: 'asc' },
    include: {
      worksite: { select: { id: true, ref: true, title: true, managerId: true } },
      assignments: { include: { person: { select: { id: true, displayName: true, firstName: true, lastName: true, role: true, contractType: true, active: true, photoThumbUrl: true } } } },
    },
  });

  const groups = new Map<string, Proposal & { raw: Slot[] }>();
  for (const e of events) {
    const day = brusselsDay(e.startAt);
    if (day < fromDay || day > toDay) continue;
    const minutes = Math.max(0, Math.round((e.endAt.getTime() - e.startAt.getTime()) / 60000));
    for (const a of e.assignments) {
      const p = a.person;
      if (!p.active || (opts.personId && p.id !== opts.personId)) continue;
      const cat = workforceCategory(p);
      if (cat === 'gestionnaire' || cat === 'bureau') continue; // supervision et bureau ne pointent pas sur chantier
      const key = `${p.id}|${e.worksiteId}|${day}`;
      const g = groups.get(key) ?? {
        key, date: day, personId: p.id, personName: p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim(), photoThumbUrl: p.photoThumbUrl,
        worksiteId: e.worksiteId, worksiteRef: e.worksite.ref, worksiteTitle: e.worksite.title, managerId: e.worksite.managerId,
        eventIds: [], slots: [], hours: 0, pauseMinutes: 0, state: 'open' as ProposalState, raw: [],
      };
      g.eventIds.push(e.id);
      const slot = { start: hhmm(e.startAt), end: hhmm(e.endAt), allDay: e.allDay, minutes };
      g.slots.push(slot);
      g.raw.push(slot);
      groups.set(key, g);
    }
  }
  if (groups.size === 0) return [];

  const personIds = [...new Set([...groups.values()].map((g) => g.personId))];
  const [entries, absences] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { personId: { in: personIds }, date: { gte: dayDate(fromDay), lte: dayDate(toDay) } },
      select: { personId: true, worksiteId: true, date: true, hours: true, status: true, planningEventId: true },
    }),
    prisma.absence.findMany({ where: { personId: { in: personIds }, startsOn: { lte: dayDate(toDay) }, endsOn: { gte: dayDate(fromDay) } }, select: { personId: true, startsOn: true, endsOn: true } }),
  ]);

  const out: Proposal[] = [];
  for (const g of groups.values()) {
    const d = dayDate(g.date).getTime();
    // absent (congé, formation) ce jour-là : pas de proposition
    if (absences.some((a) => a.personId === g.personId && a.startsOn.getTime() <= d && a.endsOn.getTime() >= d)) continue;
    const mine = entries.filter((x) => x.personId === g.personId && x.date && x.date.getTime() === d);
    // déjà traitée par une proposition précédente (validée, ou « n'a pas travaillé ») : on ne la repropose pas
    if (mine.some((x) => x.planningEventId && g.eventIds.includes(x.planningEventId))) continue;
    const net = netHours(g.raw);
    const live = mine.find((x) => x.worksiteId === g.worksiteId && x.status !== 'rejected');
    out.push({
      key: g.key, date: g.date, personId: g.personId, personName: g.personName, photoThumbUrl: g.photoThumbUrl,
      worksiteId: g.worksiteId, worksiteRef: g.worksiteRef, worksiteTitle: g.worksiteTitle, managerId: g.managerId,
      eventIds: g.eventIds, slots: g.slots, hours: net.hours, pauseMinutes: net.pauseMinutes,
      state: live ? 'covered' : 'open',
      ...(live ? { covered: { hours: live.hours, status: live.status } } : {}),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.worksiteRef.localeCompare(b.worksiteRef) || a.personName.localeCompare(b.personName, 'fr'));
}
