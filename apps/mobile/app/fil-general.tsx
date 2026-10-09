import { useCallback, useEffect, useRef, useState } from 'react';
import { View, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { apiGet, apiSend } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Loading } from '@/lib/ui';
import { T } from '@/lib/theme';
import { MsgText } from '@/lib/MsgText';
import { tr, dateLocale } from '@/lib/i18n';

interface Msg {
  id: string; kind: string; body: string | null; authorId: string | null; authorName: string | null; createdAt: string; bodyTranslated?: string | null;
}
interface Data {
  thread: { id: string };
  messages: Msg[];
}

function time(iso: string) {
  return new Date(iso).toLocaleString(dateLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function FilGeneral() {
  const { user } = useSession();
  const [d, setD] = useState<Data | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try { setD(await apiGet<Data>('/api/messagerie/general')); } catch { /* hors ligne */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { scroll.current?.scrollToEnd({ animated: false }); }, [d?.messages.length]);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    await apiSend('/api/messagerie/general/messages', 'POST', { body: text.trim() });
    setText('');
    setBusy(false);
    load();
  }

  if (!d) return <Loading />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: tr('Général JJD'), headerBackTitle: tr('Retour') }} />
      <ScrollView ref={scroll} contentContainerStyle={{ ...T.content, padding: 14, gap: 10 }}>
        {d.messages.length === 0 && <Text style={{ color: T.ink2 }}>Aucun message.</Text>}
        {d.messages.map((m) => {
          const mine = m.authorId === user?.id;
          return (
            <View key={m.id} style={[s.msgCol, mine && s.msgColMine]}>
              {!mine && <Text style={s.author}>{m.authorName}</Text>}
              {m.body ? <MsgText body={m.body} translated={m.bodyTranslated} style={[s.bubble, mine && s.bubbleMine]} /> : null}
              <Text style={[s.timeTxt, mine && { alignSelf: 'flex-end' }]}>{time(m.createdAt)}</Text>
            </View>
          );
        })}
      </ScrollView>
      <View style={s.composer}>
        <TextInput style={s.input} placeholder="Message…" value={text} onChangeText={setText} placeholderTextColor={T.ink3} />
        <Pressable style={s.sendBtn} onPress={send} disabled={busy || !text.trim()}><Feather name="send" size={16} color="#fff" /></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  msgCol: { alignItems: 'flex-start', gap: 2 },
  msgColMine: { alignItems: 'flex-end' },
  author: { fontSize: 11, color: T.ink3, marginLeft: 2 },
  timeTxt: { fontSize: 10, color: T.ink3, marginHorizontal: 2 },
  bubble: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, borderBottomLeftRadius: 4, padding: 10, alignSelf: 'flex-start', maxWidth: '85%', color: T.ink },
  bubbleMine: { backgroundColor: T.primary, borderColor: T.primary, borderBottomLeftRadius: 14, borderBottomRightRadius: 4, color: '#fff' },
  composer: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: T.line, backgroundColor: T.surface, alignItems: 'center' },
  input: { flex: 1, backgroundColor: T.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: T.ink },
  sendBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' },
});
