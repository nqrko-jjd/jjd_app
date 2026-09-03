import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
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

export default function Chantiers() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<WS[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ items: WS[] }>(`/api/worksites${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setItems(r.items);
    } catch {
      /* hors ligne */
    }
  }, [q]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <View style={{ padding: 12 }}>
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
        data={items}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: 12, paddingTop: 0, gap: 8 }}
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => router.push(`/chantier/${item.id}`)}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>
                <Text style={s.ref}>{item.ref}</Text> — {item.title}
              </Text>
              <Muted>{item.client?.name ?? '—'}</Muted>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Badge tone={TONE[item.status]}>{STATUS_LABEL[item.status] ?? item.status}</Badge>
              <Text style={s.amount}>{eur(item.quotedHt)}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  search: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 12, color: T.ink },
  row: { flexDirection: 'row', gap: 10, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 12 },
  title: { color: T.ink, fontWeight: '500' },
  ref: { fontWeight: '700' },
  amount: { color: T.ink2, fontSize: 12 },
});
