import { useCallback, useEffect, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, RefreshControl, Linking } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, Redirect, useRouter } from 'expo-router';
import { apiGet, apiSend, flushQueue, pendingCount } from '@/lib/api';
import { currentPosition } from '@/lib/geo';
import { useSession } from '@/lib/session';
import { HeroTile, ScreenHeader, EmptyState } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr, dateLocale, Alert } from '@/lib/i18n';
import { DayWrapUp } from '@/lib/DayWrapUp';

interface Ev {
  id: string;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  title?: string | null;
  worksite: { id: string; ref: string; title: string; city: string | null; address?: string | null; postalCode?: string | null };
}
interface Running {
  id: string;
  startedAt: string;
  worksiteId?: string | null;
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

/** L'accueil terrain (ouvrier, chef de chantier) — réutilisé tel quel, en vue « Terrain », par la direction et le bureau. */
export function FieldHome({ embedded = false }: { embedded?: boolean }) {
  const { person, user } = useSession();
  const router = useRouter();
  const [events, setEvents] = useState<Ev[]>([]);
  const [running, setRunning] = useState<Running | null>(null);
  const [wrapUp, setWrapUp] = useState<{ id: string; ref: string; title: string } | null>(null);
  const [linked, setLinked] = useState(true);
  const [queued, setQueued] = useState(0);
  const [weekHours, setWeekHours] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const lead = user?.role === 'foreman' || user?.role === 'admin' || user?.role === 'office';
  const [toValidate, setToValidate] = useState<{ plan: number; hours: number; reports: number } | null>(null);
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
      // heures de la semaine et messages non lus : deux cases cliquables sous le compteur
      const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
      const sunday = new Date(monday.getTime() + 7 * 86400000);
      const [mine, un] = await Promise.allSettled([
        apiGet<{ items: { hours: number | null; status: string }[] }>(`/api/timesheet/mine?from=${monday.toISOString()}&to=${sunday.toISOString()}`),
        apiGet<{ internal: number }>('/api/messagerie/unread-count'),
      ]);
      if (mine.status === 'fulfilled') setWeekHours(mine.value.items.filter((e) => e.status !== 'rejected').reduce((t, e) => t + (e.hours ?? 0), 0));
      if (un.status === 'fulfilled') setUnread(un.value.internal);
      if (user?.role === 'foreman' || user?.role === 'admin' || user?.role === 'office') {
        const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const [pl, hr, rp] = await Promise.allSettled([
          apiGet<{ items: { state: string }[] }>(`/api/timesheet/planned?date=${key}`),
          apiGet<{ items: unknown[] }>('/api/timesheet/pending'),
          apiGet<{ items: { reviewStatus: string | null }[] }>('/api/reports/review-queue'),
        ]);
        setToValidate({
          plan: pl.status === 'fulfilled' ? pl.value.items.filter((p) => p.state === 'open').length : 0,
          hours: hr.status === 'fulfilled' ? hr.value.items.length : 0,
          reports: rp.status === 'fulfilled' ? rp.value.items.filter((r) => !r.reviewStatus).length : 0,
        });
      }
    } catch {
      /* hors ligne : on garde l'état courant */
    }
  }, [person, user?.role]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(i);
  }, []);

  // Le magasinier accède aux messages et à son compte, sans écran de pointage.
  if (user?.role === 'storekeeper') return <Redirect href="/magasin" />;

  // Bureau pur (sans fiche terrain) -> tableau de bord
  if (!embedded && user && ['admin', 'office'].includes(user.role) && user.role !== 'foreman') {
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
    const leaving = running;
    const r = await apiSend<{ entry: unknown }>('/api/timesheet/timer/stop', 'POST', {
      endedAt: new Date().toISOString(),
    });
    if ('queued' in r) setQueued((q) => q + 1);
    setRunning(null);
    await load();
    // fin de journée : on PROPOSE un mot et des photos pour le fil du chantier (facultatif, pas de rapport à remplir)
    if (leaving?.worksiteId && leaving.worksite) setWrapUp({ id: leaving.worksiteId, ref: leaving.worksite.ref, title: leaving.worksite.title });
  }

  const hm = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  // le prochain chantier : celui qui n'est pas encore terminé, sinon le premier de la journée
  const nowMs = Date.now();
  const next = events.find((e) => new Date(e.endAt).getTime() > nowMs) ?? events[0] ?? null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ ...T.content, padding: 16, gap: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <ScreenHeader eyebrow="Ma journée" title={`Bonjour ${person?.firstName || person?.displayName?.split(' ')[0] || ''}`} description={tr("Vos chantiers et votre pointage du jour.")} avatar={(person?.firstName || user?.email || 'J').slice(0,1)}/>
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
          <Pressable accessibilityRole="button" style={({ pressed }) => [s.stopBtn, pressed && { opacity: 0.85 }]} onPress={() => Alert.alert('Quitter le chantier ?', 'Ton temps de présence sera enregistré.', [{ text: 'Rester', style: 'cancel' }, { text: 'Je quitte', style: 'destructive', onPress: stop }])}>
            <Text style={[s.btnTxt, { color: '#fff', fontSize: 17 }]}>Je quitte le chantier</Text>
          </Pressable>
        </HeroTile>
      ) : next ? (
        <HeroTile icon="play">
          <Text style={s.heroLabel}>Prochain chantier</Text>
          <Text style={[s.heroSub, { fontSize: 16, fontWeight: '700', color: '#fff' }]}>{next.worksite.ref} — {next.title || next.worksite.title}</Text>
          <Text style={s.heroSub}>{next.allDay ? 'Toute la journée' : hm(next.startAt) + ' – ' + hm(next.endAt)}{next.worksite.city ? ' · ' + next.worksite.city : ''}</Text>
          <Pressable accessibilityRole="button" style={({ pressed }) => [s.arriveBtn, pressed && { transform: [{ scale: 0.98 }] }]} onPress={() => start(next.worksite.id)}>
            <Feather name="play" size={20} color="#241c05" />
            <Text style={s.arriveTxt}>Je suis arrivé</Text>
          </Pressable>
        </HeroTile>
      ) : (
        <HeroTile icon="coffee">
          <Text style={s.heroLabel}>Aujourd’hui</Text>
          <Text style={s.heroBig}>Pas de chantier prévu</Text>
          <Text style={s.heroSub}>Le planning apparaîtra ici dès sa validation.</Text>
        </HeroTile>
      ))}

      <View style={s.tiles}>
        {lead && toValidate && (() => {
          const n = toValidate.plan + toValidate.hours + toValidate.reports;
          return (
            <Pressable accessibilityRole="button" accessibilityLabel={tr("À valider")} onPress={() => router.push('/valider' as never)} style={({ pressed }) => [s.tile, n > 0 && s.tileAlert, pressed && { transform: [{ scale: 0.97 }] }]}>
              <View style={[s.tileIc, n > 0 && { backgroundColor: T.kpiWarnIconBg }]}><Feather name="check-square" size={18} color={n > 0 ? T.kpiWarnFg : T.primary} /></View>
              <Text style={[s.tileLabel, n > 0 && { color: T.kpiWarnFg }]}>À valider</Text>
              <Text style={[s.tileValue, n > 0 && { color: T.kpiWarnFg }]}>{n > 0 ? `${n} à traiter` : 'Tout est validé'}</Text>
              {n > 0 && <Text style={{ fontSize: 11.5, color: T.kpiWarnFg }}>{[toValidate.plan && `${toValidate.plan} d’après le planning`, toValidate.hours && `${toValidate.hours} heures`, toValidate.reports && `${toValidate.reports} rapport${toValidate.reports > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</Text>}
            </Pressable>
          );
        })()}
        {lead && (
          <Pressable accessibilityRole="button" accessibilityLabel={tr("Nouvelle dépense")} onPress={() => router.push('/depense/nouvelle' as never)} style={({ pressed }) => [s.tile, pressed && { transform: [{ scale: 0.97 }] }]}>
            <View style={s.tileIc}><Feather name="camera" size={18} color={T.primary} /></View>
            <Text style={s.tileLabel}>Nouvelle dépense</Text>
            <Text style={s.tileValue}>Scanner un ticket</Text>
          </Pressable>
        )}
        {lead && (
          <Pressable accessibilityRole="button" accessibilityLabel={tr("Mon équipe")} onPress={() => router.push('/planning' as never)} style={({ pressed }) => [s.tile, pressed && { transform: [{ scale: 0.97 }] }]}>
            <View style={s.tileIc}><Feather name="users" size={18} color={T.primary} /></View>
            <Text style={s.tileLabel}>Mon équipe aujourd’hui</Text>
            <Text style={s.tileValue}>{new Set(events.flatMap((e) => (e as unknown as { assignments?: { person: { id: string } }[] }).assignments?.map((a) => a.person.id) ?? [])).size} personnes</Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={tr("Mes heures")} onPress={() => router.push('/heures' as never)} style={({ pressed }) => [s.tile, pressed && { transform: [{ scale: 0.97 }] }]}>
          <View style={s.tileIc}><Feather name="clock" size={18} color={T.primary} /></View>
          <Text style={s.tileLabel}>Mes heures · semaine</Text>
          <Text style={s.tileValue}>{weekHours == null ? '…' : Math.round(weekHours * 10) / 10 + ' h'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Messages" onPress={() => router.push('/messages' as never)} style={({ pressed }) => [s.tile, unread > 0 && s.tileAlert, pressed && { transform: [{ scale: 0.97 }] }]}>
          <View style={[s.tileIc, unread > 0 && { backgroundColor: T.kpiWarnIconBg }]}><Feather name="message-circle" size={18} color={unread > 0 ? T.kpiWarnFg : T.primary} /></View>
          <Text style={[s.tileLabel, unread > 0 && { color: T.kpiWarnFg }]}>Messages</Text>
          <Text style={[s.tileValue, unread > 0 && { color: T.kpiWarnFg }]}>{unread > 0 ? unread + ' non lu' + (unread > 1 ? 's' : '') : 'À jour'}</Text>
        </Pressable>
      </View>

      <Text style={s.section}>Mes chantiers du jour</Text>
      {events.length === 0 && <EmptyState title={tr("Aucune affectation aujourd’hui")} description={tr("Le planning apparaîtra ici dès sa validation.")} icon="calendar"/>}
      {events.map((e) => {
        const addr = [e.worksite.address, e.worksite.postalCode, e.worksite.city].filter(Boolean).join(' ');
        return (
          <View key={e.id} style={s.card}>
            <Pressable accessibilityRole="button" onPress={() => router.push(`/fiche/${e.worksite.id}` as never)} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={s.timeChip}><Text style={s.timeChipTxt}>{e.allDay ? 'Jour' : hm(e.startAt)}</Text></View>
                <Text style={[s.wsRef, { flex: 1 }]} numberOfLines={2}>{e.worksite.ref} — {e.title || e.worksite.title}</Text>
                <Feather name="chevron-right" size={20} color={T.ink3} />
              </View>
              {!!addr && <Text style={s.muted} numberOfLines={2}>{addr}</Text>}
            </Pressable>
            <View style={s.actionsRow}>
              {!!addr && (
                <Pressable accessibilityRole="button" accessibilityLabel={tr("Itinéraire")} style={({ pressed }) => [s.round, pressed && { opacity: 0.8 }]} onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`)}>
                  <Feather name="navigation" size={20} color={T.primary} /><Text style={s.roundTxt}>Itinéraire</Text>
                </Pressable>
              )}
              <Pressable accessibilityRole="button" accessibilityLabel="Photo" style={({ pressed }) => [s.round, pressed && { opacity: 0.8 }]} onPress={() => router.push(`/photos/${e.worksite.id}?camera=1` as never)}>
                <Feather name="camera" size={20} color={T.primary} /><Text style={s.roundTxt}>Photo</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={tr("Tâches")} style={({ pressed }) => [s.round, pressed && { opacity: 0.8 }]} onPress={() => router.push(`/fiche/${e.worksite.id}` as never)}>
                <Feather name="check-square" size={20} color={T.primary} /><Text style={s.roundTxt}>Tâches</Text>
              </Pressable>
              {linked && !running && (
                <Pressable accessibilityRole="button" accessibilityLabel={tr("Je suis arrivé")} style={({ pressed }) => [s.round, s.roundGold, pressed && { opacity: 0.85 }]} onPress={() => start(e.worksite.id)}>
                  <Feather name="play" size={20} color="#241c05" /><Text style={[s.roundTxt, { color: '#241c05' }]}>Arrivé</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
      <DayWrapUp worksite={wrapUp} onClose={() => setWrapUp(null)} />
    </ScrollView>
  );
}

export default function Today() {
  return <FieldHome />;
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
  stopBtn: { backgroundColor: T.crit, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  arriveBtn: { flexDirection: 'row', gap: 10, backgroundColor: T.gold, borderRadius: 16, paddingVertical: 17, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  arriveTxt: { color: '#241c05', fontWeight: '800', fontSize: 18 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { ...T.shadow, flexGrow: 1, flexBasis: 150, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 20, padding: 14, gap: 6 },
  tileAlert: { backgroundColor: T.kpiWarnBg, borderColor: T.kpiWarnBorder },
  tileIc: { width: 36, height: 36, borderRadius: 11, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 12, color: T.ink2, fontWeight: '600' },
  tileValue: { fontSize: 19, fontWeight: '800', color: T.ink },
  timeChip: { minWidth: 52, paddingVertical: 7, borderRadius: 12, backgroundColor: T.primarySoft, alignItems: 'center' },
  timeChipTxt: { color: T.primary, fontWeight: '800', fontSize: 13 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  round: { flex: 1, minHeight: 62, borderRadius: 16, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center', gap: 4 },
  roundGold: { backgroundColor: T.gold, borderColor: T.gold },
  roundTxt: { fontSize: 11.5, fontWeight: '700', color: T.primary },
});
