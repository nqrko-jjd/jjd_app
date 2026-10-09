import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, Image } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { apiGet, API_URL } from '@/lib/api';
import { Card, Label, Muted, Loading } from '@/lib/ui';
import { StockMove } from '@/lib/StockMove';
import { fmtQty, type StockItem } from '@/lib/stock';
import { T } from '@/lib/theme';
import { tr, dateLocale } from '@/lib/i18n';

interface Mv { id: string; type: string; qty: number; unit: string | null; createdAt: string; note: string | null; worksite: { ref: string } | null; createdBy: { email: string } | null }

/** Fiche article : stock, rack, conditionnements, derniers mouvements, et entrée / sortie en bas. */
export default function Article() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<StockItem | null>(null);
  const [moves, setMoves] = useState<Mv[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setItem((await apiGet<{ item: StockItem }>(`/api/stock/items/${id}`)).item);
      setMoves((await apiGet<{ items: Mv[] }>(`/api/stock/movements?stockItemId=${id}&pageSize=20`)).items.slice(0, 8));
    } catch { /* hors ligne */ }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!item) return <Loading />;
  const TYPE: Record<string, string> = { in: 'Entrée', out: 'Sortie', adjustment: 'Inventaire' };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: item.ref ?? 'Article', headerBackTitle: tr('Retour') }} />
      <Card>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          {item.photoThumbUrl ? <Image source={{ uri: item.photoThumbUrl.startsWith('http') ? item.photoThumbUrl : `${API_URL}${item.photoThumbUrl}` }} style={s.photo} /> : <View style={[s.photo, { alignItems: 'center', justifyContent: 'center' }]}><Feather name="package" size={28} color={T.ink3} /></View>}
          <View style={{ flex: 1, gap: 3 }}><Text style={s.name}>{item.name}</Text><Muted>{[item.ref, item.brand, item.category].filter(Boolean).join(' · ')}</Muted></View>
        </View>
        <View style={s.stats}>
          <View style={s.stat}><Text style={s.lbl}>En stock</Text><Text style={[s.val, item.low && { color: T.crit }]}>{fmtQty(item.qty)} {item.unit}</Text></View>
          <View style={s.stat}><Text style={s.lbl}>Rack</Text><Text style={s.val}>{item.location ?? '—'}</Text></View>
        </View>
        {item.low && <Text style={{ color: T.crit, fontWeight: '700' }}>Stock bas{item.minQty != null ? ` (seuil ${fmtQty(item.minQty)} ${item.unit})` : ''}</Text>}
        {item.units.length > 0 && <Muted>Conditionnements : {item.units.map((u) => `1 ${u.name} = ${fmtQty(u.factor)} ${item.unit}`).join(' · ')}</Muted>}
      </Card>

      {ok && <View style={s.ok}><Feather name="check-circle" size={18} color={T.ok} /><Text style={{ color: T.ok, fontWeight: '700', flex: 1 }}>{ok}</Text></View>}
      <Card><StockMove key={item.qty} item={item} onDone={(m) => { setOk(m); load(); }} /></Card>

      {moves.length > 0 && (
        <Card>
          <Label>Derniers mouvements</Label>
          {moves.map((m) => (
            <View key={m.id} style={s.mv}>
              <View style={[s.dot, { backgroundColor: m.type === 'in' ? T.ok : m.type === 'out' ? T.accent : T.ink3 }]} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: T.ink, fontWeight: '700' }}>{TYPE[m.type] ?? m.type} · {fmtQty(m.qty)} {m.unit ?? item.unit}</Text>
                <Muted>{[new Date(m.createdAt).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' }), m.worksite?.ref, m.createdBy?.email.split('@')[0]].filter(Boolean).join(' · ')}</Muted>
              </View>
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  photo: { width: 76, height: 76, borderRadius: 18, backgroundColor: T.surface2 },
  name: { fontSize: 18, fontWeight: '800', color: T.ink },
  stats: { flexDirection: 'row', gap: 10, marginTop: 10 },
  stat: { flex: 1, backgroundColor: T.surface2, borderRadius: 14, padding: 12, gap: 2 },
  lbl: { fontSize: 11.5, color: T.ink2, fontWeight: '600' },
  val: { fontSize: 20, fontWeight: '800', color: T.ink },
  ok: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: T.okSoft, borderRadius: 16, padding: 14 },
  mv: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: T.line },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
