import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Muted, Loading, eur } from '@/lib/ui';
import { MonthBars, HBars, compact } from '@/lib/charts';
import { T } from '@/lib/theme';

interface Analytics {
  range: { months: number };
  monthly: { month: string; revenue: number; expenses: number; hours: number }[];
  totals: { revenue: number; expenses: number; result: number; collected: number; hours: number; marginPct: number | null };
  prev: { revenue: number; expenses: number; result: number; collected: number; hours: number; marginPct: number | null };
  expenseSections: { key: string; label: string; total: number }[];
  topWorksites: { ref: string; title: string; margin: number }[];
  topClients: { name: string; revenue: number; invoices: number }[];
  quotes: { sent: number; accepted: number; declined: number; pending: number; pipelineHt: number; acceptRate: number | null };
}

/** Variation en %, masquée si la période précédente est trop faible pour être parlante. */
const pct = (cur: number, prev: number, minBase = 5000) => {
  if (Math.abs(prev) < minBase) return null;
  const v = ((cur - prev) / Math.abs(prev)) * 100;
  return Math.abs(v) > 250 ? null : Math.round(v);
};

export default function Analyse() {
  const [months, setMonths] = useState(12);
  const [entity, setEntity] = useState('');
  const [data, setData] = useState<Analytics | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Analytics>(`/api/finance/analytics?months=${months}${entity ? `&entity=${entity}` : ''}`));
      setFailed(false);
    } catch { setFailed(true); }
  }, [months, entity]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ ...T.content, gap: 18 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Stack.Screen options={{ title: 'Analyse', headerBackTitle: 'Retour' }} />

      <View style={{ gap: 10 }}>
        <Seg value={String(months)} onChange={(v) => setMonths(Number(v))} options={[['6', '6 mois'], ['12', '12 mois'], ['24', '24 mois']]} />
        <Seg value={entity} onChange={setEntity} options={[['', 'Toutes entités'], ['jjd', 'JJD'], ['tonton', 'Tonton']]} />
      </View>

      {!data && !failed && <Loading />}
      {failed && !data && <Card><Muted>Impossible de charger l’analyse (connexion ?). Tire vers le bas pour réessayer.</Muted></Card>}
      {data && (
        <>
          <View style={s.tiles}>
            <Tile label="CA net" value={eur(data.totals.revenue)} delta={pct(data.totals.revenue, data.prev.revenue)} />
            <Tile label="Résultat" value={eur(data.totals.result)} delta={pct(data.totals.result, data.prev.result)} bad={data.totals.result < 0} />
            <Tile label="Marge" value={data.totals.marginPct != null ? `${data.totals.marginPct} %` : '—'} delta={data.totals.marginPct != null && data.prev.marginPct != null ? Math.round(data.totals.marginPct - data.prev.marginPct) : null} suffix=" pt" />
            <Tile label="Encaissé" value={eur(data.totals.collected)} delta={pct(data.totals.collected, data.prev.collected)} />
            <Tile label="Heures pointées" value={Math.round(data.totals.hours).toLocaleString('fr-BE')} delta={pct(data.totals.hours, data.prev.hours, 200)} />
          </View>
          <Muted>Le facturé n’est pas le solde en banque : les règlements se contrôlent dans le rapprochement bancaire du site.</Muted>

          <Card>
            <Label>Facturé et dépenses par mois</Label>
            <MonthBars rows={data.monthly.map((m) => ({ month: m.month, a: m.revenue, b: m.expenses }))} series={{ a: 'Facturé', b: 'Dépenses' }} />
          </Card>

          <Card>
            <Label>Heures pointées par mois</Label>
            <MonthBars rows={data.monthly.map((m) => ({ month: m.month, a: m.hours }))} series={{ a: 'Heures' }} />
          </Card>

          <Card>
            <Label>Répartition des dépenses</Label>
            {data.expenseSections.length === 0 ? <Muted>Aucune dépense sur la période.</Muted>
              : <HBars rows={data.expenseSections.map((x) => ({ label: x.label, value: x.total }))} format={(n) => `${compact(n)} €`} />}
          </Card>

          <Card>
            <Label>Top chantiers · marge réelle</Label>
            {data.topWorksites.length === 0 ? <Muted>Rien à afficher.</Muted>
              : <HBars rows={data.topWorksites.map((w) => ({ label: `${w.ref} · ${w.title}`, value: w.margin }))} format={(n) => `${compact(n)} €`} />}
          </Card>

          <Card>
            <Label>Top clients · chiffre d’affaires</Label>
            {data.topClients.length === 0 ? <Muted>Rien à afficher.</Muted>
              : <HBars rows={data.topClients.map((c) => ({ label: `${c.name} (${c.invoices} fact.)`, value: c.revenue }))} format={(n) => `${compact(n)} €`} />}
          </Card>

          <Label>Devis</Label>
          <View style={s.tiles}>
            <Tile label="Émis" value={String(data.quotes.sent)} sub={`${data.quotes.pending} en attente`} />
            <Tile label="Acceptés" value={String(data.quotes.accepted)} sub={`${data.quotes.declined} déclinés / expirés`} />
            <Tile label="Taux d’acceptation" value={data.quotes.acceptRate != null ? `${data.quotes.acceptRate} %` : '—'} />
            <Tile label="Pipeline HT" value={eur(data.quotes.pipelineHt)} sub="devis envoyés, non tranchés" />
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <View style={s.seg}>
      {options.map(([k, label]) => (
        <Pressable key={k || 'all'} accessibilityRole="button" onPress={() => onChange(k)} style={[s.segBtn, value === k && s.segOn]}>
          <Text style={[s.segTxt, value === k && { color: '#fff' }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Tile({ label, value, delta, suffix = ' %', sub, bad }: { label: string; value: string; delta?: number | null; suffix?: string; sub?: string; bad?: boolean }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={[s.tileValue, bad && { color: T.crit }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {delta != null && <Text style={{ fontSize: 11.5, fontWeight: '700', color: delta >= 0 ? T.ok : T.crit }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}{suffix} <Text style={{ fontWeight: '400', color: T.ink2 }}>vs période préc.</Text></Text>}
      {sub && <Text style={{ fontSize: 11.5, color: T.ink2 }}>{sub}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: T.surface2, borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segOn: { backgroundColor: T.primary },
  segTxt: { fontSize: 13, fontWeight: '600', color: T.ink2 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { ...T.shadow, flexGrow: 1, flexBasis: '46%', backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: T.radius - 4, padding: 14, gap: 4 },
  tileLabel: { fontSize: 12, color: T.ink2 },
  tileValue: { fontSize: 19, fontWeight: '800', color: T.ink, letterSpacing: -0.4 },
});
