import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Text } from '@/lib/AppText';
import { apiGet, apiSend } from '@/lib/api';
import { T } from './theme';
import { fmtQty, type StockItem } from './stock';

type Move = 'out' | 'in';

/** Entrée / sortie de stock en quelques touches : quantité au pouce, unité, chantier (pour une sortie). */
export function StockMove({ item, defaultUnit, onDone }: { item: StockItem; defaultUnit?: string | null; onDone: (msg: string) => void }) {
  const [type, setType] = useState<Move>('out');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<string>(defaultUnit ?? item.unit);
  const [ws, setWs] = useState<{ id: string; name: string } | null>(null);
  const [q, setQ] = useState('');
  const [worksites, setWorksites] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { apiGet<{ worksites: { id: string; name: string }[] }>('/api/stock/meta').then((r) => setWorksites(r.worksites)).catch(() => {}); }, []);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? worksites.filter((w) => w.name.toLowerCase().includes(s)).slice(0, 5) : worksites.slice(0, 4);
  }, [q, worksites]);

  const units = [item.unit, ...item.units.map((u) => u.name)];
  const n = Number(qty.replace(',', '.'));
  const bump = (d: number) => setQty(fmtQty(Math.max(0, Math.round(((Number.isFinite(n) ? n : 0) + d) * 100) / 100)));

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await apiSend('/api/stock/movements', 'POST', {
        stockItemId: item.id, type, qty: n, unit: unit === item.unit ? null : unit, worksiteId: type === 'out' ? ws?.id ?? null : null,
      }, false);
      onDone(`${type === 'out' ? 'Sortie' : 'Entrée'} de ${fmtQty(n)} ${unit} enregistrée.`);
      setQty('1');
    } catch (e) { setErr((e as Error).message || 'Échec de l’enregistrement'); } finally { setBusy(false); }
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={s.seg}>
        {([['out', 'Sortie'], ['in', 'Entrée']] as [Move, string][]).map(([k, label]) => (
          <Pressable key={k} accessibilityRole="button" onPress={() => setType(k)} style={[s.segBtn, type === k && (k === 'out' ? s.segOut : s.segIn)]}>
            <Feather name={k === 'out' ? 'arrow-up-right' : 'arrow-down-left'} size={16} color={type === k ? '#fff' : T.ink2} />
            <Text style={[s.segTxt, type === k && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.qtyRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Moins" onPress={() => bump(-1)} style={s.step}><Feather name="minus" size={24} color={T.primary} /></Pressable>
        <TextInput value={qty} onChangeText={setQty} keyboardType="decimal-pad" selectTextOnFocus style={s.qty} />
        <Pressable accessibilityRole="button" accessibilityLabel="Plus" onPress={() => bump(1)} style={s.step}><Feather name="plus" size={24} color={T.primary} /></Pressable>
      </View>

      {units.length > 1 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {units.map((u) => (
            <Pressable key={u} accessibilityRole="button" onPress={() => setUnit(u)} style={[s.chip, unit === u && s.chipOn]}><Text style={[s.chipTxt, unit === u && { color: '#fff' }]}>{u}</Text></Pressable>
          ))}
        </View>
      )}

      {type === 'out' && (
        <View style={{ gap: 8 }}>
          <Text style={s.label}>Pour quel chantier ?</Text>
          {ws ? (
            <Pressable accessibilityRole="button" onPress={() => setWs(null)} style={s.picked}>
              <Text style={{ flex: 1, color: T.ink, fontWeight: '700' }} numberOfLines={2}>{ws.name}</Text>
              <Feather name="x" size={18} color={T.ink2} />
            </Pressable>
          ) : (
            <>
              <TextInput value={q} onChangeText={setQ} placeholder="Chercher un chantier (réf ou nom)" placeholderTextColor={T.ink3} style={s.search} />
              {matches.map((w) => (
                <Pressable key={w.id} accessibilityRole="button" onPress={() => setWs(w)} style={s.option}><Text style={{ color: T.ink }} numberOfLines={2}>{w.name}</Text></Pressable>
              ))}
            </>
          )}
        </View>
      )}

      {err && <Text style={{ color: T.crit, fontWeight: '600' }}>{err}</Text>}
      <Pressable accessibilityRole="button" disabled={busy || !(n > 0) || (type === 'out' && !ws)} onPress={submit} style={({ pressed }) => [s.go, type === 'in' && { backgroundColor: T.ok }, (busy || !(n > 0) || (type === 'out' && !ws)) && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.98 }] }]}>
        <Text style={s.goTxt}>{busy ? 'Enregistrement…' : type === 'out' ? `Sortir ${fmtQty(n || 0)} ${unit}` : `Rentrer ${fmtQty(n || 0)} ${unit}`}</Text>
      </Pressable>
      {type === 'out' && !ws && <Text style={{ color: T.ink2, fontSize: 12.5 }}>Choisis le chantier pour activer la sortie.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: T.surface2, borderRadius: 16, padding: 4 },
  segBtn: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 13, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  segOut: { backgroundColor: T.accent },
  segIn: { backgroundColor: T.primary },
  segTxt: { fontWeight: '800', fontSize: 15, color: T.ink2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  step: { width: 64, height: 64, borderRadius: 20, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  qty: { flex: 1, minWidth: 0, width: 0, height: 64, borderRadius: 20, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, textAlign: 'center', fontSize: 30, fontWeight: '800', color: T.ink },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line },
  chipOn: { backgroundColor: T.primary, borderColor: T.primary },
  chipTxt: { fontWeight: '700', color: T.ink },
  label: { fontSize: 12.5, fontWeight: '700', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 },
  search: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, paddingHorizontal: 14, fontSize: 15, color: T.ink },
  option: { padding: 14, borderRadius: 14, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: T.primarySoft, borderWidth: 1, borderColor: T.primary },
  go: { backgroundColor: T.accent, borderRadius: 18, paddingVertical: 18, alignItems: 'center' },
  goTxt: { color: '#fff', fontWeight: '800', fontSize: 17 },
});
