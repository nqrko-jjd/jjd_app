import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect, Redirect, useRouter } from 'expo-router';
import { apiGet, apiSend, flushQueue, pendingCount } from '@/lib/api';
import { useSession } from '@/lib/session';
import { T } from '@/lib/theme';

interface Ev {
  id: string;
  startAt: string;
  endAt: string;
  worksite: { id: string; ref: string; title: string; city: string | null };
}
interface Running {
  id: string;
  startedAt: string;
  worksite: { ref: string; title: string } | null;
}
interface TimerResp {
  running: Running | null;
  linked?: boolean;
}

function elapsed(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export default function Today() {
  const { person, user } = useSession();
  const router = useRouter();
  const [events, setEvents] = useState<Ev[]>([]);
  const [running, setRunning] = useState<Running | null>(null);
  const [linked, setLinked] = useState(true);
  const [queued, setQueued] = useState(0);
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    await flushQueue();
    setQueued(await pendingCount());
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
    try {
      const [plan, timer] = await Promise.all([
        apiGet<{ items: Ev[] }>(`/api/planning?from=${from}&to=${to}${person ? `&personId=${person.id}` : ''}`),
        apiGet<TimerResp>('/api/timesheet/timer'),
      ]);
      setEvents(plan.items);
      setRunning(timer.running);
      setLinked(timer.linked !== false);
    } catch {
      /* hors ligne : on garde l'état courant */
    }
  }, [person]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(i);
  }, []);

  // Bureau pur (sans fiche terrain) -> tableau de bord
  if (user && ['admin', 'office'].includes(user.role) && user.role !== 'foreman') {
    return <Redirect href="/dashboard" />;
  }

  async function start(worksiteId: string) {
    const r = await apiSend<{ entry: unknown }>('/api/timesheet/timer/start', 'POST', {
      worksiteId,
      startedAt: new Date().toISOString(),
    });
    if ('queued' in r) setQueued((q) => q + 1);
    await load();
  }
  async function stop() {
    const r = await apiSend<{ entry: unknown }>('/api/timesheet/timer/stop', 'POST', {
      endedAt: new Date().toISOString(),
    });
    if ('queued' in r) setQueued((q) => q + 1);
    setRunning(null);
    await load();
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ padding: 16, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Text style={s.hi}>Bonjour {person?.displayName || person?.firstName || ''}</Text>
      {queued > 0 && <Text style={s.queued}>⏳ {queued} pointage(s) en attente de réseau</Text>}

      {!linked && (
        <View style={[s.card, { borderColor: T.accent, borderWidth: 2 }]}>
          <Text style={s.label}>Compte non lié</Text>
          <Text style={s.muted}>
            Ton compte n’est pas encore rattaché à ta fiche ouvrier. Le bureau doit le faire
            (fiche Équipe → « Lier à un compte »). En attendant, tu ne peux pas pointer.
          </Text>
        </View>
      )}

      {linked && (running ? (
        <View style={[s.card, { borderColor: T.ok, borderWidth: 2 }]}>
          <Text style={s.label}>Compteur en cours</Text>
          <Text style={s.wsRef}>{running.worksite?.ref} — {running.worksite?.title}</Text>
          <Text style={s.big}>{elapsed(running.startedAt)}</Text>
          <Pressable style={[s.btn, { backgroundColor: T.crit }]} onPress={stop}>
            <Text style={s.btnTxt}>Arrêter</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.label}>Aucun compteur actif</Text>
          <Text style={s.muted}>Choisis un chantier ci-dessous pour démarrer.</Text>
        </View>
      ))}

      <Text style={s.section}>Mes chantiers du jour</Text>
      {events.length === 0 && <Text style={s.muted}>Rien de planifié aujourd’hui.</Text>}
      {events.map((e) => (
        <View key={e.id} style={s.card}>
          <Text style={s.wsRef}>{e.worksite.ref} — {e.worksite.title}</Text>
          {e.worksite.city && <Text style={s.muted}>{e.worksite.city}</Text>}
          <Text style={s.muted}>
            {new Date(e.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })} –{' '}
            {new Date(e.endAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            {linked && !running && (
              <Pressable style={[s.btn, { flex: 1 }]} onPress={() => start(e.worksite.id)}>
                <Text style={s.btnTxt}>Démarrer le compteur</Text>
              </Pressable>
            )}
            <Pressable style={[s.btn, { backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line }]} onPress={() => router.push(`/fil/${e.worksite.id}` as never)}>
              <Text style={[s.btnTxt, { color: T.ink }]}>💬 Fil</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  hi: { fontSize: 20, fontWeight: '700', color: T.ink },
  queued: { color: T.accent, fontWeight: '600' },
  section: { fontSize: 13, fontWeight: '700', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  card: { backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: 16, gap: 6 },
  label: { fontSize: 12, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 },
  wsRef: { fontSize: 16, fontWeight: '600', color: T.ink },
  big: { fontSize: 40, fontWeight: '800', color: T.ink, marginVertical: 4 },
  muted: { color: T.ink2 },
  btn: { backgroundColor: T.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
