/**
 * Mise en forme d'un créneau du planning pour Google Agenda — même présentation que les anciennes fiches faites à la main :
 * titre « R-654 - Wavre - Matexi - Condor - App 2.2 - Silicone douche + plinthes », puis des blocs séparés, chacun avec son icône
 * (accès, contact, mission en tirets, ouvriers, matériel, véhicule, gestionnaire). Texte brut : Google l'affiche tel quel, sans balise.
 */
export interface GcalEventSource {
  kind: string;
  title: string | null;
  allDay: boolean;
  meetingOnSite: boolean;
  meetingAddress: string | null; meetingBox: string | null; meetingPostalCode: string | null; meetingCity: string | null;
  tasksNote: string | null;
  accessNote: string | null;
  materialsNote: string | null;
  note: string | null;
  departureAt: Date | null;
  departureFrom: string | null;
  worksite: {
    ref: string; title: string;
    address: string | null; box: string | null; postalCode: string | null; city: string | null;
    manager?: { displayName: string | null; firstName: string } | null;
    acp?: { digicode: string | null; accessNote: string | null } | null;
    /** contacts propres à l'intervention (propriétaire, locataire, sur place…), saisis sur le chantier */
    contacts?: { role: string; name: string; phone: string | null }[];
  };
  team: { name: string } | null;
  vehicles: { vehicle: { plate: string | null; model: string | null; brand?: string | null; code?: string | null }; driver: { displayName: string | null; firstName: string } | null }[];
  assignments: { person: { displayName: string | null; firstName: string } }[];
  equipment: { equipment: { name: string } }[];
  consumables: { qty: number; consumable: { name: string; unit: string } }[];
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\r/g, '').trim();
/** « A, B et C » */
export function joinNames(list: string[]): string {
  const l = list.filter(Boolean);
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`;
}
/** Une ligne par tâche, précédée d'un tiret (sans doubler un tiret déjà saisi). */
const bullets = (text: string) => clean(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (/^[-–—•*]\s*/.test(l) ? `– ${l.replace(/^[-–—•*]\s*/, '')}` : `– ${l}`));
const hhmm = (d: Date) => new Intl.DateTimeFormat('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).format(d).replace(':', 'h');

/** Couleurs Google Agenda : les rendez-vous d'affaire en JAUNE (« Banane », id 5) comme dans les anciennes fiches ;
 *  les interventions gardent la couleur de l'agenda (bleu). À la mise à jour, l'absence de couleur remet celle de l'agenda. */
export const GCAL_COLOR_MEETING = '5';

type GcalComposed = { summary: string; description: string; location: string | undefined; colorId: string | undefined };
/** Blocs « Mission » et « Ouvriers » déjà composés (fiche regroupant plusieurs créneaux d'un même chantier le même jour). */
interface BlockOverride { mission?: string; people?: string }

export function composeGcalEvent(ev: GcalEventSource, ov: BlockOverride = {}): GcalComposed {
  const w = ev.worksite;
  // titre : réf - titre du chantier - titre du créneau (sans répéter ce qui est déjà dedans)
  const parts = [ev.kind === 'meeting' ? 'RDV' : w.ref, clean(w.title)];
  const t = clean(ev.title);
  if (t && !clean(w.title).toLowerCase().includes(t.toLowerCase())) parts.push(t);
  const summary = parts.filter(Boolean).join(' - ');

  const blocks: string[] = [];
  const access = [clean(ev.accessNote), w.acp?.accessNote ? clean(w.acp.accessNote) : '', w.acp?.digicode ? `Digicode : ${w.acp.digicode}` : ''].filter(Boolean);
  if (access.length) blocks.push(`🏢 Accès / Étage : ${access.join('\n')}`);

  // champ « Contact sur place / coordination » du formulaire (pour un RDV : « Avec qui »), recopié tel quel dans le bloc 📞 ;
  // à défaut, les contacts renseignés sur le chantier (sur place d'abord)
  const noteLines = clean(ev.note).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^contact( sur place)?\s*:\s*/i, ''));
  if (noteLines.length) blocks.push(`${ev.kind === 'meeting' ? '🤝 Avec' : '📞 Contact sur place'} : ${noteLines.join('\n')}`);
  else if (ev.kind !== 'meeting' && w.contacts?.length) {
    const order = (r: string) => (r === 'sur_place' ? 0 : r === 'locataire' ? 1 : r === 'proprietaire' ? 2 : 3);
    const list = [...w.contacts].sort((a, b) => order(a.role) - order(b.role)).slice(0, 3);
    blocks.push(`📞 Contact sur place : ${list.map((c) => [c.name, c.phone].filter(Boolean).join(' – ')).join(' / ')}`);
  }

  if (ov.mission) blocks.push(ov.mission);
  else if (clean(ev.tasksNote)) blocks.push(['🛠 Mission :', ...bullets(ev.tasksNote!)].join('\n'));

  const people = joinNames(ev.assignments.map((a) => a.person.displayName || a.person.firstName));
  if (ov.people) blocks.push(ov.people);
  else if (people) blocks.push(`👥 Ouvriers : ${people}`);
  else if (ev.team) blocks.push(`👥 Équipe : ${ev.team.name}`);

  const material = [
    ...ev.equipment.map((e) => e.equipment.name),
    ...ev.consumables.map((c) => `${c.consumable.name} (${c.qty} ${c.consumable.unit})`),
    clean(ev.materialsNote),
  ].filter(Boolean).join(', ');
  if (material) blocks.push(`🔧 Matériel : ${material}`);

  const vehicles = ev.vehicles.map((v) => {
    const label = [v.vehicle.brand ?? v.vehicle.model, v.vehicle.brand ? v.vehicle.model : null, v.vehicle.plate].filter(Boolean).join(' ');
    const driver = v.driver ? v.driver.displayName || v.driver.firstName : null;
    return driver ? `${label} (${driver})` : label;
  }).filter(Boolean);
  if (vehicles.length) blocks.push(`🚐 Véhicule${vehicles.length > 1 ? 's' : ''} : ${vehicles.join(', ')}`);

  if (ev.departureAt || clean(ev.departureFrom)) blocks.push(`🕗 Départ : ${[ev.departureAt ? hhmm(ev.departureAt) : null, clean(ev.departureFrom) || null].filter(Boolean).join(' · ')}`);

  const manager = w.manager ? w.manager.displayName || w.manager.firstName : '';
  if (manager) blocks.push(`👤 Gestionnaire : ${manager}`);

  // RDV ailleurs qu'au chantier : sa propre adresse plutôt que celle du chantier
  const location = ev.kind === 'meeting' && !ev.meetingOnSite
    ? [[ev.meetingAddress, ev.meetingBox && `bte ${ev.meetingBox}`].filter(Boolean).join(' '), [ev.meetingPostalCode, ev.meetingCity].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    : [[w.address, w.box && `bte ${w.box}`].filter(Boolean).join(' '), [w.postalCode, w.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return { summary, description: blocks.join('\n\n'), location: location || undefined, colorId: ev.kind === 'meeting' ? GCAL_COLOR_MEETING : undefined };
}

export type GcalSlot = GcalEventSource & { startAt: Date; endAt: Date };

/** minutes depuis minuit, heure de Bruxelles */
const brusselsMinutes = (d: Date) => {
  const [h, m] = new Intl.DateTimeFormat('fr-BE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Brussels' }).format(d).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const uniqLines = (texts: (string | null)[]) => [...new Set(texts.flatMap((t) => clean(t).split('\n').map((l) => l.trim()).filter(Boolean)))].join('\n') || null;

/**
 * UNE seule fiche Google par chantier et par jour : quand plusieurs créneaux se suivent (matin / après-midi, deux équipes…),
 * ils sont fusionnés — horaire du premier début au dernier fin, et le détail (qui fait quoi, matin ou après-midi) dans la description.
 * Un seul créneau : identique à composeGcalEvent.
 */
export function composeGcalGroup(slots: GcalSlot[]): GcalComposed & { start: Date; end: Date; allDay: boolean } {
  const sorted = [...slots].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const first = sorted[0]!;
  const timed = sorted.filter((s) => !s.allDay);
  const allDay = timed.length === 0;
  const range = allDay ? sorted : timed;
  const start = new Date(Math.min(...range.map((s) => s.startAt.getTime())));
  const end = new Date(Math.max(...range.map((s) => s.endAt.getTime())));
  if (sorted.length === 1) return { ...composeGcalEvent(first), start: first.startAt, end: first.endAt, allDay: first.allDay };

  // quand les créneaux n'ont pas tous le même horaire, on précise lequel (AM / PM / heures)
  const sameRange = sorted.every((s) => s.startAt.getTime() === first.startAt.getTime() && s.endAt.getTime() === first.endAt.getTime());
  const tag = (s: GcalSlot) => {
    if (sameRange || s.allDay) return '';
    if (brusselsMinutes(s.endAt) <= 13 * 60) return 'AM';
    if (brusselsMinutes(s.startAt) >= 12 * 60) return 'PM';
    return s.startAt.getTime() === start.getTime() && s.endAt.getTime() === end.getTime() ? '' : `${hhmm(s.startAt)}–${hhmm(s.endAt)}`;
  };

  const wTitle = clean(first.worksite.title).toLowerCase();
  const titles = [...new Set(sorted.map((s) => clean(s.title)).filter((t) => t && !wTitle.includes(t.toLowerCase())))];

  // ouvriers : une ligne par créneau, avec son AM / PM
  const peopleLines: string[] = [];
  for (const s of sorted) {
    const who = joinNames(s.assignments.map((a) => a.person.displayName || a.person.firstName)) || (s.team ? `Équipe ${s.team.name}` : '');
    if (!who) continue;
    const t = tag(s);
    const line = t ? `${who} (${t})` : who;
    if (!peopleLines.includes(line)) peopleLines.push(line);
  }
  const people = peopleLines.length === 0 ? undefined : peopleLines.length === 1 ? `👥 Ouvriers : ${peopleLines[0]}` : ['👥 Ouvriers :', ...peopleLines.map((l) => `– ${l}`)].join('\n');

  // mission : un seul texte si identique partout, sinon une section par créneau
  const missions: { label: string; text: string }[] = [];
  for (const s of sorted) {
    const text = clean(s.tasksNote);
    if (!text || missions.some((m) => m.text === text)) continue;
    missions.push({ label: [tag(s), titles.length > 1 ? clean(s.title) : ''].filter(Boolean).join(' · '), text });
  }
  const mission = missions.length === 0 ? undefined
    : missions.length === 1 ? ['🛠 Mission :', ...bullets(missions[0]!.text)].join('\n')
    : ['🛠 Mission :', ...missions.flatMap((m, i) => [`${m.label || `Équipe ${i + 1}`} :`, ...bullets(m.text)])].join('\n');

  const vSeen = new Set<string>();
  const vehicles = sorted.flatMap((s) => s.vehicles).filter((v) => { const k = `${v.vehicle.plate}|${v.vehicle.model}|${v.vehicle.code}`; if (vSeen.has(k)) return false; vSeen.add(k); return true; });
  const eqSeen = new Set<string>();
  const equipment = sorted.flatMap((s) => s.equipment).filter((e) => { if (eqSeen.has(e.equipment.name)) return false; eqSeen.add(e.equipment.name); return true; });
  const csSeen = new Set<string>();
  const consumables = sorted.flatMap((s) => s.consumables).filter((c) => { if (csSeen.has(c.consumable.name)) return false; csSeen.add(c.consumable.name); return true; });

  const merged: GcalEventSource = {
    ...first,
    title: titles.length === 1 ? titles[0]! : null,
    allDay,
    accessNote: uniqLines(sorted.map((s) => s.accessNote)),
    materialsNote: uniqLines(sorted.map((s) => s.materialsNote)),
    note: uniqLines(sorted.map((s) => s.note)),
    departureAt: sorted.find((s) => s.departureAt)?.departureAt ?? null,
    departureFrom: sorted.find((s) => clean(s.departureFrom))?.departureFrom ?? null,
    team: null, assignments: [], vehicles, equipment, consumables,
  };
  return { ...composeGcalEvent(merged, { mission, people }), start, end, allDay };
}
