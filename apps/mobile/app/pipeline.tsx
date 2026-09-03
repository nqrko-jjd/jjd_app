import { useCallback, useState } from 'react';
import { ScrollView, Text, View, RefreshControl } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Loading, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Opp {
  id: string; title: string; stage: string; estimatedValue: number | null;
  nextActionOn: string | null; nextActionNote: string | null;
  contact: { name: string } | null;
  building: { name: string } | null;
}
const STAGE: Record<string, string> = {
  new: 'Nouvelle demande', to_qualify: 'À qualifier', visit_scheduled: 'Visite planifiée',
  quote_sent: 'Devis envoyé', follow_up: 'Relancé',
};
const ORDER = ['new', 'to_qualify', 'visit_scheduled', 'quote_sent', 'follow_up'];

export default function Pipeline() {
  const [cols, setCols] = useState<{ stage: string; items: Opp[] }[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ columns: { stage: string; items: Opp[] }[] }>('/api/crm');
      setCols(r.columns);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!cols) return <Loading />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Stack.Screen options={{ title: 'Pipeline', headerBackTitle: 'Retour' }} />
      {ORDER.map((stage) => {
        const col = cols.find((c) => c.stage === stage);
        const items = col?.items ?? [];
        return (
          <View key={stage} style={{ gap: 6 }}>
            <Label>{STAGE[stage] ?? stage} ({items.length})</Label>
            {items.length === 0 && <Text style={{ color: T.ink3 }}>—</Text>}
            {items.map((o) => {
              const overdue = o.nextActionOn && new Date(o.nextActionOn).getTime() < Date.now();
              return (
                <Card key={o.id}>
                  <Text style={{ fontWeight: '600', color: T.ink }}>{o.title}</Text>
                  <Text style={{ color: T.ink2 }}>
                    {o.contact?.name ?? o.building?.name ?? '—'}
                    {o.estimatedValue != null ? ` · ${eur(o.estimatedValue)}` : ''}
                  </Text>
                  {o.nextActionOn && (
                    <Text style={{ color: overdue ? T.crit : T.ink2, fontSize: 12 }}>
                      {dateBE(o.nextActionOn)}{o.nextActionNote ? ` · ${o.nextActionNote}` : ''}
                    </Text>
                  )}
                </Card>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}
