import { useCallback, useEffect, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, Redirect, useRouter } from 'expo-router';
import { apiGet, apiSend, flushQueue, pendingCount } from '@/lib/api';
import { currentPosition } from '@/lib/geo';
import { useSession } from '@/lib/session';
import { HeroTile, ScreenHeader, EmptyState } from '@/lib/ui';
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

  // Le magasinier accède aux messages et à son compte, sans écran de pointage.
  if (user?.role === 'storekeeper') return <Redirect href="/plus" />;

  // Bureau pur (sans fiche terrain) -> tableau de bord
  if (user && ['admin', 'office'].includes(user.role) && user.role !== 'foreman') {
    return <Redirect href="/dashboard" />;
  }

  async function start(worksiteId: string) {
    const pos = await currentPosition();
    const r = await apiSend<{ entry: unknown; geoFlag?: boolean; geoDistance?: number; geoInit?: boolean }>('/api/timesheet/timer/start', 'POST', {
      worksiteId,
      startedAt: new Date().toISOString(),
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
    });
    if ('queued' in r) setQueued((q) => q + 1);
    else if (!pos) {
      Alert.alert('Position non transmise', 'Géolocalisation refusée ou indisponible — le pointage n’a pas pu être vérifié.');
    } else if ((r as { geoInit?: boolean }).geoInit) {
      Alert.alert('Point de référence enregistré', 'Aucun point n’était encore fixé pour ce chantier : ta position actuelle vient de le devenir.');
    } else if ((r as { geoFlag?: boolean }).geoFlag) {
      Alert.alert('Pointage hors zone', `Tu es à environ ${(r as { geoDistance?: number }).geoDistance} m du chantier. Le pointage est enregistré mais sera vérifié par le bureau.`);
    }
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
      contentContainerStyle={{ ...T.content, padding: 16, gap: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <ScreenHeader eyebrow="Ma journée" title={`Bonjour ${person?.firstName || person?.displayName?.split(' ')[0] || ''}`} description="Vos chantiers et votre pointage du jour." avatar={(person?.firstName || user?.email || 'J').slice(0,1)}/>
      {queued > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Feather name="clock" size={14} color={T.accent} />
          <Text style={s.queued}>{queued} pointage(s) en attente de réseau</Text>
        </View>
      )}

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
        <HeroTile icon="clock">
          <Text style={s.heroLabel}>Compteur en cours</Text>
          <Text style={s.heroSub}>{running.worksite?.ref} — {running.worksite?.title}</Text>
          <Text style={s.heroBig}>{elapsed(running.startedAt)}</Text>
          <Pressable style={s.stopBtn} onPress={stop}>
            <Text style={[s.btnTxt, { color: '#fff' }]}>Je quitte le chantier</Text>
          </Pressable>
        </HeroTile>
      ) : (
        <HeroTile icon="play">
          <Text style={s.heroLabel}>Arrivé sur chantier ?</Text>
          <Text style={s.heroBig}>0 h 00</Text>
          <Text style={s.heroSub}>Choisis ton chantier pour enregistrer ton arrivée.</Text>
        </HeroTile>
      ))}

      <Text style={s.section}>Mes chantiers du jour</Text>
      {events.length === 0 && <EmptyState title="Aucune affectation aujourd’hui" description="Le planning apparaîtra ici dès sa validation." icon="calendar"/>}
      {events.map((e) => (
        <Pressable key={e.id} style={s.card} onPress={() => router.push(`/fiche/${e.worksite.id}` as never)}>
          <Text style={s.wsRef}>{e.worksite.ref} — {e.worksite.title}</Text>
          {e.worksite.city && <Text style={s.muted}>{e.worksite.city}</Text>}
          <Text style={s.muted}>
            {new Date(e.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })} –{' '}
            {new Date(e.endAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            {linked && !running && (
              <Pressable style={[s.btn, s.btnGold, { flex: 1 }]} onPress={() => start(e.worksite.id)}>
                <Text style={[s.btnTxt, { color: '#241c05' }]}>Je suis arrivé</Text>
              </Pressable>
            )}
            <Pressable style={[s.btn, { backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line }]} onPress={() => router.push(`/fiche/${e.worksite.id}` as never)}>
              <Text style={[s.btnTxt, { color: T.ink }]}>Voir la fiche</Text>
            </Pressable>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  eyebrow: { fontSize: 11.5, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', marginBottom: 4 },
  hi: { fontSize: 22, fontWeight: '800', color: T.ink },
  queued: { color: T.accent, fontWeight: '600' },
  section: { fontSize: 13, fontWeight: '700', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  card: { backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: 16, gap: 6 },
  label: { fontSize: 12, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 },
  wsRef: { lineHeight: 24, fontSize: 17, fontWeight: '600', color: T.ink },
  big: { fontSize: 40, fontWeight: '800', color: T.ink, marginVertical: 4 },
  muted: { color: T.ink2 },
  btn: { backgroundColor: T.primary, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 8 },
  btnGold: { backgroundColor: T.gold },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  heroLabel: { fontSize: 12.5, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  heroBig: { fontSize: 34, fontWeight: '800', color: '#fff', marginVertical: 6, fontVariant: ['tabular-nums'] },
  stopBtn: { backgroundColor: T.crit, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 4 },
});
