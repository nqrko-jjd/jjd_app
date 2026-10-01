import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Feather } from '@expo/vector-icons';
import { Card, HeroTile, Label, Muted, Loading, eur, ScreenHeader, EmptyState } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Dash {
  kpis: { invoicedMonth: number; paidMonth: number; overdueAmount: number; overdueCount: number; openWorksites: number; hoursWeek: number };
  alerts: { kind: string; severity: string; label: string; count: number; amount?: number }[];
}

const TODAY = new Date().toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });

export default function Dashboard() {
  const { person } = useSession();
  const router = useRouter();
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
  const first = person?.firstName ?? person?.displayName?.split(' ')[0];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ ...T.content, padding: 16, gap: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <ScreenHeader eyebrow={TODAY} title={first ? `Bonjour ${first},` : 'Bonjour,'} description="Votre activité et vos priorités, en un regard." avatar={first?.slice(0,1) || 'J'}/>


      <Pressable accessibilityRole="button" onPress={()=>router.push('/documents' as never)}><HeroTile icon="bar-chart-2">
        <Text style={s.heroLabel}>Facturé ce mois</Text>
        <Text style={s.heroValue}>{eur(data.kpis.invoicedMonth)}</Text>
      </HeroTile></Pressable>

      <View style={s.kpiRow}>
        <Kpi
          icon="credit-card"
          label="Encaissé ce mois"
          value={eur(data.kpis.paidMonth)}
          onPress={() => router.push('/documents' as never)}
          sub={data.kpis.invoicedMonth ? `${Math.round((data.kpis.paidMonth / data.kpis.invoicedMonth) * 100)} % du montant facturé` : undefined}
        />
        <Kpi
          icon="home"
          label="Chantiers en cours"
          value={String(data.kpis.openWorksites)}
          onPress={() => router.push('/chantiers?status=in_progress' as never)}
        />
      </View>

      <Pressable accessibilityRole="button" style={[s.kpi, s.kpiWarn]} onPress={()=>router.push('/documents' as never)}>
        <View style={s.kpiHead}>
          <Text style={[s.kpiLabel, { color: T.kpiWarnFg }]}>Impayés</Text>
          <View style={[s.kpiIcon, { backgroundColor: T.kpiWarnIconBg }]}>
            <Feather name="flag" size={14} color={T.kpiWarnFg} />
          </View>
        </View>
        <Text style={[s.kpiValue, { color: T.kpiWarnFg }]}>{eur(data.kpis.overdueAmount)}</Text>
        <Text style={s.kpiSub}>{data.kpis.overdueCount} facture{data.kpis.overdueCount > 1 ? 's' : ''} en retard</Text>
      </Pressable>

      <Label>À suivre</Label>
      {data.alerts.length === 0 && <EmptyState title="Tout est à jour" description="Aucune alerte à traiter pour le moment." icon="check-circle"/>}
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

function Kpi({
  icon, label, value, sub, onPress,
}: { icon: keyof typeof Feather.glyphMap; label: string; value: string; sub?: string; onPress?: () => void }) {
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap style={s.kpi} onPress={onPress}>
      <View style={s.kpiHead}>
        <Text style={s.kpiLabel}>{label}</Text>
        <View style={s.kpiIcon}>
          <Feather name={icon} size={14} color={T.gold} />
        </View>
      </View>
      <Text style={s.kpiValue}>{value}</Text>
      {sub && <Text style={s.kpiSub}>{sub}</Text>}
    </Wrap>
  );
}

const s = StyleSheet.create({
  eyebrow: { fontSize: 11.5, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', marginBottom: 4 },
  greeting: { fontSize: 24, fontWeight: '800', color: T.ink, marginBottom: 2 },
  kpiRow: { flexDirection: 'row', gap: 10 },
  heroLabel: { fontSize: 12.5, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  heroValue: { fontSize: 34, fontWeight: '800', color: '#fff', marginTop: 4 },
  kpi: { ...T.shadow, flex: 1, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: T.radius + 3, padding: 18, gap: 8 },
  kpiWarn: { backgroundColor: T.kpiWarnBg, borderColor: T.kpiWarnBorder },
  kpiHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kpiIcon: { width: 26, height: 26, borderRadius: 8, backgroundColor: T.goldSoft, alignItems: 'center', justifyContent: 'center' },
  kpiLabel: { fontSize: 12.5, color: T.ink2, flexShrink: 1, marginRight: 6 },
  kpiValue: { fontSize: 23, fontWeight: '700', color: T.ink, letterSpacing: -0.4 },
  kpiSub: { fontSize: 11, color: T.ink2 },
});
