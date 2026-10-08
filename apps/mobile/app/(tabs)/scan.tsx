import { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Image } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Muted } from '@/lib/ui';
import { ScanInput } from '@/lib/ScanInput';
import { StockMove } from '@/lib/StockMove';
import { fmtQty, type StockItem } from '@/lib/stock';
import { API_URL } from '@/lib/api';
import { T } from '@/lib/theme';

type Result = { kind: 'stock'; item: StockItem; unitName: string | null } | { kind: 'rack'; code: string; items: StockItem[] };

/** Scanner : un code → l'article (stock, rack, photo) et, tout de suite, une entrée ou une sortie en quelques touches. */
export default function Scan() {
  const router = useRouter();
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(async (code: string) => {
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await apiGet<{ kind: 'stock'; item: StockItem; unitName: string | null } | { kind: 'rack'; code: string }>(`/api/stock/scan/${encodeURIComponent(code)}`);
      if (r.kind === 'rack') {
        const all = await apiGet<{ items: StockItem[] }>('/api/stock/items');
        setRes({ kind: 'rack', code: r.code, items: all.items.filter((i) => (i.location ?? '').toUpperCase() === r.code.toUpperCase()) });
      } else setRes(r);
    } catch (e) { setRes(null); setErr((e as Error).message || 'Code inconnu'); } finally { setBusy(false); }
  }, []);

  async function refresh(id: string) {
    try { const r = await apiGet<{ item: StockItem }>(`/api/stock/items/${id}`); setRes((cur) => (cur && cur.kind === 'stock' ? { ...cur, item: r.item } : cur)); } catch { /* garde l'affichage */ }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <View><Text style={s.title}>Scanner</Text><Muted>Un code-barres, une étiquette ou un rack.</Muted></View>
      <ScanInput onCode={lookup} />

      {busy && <Muted>Recherche…</Muted>}
      {err && <View style={s.err}><Feather name="alert-circle" size={18} color={T.crit} /><Text style={{ color: T.crit, fontWeight: '700', flex: 1 }}>{err}</Text></View>}
      {ok && <View style={s.ok}><Feather name="check-circle" size={18} color={T.ok} /><Text style={{ color: T.ok, fontWeight: '700', flex: 1 }}>{ok}</Text></View>}

      {res?.kind === 'stock' && (
        <>
          <Pressable accessibilityRole="button" onPress={() => router.push(`/article/${res.item.id}` as never)} style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
            <Card>
              <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                {res.item.photoThumbUrl ? <Image source={{ uri: res.item.photoThumbUrl.startsWith('http') ? res.item.photoThumbUrl : `${API_URL}${res.item.photoThumbUrl}` }} style={s.photo} /> : <View style={[s.photo, s.noPhoto]}><Feather name="package" size={26} color={T.ink3} /></View>}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.name} numberOfLines={3}>{res.item.name}</Text>
                  <Muted>{[res.item.ref, res.item.brand].filter(Boolean).join(' · ')}</Muted>
                </View>
                <Feather name="chevron-right" size={20} color={T.ink3} />
              </View>
              <View style={s.stats}>
                <View style={s.stat}><Text style={s.statLbl}>En stock</Text><Text style={[s.statVal, res.item.low && { color: T.crit }]}>{fmtQty(res.item.qty)} {res.item.unit}</Text></View>
                <View style={s.stat}><Text style={s.statLbl}>Rack</Text><Text style={s.statVal}>{res.item.location ?? '—'}</Text></View>
              </View>
              {res.item.low && <Text style={{ color: T.crit, fontWeight: '700' }}>Stock bas{res.item.minQty != null ? ` (seuil ${fmtQty(res.item.minQty)} ${res.item.unit})` : ''}</Text>}
            </Card>
          </Pressable>
          <Card>
            <StockMove key={res.item.id + res.item.qty} item={res.item} defaultUnit={res.unitName} onDone={(m) => { setOk(m); refresh(res.item.id); }} />
          </Card>
        </>
      )}

      {res?.kind === 'rack' && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={s.rackIc}><Feather name="grid" size={20} color={T.primary} /></View><View><Text style={s.name}>Rack {res.code}</Text><Muted>{res.items.length} article{res.items.length > 1 ? 's' : ''} rangé{res.items.length > 1 ? 's' : ''}</Muted></View></View>
          {res.items.map((i) => (
            <Pressable key={i.id} accessibilityRole="button" onPress={() => router.push(`/article/${i.id}` as never)} style={s.line}>
              <Text style={{ flex: 1, color: T.ink }} numberOfLines={2}>{i.name}</Text>
              <Text style={{ fontWeight: '800', color: T.ink }}>{fmtQty(i.qty)} {i.unit}</Text>
              <Feather name="chevron-right" size={16} color={T.ink3} />
            </Pressable>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: T.ink },
  err: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: T.critSoft, borderRadius: 16, padding: 14 },
  ok: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: T.okSoft, borderRadius: 16, padding: 14 },
  photo: { width: 64, height: 64, borderRadius: 16, backgroundColor: T.surface2 },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 17, fontWeight: '800', color: T.ink },
  stats: { flexDirection: 'row', gap: 10, marginTop: 10 },
  stat: { flex: 1, backgroundColor: T.surface2, borderRadius: 14, padding: 12, gap: 2 },
  statLbl: { fontSize: 11.5, color: T.ink2, fontWeight: '600' },
  statVal: { fontSize: 20, fontWeight: '800', color: T.ink },
  rackIc: { width: 44, height: 44, borderRadius: 14, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: T.line },
});
