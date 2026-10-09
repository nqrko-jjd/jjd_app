import { useCallback, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, RefreshControl, TextInput } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet, apiSend } from '@/lib/api';
import { Muted, Loading, EmptyState } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr, dateLocale } from '@/lib/i18n';

interface Row { id: string; kind: 'mail' | 'note'; subject: string | null; fromAddress: string | null; at: string; snippet: string; hasNote: boolean; attachmentCount: number }
const who = (r: Row) => (r.kind === 'note' ? 'Note de suivi' : (/^"?([^"<]*?)"?\s*</.exec(r.fromAddress ?? '')?.[1]?.trim() || r.fromAddress || 'Expéditeur inconnu'));
const when = (iso: string) => { const d = new Date(iso); return d.getFullYear() === new Date().getFullYear() ? d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : d.toLocaleDateString(dateLocale()); };

/** Suivi des mails d'un chantier (bureau) : la liste, un toucher ouvre le mail avec ses pièces jointes. */
export default function SuiviMails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setRows((await apiGet<{ items: Row[] }>(`/api/worksites/${id}/mails`)).items); } catch (e) { setErr((e as Error).message); setRows((x) => x ?? []); } }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  async function addNote() {
    try { await apiSend(`/api/worksites/${id}/mails`, 'POST', { note }, false); setNote(''); setAdding(false); await load(); } catch (e) { setErr((e as Error).message); }
  }
  if (!rows) return <Loading />;
  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <Stack.Screen options={{ title: tr('Suivi mails'), headerBackTitle: tr('Retour') }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 6 }}>
            <View style={s.lock}><Feather name="lock" size={14} color={T.ink2} /><Text style={{ color: T.ink2, fontSize: 12.5, flex: 1 }}>Visible du bureau uniquement, jamais des équipes.</Text></View>
            {adding ? (
              <View style={s.card}>
                <TextInput value={note} onChangeText={setNote} multiline autoFocus placeholder={tr("Appel, décision, information à garder…")} placeholderTextColor={T.ink3} style={s.input} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable accessibilityRole="button" disabled={!note.trim()} onPress={addNote} style={[s.ok, !note.trim() && { opacity: 0.4 }]}><Text style={s.okTxt}>Enregistrer</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setAdding(false)} style={s.cancel}><Text style={{ color: T.ink2, fontWeight: '700' }}>Annuler</Text></Pressable>
                </View>
              </View>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={s.add}><Feather name="plus" size={18} color="#fff" /><Text style={s.okTxt}>Ajouter une note</Text></Pressable>
            )}
            {err && <Text style={{ color: T.crit }}>{err}</Text>}
          </View>
        }
        ListEmptyComponent={<EmptyState title={tr("Aucun mail suivi")} description={tr("Les mails validés depuis la Boîte IA, avec leurs pièces jointes, apparaîtront ici.")} icon="mail" />}
        renderItem={({ item: r }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push(`/mail/${id}/${r.id}` as never)} style={({ pressed }) => [s.row, pressed && { opacity: 0.9 }]}>
            <View style={[s.av, r.kind === 'note' && { backgroundColor: T.goldSoft }]}><Feather name={r.kind === 'note' ? 'edit-3' : 'mail'} size={18} color={r.kind === 'note' ? T.accent : '#fff'} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: T.ink, fontWeight: '800', flex: 1 }} numberOfLines={1}>{who(r)}</Text><Text style={s.date}>{when(r.at)}</Text></View>
              <Text style={{ color: T.ink, fontWeight: '600' }} numberOfLines={1}>{r.subject?.trim() || (r.kind === 'note' ? r.snippet.slice(0, 60) : '(sans objet)')}</Text>
              <Muted numberOfLines={2}>{r.kind === 'note' ? 'Note' : r.snippet || '—'}</Muted>
              {(r.attachmentCount > 0 || (r.hasNote && r.kind === 'mail')) && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                  {r.attachmentCount > 0 && <View style={s.tag}><Feather name="paperclip" size={11} color={T.ink2} /><Text style={s.tagTxt}>{r.attachmentCount}</Text></View>}
                  {r.hasNote && r.kind === 'mail' && <View style={[s.tag, { backgroundColor: T.warnSoft }]}><Text style={[s.tagTxt, { color: T.warn }]}>note</Text></View>}
                </View>
              )}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  lock: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  add: { flexDirection: 'row', gap: 8, backgroundColor: T.primary, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 18, padding: 12, gap: 10 },
  input: { minHeight: 90, fontSize: 15, color: T.ink, textAlignVertical: 'top' },
  ok: { flex: 1, backgroundColor: T.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  okTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  cancel: { flex: 1, backgroundColor: T.surface2, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  row: { ...T.shadow, flexDirection: 'row', gap: 12, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 18, padding: 14 },
  av: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#2f6f5a', alignItems: 'center', justifyContent: 'center' },
  date: { fontSize: 12, color: T.ink3 },
  tag: { flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: T.surface2, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  tagTxt: { fontSize: 11.5, color: T.ink2, fontWeight: '700' },
});
