import { useCallback, useMemo, useState } from 'react';
import { View, FlatList, Pressable, TextInput, StyleSheet, Image } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet, API_URL } from '@/lib/api';
import { Muted, Loading, EmptyState } from '@/lib/ui';
import { fmtQty, type StockItem } from '@/lib/stock';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

/** Tous les articles du magasin : recherche au clavier, filtre « stock bas », une touche pour ouvrir la fiche. */
export default function Articles() {
  const { low } = useLocalSearchParams<{ low?: string }>();
  const router = useRouter();
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(low === '1');
  useFocusEffect(useCallback(() => { apiGet<{ items: StockItem[] }>('/api/stock/items').then((r) => setItems(r.items)).catch(() => {}); }, []));

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items ?? []).filter((i) => (!onlyLow || i.low) && (!s || `${i.name} ${i.ref ?? ''} ${i.brand ?? ''} ${i.location ?? ''}`.toLowerCase().includes(s)));
  }, [items, q, onlyLow]);

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <Stack.Screen options={{ title: tr('Articles'), headerBackTitle: tr('Retour') }} />
      <View style={{ padding: 16, gap: 10 }}>
        <View style={s.field}><Feather name="search" size={18} color={T.ink2} /><TextInput value={q} onChangeText={setQ} placeholder={tr("Nom, référence, marque, rack…")} placeholderTextColor={T.ink3} style={s.input} /></View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([[false, 'Tous'], [true, 'Stock bas']] as const).map(([k, label]) => (
            <Pressable key={label} accessibilityRole="button" onPress={() => setOnlyLow(k)} style={[s.chip, onlyLow === k && s.chipOn]}><Text style={[s.chipTxt, onlyLow === k && { color: '#fff' }]}>{label}</Text></Pressable>
          ))}
          <Text style={{ alignSelf: 'center', color: T.ink2, marginLeft: 6 }}>{shown.length} article{shown.length > 1 ? 's' : ''}</Text>
        </View>
      </View>
      {!items ? <Loading /> : (
        <FlatList
          data={shown}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10 }}
          ListEmptyComponent={<EmptyState title={tr("Aucun article")} description={tr("Essaie un autre mot ou enlève le filtre.")} icon="package" />}
          renderItem={({ item: i }) => (
            <Pressable accessibilityRole="button" onPress={() => router.push(`/article/${i.id}` as never)} style={({ pressed }) => [s.row, pressed && { opacity: 0.9 }]}>
              {i.photoThumbUrl ? <Image source={{ uri: i.photoThumbUrl.startsWith('http') ? i.photoThumbUrl : `${API_URL}${i.photoThumbUrl}` }} style={s.photo} /> : <View style={[s.photo, { alignItems: 'center', justifyContent: 'center' }]}><Feather name="package" size={20} color={T.ink3} /></View>}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: T.ink, fontWeight: '700' }} numberOfLines={2}>{i.name}</Text>
                <Muted>{[i.ref, i.location && `Rack ${i.location}`].filter(Boolean).join(' · ')}</Muted>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.qty, i.low && { color: T.crit }]}>{fmtQty(i.qty)}</Text>
                <Text style={s.unit}>{i.unit}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 16, paddingHorizontal: 14, minHeight: 52 },
  input: { flex: 1, fontSize: 16, color: T.ink, paddingVertical: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line },
  chipOn: { backgroundColor: T.primary, borderColor: T.primary },
  chipTxt: { fontWeight: '700', color: T.ink },
  row: { ...T.shadow, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 18, padding: 12 },
  photo: { width: 52, height: 52, borderRadius: 14, backgroundColor: T.surface2 },
  qty: { fontSize: 20, fontWeight: '800', color: T.ink },
  unit: { fontSize: 11.5, color: T.ink2 },
});
