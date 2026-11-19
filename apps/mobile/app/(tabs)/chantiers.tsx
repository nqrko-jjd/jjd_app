import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, TextInput, Pressable, FlatList, StyleSheet } from 'react-native';
import { Text } from '@/lib/AppText';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Badge, Muted, eur, ScreenHeader, EmptyState } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface WS {
  id: string; ref: string; title: string; status: string; entity: string;
  quotedHt: number | null;
  client: { name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  lead: 'Demande', quote_needed: 'Devis à faire', quote_sent: 'Devis envoyé', to_plan: 'À planifier', scheduled: 'Planifié', in_progress: 'En cours',
  on_hold: 'En attente', done: 'Terminé', to_invoice: 'À facturer', invoiced: 'Facturé',
  closed: 'Clôturé', cancelled: 'Abandonné',
};
const TONE: Record<string, 'ok' | 'warn' | 'crit' | undefined> = {
  in_progress: undefined, done: 'ok', invoiced: 'ok', closed: 'ok', to_invoice: 'warn', on_hold: 'warn', cancelled: 'crit',
};

/** Ordre des pastilles : le parcours d'un chantier, de la demande à la clôture. */
const FILTER_ORDER = ['in_progress', 'to_invoice', 'on_hold', 'lead', 'quote_needed', 'quote_sent', 'to_plan', 'scheduled', 'done', 'invoiced', 'closed', 'cancelled'] as const;
const FILTER_LABEL: Record<string, string> = { on_hold: 'Sous observation / en attente' };

export default function Chantiers() {
  const router = useRouter();
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>();
  const { user } = useSession();
  const worker = user?.role === 'worker';
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>(statusParam && STATUS_LABEL[statusParam] ? statusParam : 'all');
  // l'onglet reste monté : un nouveau lien depuis l'accueil (« À facturer », « Sous observation »…) doit changer le filtre
  useEffect(() => { setFilter(statusParam && STATUS_LABEL[statusParam] ? statusParam : 'all'); }, [statusParam]);
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

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.status] = (c[it.status] ?? 0) + 1;
    return c;
  }, [items]);
  const filtered = useMemo(() => (filter === 'all' ? items : items.filter((it) => it.status === filter)), [items, filter]);
  const pills = [{ key: 'all', label: tr('Tous'), n: items.length }, ...FILTER_ORDER.filter((k) => counts[k] || k === filter).map((k) => ({ key: k as string, label: tr(FILTER_LABEL[k] ?? STATUS_LABEL[k] ?? k), n: counts[k] ?? 0 }))];

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <ScreenHeader title={worker ? 'Mes chantiers' : 'Vos chantiers'} eyebrow="Suivi des travaux" description={`${items.length} dossier${items.length > 1 ? 's' : ''} à retrouver facilement.`}/>

      </View>

      <View style={s.pillRow}>
        {pills.map((f) => (
          <Pressable key={f.key} accessibilityRole="button" onPress={() => setFilter(f.key)} style={[s.pill, filter === f.key && s.pillActive]}>
            <Text style={[s.pillLabel, filter === f.key && s.pillLabelActive]}>{f.label} · {f.n}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ paddingHorizontal: 18 }}>
        <TextInput
          style={s.search}
          placeholder={tr("Rechercher (réf, titre, ville)…")}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={load}
          placeholderTextColor={T.ink2}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ ...T.content, padding: 18, paddingTop: 12, gap: 12 }}
        ListEmptyComponent={<EmptyState title={tr("Aucun chantier trouvé")} description={tr("Changez le filtre ou votre recherche.")} icon="home"/>}
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => router.push(`/chantier/${item.id}` as never)}>
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
  pillRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8, flexDirection: 'row', flexWrap: 'wrap' },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line },
  pillActive: { backgroundColor: T.primary, borderColor: T.primary },
  pillLabel: { color: T.ink2, fontWeight: '600', fontSize: 13 },
  pillLabelActive: { color: '#fff' },
  search: { minHeight: 48, fontSize: 14, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, padding: 14, color: T.ink },
  row: { ...T.shadow, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: T.radius, padding: 18 },
  rowTitle: { color: T.ink, fontSize: 17, lineHeight: 25, fontWeight: '700', marginBottom: 12 },
  ref: { fontWeight: '700', color: T.accent, fontSize: 12.5 },
  amount: { color: T.ink, fontSize: 15, fontWeight: '700', marginLeft: 10 },
});
