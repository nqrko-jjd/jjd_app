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

export function composeGcalEvent(ev: GcalEventSource): { summary: string; description: string; location: string | undefined; colorId: string | undefined } {
  const w = ev.worksite;
  // titre : réf - titre du chantier - titre du créneau (sans répéter ce qui est déjà dedans)
  const parts = [ev.kind === 'meeting' ? 'RDV' : w.ref, clean(w.title)];
  const t = clean(ev.title);
  if (t && !clean(w.title).toLowerCase().includes(t.toLowerCase())) parts.push(t);
  const summary = parts.filter(Boolean).join(' - ');

  const blocks: string[] = [];
  const access = [clean(ev.accessNote), w.acp?.accessNote ? clean(w.acp.accessNote) : '', w.acp?.digicode ? `Digicode : ${w.acp.digicode}` : ''].filter(Boolean);
  if (access.length) blocks.push(`🏢 Accès / Étage : ${access.join('\n')}`);

  // note libre : les lignes « Contact … : » deviennent le bloc contact, le reste des consignes
  const noteLines = clean(ev.note).split('\n').map((l) => l.trim()).filter(Boolean);
  const contacts = noteLines.filter((l) => /^contact\b/i.test(l)).map((l) => l.replace(/^contact( sur place)?\s*:?\s*/i, ''));
  const others = noteLines.filter((l) => !/^contact\b/i.test(l));
  if (others.length) blocks.push(others.join('\n'));
  if (contacts.length) blocks.push(`📞 Contact sur place : ${contacts.join(' / ')}`);

  if (clean(ev.tasksNote)) blocks.push(['🛠 Mission :', ...bullets(ev.tasksNote!)].join('\n'));

  const people = joinNames(ev.assignments.map((a) => a.person.displayName || a.person.firstName));
  if (people) blocks.push(`👥 Ouvriers : ${people}`);
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
