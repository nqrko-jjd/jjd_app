import { useCallback, useMemo, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Card, Muted, Loading, EmptyState } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Ev {
  id: string; title: string | null; startAt: string; endAt: string; allDay: boolean; kind?: string;
  materialsNote: string | null;
  worksite: { id: string; ref: string; title: string; city: string | null };
  vehicles: { vehicle: { plate: string | null; model: string | null } }[];
  assignments: { person: { id: string; displayName: string | null; firstName: string } }[];
}
interface Person { id: string; displayName: string | null; firstName: string; lastName: string | null }
type View_ = 'jour' | 'semaine' | 'mois' | 'equipe' | 'chantiers';

const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAY_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const KIND = {
  intervention: { main: '#3d7fc4', soft: '#e4eef9', ink: '#1f5a96', label: 'Intervention' },
  meeting: { main: '#e0a800', soft: '#fbf1cc', ink: '#7a5c00', label: 'Rendez-vous' },
} as const;
const kindOf = (e: { kind?: string }) => (e.kind === 'meeting' ? KIND.meeting : KIND.intervention);

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const hm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
const name = (p: { displayName: string | null; firstName: string }) => p.displayName || p.firstName;

/** Planning : le même planning que le site, en cinq vues pensées pour le doigt (jour, semaine, mois, par personne, par chantier). */
export default function Planning() {
  const { user, person } = useSession();
  const router = useRouter();
  const mine = user?.role === 'worker';
  const staff = !mine;
  const [view, setView] = useState<View_>('jour');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [items, setItems] = useState<Ev[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // période à charger : la semaine de la date choisie, ou le mois entier (grille de 6 semaines) en vue Mois
  const range = useMemo(() => {
    if (view === 'mois') {
      const first = mondayOf(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
      return { from: first, to: addDays(first, 42) };
    }
    const w = mondayOf(anchor);
    return { from: w, to: addDays(w, 7) };
  }, [view, anchor]);

  const load = useCallback(async () => {
    const personParam = mine && person?.id ? `&personId=${person.id}` : '';
    try {
      const r = await apiGet<{ items: Ev[] }>(`/api/planning?from=${range.from.toISOString()}&to=${range.to.toISOString()}${personParam}`);
      setItems(r.items);
    } catch { /* hors ligne */ }
  }, [range, mine, person?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useFocusEffect(useCallback(() => {
    if (staff) apiGet<{ items: Person[] }>('/api/people?active=1').then((r) => setPeople(r.items)).catch(() => {});
  }, [staff]));

  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of items ?? []) {
      const k = key(new Date(e.startAt));
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    for (const list of m.values()) list.sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
    return m;
  }, [items]);

  const today = startOfDay(new Date());
  const dayEvents = byDay.get(key(anchor)) ?? [];
  const week = mondayOf(anchor);

  function shift(dir: number) {
    if (view === 'mois') setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
    else if (view === 'equipe' || view === 'chantiers') setAnchor(addDays(anchor, dir));
    else setAnchor(addDays(anchor, dir * 7));
  }
  const open = (e: Ev) => router.push((mine ? `/fiche/${e.worksite.id}` : `/chantier/${e.worksite.id}`) as never);

  const title = view === 'mois'
    ? `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
    : view === 'equipe' || view === 'chantiers'
      ? `${DAY_LONG[(anchor.getDay() + 6) % 7]} ${anchor.getDate()} ${MONTHS[anchor.getMonth()].toLowerCase()}`
      : `${week.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })} – ${addDays(week, 6).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })}`;

  const views: [View_, string][] = staff
    ? [['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois'], ['equipe', 'Équipe'], ['chantiers', 'Chantiers']]
    : [['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois']];

  if (!items) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={s.title}>{mine ? 'Mon planning' : 'Planning'}</Text>
          <Pressable accessibilityRole="button" onPress={() => setAnchor(today)} style={s.todayBtn}><Text style={s.todayTxt}>Aujourd’hui</Text></Pressable>
        </View>
        <View style={s.seg}>
          {views.map(([k, label]) => (
            <Pressable key={k} accessibilityRole="button" onPress={() => setView(k)} style={[s.segBtn, view === k && s.segOn]}>
              <Text style={[s.segTxt, view === k && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 2 }}>
          {([KIND.intervention, KIND.meeting] as const).map((k) => (
            <View key={k.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: k.main }} /><Text style={{ fontSize: 12, color: T.ink2, fontWeight: '600' }}>{k.label}</Text></View>
          ))}
        </View>
        <View style={s.nav}>
          <Pressable accessibilityRole="button" accessibilityLabel="Précédent" style={s.navBtn} onPress={() => shift(-1)}><Feather name="chevron-left" size={20} color={T.ink} /></Pressable>
          <Text style={s.week}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Suivant" style={s.navBtn} onPress={() => shift(1)}><Feather name="chevron-right" size={20} color={T.ink} /></Pressable>
        </View>
      </View>

      {view === 'jour' && (
        <View style={s.strip}>
          {DAY_SHORT.map((label, i) => {
            const date = addDays(week, i);
            const sel = sameDay(date, anchor);
            const count = (byDay.get(key(date)) ?? []).length;
            return (
              <Pressable key={i} accessibilityRole="button" style={[s.dayPill, sel && s.dayPillActive]} onPress={() => setAnchor(date)}>
                <Text style={[s.dayPillLabel, sel && { color: '#fff' }]}>{label}</Text>
                <Text style={[s.dayPillNum, sel && { color: '#fff' }, sameDay(date, today) && !sel && { color: T.primary }]}>{date.getDate()}</Text>
                <View style={[s.dot, count > 0 && (sel ? { backgroundColor: '#fff' } : { backgroundColor: T.gold })]} />
              </Pressable>
            );
          })}
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ ...T.content, padding: 16, paddingTop: 12, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {view === 'jour' && (
          <>
            <Text style={s.dayHeading}>{DAY_LONG[(anchor.getDay() + 6) % 7]} {anchor.toLocaleDateString('fr-BE', { day: '2-digit', month: 'long' })}</Text>
            {dayEvents.length === 0 && <EmptyState title="Journée disponible" description="Aucune affectation pour ce jour." icon="calendar" />}
            {dayEvents.map((e) => <EventCard key={e.id} e={e} onPress={() => open(e)} />)}
          </>
        )}

        {view === 'semaine' && DAY_SHORT.map((label, i) => {
          const date = addDays(week, i);
          const list = byDay.get(key(date)) ?? [];
          return (
            <View key={i} style={{ gap: 8 }}>
              <Pressable accessibilityRole="button" onPress={() => { setAnchor(date); setView('jour'); }} style={s.weekHead}>
                <Text style={[s.dayHeading, sameDay(date, today) && { color: T.primary }]}>{DAY_LONG[i]} {date.getDate()} {MONTHS[date.getMonth()].toLowerCase()}</Text>
                <Text style={s.weekCount}>{list.length ? `${list.length} intervention${list.length > 1 ? 's' : ''}` : 'Libre'}</Text>
              </Pressable>
              {list.map((e) => <EventCard key={e.id} e={e} compact onPress={() => open(e)} />)}
            </View>
          );
        })}

        {view === 'mois' && (() => {
          const first = range.from;
          const month = anchor.getMonth();
          return (
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row' }}>{DAY_SHORT.map((d) => <Text key={d} style={s.monthHead}>{d}</Text>)}</View>
              {Array.from({ length: 6 }, (_, w) => (
                <View key={w} style={{ flexDirection: 'row', gap: 3 }}>
                  {Array.from({ length: 7 }, (_, d) => {
                    const date = addDays(first, w * 7 + d);
                    const list = byDay.get(key(date)) ?? [];
                    const out = date.getMonth() !== month;
                    return (
                      <Pressable key={d} accessibilityRole="button" accessibilityLabel={`${date.getDate()} ${MONTHS[date.getMonth()]}, ${list.length} élément${list.length > 1 ? 's' : ''}`}
                        onPress={() => { setAnchor(date); setView('jour'); }}
                        style={[s.cell, out && { opacity: 0.4 }, sameDay(date, today) && s.cellToday]}>
                        <Text style={[s.cellNum, sameDay(date, today) && { color: T.primary }]}>{date.getDate()}</Text>
                        {list.slice(0, 3).map((e) => {
                          const k = kindOf(e);
                          return <View key={e.id} style={[s.bar, { backgroundColor: k.soft, borderLeftColor: k.main }]}><Text style={[s.barTxt, { color: k.ink }]} numberOfLines={1}>{e.worksite.ref.replace('R-', '')}</Text></View>;
                        })}
                        {list.length > 3 && <Text style={s.more}>+{list.length - 3}</Text>}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
              <Muted>Touchez un jour pour voir son détail. Bleu : intervention · jaune : rendez-vous.</Muted>
            </View>
          );
        })()}

        {view === 'equipe' && (() => {
          const perPerson = new Map<string, { p: { id: string; displayName: string | null; firstName: string }; evs: Ev[] }>();
          for (const e of dayEvents) for (const a of e.assignments) {
            const cur = perPerson.get(a.person.id) ?? { p: a.person, evs: [] };
            cur.evs.push(e); perPerson.set(a.person.id, cur);
          }
          const busy = [...perPerson.values()].sort((x, y) => name(x.p).localeCompare(name(y.p)));
          const free = people.filter((p) => !perPerson.has(p.id)).sort((x, y) => name(x).localeCompare(name(y)));
          return (
            <>
              <Text style={s.dayHeading}>{busy.length} au planning · {free.length} libre{free.length > 1 ? 's' : ''}</Text>
              {busy.map(({ p, evs }) => (
                <Card key={p.id}>
                  <Text style={{ fontWeight: '800', color: T.ink, fontSize: 15 }}>{name(p)}</Text>
                  {evs.map((e) => (
                    <Pressable key={e.id} accessibilityRole="button" onPress={() => open(e)} style={s.line}>
                      <Text style={[s.lineTime, { color: kindOf(e).ink }]}>{e.allDay ? 'Jour' : hm(e.startAt)}</Text>
                      <Text style={{ flex: 1, color: T.ink }} numberOfLines={2}>{e.worksite.ref} · {e.title || e.worksite.title}</Text>
                      <Feather name="chevron-right" size={16} color={T.ink3} />
                    </Pressable>
                  ))}
                </Card>
              ))}
              {free.length > 0 && (
                <Card>
                  <Text style={{ fontWeight: '800', color: T.ink2, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4 }}>Libres</Text>
                  <Text style={{ color: T.ink, lineHeight: 22 }}>{free.map(name).join(' · ')}</Text>
                </Card>
              )}
            </>
          );
        })()}

        {view === 'chantiers' && (() => {
          const perWs = new Map<string, { w: Ev['worksite']; evs: Ev[] }>();
          for (const e of dayEvents) {
            const cur = perWs.get(e.worksite.id) ?? { w: e.worksite, evs: [] };
            cur.evs.push(e); perWs.set(e.worksite.id, cur);
          }
          const list = [...perWs.values()].sort((x, y) => x.w.ref.localeCompare(y.w.ref));
          return (
            <>
              <Text style={s.dayHeading}>{list.length} chantier{list.length > 1 ? 's' : ''} actif{list.length > 1 ? 's' : ''} ce jour</Text>
              {list.length === 0 && <EmptyState title="Aucun chantier ce jour" description="Aucune affectation n’est prévue." icon="home" />}
              {list.map(({ w, evs }) => {
                const team = [...new Set(evs.flatMap((e) => e.assignments.map((a) => name(a.person))))];
                return (
                  <Pressable key={w.id} accessibilityRole="button" onPress={() => router.push(`/chantier/${w.id}` as never)} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
                    <Card>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={[s.ref, { flex: 1 }]} numberOfLines={2}>{w.ref} — {w.title}</Text>
                        <Feather name="chevron-right" size={18} color={T.ink3} />
                      </View>
                      {!!w.city && <Muted>{w.city}</Muted>}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather name="users" size={13} color={T.ink2} />
                        <Text style={{ color: T.ink, flex: 1 }}>{team.length ? `${team.length} · ${team.join(', ')}` : 'Aucun ouvrier'}</Text>
                      </View>
                    </Card>
                  </Pressable>
                );
              })}
            </>
          );
        })()}
      </ScrollView>
    </View>
  );
}

function EventCard({ e, onPress, compact }: { e: Ev; onPress: () => void; compact?: boolean }) {
  const k = kindOf(e);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
      <View style={[s.evCard, { borderLeftColor: k.main, backgroundColor: k.soft }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <Text style={s.ref}>{e.worksite.ref} — {e.title || e.worksite.title}</Text>
          <Text style={[s.time, { color: k.ink }]}>{e.allDay ? 'Journée' : `${hm(e.startAt)}–${hm(e.endAt)}`}</Text>
        </View>
        <Text style={[s.kindTag, { color: k.ink }]}>{k.label}</Text>
        {!compact && !!e.worksite.city && <Muted>{e.worksite.city}</Muted>}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <Feather name="users" size={12} color={T.ink2} />
          <Text style={{ color: T.ink, flex: 1 }}>{e.assignments.map((a) => name(a.person)).join(', ') || 'Aucun ouvrier'}</Text>
        </View>
        {!compact && (e.vehicles.length > 0 || e.materialsNote) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 }}>
            {e.vehicles.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="truck" size={12} color={T.ink2} />
                <Muted>{e.vehicles.map((v) => v.vehicle.plate || v.vehicle.model).join(', ')}</Muted>
              </View>
            )}
            {!!e.materialsNote && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="tool" size={12} color={T.ink2} />
                <Muted>{e.materialsNote}</Muted>
              </View>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  evCard: { borderRadius: 18, borderWidth: 1, borderColor: T.line, borderLeftWidth: 6, padding: 14, gap: 4 },
  kindTag: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 28, fontWeight: '800', color: T.ink },
  todayBtn: { borderWidth: 1, borderColor: T.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: T.surface },
  todayTxt: { color: T.primary, fontWeight: '700', fontSize: 13 },
  seg: { flexDirection: 'row', backgroundColor: T.surface2, borderRadius: 14, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  segOn: { backgroundColor: T.primary },
  segTxt: { fontSize: 12.5, fontWeight: '700', color: T.ink2 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { borderWidth: 1, borderColor: T.line, borderRadius: 12, width: 48, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: T.surface },
  week: { fontWeight: '700', color: T.ink, fontSize: 15 },
  strip: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 8, gap: 4 },
  dayPill: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 16, gap: 2 },
  dayPillActive: { backgroundColor: T.primary },
  dayPillLabel: { fontSize: 10.5, color: T.ink3, fontWeight: '700', textTransform: 'uppercase' },
  dayPillNum: { fontSize: 18, color: T.ink, fontWeight: '700' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent', marginTop: 2 },
  dayHeading: { fontSize: 13, fontWeight: '700', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 },
  ref: { fontSize: 15, lineHeight: 23, fontWeight: '700', color: T.ink, flex: 1 },
  time: { color: T.ink2, fontSize: 12, fontWeight: '600' },
  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  weekCount: { fontSize: 12, color: T.ink2, fontWeight: '600' },
  monthHead: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: T.ink3, textTransform: 'uppercase' },
  cell: { flex: 1, minHeight: 92, borderRadius: 10, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, alignItems: 'stretch', padding: 3, gap: 2 },
  bar: { borderLeftWidth: 3, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  barTxt: { fontSize: 9.5, fontWeight: '800' },
  more: { fontSize: 10, fontWeight: '800', color: T.ink2, textAlign: 'center' },
  cellToday: { borderColor: T.primary, borderWidth: 2 },
  cellOn: { backgroundColor: T.primarySoft },
  cellNum: { fontSize: 12.5, fontWeight: '800', color: T.ink, textAlign: 'center' },
  cellBadge: { minWidth: 20, paddingHorizontal: 5, height: 18, borderRadius: 9, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' },
  cellBadgeTxt: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: T.line },
  lineTime: { width: 44, color: T.primary, fontWeight: '800', fontSize: 13 },
});
