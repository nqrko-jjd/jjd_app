import { useCallback, useState } from 'react';
import { ScrollView, Text, View, Pressable, RefreshControl } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { apiGet, apiSend } from '@/lib/api';
import { Card, Loading, Badge } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Issue {
  id: string; entity: string; rowRef: string | null; severity: string; message: string;
}
const ENT: Record<string, string> = { worksite: 'Chantiers', ledger: 'Grand livre', time_entry: 'Pointage', contact: 'Contacts', person: 'Personnes' };

export default function Controle() {
  const [data, setData] = useState<{ items: Issue[]; openBySeverity: Record<string, number> } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await apiGet('/api/imports/issues?resolved=0')); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function resolve(id: string) {
    setData((c) => (c ? { ...c, items: c.items.filter((x) => x.id !== id) } : c));
    await apiSend(`/api/imports/issues/${id}`, 'PATCH', { resolved: true });
  }

  if (!data) return <Loading />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Stack.Screen options={{ title: 'File de contrôle', headerBackTitle: 'Retour' }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Badge tone="crit">{data.openBySeverity.error ?? 0} erreurs</Badge>
        <Badge tone="warn">{data.openBySeverity.warning ?? 0} avertis.</Badge>
        <Badge>{data.openBySeverity.info ?? 0} infos</Badge>
      </View>
      {data.items.slice(0, 150).map((i) => (
        <Card key={i.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: T.ink2, fontSize: 12 }}>{ENT[i.entity] ?? i.entity} · {i.rowRef ?? ''}</Text>
            <Pressable onPress={() => resolve(i.id)}>
              <Text style={{ color: T.primary, fontWeight: '700', fontSize: 12 }}>Traité</Text>
            </Pressable>
          </View>
          <Text style={{ color: T.ink }}>{i.message}</Text>
        </Card>
      ))}
      {data.items.length === 0 && <Text style={{ color: T.ink2 }}>Rien à traiter.</Text>}
    </ScrollView>
  );
}
