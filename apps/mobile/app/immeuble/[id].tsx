import { useCallback, useState } from 'react';
import { ScrollView, Text, Pressable } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Loading, Row, Badge, useRouterPush } from '@/lib/ui';
import { T } from '@/lib/theme';

interface D {
  building: {
    name: string; address: string | null; city: string | null;
    syndic: { name: string; email: string | null; phone: string | null } | null;
    worksites: { id: string; ref: string; title: string; status: string }[];
  };
}

export default function ImmeubleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const push = useRouterPush();
  const [d, setD] = useState<D | null>(null);
  useFocusEffect(useCallback(() => { apiGet<D>(`/api/buildings/${id}`).then(setD).catch(() => {}); }, [id]));
  if (!d) return <Loading />;
  const b = d.building;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Stack.Screen options={{ title: b.name, headerBackTitle: 'Retour' }} />
      <Card>
        <Row k="Adresse" v={[b.address, b.city].filter(Boolean).join(', ') || '—'} />
        {b.syndic && <Row k="Syndic" v={b.syndic.name} />}
        {b.syndic?.phone && <Row k="Tél. syndic" v={b.syndic.phone} />}
      </Card>
      <Label>Interventions ({b.worksites.length})</Label>
      {b.worksites.map((w) => (
        <Pressable key={w.id} onPress={() => push(`/chantier/${w.id}`)}>
          <Card>
            <Text style={{ fontWeight: '600', color: T.ink }}>{w.ref} — {w.title}</Text>
            <Badge>{w.status}</Badge>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
