import { useCallback, useState } from 'react';
import { ScrollView, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack, useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { ScreenHeader, Card, Label, Loading, Row, Badge } from '@/lib/ui';
import { WORKSITE_STATUS_LABEL } from '@/lib/labels';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

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
  const router = useRouter();
  const [d, setD] = useState<D | null>(null);
  useFocusEffect(useCallback(() => { apiGet<D>(`/api/contacts/${id}`).then(setD).catch(() => {}); }, [id]));
  if (!d) return <Loading />;
  const c = d.contact;


  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 20 }}>
      <Stack.Screen options={{ title: c.name, headerBackTitle: tr('Retour') }} />
      <ScreenHeader title={c.name} eyebrow="Contact" description={[c.address, c.postalCode, c.city].filter(Boolean).join(' · ')}/>
      <Card>
        <Row k="E-mail" v={c.email ?? '—'} />
        <Row k="Téléphone" v={c.phone ?? '—'} />
        <Row k="TVA" v={c.vat ?? '—'} />
        <Row k="Adresse" v={[c.address, c.postalCode, c.city].filter(Boolean).join(' ') || '—'} />
        {c.syndic && <Row k="Syndic" v={c.syndic.name} />}
      </Card>
      <Label>Chantiers ({c.worksites.length})</Label>
      {c.worksites.map((w) => (
        <Pressable key={w.id} accessibilityRole="button" accessibilityLabel={`Ouvrir ${w.title}`} onPress={() => router.push(`/chantier/${w.id}` as never)}><Card>
          <Text style={{ fontWeight: '600', color: T.ink }}>{w.ref} — {w.title}</Text>
          <Badge>{WORKSITE_STATUS_LABEL[w.status as keyof typeof WORKSITE_STATUS_LABEL] ?? w.status}</Badge>
        </Card></Pressable>
      ))}
    </ScrollView>
  );
}
