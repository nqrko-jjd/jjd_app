import { useCallback, useMemo, useState } from 'react';
import { View, TextInput, Pressable, FlatList, StyleSheet, ScrollView } from 'react-native';
import { Text } from '@/lib/AppText';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Badge, Muted, eur } from '@/lib/ui';
import { T } from '@/lib/theme';

interface WS {
  id: string; ref: string; title: string; status: string; entity: string;
  quotedHt: number | null;
  client: { name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  lead: 'Demande', to_plan: 'À planifier', scheduled: 'Planifié', in_progress: 'En cours',
  on_hold: 'En attente', done: 'Terminé', to_invoice: 'À facturer', invoiced: 'Facturé',
  closed: 'Clôturé', cancelled: 'Abandonné',
};
const TONE: Record<string, 'ok' | 'warn' | 'crit' | undefined> = {
  in_progress: undefined, done: 'ok', invoiced: 'ok', closed: 'ok', to_invoice: 'warn', on_hold: 'warn', cancelled: 'crit',
};

const OPEN_STATUSES = ['lead', 'to_plan', 'scheduled', 'in_progress', 'on_hold'];

const FILTERS = [
  { key: 'all', label: 'Tous', test: () => true },
  { key: 'open', label: 'En cours', test: (it: WS) => OPEN_STATUSES.includes(it.status) },
  { key: 'to_invoice', label: 'À facturer', test: (it: WS) => it.status === 'to_invoice' },
] as const;

export default function Chantiers() {
  const router = useRouter();
  const { user } = useSession();
  const worker = user?.role === 'worker';
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [items, setItems] = useState<WS[]>([]);

  const load = useCallback(async () => {
    try {
      const path = worker ? '/api/worksites/mine' : '/api/worksites';
      const r = await apiGet<{ items: WS[] }>(`${path}${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setItems(r.items);
    } catch {
      /* hors ligne */
    }
  }, [q, worker]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const filtered = useMemo(() => items.filter(active.test), [items, active]);

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Text style={s.eyebrow}>Suivi des travaux</Text>
        <Text style={s.title}>{worker ? 'Mes chantiers' : 'Vos chantiers'}</Text>
        <Muted style={{ marginBottom: 12 }}>
          {items.length} dossier{items.length > 1 ? 's' : ''} relevé{items.length > 1 ? 's' : ''}
        </Muted>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pillRow}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[s.pill, filter === f.key && s.pillActive]}>
            <Text style={[s.pillLabel, filter === f.key && s.pillLabelActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: 12 }}>
        <TextInput
          style={s.search}
          placeholder="Rechercher (réf, titre, ville)…"
          value={q}
          onChangeText={setQ}
          onSubmitEditing={load}
          placeholderTextColor={T.ink2}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: 12, paddingTop: 8, gap: 8 }}
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => router.push((worker ? `/fil/${item.id}` : `/chantier/${item.id}`) as never)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Text style={s.ref}>{item.ref}</Text>
              <Badge tone={TONE[item.status]}>{STATUS_LABEL[item.status] ?? item.status}</Badge>
            </View>
            <Text style={s.rowTitle}>{item.title}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Muted>{item.client?.name ?? '—'}</Muted>
              {!worker && <Text style={s.amount}>{eur(item.quotedHt)}</Text>}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  eyebrow: { fontSize: 11.5, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '800', color: T.ink, marginTop: 2, marginBottom: 2 },
  pillRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line },
  pillActive: { backgroundColor: T.primary, borderColor: T.primary },
  pillLabel: { color: T.ink2, fontWeight: '600', fontSize: 13 },
  pillLabelActive: { color: '#fff' },
  search: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 12, color: T.ink },
  row: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: T.radius, padding: 12 },
  rowTitle: { color: T.ink, fontWeight: '700', marginBottom: 4 },
  ref: { fontWeight: '700', color: T.accent, fontSize: 12.5 },
  amount: { color: T.ink2, fontSize: 12 },
});
