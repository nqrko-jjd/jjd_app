import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Muted, Loading, eur } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Dash {
  kpis: { invoicedMonth: number; paidMonth: number; overdueAmount: number; overdueCount: number; openWorksites: number; hoursWeek: number };
  alerts: { kind: string; severity: string; label: string; count: number; amount?: number }[];
}

export default function Dashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Dash>('/api/dashboard'));
    } catch {
      /* hors ligne */
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data) return <Loading />;

  const sevColor: Record<string, string> = { critical: T.crit, warning: T.accent, info: T.ink2 };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <View style={s.kpiRow}>
        <Kpi label="Facturé ce mois" value={eur(data.kpis.invoicedMonth)} />
        <Kpi label="Encaissé" value={eur(data.kpis.paidMonth)} />
      </View>
      <View style={s.kpiRow}>
        <Kpi label="Impayés" value={eur(data.kpis.overdueAmount)} sub={`${data.kpis.overdueCount} factures`} />
        <Kpi label="Chantiers ouverts" value={String(data.kpis.openWorksites)} />
      </View>

      <Label>Alertes</Label>
      {data.alerts.length === 0 && <Muted>Rien à signaler.</Muted>}
      {data.alerts.map((a) => (
        <Card key={a.kind}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, backgroundColor: sevColor[a.severity] ?? T.ink2 }} />
            <Text style={{ flex: 1, color: T.ink }}>{a.label}</Text>
            <Text style={{ fontWeight: '700', color: T.ink }}>{a.count}</Text>
          </View>
          {a.amount != null && <Muted>{eur(a.amount)}</Muted>}
        </Card>
      ))}
    </ScrollView>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={s.kpiValue}>{value}</Text>
      {sub && <Text style={s.kpiSub}>{sub}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  kpiRow: { flexDirection: 'row', gap: 10 },
  kpi: { flex: 1, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: T.radius, padding: 12 },
  kpiLabel: { fontSize: 11, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiValue: { fontSize: 18, fontWeight: '700', color: T.ink, marginTop: 3 },
  kpiSub: { fontSize: 11, color: T.ink2 },
});
