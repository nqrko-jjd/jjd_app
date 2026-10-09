import { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl, TextInput } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { apiGet, apiSend } from '@/lib/api';
import { Muted, Loading, EmptyState } from '@/lib/ui';
import { MailView, type MailAttachment } from '@/lib/MailView';
import { WorksitePick, type Ws } from '@/lib/WorksitePick';
import { T } from '@/lib/theme';
import { tr, dateLocale, Alert } from '@/lib/i18n';

type Kind = 'lead' | 'appointment' | 'worksite_note' | 'payment_reminder' | 'other';
interface Sug {
  id: string; kind: Kind; subject: string | null; fromAddress: string | null; receivedAt: string | null; summary: string | null; status: string;
  extracted: { urgent?: boolean; proposedDate?: string | null; requesterName?: string | null; requesterPhone?: string | null; problemType?: string | null } | null;
  worksite: { id: string; ref: string; title: string } | null;
}
interface Source { subject: string; from: string; to: string; receivedAt: string | null; text: string; html: string | null; attachments: { index: number; filename: string; contentType: string; size: number }[] }

const KIND: Record<Kind, string> = { lead: 'Nouvelle demande', appointment: 'Rendez-vous', worksite_note: 'Note chantier', payment_reminder: 'Paiement', other: 'Autre' };
const TABS: [Kind | '', string][] = [['', 'Tous'], ['lead', 'Demandes'], ['appointment', 'RDV'], ['worksite_note', 'Notes'], ['payment_reminder', 'Paiements'], ['other', 'Autre']];
const dayLabel = (d: Date) => d.toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric' });
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Boîte IA sur téléphone : les mails qui demandent une action, à traiter d'un geste. Rien n'est créé sans ta validation. */
export default function BoiteIa() {
  const [kind, setKind] = useState<Kind | ''>('');
  const [items, setItems] = useState<Sug[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<'mail' | 'act'>('act');
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setItems((await apiGet<{ items: Sug[] }>(`/api/mail-suggestions?status=pending${kind ? `&kind=${kind}` : ''}`)).items); } catch { setItems((x) => x ?? []); }
  }, [kind]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function applyIt(s: Sug, body: Record<string, unknown>, ok: string) {
    try { await apiSend(`/api/mail-suggestions/${s.id}/apply`, 'POST', body, false); setOpenId(null); setFlash({ ok: true, text: ok }); await load(); }
    catch (e) { setFlash({ ok: false, text: (e as Error).message || 'Échec' }); }
  }
  const dismiss = (s: Sug) => Alert.alert('Rejeter cette suggestion ?', 'Rien ne sera créé.', [{ text: 'Annuler', style: 'cancel' }, { text: 'Rejeter', style: 'destructive', onPress: async () => { try { await apiSend(`/api/mail-suggestions/${s.id}`, 'PATCH', { status: 'dismissed' }, false); await load(); } catch (e) { setFlash({ ok: false, text: (e as Error).message }); } } }]);

  if (!items) return <Loading />;
  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <Stack.Screen options={{ title: tr('Boîte IA'), headerBackTitle: tr('Retour') }} />
      <View style={{ paddingTop: 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {TABS.map(([k, label]) => <Pressable key={label} accessibilityRole="button" onPress={() => { setKind(k); setItems(null); }} style={[s.chip, kind === k && s.chipOn]}><Text style={[s.chipTxt, kind === k && { color: '#fff' }]}>{label}</Text></Pressable>)}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={{ ...T.content, padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {flash && <View style={[s.flash, { backgroundColor: flash.ok ? T.okSoft : T.critSoft }]}><Text style={{ color: flash.ok ? T.ok : T.crit, fontWeight: '700', flex: 1 }}>{flash.text}</Text></View>}
        {items.length === 0 && <EmptyState title={tr("Rien à traiter")} description={tr("Les mails qui demandent une action apparaîtront ici.")} icon="inbox" />}
        {items.map((sg) => (
          <View key={sg.id} style={s.card}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <View style={s.badge}><Text style={s.badgeTxt}>{KIND[sg.kind]}</Text></View>
              {sg.extracted?.urgent && <View style={[s.badge, { backgroundColor: T.critSoft }]}><Text style={[s.badgeTxt, { color: T.crit }]}>Urgent</Text></View>}
              {sg.worksite && <View style={[s.badge, { backgroundColor: T.okSoft }]}><Text style={s.badgeTxt}>{sg.worksite.ref}</Text></View>}
            </View>
            <Text style={s.summary}>{sg.summary ?? sg.subject ?? '(sans résumé)'}</Text>
            <Muted numberOfLines={2}>{(sg.fromAddress ?? '—').replace(/<.*>/, '').trim()} · {sg.receivedAt ? new Date(sg.receivedAt).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' }) : ''}{sg.subject ? ` · ${sg.subject}` : ''}</Muted>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable accessibilityRole="button" onPress={() => { setOpenId(openId === sg.id && mode === 'mail' ? null : sg.id); setMode('mail'); }} style={s.sec}><Feather name="mail" size={16} color={T.primary} /><Text style={s.secTxt}>Le mail</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => { setOpenId(openId === sg.id && mode === 'act' ? null : sg.id); setMode('act'); }} style={s.main}><Feather name="check" size={16} color="#fff" /><Text style={s.mainTxt}>Traiter</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={tr("Rejeter")} onPress={() => dismiss(sg)} style={s.rej}><Feather name="x" size={18} color={T.crit} /></Pressable>
            </View>
            {openId === sg.id && mode === 'mail' && <MailBox id={sg.id} />}
            {openId === sg.id && mode === 'act' && <Act sg={sg} onApply={(b, ok) => applyIt(sg, b, ok)} />}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function MailBox({ id }: { id: string }) {
  const [m, setM] = useState<Source | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { apiGet<Source>(`/api/mail-suggestions/${id}/source`).then(setM).catch((e) => setErr((e as Error).message)); }, [id]));
  if (err) return <Text style={{ color: T.crit }}>{err}</Text>;
  if (!m) return <Muted>Chargement du mail…</Muted>;
  const atts: MailAttachment[] = m.attachments.map((a) => ({ name: a.filename, size: a.size, type: a.contentType, path: `/api/mail-suggestions/${id}/attachment/${a.index}` }));
  return <MailView subject={m.subject} from={m.from} to={m.to} date={m.receivedAt} html={m.html} text={m.text} attachments={atts} />;
}

/** Le panneau « Traiter » : dépend du type de suggestion, toujours sans clavier superflu. */
function Act({ sg, onApply }: { sg: Sug; onApply: (b: Record<string, unknown>, ok: string) => void }) {
  const [ws, setWs] = useState<Ws | null>(null);
  const initial = sg.worksite ? { id: sg.worksite.id, name: `${sg.worksite.ref} · ${sg.worksite.title}` } : null;
  const wsId = ws?.id ?? initial?.id ?? '';
  const [note, setNote] = useState(sg.summary ?? '');
  const [newR, setNewR] = useState(!sg.worksite);
  const [asIv, setAsIv] = useState(false);
  const [dayIdx, setDayIdx] = useState(1);
  const [start, setStart] = useState(8 * 60 + 30);
  const [end, setEnd] = useState(17 * 60);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; });
  const when = (min: number) => { const d = new Date(days[dayIdx]!); d.setHours(Math.floor(min / 60), min % 60, 0, 0); return d.toISOString(); };
  const stepper = (label: string, v: number, set: (n: number) => void) => (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={s.lbl}>{label}</Text>
      <View style={s.timeRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} moins`} onPress={() => set(Math.max(0, v - 30))} style={s.tBtn}><Feather name="minus" size={18} color={T.primary} /></Pressable>
        <Text style={s.time}>{hhmm(v)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} plus`} onPress={() => set(Math.min(23 * 60 + 30, v + 30))} style={s.tBtn}><Feather name="plus" size={18} color={T.primary} /></Pressable>
      </View>
    </View>
  );
  const dayPicker = (
    <View style={{ gap: 8 }}>
      <Text style={s.lbl}>Jour</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {days.map((d, i) => <Pressable key={i} accessibilityRole="button" onPress={() => setDayIdx(i)} style={[s.chip, dayIdx === i && s.chipOn]}><Text style={[s.chipTxt, dayIdx === i && { color: '#fff' }]}>{i === 0 ? 'Auj.' : i === 1 ? 'Demain' : dayLabel(d)}</Text></Pressable>)}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 12 }}>{stepper('De', start, setStart)}{stepper('À', end, setEnd)}</View>
    </View>
  );
  const go = (label: string, onPress: () => void, off = false) => <Pressable accessibilityRole="button" disabled={off} onPress={onPress} style={({ pressed }) => [s.go, off && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.98 }] }]}><Text style={s.goTxt}>{label}</Text></Pressable>;
  const noteBox = <TextInput value={note} onChangeText={setNote} multiline placeholder="Note" placeholderTextColor={T.ink3} style={s.note} />;

  if (sg.kind === 'lead') {
    return (
      <View style={s.act}>
        <Text style={s.lbl}>Chantier (R-)</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={() => setNewR(true)} style={[s.tab, newR && s.tabOn]}><Text style={[s.tabTxt, newR && { color: '#fff' }]}>Nouveau R-</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setNewR(false)} style={[s.tab, !newR && s.tabOn]}><Text style={[s.tabTxt, !newR && { color: '#fff' }]}>Chantier existant</Text></Pressable>
        </View>
        {newR ? <Muted>Un nouveau chantier est créé au statut « Devis à rédiger », relié à la piste du pipeline.</Muted> : <WorksitePick value={ws} onChange={setWs} initial={initial} />}
        {noteBox}
        {go(newR ? 'Créer la piste et le nouveau R-' : 'Créer la piste sur ce chantier', () => onApply({ title: (sg.summary ?? sg.subject ?? 'Demande reçue par mail').slice(0, 120), note, ...(newR ? { createWorksite: true } : { worksiteId: wsId }) }, newR ? 'Piste et nouveau chantier créés.' : 'Piste créée.'), !newR && !wsId)}
      </View>
    );
  }
  if (sg.kind === 'appointment') {
    return (
      <View style={s.act}>
        <Text style={s.lbl}>Chantier</Text>
        <WorksitePick value={ws} onChange={setWs} initial={initial} />
        {dayPicker}
        {noteBox}
        {go('Ajouter au planning (à confirmer)', () => onApply({ worksiteId: wsId, title: (sg.summary ?? 'Rendez-vous').slice(0, 120), startAt: when(start), durationMin: Math.max(30, end - start), note }, 'Rendez-vous ajouté au planning.'), !wsId || end <= start)}
      </View>
    );
  }
  if (sg.kind === 'worksite_note') {
    return (
      <View style={s.act}>
        <Text style={s.lbl}>Chantier</Text>
        <WorksitePick value={ws} onChange={setWs} initial={initial} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={() => setAsIv(false)} style={[s.tab, !asIv && s.tabOn]}><Text style={[s.tabTxt, !asIv && { color: '#fff' }]}>Poster une note</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setAsIv(true)} style={[s.tab, asIv && s.tabOn]}><Text style={[s.tabTxt, asIv && { color: '#fff' }]}>Créer une intervention</Text></Pressable>
        </View>
        {asIv && dayPicker}
        {noteBox}
        <Muted>Le mail et la note sont classés dans le « Suivi mails » du chantier (bureau uniquement).</Muted>
        {go(asIv ? 'Ajouter au planning (à confirmer)' : 'Ajouter au suivi du chantier', () => onApply(asIv ? { worksiteId: wsId, asIntervention: true, title: (sg.summary ?? 'Intervention').slice(0, 120), body: note, startAt: when(start), endAt: when(end) } : { worksiteId: wsId, body: note }, asIv ? 'Intervention ajoutée au planning.' : 'Note ajoutée au suivi.'), !wsId || !note.trim() || (asIv && end <= start))}
      </View>
    );
  }
  return <View style={s.act}>{go('Marquer comme pris en compte', () => onApply({ note }, 'Pris en compte.'))}</View>;
}

