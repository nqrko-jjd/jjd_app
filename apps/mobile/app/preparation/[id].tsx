import { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Image, TextInput } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet, apiSend, API_URL } from '@/lib/api';
import { Card, Muted, Loading } from '@/lib/ui';
import { ScanInput } from '@/lib/ScanInput';
import { fmtQty, type StockOrder, type OrderLine } from '@/lib/stock';
import { T } from '@/lib/theme';
import { tr, dateLocale, Alert } from '@/lib/i18n';

/** Préparer une commande de matériel : on scanne chaque article (ou on règle la quantité au pouce), puis on valide : les sorties de stock vers le chantier se font toutes seules. */
export default function Preparation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<StockOrder | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setOrder((await apiGet<{ order: StockOrder }>(`/api/stock-orders/${id}`)).order); } catch { /* hors ligne */ }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!order) return <Loading />;
  const open = order.status === 'to_prepare' || order.status === 'preparing';
  const done = order.lines.filter((l) => l.pickedQty + 0.0001 >= l.qty).length;

  async function scan(code: string) {
    try {
      const r = await apiSend<{ order: StockOrder; itemName: string }>(`/api/stock-orders/${id}/scan`, 'POST', { code }, false);
      if ('order' in r) { setOrder(r.order); setFlash({ ok: true, text: `✓ ${r.itemName} ajouté` }); }
    } catch (e) { setFlash({ ok: false, text: (e as Error).message || 'Code refusé' }); }
  }
  async function setPicked(l: OrderLine, value: number) {
    const v = Math.max(0, Math.min(l.qty, Math.round(value * 100) / 100));
    try { const r = await apiSend<{ order: StockOrder }>(`/api/stock-orders/${id}/lines/${l.id}/picked`, 'POST', { pickedQty: v }, false); if ('order' in r) setOrder(r.order); }
    catch (e) { setFlash({ ok: false, text: (e as Error).message }); }
  }
  async function complete(allowShort: boolean) {
    setBusy(true);
    try {
      const r = await apiSend<{ order: StockOrder }>(`/api/stock-orders/${id}/complete`, 'POST', { allowShort }, false);
      if ('order' in r) { setOrder(r.order); setFlash({ ok: true, text: 'Préparation validée : le stock est sorti vers le chantier.' }); }
    } catch (e) {
      const msg = (e as Error).message || 'Impossible de valider';
      if (/manque/i.test(msg)) Alert.alert('Préparation incomplète', `${msg}\n\nValider quand même avec ce qui est préparé ?`, [{ text: 'Continuer à préparer', style: 'cancel' }, { text: 'Valider quand même', onPress: () => complete(true) }]);
      else setFlash({ ok: false, text: msg });
    } finally { setBusy(false); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: order.ref, headerBackTitle: tr('Retour') }} />

      <Pressable accessibilityRole="button" onPress={() => router.push(`/chantier/${order.worksite.id}` as never)}>
        <Card>
          <Text style={s.ws}>{order.worksite.ref} · {order.worksite.title}</Text>
          <Muted>{order.neededOn ? `Pour le ${new Date(order.neededOn).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}` : 'Sans date de besoin'}</Muted>
          {!!order.note && <Text style={{ color: T.ink, marginTop: 4 }}>{order.note}</Text>}
          <View style={s.track}><View style={[s.fill, { width: `${order.lines.length ? (done / order.lines.length) * 100 : 0}%` }]} /></View>
          <Text style={s.prog}>{done} / {order.lines.length} articles prêts</Text>
        </Card>
      </Pressable>

      {open && <ScanInput onCode={scan} placeholder={tr("Scanner l’article à ajouter")} />}
      {flash && <View style={[s.flash, { backgroundColor: flash.ok ? T.okSoft : T.critSoft }]}><Text style={{ color: flash.ok ? T.ok : T.crit, fontWeight: '700', flex: 1 }}>{flash.text}</Text></View>}

      {order.lines.map((l) => {
        const unit = l.unitName ?? l.stockItem.unit;
        const full = l.pickedQty + 0.0001 >= l.qty;
        return (
          <View key={l.id} style={[s.line, full && s.lineDone]}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              {l.stockItem.photoThumbUrl ? <Image source={{ uri: l.stockItem.photoThumbUrl.startsWith('http') ? l.stockItem.photoThumbUrl : `${API_URL}${l.stockItem.photoThumbUrl}` }} style={s.photo} /> : <View style={[s.photo, { alignItems: 'center', justifyContent: 'center' }]}><Feather name="package" size={20} color={T.ink3} /></View>}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.name} numberOfLines={3}>{l.stockItem.name}</Text>
                <Muted>{[l.stockItem.ref, `${fmtQty(l.stockItem.qty)} en stock`].filter(Boolean).join(' · ')}</Muted>
              </View>
              {full && <View style={s.check}><Feather name="check" size={18} color="#fff" /></View>}
            </View>
            {open ? (
              <View style={s.qtyRow}>
                <Pressable accessibilityRole="button" accessibilityLabel={tr("Moins")} onPress={() => setPicked(l, l.pickedQty - 1)} style={s.step}><Feather name="minus" size={22} color={T.primary} /></Pressable>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={s.picked}>{fmtQty(l.pickedQty)} <Text style={s.of}>/ {fmtQty(l.qty)} {unit}</Text></Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={tr("Plus")} onPress={() => setPicked(l, l.pickedQty + 1)} style={s.step}><Feather name="plus" size={22} color={T.primary} /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={tr("Tout prendre")} onPress={() => setPicked(l, l.qty)} style={[s.step, { backgroundColor: T.primary }]}><Feather name="check-circle" size={22} color="#fff" /></Pressable>
              </View>
            ) : <Text style={s.picked}>{fmtQty(l.pickedQty)} <Text style={s.of}>/ {fmtQty(l.qty)} {unit}</Text></Text>}
            {!!l.note && <Muted>{l.note}</Muted>}
          </View>
        );
      })}

      {open && (
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => complete(false)} style={({ pressed }) => [s.validate, busy && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}>
          <Feather name="check-circle" size={22} color="#fff" />
          <Text style={s.validateTxt}>{busy ? 'Validation…' : 'Valider la préparation'}</Text>
        </Pressable>
      )}
      {!open && <View style={s.flash}><Text style={{ color: T.ink2, flex: 1 }}>{order.status === 'prepared' ? 'Préparation validée : le stock a été sorti vers le chantier.' : 'Préparation annulée.'}</Text></View>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  ws: { fontSize: 17, fontWeight: '800', color: T.ink },
  track: { height: 8, borderRadius: 4, backgroundColor: T.surface2, marginTop: 8 },
  fill: { height: 8, borderRadius: 4, backgroundColor: T.primary },
  prog: { fontSize: 12.5, color: T.ink2, marginTop: 4 },
  flash: { flexDirection: 'row', borderRadius: 16, padding: 14, backgroundColor: T.surface2 },
  line: { ...T.shadow, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 20, padding: 14, gap: 12 },
  lineDone: { backgroundColor: T.okSoft, borderColor: T.primary },
  photo: { width: 52, height: 52, borderRadius: 14, backgroundColor: T.surface2 },
  name: { fontSize: 15.5, fontWeight: '700', color: T.ink },
  check: { width: 30, height: 30, borderRadius: 15, backgroundColor: T.ok, alignItems: 'center', justifyContent: 'center' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { width: 56, height: 56, borderRadius: 18, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  picked: { fontSize: 24, fontWeight: '800', color: T.ink },
  of: { fontSize: 14, fontWeight: '600', color: T.ink2 },
  validate: { flexDirection: 'row', gap: 10, backgroundColor: T.primary, borderRadius: 20, paddingVertical: 19, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  validateTxt: { color: '#fff', fontWeight: '800', fontSize: 17 },
});
