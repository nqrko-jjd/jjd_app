import { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Loading, EmptyState } from '@/lib/ui';
import { T } from '@/lib/theme';
import { dateLocale } from '@/lib/i18n';

interface Row { id: string; ref: string; status: string; neededOn: string | null; worksite: { ref: string; title: string }; lineCount: number; doneLines: number }
const STATUS: Record<string, string> = { to_prepare: 'À préparer', preparing: 'En cours', prepared: 'Prête', cancelled: 'Annulée' };

/** Préparations de matériel pour les chantiers : on touche une carte, on prépare en scannant. */
export default function Preparations() {
  const router = useRouter();
  const [tab, setTab] = useState<'open' | 'prepared'>('open');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setRows((await apiGet<{ items: Row[] }>(`/api/stock-orders?status=${tab}`)).items); } catch { /* hors ligne */ }
  }, [tab]);
  useFocusEffect(useCallback(() => { setRows(null); load(); }, [load]));

  const dueLabel = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso); const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    return { text: days < 0 ? `En retard de ${-days} j` : days === 0 ? 'Pour aujourd’hui' : days === 1 ? 'Pour demain' : `Pour le ${d.toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' })}`, late: days < 0, soon: days <= 1 };
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 12 }}>
        <Text style={s.title}>Préparations</Text>
        <View style={s.seg}>
          {([['open', 'À préparer'], ['prepared', 'Terminées']] as const).map(([k, label]) => (
            <Pressable key={k} accessibilityRole="button" onPress={() => setTab(k)} style={[s.segBtn, tab === k && s.segOn]}><Text style={[s.segTxt, tab === k && { color: '#fff' }]}>{label}</Text></Pressable>
          ))}
        </View>
      </View>
      {!rows ? <Loading /> : (
        <ScrollView contentContainerStyle={{ ...T.content, padding: 16, gap: 10 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
          {rows.length === 0 && <EmptyState title={tab === 'open' ? 'Rien à préparer' : 'Aucune préparation terminée'} description={tab === 'open' ? 'Les demandes de matériel des chantiers apparaîtront ici.' : 'Les préparations validées apparaîtront ici.'} icon="package" />}
          {rows.map((r) => {
            const due = dueLabel(r.neededOn);
            const pct = r.lineCount ? Math.round((r.doneLines / r.lineCount) * 100) : 0;
            return (
              <Pressable key={r.id} accessibilityRole="button" onPress={() => router.push(`/preparation/${r.id}` as never)} style={({ pressed }) => [s.card, pressed && { opacity: 0.92 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={s.ref}>{r.ref}</Text>
                  <View style={[s.badge, r.status === 'preparing' && { backgroundColor: T.warnSoft }, r.status === 'prepared' && { backgroundColor: T.okSoft }]}><Text style={[s.badgeTxt, r.status === 'preparing' && { color: T.warn }]}>{STATUS[r.status] ?? r.status}</Text></View>
                  <View style={{ flex: 1 }} />
                  <Feather name="chevron-right" size={20} color={T.ink3} />
                </View>
                <Text style={s.ws} numberOfLines={2}>{r.worksite.ref} · {r.worksite.title}</Text>
                {due && tab === 'open' && <Text style={[s.due, due.soon && { color: T.accent }, due.late && { color: T.crit }]}>{due.text}</Text>}
                <View style={s.track}><View style={[s.fill, { width: `${pct}%` }]} /></View>
                <Text style={s.prog}>{r.doneLines} / {r.lineCount} articles prêts</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: T.ink },
  seg: { flexDirection: 'row', backgroundColor: T.surface2, borderRadius: 14, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: 'center' },
  segOn: { backgroundColor: T.primary },
  segTxt: { fontWeight: '700', color: T.ink2 },
  card: { ...T.shadow, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 20, padding: 16, gap: 8 },
  ref: { fontSize: 15, fontWeight: '800', color: T.ink },
  badge: { backgroundColor: T.primarySoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeTxt: { fontSize: 11.5, fontWeight: '800', color: T.primary },
  ws: { fontSize: 15, color: T.ink, fontWeight: '600' },
  due: { fontSize: 13, fontWeight: '700', color: T.ink2 },
  track: { height: 8, borderRadius: 4, backgroundColor: T.surface2 },
  fill: { height: 8, borderRadius: 4, backgroundColor: T.primary },
  prog: { fontSize: 12.5, color: T.ink2 },
});
