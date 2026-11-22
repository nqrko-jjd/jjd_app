import { Pressable, View } from 'react-native';
import { Text } from '@/lib/AppText';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { apiSend } from '@/lib/api';
import { Card, EmptyState, Muted, ScreenHeader } from '@/lib/ui';
import { T } from '@/lib/theme';
import { dateLocale } from '@/lib/i18n';
import { PortalScroll, usePortalData } from '@/lib/portal';

interface Thread { threadId: string; worksiteId: string; ref: string; title: string; lastMessage: string; lastAt: string | null; unread: number }

function when(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' });
}

export default function Messages() {
  const router = useRouter();
  const st = usePortalData<{ items: Thread[] }>('/api/portal/messages');
  const items = st.data?.items ?? [];

  async function open(t: Thread) {
    if (t.unread > 0) await apiSend(`/api/portal/messages/${t.threadId}/read`, 'POST', {}, false).catch(() => {});
    router.push(`/espace/chantier/${t.worksiteId}` as never);
  }

  return (
    <PortalScroll state={st}>
      <ScreenHeader eyebrow="Espace client" title="Messages" description="Vos échanges avec l’équipe JJD, chantier par chantier." />
      {items.length === 0 ? <EmptyState icon="message-circle" title="Aucun message" description="Écrivez à JJD depuis la fiche d’un chantier." /> : items.map((t) => (
        <Pressable key={t.threadId} onPress={() => void open(t)}>
          <Card accent={t.unread > 0 ? T.gold : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontWeight: t.unread > 0 ? '800' : '700' }}>{t.title}</Text>
                <Muted numberOfLines={2}>{t.lastMessage}</Muted>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Muted>{when(t.lastAt)}</Muted>
                {t.unread > 0 ? <View style={{ backgroundColor: T.gold, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ fontWeight: '800', fontSize: 12 }}>{t.unread}</Text></View> : null}
              </View>
              <Feather name="chevron-right" size={18} color={T.ink3} />
            </View>
          </Card>
        </Pressable>
      ))}
    </PortalScroll>
  );
}
