import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, TextInput, Switch } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet, apiSend } from '@/lib/api';
import { Muted, Loading } from '@/lib/ui';
import { WorksitePick, type Ws } from '@/lib/WorksitePick';
import { T } from '@/lib/theme';

interface Person { id: string; firstName: string; lastName: string | null; displayName: string | null }
interface Vehicle { id: string; plate: string | null; model: string | null; brand: string | null; code: string | null; name?: string | null }
interface Ev {
  id: string; title: string | null; startAt: string; endAt: string; allDay: boolean; status: string; kind: string; tasksNote: string | null; accessNote: string | null; materialsNote: string | null; note: string | null;
  meetingOnSite: boolean; meetingAddress: string | null; meetingPostalCode: string | null; meetingCity: string | null;
  worksite: { id: string; ref: string; title: string };
  assignments: { person: { id: string } }[]; vehicles: { vehicle: { id: string }; driver: { id: string } | null }[];
}
const KIND = { intervention: { main: '#3d7fc4', soft: '#e4eef9', label: 'Intervention' }, meeting: { main: '#e0a800', soft: '#fbf1cc', label: 'Rendez-vous' } } as const;
const pn = (p: Person) => p.displayName || p.firstName;
const dayStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutesOf = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

/** Créer, modifier ou dupliquer une intervention (bleu) ou un rendez-vous (jaune) : tout au doigt, sans clavier sauf pour les notes. */
export default function Edition() {
  const { id, date, worksiteId, dupFrom } = useLocalSearchParams<{ id?: string; date?: string; worksiteId?: string; dupFrom?: string }>();
  const router = useRouter();
  const sourceId = id ?? dupFrom;
  const [loading, setLoading] = useState(!!sourceId);
  const [kind, setKind] = useState<'intervention' | 'meeting'>('intervention');
  const [ws, setWs] = useState<Ws | null>(null);
  const [title, setTitle] = useState('');
  const [day, setDay] = useState(date ?? dayStr(new Date()));
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(8 * 60 + 30);
  const [end, setEnd] = useState(17 * 60);
  const [people, setPeople] = useState<string[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [tasks, setTasks] = useState('');
  const [access, setAccess] = useState('');
  const [materials, setMaterials] = useState('');
  const [note, setNote] = useState('');
  const [onSite, setOnSite] = useState(true);
  const [addr, setAddr] = useState('');
  const [tentative, setTentative] = useState(false);
  const [allPeople, setAllPeople] = useState<Person[]>([]);
  const [allVehicles, setAllVehicles] = useState<Vehicle[]>([]);
  const [busy, setBusy] = useState<{ people: Map<string, string>; vehicles: Map<string, string> }>({ people: new Map(), vehicles: new Map() });
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ items: Person[] }>('/api/people?active=1').then((r) => setAllPeople(r.items)).catch(() => {});
    apiGet<{ items: Vehicle[] }>('/api/vehicles').then((r) => setAllVehicles(r.items)).catch(() => {});
    if (worksiteId) apiGet<{ worksites: Ws[] }>('/api/meta/pickers').then((r) => { const w = r.worksites.find((x) => x.id === worksiteId); if (w) setWs(w); }).catch(() => {});
  }, [worksiteId]);

  useEffect(() => {
    if (!sourceId) return;
    apiGet<{ event: Ev }>(`/api/planning/${sourceId}`).then(({ event: e }) => {
      setKind(e.kind === 'meeting' ? 'meeting' : 'intervention');
      setWs({ id: e.worksite.id, name: `${e.worksite.ref} · ${e.worksite.title}` });
      setTitle(e.title ?? ''); setAllDay(e.allDay); setStart(minutesOf(e.startAt)); setEnd(minutesOf(e.endAt) || 17 * 60);
      if (id) setDay(dayStr(new Date(e.startAt)));
      setPeople(e.assignments.map((a) => a.person.id)); setVehicles(e.vehicles.map((v) => v.vehicle.id));
      setTasks(e.tasksNote ?? ''); setAccess(e.accessNote ?? ''); setMaterials(e.materialsNote ?? ''); setNote(e.note ?? '');
      setOnSite(e.meetingOnSite); setAddr([e.meetingAddress, e.meetingPostalCode, e.meetingCity].filter(Boolean).join(' '));
      setTentative(e.status === 'tentative');
    }).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
  }, [sourceId, id]);

  // qui est déjà pris ce jour-là (sur un autre chantier) : signalé, jamais bloquant
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const from = new Date(`${day}T00:00:00`); const to = new Date(from.getTime() + 86400000);
    apiGet<{ items: { id: string; worksite: { ref: string }; assignments: { person: { id: string } }[]; vehicles: { vehicle: { id: string } }[] }[] }>(`/api/planning?from=${from.toISOString()}&to=${to.toISOString()}`).then((r) => {
      const p = new Map<string, string>(); const v = new Map<string, string>();
      for (const e of r.items) { if (e.id === id) continue; for (const a of e.assignments) p.set(a.person.id, e.worksite.ref); for (const x of e.vehicles) v.set(x.vehicle.id, e.worksite.ref); }
      setBusy({ people: p, vehicles: v });
    }).catch(() => {});
  }, [day, id]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; }), []);
  const shownPeople = useMemo(() => { const s = q.trim().toLowerCase(); return allPeople.filter((p) => !s || pn(p).toLowerCase().includes(s) || (p.lastName ?? '').toLowerCase().includes(s)); }, [allPeople, q]);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const c = KIND[kind];
  const vlabel = (v: Vehicle) => [v.model || v.brand || v.name, v.plate].filter(Boolean).join(' · ') || v.code || 'Véhicule';
  const valid = !!ws && /^\d{4}-\d{2}-\d{2}$/.test(day) && (allDay || end > start);

  async function save() {
    if (!ws) return;
    setSaving(true); setErr(null);
    const at = (m: number) => new Date(`${day}T${hhmm(m)}:00`).toISOString();
    const body: Record<string, unknown> = {
      worksiteId: ws.id, kind, title: title.trim() || null, allDay,
      startAt: allDay ? at(0) : at(start), endAt: allDay ? at(23 * 60 + 59) : at(end),
      status: tentative ? 'tentative' : 'confirmed', personIds: people,
      vehicles: vehicles.map((vehicleId) => ({ vehicleId })),
      tasksNote: tasks.trim() || null, accessNote: access.trim() || null, materialsNote: materials.trim() || null, note: note.trim() || null,
      ...(kind === 'meeting' ? { meetingOnSite: onSite, meetingAddress: onSite ? null : addr.trim() || null } : {}),
    };
    try {
      const r = id ? await apiSend<{ event: { id: string } }>(`/api/planning/${id}`, 'PATCH', body, false) : await apiSend<{ event: { id: string } }>('/api/planning', 'POST', body, false);
      const newId = 'event' in r ? r.event.id : id;
      router.replace(`/evenement/${newId}` as never);
    } catch (e) { setErr((e as Error).message || 'Enregistrement impossible'); } finally { setSaving(false); }
  }

  if (loading) return <Loading />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: id ? 'Modifier' : dupFrom ? 'Dupliquer' : 'Nouveau planning', headerBackTitle: 'Retour' }} />

      <View style={s.seg}>
        {(['intervention', 'meeting'] as const).map((k) => (
          <Pressable key={k} accessibilityRole="button" onPress={() => setKind(k)} style={[s.segBtn, kind === k && { backgroundColor: KIND[k].main }]}><Text style={[s.segTxt, kind === k && { color: '#fff' }]}>{KIND[k].label}</Text></Pressable>
        ))}
      </View>

      <View style={[s.card, { borderLeftColor: c.main, borderLeftWidth: 6 }]}>
        <Text style={s.lbl}>Chantier</Text>
        <WorksitePick value={ws} onChange={setWs} />
        <Text style={s.lbl}>{kind === 'meeting' ? 'Objet du rendez-vous' : 'Titre (facultatif)'}</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder={kind === 'meeting' ? 'RDV avec l’architecte…' : 'Ex. Lot 2 — Électricité'} placeholderTextColor={T.ink3} style={s.input} />
      </View>

      <View style={s.card}>
        <Text style={s.lbl}>Jour</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {days.map((d, i) => { const k = dayStr(d); return (
            <Pressable key={k} accessibilityRole="button" onPress={() => setDay(k)} style={[s.dayChip, day === k && { backgroundColor: c.main, borderColor: c.main }]}>
              <Text style={[s.dayDow, day === k && { color: '#fff' }]}>{i === 0 ? 'Auj.' : d.toLocaleDateString('fr-BE', { weekday: 'short' })}</Text>
              <Text style={[s.dayNum, day === k && { color: '#fff' }]}>{d.getDate()}</Text>
            </Pressable>
          ); })}
        </ScrollView>
        <TextInput value={day} onChangeText={setDay} placeholder="AAAA-MM-JJ" placeholderTextColor={T.ink3} style={s.input} />
        <View style={s.switchRow}><Text style={{ flex: 1, color: T.ink, fontWeight: '700' }}>Toute la journée</Text><Switch value={allDay} onValueChange={setAllDay} trackColor={{ true: c.main }} /></View>
        {!allDay && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {([['De', start, setStart], ['À', end, setEnd]] as const).map(([l, v, set]) => (
              <View key={l} style={{ flex: 1, gap: 6 }}>
                <Text style={s.lbl}>{l}</Text>
                <View style={s.timeRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${l} moins`} onPress={() => set(Math.max(0, v - 30))} style={s.tBtn}><Feather name="minus" size={20} color={T.primary} /></Pressable>
                  <Text style={s.time}>{hhmm(v)}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${l} plus`} onPress={() => set(Math.min(23 * 60 + 30, v + 30))} style={s.tBtn}><Feather name="plus" size={20} color={T.primary} /></Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
        {!allDay && end <= start && <Text style={{ color: T.crit, fontWeight: '700' }}>L’heure de fin doit suivre l’heure de début.</Text>}
      </View>

      <View style={s.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={s.lbl}>Équipe</Text><Text style={{ color: c.main, fontWeight: '800' }}>{people.length ? `${people.length} choisi${people.length > 1 ? 's' : ''}` : ''}</Text></View>
        <TextInput value={q} onChangeText={setQ} placeholder="Chercher une personne" placeholderTextColor={T.ink3} style={s.input} />
        <View style={s.wrap}>
          {shownPeople.map((p) => {
            const on = people.includes(p.id); const taken = busy.people.get(p.id);
            return (
              <Pressable key={p.id} accessibilityRole="button" onPress={() => toggle(people, setPeople, p.id)} style={[s.person, on && { backgroundColor: c.main, borderColor: c.main }]}>
                <Text style={[s.personTxt, on && { color: '#fff' }]}>{pn(p)}</Text>
                {!!taken && !on && <Text style={s.taken}>{taken}</Text>}
                {!!taken && on && <Text style={[s.taken, { color: '#fff' }]}>déjà {taken}</Text>}
              </Pressable>
            );
          })}
        </View>
        <Muted>Une étiquette « R-… » indique que la personne est déjà affectée ce jour-là ailleurs.</Muted>
      </View>

      {allVehicles.length > 0 && (
        <View style={s.card}>
          <Text style={s.lbl}>Véhicules</Text>
          <View style={s.wrap}>
            {allVehicles.map((v) => {
              const on = vehicles.includes(v.id); const taken = busy.vehicles.get(v.id);
              return (
                <Pressable key={v.id} accessibilityRole="button" onPress={() => toggle(vehicles, setVehicles, v.id)} style={[s.person, on && { backgroundColor: c.main, borderColor: c.main }]}>
                  <Text style={[s.personTxt, on && { color: '#fff' }]}>{vlabel(v)}</Text>
                  {!!taken && <Text style={[s.taken, on && { color: '#fff' }]}>{on ? `déjà ${taken}` : taken}</Text>}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <View style={s.card}>
        <Text style={s.lbl}>{kind === 'meeting' ? 'Avec qui / à noter' : 'Mission du jour'}</Text>
        <TextInput value={kind === 'meeting' ? note : tasks} onChangeText={kind === 'meeting' ? setNote : setTasks} multiline placeholder={kind === 'meeting' ? 'Nom, téléphone, sujet…' : 'Ce qu’il faut faire, une ligne par tâche'} placeholderTextColor={T.ink3} style={[s.input, s.area]} />
        {kind === 'intervention' && (<>
          <Text style={s.lbl}>Accès / étage</Text>
          <TextInput value={access} onChangeText={setAccess} placeholder="Digicode, étage, personne à contacter…" placeholderTextColor={T.ink3} style={s.input} />
          <Text style={s.lbl}>Matériel à prévoir</Text>
          <TextInput value={materials} onChangeText={setMaterials} placeholder="Échelle, plaques, outils…" placeholderTextColor={T.ink3} style={s.input} />
          <Text style={s.lbl}>Contact sur place</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Nom et téléphone" placeholderTextColor={T.ink3} style={s.input} />
        </>)}
        {kind === 'meeting' && (<>
          <View style={s.switchRow}><Text style={{ flex: 1, color: T.ink, fontWeight: '700' }}>Sur place (adresse du chantier)</Text><Switch value={onSite} onValueChange={setOnSite} trackColor={{ true: c.main }} /></View>
          {!onSite && <TextInput value={addr} onChangeText={setAddr} placeholder="Adresse du rendez-vous" placeholderTextColor={T.ink3} style={s.input} />}
        </>)}
        <View style={s.switchRow}><View style={{ flex: 1 }}><Text style={{ color: T.ink, fontWeight: '700' }}>À confirmer</Text><Muted>Créneau pas encore garanti</Muted></View><Switch value={tentative} onValueChange={setTentative} trackColor={{ true: T.accent }} /></View>
      </View>

      {err && <Text style={{ color: T.crit, fontWeight: '700' }}>{err}</Text>}
      <Pressable accessibilityRole="button" disabled={!valid || saving} onPress={save} style={({ pressed }) => [s.go, { backgroundColor: c.main }, (!valid || saving) && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.98 }] }]}>
        <Feather name="check-circle" size={22} color="#fff" /><Text style={s.goTxt}>{saving ? 'Enregistrement…' : id ? 'Enregistrer les modifications' : 'Ajouter au planning'}</Text>
      </Pressable>
      {!ws && <Muted>Choisis le chantier pour activer l’enregistrement.</Muted>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: T.surface2, borderRadius: 16, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 14, borderRadius: 13, alignItems: 'center' },
  segTxt: { fontWeight: '800', fontSize: 15, color: T.ink2 },
  card: { backgroundColor: T.surface, borderRadius: 20, borderWidth: 1, borderColor: T.line, padding: 14, gap: 10 },
  lbl: { fontSize: 12, fontWeight: '800', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15.5, color: T.ink },
  area: { minHeight: 90, textAlignVertical: 'top' },
  dayChip: { width: 56, paddingVertical: 10, borderRadius: 16, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line, alignItems: 'center', gap: 2 },
  dayDow: { fontSize: 11, fontWeight: '700', color: T.ink3, textTransform: 'uppercase' },
  dayNum: { fontSize: 18, fontWeight: '800', color: T.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tBtn: { width: 38, height: 44, borderRadius: 12, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  time: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 18, fontWeight: '800', color: T.ink },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  person: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line },
  personTxt: { fontWeight: '700', color: T.ink, fontSize: 14 },
  taken: { fontSize: 10.5, color: T.accent, fontWeight: '800' },
  go: { flexDirection: 'row', gap: 10, borderRadius: 20, paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  goTxt: { color: '#fff', fontWeight: '800', fontSize: 17 },
});