const s = StyleSheet.create({
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line },
  chipOn: { backgroundColor: T.primary, borderColor: T.primary },
  chipTxt: { fontWeight: '700', color: T.ink, fontSize: 13 },
  flash: { flexDirection: 'row', borderRadius: 16, padding: 14 },
  card: { ...T.shadow, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 20, padding: 14, gap: 10 },
  badge: { backgroundColor: T.primarySoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeTxt: { fontSize: 11.5, fontWeight: '800', color: T.primary },
  summary: { fontSize: 15.5, fontWeight: '700', color: T.ink, lineHeight: 22 },
  sec: { flexDirection: 'row', gap: 6, flex: 1, backgroundColor: T.primarySoft, borderRadius: 14, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  secTxt: { color: T.primary, fontWeight: '800' },
  main: { flexDirection: 'row', gap: 6, flex: 1.2, backgroundColor: T.primary, borderRadius: 14, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  mainTxt: { color: '#fff', fontWeight: '800' },
  rej: { width: 50, backgroundColor: T.critSoft, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  act: { gap: 12, paddingTop: 6, borderTopWidth: 1, borderTopColor: T.line },
  lbl: { fontSize: 12, fontWeight: '800', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 },
  tab: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line, alignItems: 'center' },
  tabOn: { backgroundColor: T.primary, borderColor: T.primary },
  tabTxt: { fontWeight: '700', color: T.ink, fontSize: 13 },
  note: { minHeight: 76, borderRadius: 14, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, padding: 12, fontSize: 15, color: T.ink, textAlignVertical: 'top' },
  go: { backgroundColor: T.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  goTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  time: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: T.ink },
});
