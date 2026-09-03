import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Muted, Loading } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Ev {
  id: string; title: string | null; startAt: string; endAt: string; allDay: boolean;
  materialsNote: string | null;
  worksite: { ref: string; title: string; city: string | null };
  vehicle: { plate: string | null; model: string | null } | null;
  assignments: { person: { id: string; displayName: string | null; firstName: string } }[];
}

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export default function Planning() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [items, setItems] = useState<Ev[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const from = weekStart.toISOString();
    const to = new Date(weekStart.getTime() + 7 * 86400000).toISOString();
    try {
      const r = await apiGet<{ items: Ev[] }>(`/api/planning?from=${from}&to=${to}`);
      setItems(r.items);
    } catch {
      /* hors ligne */
    }
  }, [weekStart]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const byDay = useMemo(() => {
    const m: Record<number, Ev[]> = {};
    for (const e of items ?? []) {
      const d = (new Date(e.startAt).getDay() + 6) % 7;
      (m[d] ??= []).push(e);
    }
    return m;
  }, [items]);

  if (!items) return <Loading />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <View style={s.nav}>
        <Pressable style={s.navBtn} onPress={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86400000))}><Text style={s.navTxt}>←</Text></Pressable>
        <Text style={s.week}>
          {weekStart.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })} –{' '}
          {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })}
        </Text>
        <Pressable style={s.navBtn} onPress={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86400000))}><Text style={s.navTxt}>→</Text></Pressable>
      </View>

      {DAYS.map((label, i) => {
        const evs = byDay[i] ?? [];
        const date = new Date(weekStart.getTime() + i * 86400000);
        return (
          <View key={i} style={{ gap: 6 }}>
            <Text style={s.day}>{label} {date.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })}</Text>
            {evs.length === 0 ? <Muted>—</Muted> : evs.map((e) => (
              <Card key={e.id}>
                <Text style={s.ref}>{e.worksite.ref} — {e.title || e.worksite.title}</Text>
                <Muted>
                  {e.allDay ? 'Journée' : `${new Date(e.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}–${new Date(e.endAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`}
                  {e.worksite.city ? ` · ${e.worksite.city}` : ''}
                </Muted>
                <Text style={{ color: T.ink }}>
                  {e.assignments.map((a) => a.person.displayName || a.person.firstName).join(', ') || 'Aucun ouvrier'}
                </Text>
                {(e.vehicle || e.materialsNote) && (
                  <Muted>
                    {[e.vehicle ? `🚐 ${e.vehicle.plate || e.vehicle.model}` : null, e.materialsNote ? `🔧 ${e.materialsNote}` : null].filter(Boolean).join('  ')}
                  </Muted>
                )}
              </Card>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { borderWidth: 1, borderColor: T.line, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: T.surface },
  navTxt: { fontSize: 16, color: T.ink },
  week: { fontWeight: '600', color: T.ink },
  day: { fontSize: 13, fontWeight: '700', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6 },
  ref: { fontWeight: '600', color: T.ink },
});
