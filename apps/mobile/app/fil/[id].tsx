import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { apiGet, apiSend, apiUploadPhoto, API_URL } from '@/lib/api';
import { Loading } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Msg {
  id: string; kind: string; body: string | null; fileUrl: string | null; thumbUrl: string | null;
  authorName: string | null; createdAt: string;
}
interface Data {
  thread: { closedAt: string | null };
  messages: Msg[];
  participants: { id: string }[];
}

function time(iso: string) {
  return new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function Fil() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try { setD(await apiGet<Data>(`/api/worksites/${id}/thread`)); } catch {}
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { scroll.current?.scrollToEnd({ animated: false }); }, [d?.messages.length]);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    const r = await apiSend<{ message: unknown }>(`/api/worksites/${id}/thread/messages`, 'POST', { body: text.trim() });
    if ('queued' in r) Alert.alert('Hors ligne', 'Le message sera envoyé au retour du réseau.');
    setText('');
    setBusy(false);
    load();
  }
  async function addPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.7 });
    if (res.canceled || !res.assets[0]) return;
    setBusy(true);
    try {
      await apiUploadPhoto(`/api/worksites/${id}/thread/photos`, res.assets[0].uri);
    } catch {
      Alert.alert('Échec', "La photo n'a pas pu être envoyée (réseau ?).");
    }
    setBusy(false);
    load();
  }
  async function markDone() {
    Alert.alert('Chantier terminé ?', 'Signaler le chantier comme terminé au bureau.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Confirmer', onPress: async () => { await apiSend(`/api/worksites/${id}/thread/close`, 'POST', {}); load(); } },
    ]);
  }

  if (!d) return <Loading />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: 'Fil de chantier', headerBackTitle: 'Retour' }} />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 14, gap: 10 }}>
        {d.messages.length === 0 && <Text style={{ color: T.ink2 }}>Aucun message.</Text>}
        {d.messages.map((m) => (
          <View key={m.id} style={{ gap: 3 }}>
            <Text style={{ fontSize: 11, color: T.ink3 }}>{m.kind === 'status' ? '●' : m.authorName} · {time(m.createdAt)}</Text>
            {m.kind === 'photo' && m.fileUrl && (
              <Image source={{ uri: `${API_URL}${m.thumbUrl ?? m.fileUrl}` }} style={s.photo} />
            )}
            {m.body ? (
              <Text style={m.kind === 'status' ? s.status : s.bubble}>{m.body}</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>

      {d.thread.closedAt ? (
        <View style={s.closed}><Text style={{ color: T.ok, fontWeight: '700' }}>Chantier signalé terminé</Text></View>
      ) : (
        <Pressable style={s.doneBtn} onPress={markDone}><Text style={{ color: T.ok, fontWeight: '700' }}>✓ Chantier terminé</Text></Pressable>
      )}

      <View style={s.composer}>
        <Pressable style={s.iconBtn} onPress={addPhoto} disabled={busy}><Text style={{ fontSize: 18 }}>📷</Text></Pressable>
        <TextInput style={s.input} placeholder="Message…" value={text} onChangeText={setText} placeholderTextColor={T.ink3} />
        <Pressable style={s.sendBtn} onPress={send} disabled={busy || !text.trim()}><Text style={{ color: '#fff', fontWeight: '700' }}>›</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  photo: { width: 220, height: 165, borderRadius: 10, backgroundColor: T.surface2 },
  bubble: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 10, alignSelf: 'flex-start', maxWidth: '85%', color: T.ink },
  status: { fontStyle: 'italic', color: T.ink2, fontSize: 13 },
  closed: { padding: 10, alignItems: 'center', backgroundColor: T.okSoft },
  doneBtn: { padding: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: T.line, backgroundColor: T.surface },
  composer: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: T.line, backgroundColor: T.surface, alignItems: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: T.surface2, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, backgroundColor: T.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: T.ink },
  sendBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' },
});
