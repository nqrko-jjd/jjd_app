import { useCallback, useState } from 'react';
import { View, TextInput, Pressable, FlatList, StyleSheet } from 'react-native';
import { Text } from '@/lib/AppText';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Muted, Loading, ScreenHeader, EmptyState } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr, dateLocale } from '@/lib/i18n';

interface ThreadItem {
  id: string; kind: string; title: string; sub: string; worksiteId: string | null; ref: string | null;
  lastMessage: string; lastAt: string | null; unread: number; pinned: boolean;
}

function time(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' });
}

export default function Messages() {
  const router = useRouter();
  const [items, setItems] = useState<ThreadItem[] | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ items: ThreadItem[] }>('/api/messagerie/threads?audience=internal');
      setItems(r.items);
    } catch {
      /* hors ligne */
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!items) return <Loading />;
  const filtered = q ? items.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())) : items;

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <ScreenHeader title="Messages" eyebrow="Votre équipe" description={tr("Le fil JJD et les échanges de vos chantiers.")}/>

      </View>
      <View style={{ padding: 18 }}>
        <TextInput
          style={s.search}
          placeholder={tr("Rechercher une conversation…")}
          value={q}
          onChangeText={setQ}
          placeholderTextColor={T.ink3}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ ...T.content, padding: 18, paddingTop: 0, gap: 0 }}
        ListEmptyComponent={<EmptyState title={tr("Aucune conversation")} description={tr("Les échanges de votre équipe apparaîtront ici.")} icon="message-circle"/>}
        renderItem={({ item }) => (
          <Pressable
            style={s.row}
            onPress={() => router.push((item.kind === 'general' ? '/fil-general' : `/fil/${item.worksiteId}`) as never)}
          >
            <View style={s.avatar}>
              <Text style={s.avatarTxt}>{item.kind === 'general' ? 'J' : (item.ref ?? item.title).slice(0, 2)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={s.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={s.time}>{time(item.lastAt)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 0 }}>
                <Text style={s.preview} numberOfLines={1}>{item.lastMessage || item.sub}</Text>
                {item.unread > 0 && (
                  <View style={s.badge}><Text style={s.badgeTxt}>{item.unread}</Text></View>
                )}
              </View>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  eyebrow: { fontSize: 11.5, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '800', color: T.ink, marginTop: 2 },
  search: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, padding: 14, color: T.ink },
  row: { flexDirection: 'row', gap: 10, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line, padding: 18, minHeight: 88, alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 18, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#fff', fontWeight: '800', fontSize: 13, textTransform: 'uppercase' },
  rowTitle: { fontSize: 15, color: T.ink, fontWeight: '700', flexShrink: 1, marginRight: 8 },
  time: { color: T.ink3, fontSize: 11 },
  preview: { color: T.ink2, fontSize: 13, flex: 1 },
  badge: { backgroundColor: T.gold, borderRadius: 999, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  badgeTxt: { color: '#241c05', fontWeight: '800', fontSize: 10.5 },
});
