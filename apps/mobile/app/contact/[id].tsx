import { useCallback, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Loading, Row, Badge } from '@/lib/ui';
import { T } from '@/lib/theme';

interface D {
  contact: {
    name: string; email: string | null; phone: string | null; vat: string | null;
    address: string | null; postalCode: string | null; city: string | null;
    syndic: { name: string } | null;
    worksites: { id: string; ref: string; title: string; status: string }[];
  };
}

export default function ContactDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<D | null>(null);
  useFocusEffect(useCallback(() => { apiGet<D>(`/api/contacts/${id}`).then(setD).catch(() => {}); }, [id]));
  if (!d) return <Loading />;
  const c = d.contact;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Stack.Screen options={{ title: c.name, headerBackTitle: 'Retour' }} />
      <Card>
        <Row k="E-mail" v={c.email ?? '—'} />
        <Row k="Téléphone" v={c.phone ?? '—'} />
        <Row k="TVA" v={c.vat ?? '—'} />
        <Row k="Adresse" v={[c.address, c.postalCode, c.city].filter(Boolean).join(' ') || '—'} />
        {c.syndic && <Row k="Syndic" v={c.syndic.name} />}
      </Card>
      <Label>Chantiers ({c.worksites.length})</Label>
      {c.worksites.map((w) => (
        <Card key={w.id}>
          <Text style={{ fontWeight: '600', color: T.ink }}>{w.ref} — {w.title}</Text>
          <Badge>{w.status}</Badge>
        </Card>
      ))}
    </ScrollView>
  );
}
