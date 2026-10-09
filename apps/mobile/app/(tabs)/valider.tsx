import { useCallback, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, RefreshControl, TextInput, Image } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { apiGet, apiSend, API_URL } from '@/lib/api';
import { Muted, Loading, EmptyState, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr, dateLocale, Alert } from '@/lib/i18n';

interface Pending {
  id: string; date: string | null; hours: number | null; amount: number | null; task: string | null; geoFlag?: boolean;
  person: { displayName: string | null; firstName: string };
  worksite: { ref: string; title: string } | null;
}
interface Proposal {
  key: string; date: string; personId: string; personName: string; photoThumbUrl: string | null; worksiteId: string; worksiteRef: string; worksiteTitle: string;
  slots: { start: string; end: string }[]; hours: number; pauseMinutes: number; state: string; covered?: { hours: number | null; status: string };
}
interface Report {
  id: string; date: string | null; signedAt: string | null; authorName: string | null; workDone: string | null; clientName: string | null; reviewStatus: string | null;
  photos: { id: string }[]; worksite: { ref: string; title: string };
}
type Seg = 'planning' | 'heures' | 'rapports';

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** « À valider » : les heures proposées d'après le planning, les pointages à contrôler et les rapports signés à relire. */
export default function Valider() {
  const [seg, setSeg] = useState<Seg>('planning');
  const [day, setDay] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [props, setProps] = useState<Proposal[]>([]);
  const [hoursOver, setHoursOver] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [needs, setNeeds] = useState<{ id: string; note: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [p, h, r] = await Promise.allSettled([
      apiGet<{ items: Proposal[] }>(`/api/timesheet/planned?date=${dayKey(day)}`),
      apiGet<{ items: Pending[] }>('/api/timesheet/pending'),
      apiGet<{ items: Report[] }>('/api/reports/review-queue'),
    ]);
    if (p.status === 'fulfilled') setProps(p.value.items);
    if (h.status === 'fulfilled') setPending(h.value.items); else setPending((x) => x ?? []);
    if (r.status === 'fulfilled') setReports(r.value.items.filter((x) => !x.reviewStatus));
  }, [day]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = props.filter((p) => p.state === 'open');
  const done = props.filter((p) => p.state !== 'open');
  const name = (p: Pending['person']) => p.displayName || p.firstName;

  async function run(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); await load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message || 'Action impossible' }); } finally { setBusy(null); }
  }
  const item = (p: Proposal) => ({ personId: p.personId, worksiteId: p.worksiteId, date: p.date, hours: hoursOver[p.key] ?? p.hours });
  const validateDay = () => Alert.alert('Valider toute la journée ?', `${open.length} pointage${open.length > 1 ? 's' : ''} aux heures prévues.`, [{ text: 'Annuler', style: 'cancel' }, { text: 'Tout valider', onPress: () => run('day', () => apiSend('/api/timesheet/planned/validate-day', 'POST', { date: dayKey(day) }, false), 'Journée validée.') }]);
  const approveAll = () => Alert.alert('Tout valider ?', `${pending?.filter((x) => !x.geoFlag).length ?? 0} pointage(s) hors alerte de position.`, [{ text: 'Annuler', style: 'cancel' }, { text: 'Tout valider', onPress: () => run('all', () => apiSend('/api/timesheet/entries/approve-all', 'POST', {}, false), 'Pointages validés.') }]);

  if (!pending) return <Loading />;

  const segs: [Seg, string, number][] = [['planning', 'Planning', open.length], ['heures', 'Heures', pending.length], ['rapports', 'Rapports', reports.length]];

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 12 }}>
        <View style={s.seg}>
          {segs.map(([k, label, n]) => (
            <Pressable key={k} accessibilityRole="button" onPress={() => { setSeg(k); setMsg(null); }} style={[s.segBtn, seg === k && s.segOn]}>
              <Text style={[s.segTxt, seg === k && { color: '#fff' }]}>{label}</Text>
              {n > 0 && <View style={[s.count, seg === k && { backgroundColor: 'rgba(255,255,255,0.25)' }]}><Text style={[s.countTxt, seg === k && { color: '#fff' }]}>{n}</Text></View>}
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ ...T.content, padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {msg && <View style={[s.flash, { backgroundColor: msg.ok ? T.okSoft : T.critSoft }]}><Text style={{ color: msg.ok ? T.ok : T.crit, fontWeight: '700', flex: 1 }}>{msg.text}</Text></View>}

        {seg === 'planning' && (
          <>
            <View style={s.nav}>
              <Pressable accessibilityRole="button" accessibilityLabel={tr("Jour précédent")} onPress={() => setDay(addDays(day, -1))} style={s.navBtn}><Feather name="chevron-left" size={20} color={T.ink} /></Pressable>
              <Text style={s.navTitle}>{day.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={tr("Jour suivant")} onPress={() => setDay(addDays(day, 1))} style={s.navBtn}><Feather name="chevron-right" size={20} color={T.ink} /></Pressable>
            </View>
            {open.length > 0 && (
              <Pressable accessibilityRole="button" disabled={busy === 'day'} onPress={validateDay} style={({ pressed }) => [s.big, pressed && { transform: [{ scale: 0.98 }] }, busy === 'day' && { opacity: 0.5 }]}>
                <Feather name="check-circle" size={22} color="#fff" />
                <Text style={s.bigTxt}>Tout valider · {open.length} pointage{open.length > 1 ? 's' : ''}</Text>
              </Pressable>
            )}
            {open.length === 0 && <EmptyState title={props.length ? 'Journée validée' : 'Rien à valider ce jour'} description={props.length ? 'Tous les pointages du planning sont traités.' : 'Aucune intervention au planning ce jour.'} icon="check-circle" />}
            {open.map((p) => {
              const h = hoursOver[p.key] ?? p.hours;
              return (
                <View key={p.key} style={s.card}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    {p.photoThumbUrl ? <Image source={{ uri: p.photoThumbUrl.startsWith('http') ? p.photoThumbUrl : `${API_URL}${p.photoThumbUrl}` }} style={s.avatar} /> : <View style={[s.avatar, s.avatarEmpty]}><Text style={{ fontWeight: '800', color: T.primary }}>{p.personName.slice(0, 1)}</Text></View>}
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={s.name}>{p.personName}</Text>
                      <Muted>{p.worksiteRef} · {p.worksiteTitle}</Muted>
                      <Muted>{p.slots.map((x) => `${x.start}–${x.end}`).join(' · ')}{p.pauseMinutes ? ` · pause ${p.pauseMinutes} min` : ''}</Muted>
                    </View>
                  </View>
                  <View style={s.stepRow}>
                    <Pressable accessibilityRole="button" accessibilityLabel={tr("Moins une demi-heure")} onPress={() => setHoursOver({ ...hoursOver, [p.key]: Math.max(0.5, h - 0.5) })} style={s.step}><Feather name="minus" size={20} color={T.primary} /></Pressable>
                    <Text style={s.hours}>{String(h).replace('.', ',')} h</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={tr("Plus une demi-heure")} onPress={() => setHoursOver({ ...hoursOver, [p.key]: Math.min(16, h + 0.5) })} style={s.step}><Feather name="plus" size={20} color={T.primary} /></Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Pressable accessibilityRole="button" disabled={busy === p.key} onPress={() => run(p.key, () => apiSend('/api/timesheet/planned/validate', 'POST', { items: [item(p)] }, false), `${p.personName} validé.`)} style={[s.ok, busy === p.key && { opacity: 0.5 }]}><Feather name="check" size={18} color="#fff" /><Text style={s.okTxt}>Valider</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy === p.key} onPress={() => run(p.key, () => apiSend('/api/timesheet/planned/dismiss', 'POST', { items: [{ personId: p.personId, worksiteId: p.worksiteId, date: p.date }] }, false), `${p.personName} : n’a pas travaillé.`)} style={[s.no, busy === p.key && { opacity: 0.5 }]}><Text style={s.noTxt}>N’a pas travaillé</Text></Pressable>
                  </View>
                </View>
              );
            })}
            {done.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={s.sub}>Déjà traités</Text>
                {done.map((p) => <Muted key={p.key}>✓ {p.personName} · {p.worksiteRef}{p.covered ? ` · ${p.covered.hours ?? 0} h (${p.covered.status === 'rejected' ? 'refusé' : 'validé'})` : ''}</Muted>)}
              </View>
            )}
          </>
        )}

        {seg === 'heures' && (
          <>
            {pending.length === 0 && <EmptyState title={tr("Rien à valider")} description={tr("Tous les pointages sont traités.")} icon="check-circle" />}
            {pending.filter((x) => !x.geoFlag).length > 1 && (
              <Pressable accessibilityRole="button" disabled={busy === 'all'} onPress={approveAll} style={({ pressed }) => [s.big, pressed && { transform: [{ scale: 0.98 }] }, busy === 'all' && { opacity: 0.5 }]}>
                <Feather name="check-circle" size={22} color="#fff" /><Text style={s.bigTxt}>Tout valider</Text>
              </Pressable>
            )}
            {pending.map((e) => (
              <View key={e.id} style={[s.card, e.geoFlag && { borderColor: T.accent, borderWidth: 1.5 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={s.name}>{name(e.person)}</Text><Muted>{dateBE(e.date)}</Muted></View>
                {e.worksite && <Muted>{e.worksite.ref} — {e.worksite.title}</Muted>}
                <Text style={{ color: T.ink, fontWeight: '700' }}>{e.hours ?? 0} h{e.amount != null ? ` · ${eur(e.amount)}` : ''}{e.task ? ` · ${e.task}` : ''}</Text>
                {e.geoFlag && <Text style={{ color: T.accent, fontWeight: '700', fontSize: 12.5 }}>Pointé hors de la zone du chantier</Text>}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable accessibilityRole="button" disabled={busy === e.id} onPress={() => run(e.id, () => apiSend(`/api/timesheet/entries/${e.id}/approve`, 'POST', undefined, false), 'Pointage validé.')} style={[s.ok, busy === e.id && { opacity: 0.5 }]}><Feather name="check" size={18} color="#fff" /><Text style={s.okTxt}>Valider</Text></Pressable>
                  <Pressable accessibilityRole="button" disabled={busy === e.id} onPress={() => run(e.id, () => apiSend(`/api/timesheet/entries/${e.id}/reject`, 'POST', undefined, false), 'Pointage refusé.')} style={[s.no, busy === e.id && { opacity: 0.5 }]}><Text style={s.noTxt}>Refuser</Text></Pressable>
                </View>
              </View>
            ))}
          </>
        )}

        {seg === 'rapports' && (
          <>
            {reports.length === 0 && <EmptyState title={tr("Aucun rapport à relire")} description={tr("Les rapports signés par les équipes apparaîtront ici.")} icon="file-text" />}
            {reports.map((r) => (
              <View key={r.id} style={s.card}>
                <Text style={s.name}>{r.worksite.ref} · {r.worksite.title}</Text>
                <Muted>{[r.authorName, dateBE(r.signedAt ?? r.date), r.clientName && `signé par ${r.clientName}`, r.photos.length ? `${r.photos.length} photo${r.photos.length > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ')}</Muted>
                {!!r.workDone && <Text style={{ color: T.ink }} numberOfLines={5}>{r.workDone}</Text>}
                {needs?.id === r.id ? (
                  <View style={{ gap: 8 }}>
                    <TextInput value={needs.note} onChangeText={(t) => setNeeds({ id: r.id, note: t })} placeholder={tr("Ce qu’il faut compléter…")} placeholderTextColor={T.ink3} multiline style={s.note} autoFocus />
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Pressable accessibilityRole="button" disabled={!needs.note.trim() || busy === r.id} onPress={() => run(r.id, async () => { await apiSend(`/api/reports/${r.id}/review`, 'POST', { decision: 'needs_info', note: needs.note }, false); setNeeds(null); }, 'Complément demandé.')} style={[s.ok, { backgroundColor: T.accent }, !needs.note.trim() && { opacity: 0.45 }]}><Text style={s.okTxt}>Envoyer</Text></Pressable>
                      <Pressable accessibilityRole="button" onPress={() => setNeeds(null)} style={s.no}><Text style={s.noTxt}>Annuler</Text></Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Pressable accessibilityRole="button" disabled={busy === r.id} onPress={() => run(r.id, () => apiSend(`/api/reports/${r.id}/review`, 'POST', { decision: 'approved' }, false), 'Rapport validé.')} style={[s.ok, busy === r.id && { opacity: 0.5 }]}><Feather name="check" size={18} color="#fff" /><Text style={s.okTxt}>Valider</Text></Pressable>
                    <Pressable accessibilityRole="button" onPress={() => setNeeds({ id: r.id, note: '' })} style={s.no}><Text style={s.noTxt}>À compléter</Text></Pressable>
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: T.ink },
  seg: { flexDirection: 'row', backgroundColor: T.surface2, borderRadius: 14, padding: 3 },
  segBtn: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 11, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: T.primary },
  segTxt: { fontWeight: '700', color: T.ink2 },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: T.goldSoft, alignItems: 'center', justifyContent: 'center' },
  countTxt: { fontSize: 11.5, fontWeight: '800', color: T.accent },
  flash: { flexDirection: 'row', borderRadius: 16, padding: 14 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 48, height: 40, borderRadius: 12, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center' },
  navTitle: { fontWeight: '700', color: T.ink, fontSize: 15, textTransform: 'capitalize' },
  big: { flexDirection: 'row', gap: 10, backgroundColor: T.primary, borderRadius: 20, paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  bigTxt: { color: '#fff', fontWeight: '800', fontSize: 16.5 },
  card: { ...T.shadow, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 20, padding: 14, gap: 10 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: T.surface2 },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: T.primarySoft },
  name: { fontSize: 15.5, fontWeight: '800', color: T.ink },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  step: { width: 48, height: 48, borderRadius: 16, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  hours: { fontSize: 26, fontWeight: '800', color: T.ink, minWidth: 90, textAlign: 'center' },
  ok: { flex: 1.2, flexDirection: 'row', gap: 6, backgroundColor: T.primary, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  okTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  no: { flex: 1, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  noTxt: { color: T.crit, fontWeight: '800', fontSize: 14 },
  sub: { fontSize: 12.5, fontWeight: '700', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 },
  note: { minHeight: 80, borderRadius: 14, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, padding: 12, fontSize: 15, color: T.ink, textAlignVertical: 'top' },
});
