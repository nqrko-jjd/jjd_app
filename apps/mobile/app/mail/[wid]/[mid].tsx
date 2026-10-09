import { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, TextInput } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet, apiSend } from '@/lib/api';
import { Muted, Loading } from '@/lib/ui';
import { MailView, type MailAttachment } from '@/lib/MailView';
import { T } from '@/lib/theme';
import { tr, dateLocale, Alert } from '@/lib/i18n';

interface Detail {
  id: string; kind: 'mail' | 'note'; subject: string | null; fromAddress: string | null; toAddress: string | null; at: string;
  bodyText: string | null; bodyHtml: string | null; note: string | null;
  attachments: { index: number; filename: string; contentType: string; size: number; available: boolean; skipped: string | null }[];
}

/** Lecture d'un mail du suivi d'un chantier, avec sa note modifiable. */
export default function MailDetail() {
  const { wid, mid } = useLocalSearchParams<{ wid: string; mid: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const base = `/api/worksites/${wid}/mails/${mid}`;
  const load = useCallback(async () => { try { const r = await apiGet<Detail>(base); setD(r); setNote(r.note ?? ''); } catch (e) { setMsg((e as Error).message); } }, [base]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!d) return msg ? <View style={{ padding: 20 }}><Text style={{ color: T.crit }}>{msg}</Text></View> : <Loading />;
  const dirty = note !== (d.note ?? '');
  async function save() { setBusy(true); try { await apiSend(base, 'PATCH', { note }, false); setMsg('Note enregistrée.'); await load(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } }
  const remove = () => Alert.alert(d.kind === 'note' ? 'Supprimer cette note ?' : 'Retirer ce mail du suivi ?', d.kind === 'note' ? '' : 'Il reste dans la boîte mail.', [{ text: 'Annuler', style: 'cancel' }, { text: 'Confirmer', style: 'destructive', onPress: async () => { try { await apiSend(base, 'DELETE', undefined, false); router.back(); } catch (e) { setMsg((e as Error).message); } } }]);
  const atts: MailAttachment[] = d.attachments.map((a) => ({ name: a.filename, size: a.size, type: a.contentType, path: a.available ? `${base}/attachments/${a.index}` : null, reason: a.skipped }));

  const noteBox = (
    <View style={s.note}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Feather name="edit-3" size={15} color={T.ink} /><Text style={{ fontWeight: '800', color: T.ink }}>{d.kind === 'note' ? 'Note' : 'Note de suivi'}</Text><Text style={{ marginLeft: 'auto', fontSize: 11.5, color: T.ink2 }}>bureau uniquement</Text></View>
      <TextInput value={note} onChangeText={setNote} multiline placeholder={tr("Ajouter une note de suivi sur ce mail…")} placeholderTextColor={T.ink3} style={s.input} />
      {!!msg && <Text style={{ color: T.ink2, fontSize: 12.5 }}>{msg}</Text>}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable accessibilityRole="button" disabled={busy || !dirty || (d.kind === 'note' && !note.trim())} onPress={save} style={[s.save, (busy || !dirty) && { opacity: 0.4 }]}><Text style={s.saveTxt}>{dirty ? 'Enregistrer' : 'Enregistrée'}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={tr("Supprimer")} onPress={remove} style={s.del}><Feather name="trash-2" size={18} color={T.crit} /></Pressable>
      </View>
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: d.kind === 'note' ? 'Note' : 'Mail', headerBackTitle: tr('Retour') }} />
      {d.kind === 'note' ? (
        <View style={{ gap: 6 }}><Text style={{ fontSize: 20, fontWeight: '800', color: T.ink }}>{d.subject?.trim() || 'Note de suivi'}</Text><Muted>{new Date(d.at).toLocaleString(dateLocale(), { dateStyle: 'long', timeStyle: 'short' })}</Muted></View>
      ) : (
        <MailView subject={d.subject} from={d.fromAddress} to={d.toAddress} date={d.at} html={d.bodyHtml} text={d.bodyText} attachments={atts} />
      )}
      {noteBox}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  note: { backgroundColor: T.surface2, borderRadius: 18, borderWidth: 1, borderColor: T.line, padding: 14, gap: 10 },
  input: { minHeight: 80, backgroundColor: T.surface, borderRadius: 12, borderWidth: 1, borderColor: T.line, padding: 12, fontSize: 15, color: T.ink, textAlignVertical: 'top' },
  save: { flex: 1, backgroundColor: T.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveTxt: { color: '#fff', fontWeight: '800' },
  del: { width: 52, backgroundColor: T.critSoft, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
