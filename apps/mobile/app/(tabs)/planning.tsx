import { useCallback, useMemo, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Card, Muted, Loading, EmptyState } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Ev {
  id: string; title: string | null; startAt: string; endAt: string; allDay: boolean;
  materialsNote: string | null;
  worksite: { ref: string; title: string; city: string | null };
  vehicles: { vehicle: { plate: string | null; model: string | null } }[];
  assignments: { person: { id: string; displayName: string | null; firstName: string } }[];
}

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAY_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export default function Planning() {
  const { user, person } = useSession();
  const mine = user?.role === 'worker';
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [dayIndex, setDayIndex] = useState(() => (new Date().getDay() + 6) % 7);
  const [items, setItems] = useState<Ev[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const from = weekStart.toISOString();
    const to = new Date(weekStart.getTime() + 7 * 86400000).toISOString();
    const personParam = mine && person?.id ? `&personId=${person.id}` : '';
    try {
      const r = await apiGet<{ items: Ev[] }>(`/api/planning?from=${from}&to=${to}${personParam}`);
      setItems(r.items);
    } catch {
      /* hors ligne */
    }
  }, [weekStart, mine, person?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function shiftWeek(delta: number) {
    setWeekStart(new Date(weekStart.getTime() + delta * 7 * 86400000));
  }
  function goToday() {
    setWeekStart(mondayOf(new Date()));
    setDayIndex((new Date().getDay() + 6) % 7);
  }

  const byDay = useMemo(() => {
    const m: Record<number, Ev[]> = {};
    for (const e of items ?? []) {
      const d = (new Date(e.startAt).getDay() + 6) % 7;
      (m[d] ??= []).push(e);
    }
    for (const d of Object.keys(m)) m[+d]!.sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
    return m;
  }, [items]);

  const today = new Date();
  const selectedDate = new Date(weekStart.getTime() + dayIndex * 86400000);
  const dayEvents = byDay[dayIndex] ?? [];

  if (!items) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={s.title}>{mine ? 'Mon planning' : 'Planning'}</Text>
          <Pressable onPress={goToday} style={s.todayBtn}><Text style={s.todayTxt}>Aujourd’hui</Text></Pressable>
        </View>
        <View style={s.nav}>
          <Pressable style={s.navBtn} onPress={() => shiftWeek(-1)}><Feather name="chevron-left" size={18} color={T.ink} /></Pressable>
          <Text style={s.week}>
            {weekStart.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })} –{' '}
            {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })}
          </Text>
          <Pressable style={s.navBtn} onPress={() => shiftWeek(1)}><Feather name="chevron-right" size={18} color={T.ink} /></Pressable>
        </View>
      </View>

      <View style={s.strip}>
        {DAY_SHORT.map((label, i) => {
          const date = new Date(weekStart.getTime() + i * 86400000);
          const isToday = sameDay(date, today);
          const isSelected = i === dayIndex;
          const count = (byDay[i] ?? []).length;
          return (
            <Pressable key={i} style={[s.dayPill, isSelected && s.dayPillActive]} onPress={() => setDayIndex(i)}>
              <Text style={[s.dayPillLabel, isSelected && s.dayPillLabelActive]}>{label}</Text>
              <Text style={[s.dayPillNum, isSelected && s.dayPillLabelActive, isToday && !isSelected && { color: T.primary }]}>{date.getDate()}</Text>
              <View style={[s.dot, count > 0 && (isSelected ? s.dotActive : s.dotOn)]} />
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{ ...T.content, padding: 16, paddingTop: 12, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Text style={s.dayHeading}>{DAY_LONG[dayIndex]} {selectedDate.toLocaleDateString('fr-BE', { day: '2-digit', month: 'long' })}</Text>
        {dayEvents.length === 0 && <EmptyState title="Journée disponible" description="Aucune affectation pour ce jour." icon="calendar"/>}
        {dayEvents.map((e) => (
          <Card key={e.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <Text style={s.ref}>{e.worksite.ref} — {e.title || e.worksite.title}</Text>
              <Text style={s.time}>
                {e.allDay ? 'Journée' : `${new Date(e.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}–${new Date(e.endAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`}
              </Text>
            </View>
            {e.worksite.city && <Muted>{e.worksite.city}</Muted>}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Feather name="users" size={12} color={T.ink2} />
              <Text style={{ color: T.ink, flex: 1 }}>
                {e.assignments.map((a) => a.person.displayName || a.person.firstName).join(', ') || 'Aucun ouvrier'}
              </Text>
            </View>
            {(e.vehicles.length > 0 || e.materialsNote) && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 }}>
                {e.vehicles.length > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Feather name="truck" size={12} color={T.ink2} />
                    <Muted>{e.vehicles.map((v) => v.vehicle.plate || v.vehicle.model).join(', ')}</Muted>
                  </View>
                )}
                {e.materialsNote && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Feather name="tool" size={12} color={T.ink2} />
                    <Muted>{e.materialsNote}</Muted>
                  </View>
                )}
              </View>
            )}
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: T.ink },
  todayBtn: { borderWidth: 1, borderColor: T.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: T.surface },
  todayTxt: { color: T.primary, fontWeight: '700', fontSize: 12.5 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  navBtn: { borderWidth: 1, borderColor: T.line, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: T.surface },
  week: { fontWeight: '600', color: T.ink },
  strip: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 10, gap: 4 },
  dayPill: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 16, gap: 2 },
  dayPillActive: { backgroundColor: T.primary },
  dayPillLabel: { fontSize: 10.5, color: T.ink3, fontWeight: '700', textTransform: 'uppercase' },
  dayPillNum: { fontSize: 18, color: T.ink, fontWeight: '700' },
  dayPillLabelActive: { color: '#fff' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent', marginTop: 2 },
  dotOn: { backgroundColor: T.gold },
  dotActive: { backgroundColor: '#fff' },
  dayHeading: { fontSize: 13, fontWeight: '700', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  ref: { fontSize: 15, lineHeight: 23, fontWeight: '700', color: T.ink, flex: 1 },
  time: { color: T.ink2, fontSize: 12, fontWeight: '600' },
});
