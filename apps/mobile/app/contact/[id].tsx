import { useCallback, useState } from 'react';
import { ScrollView, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack, useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { ScreenHeader, Card, Label, Loading, Row, Badge } from '@/lib/ui';
import { WORKSITE_STATUS_LABEL } from '@/lib/labels';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';
import { EditButton, type Section } from '@/lib/EditForm';

interface D {
  contact: {
    name: string; email: string | null; phone: string | null; vat: string | null;
    address: string | null; postalCode: string | null; city: string | null;
    syndic: { name: string } | null;
    worksites: { id: string; ref: string; title: string; status: string }[];
  };
}

const CONTACT_SECTIONS: Section[] = [
  { title: 'Contact', fields: [
    { key: 'name', label: 'Nom', required: true },
    { key: 'type', label: 'Type', type: 'select', required: true, options: [{ value: 'client', label: 'Client' }, { value: 'supplier', label: 'Fournisseur' }, { value: 'both', label: 'Les deux' }] },
    { key: 'jobTitle', label: 'Fonction' }, { key: 'email', label: 'E-mail', type: 'email' }, { key: 'phone', label: 'Téléphone', type: 'phone' }, { key: 'vat', label: 'N° TVA' },
  ] },
  { title: 'Adresse', fields: [
    { key: 'address', label: 'Adresse' }, { key: 'box', label: 'Boîte' }, { key: 'postalCode', label: 'Code postal' }, { key: 'city', label: 'Ville' },
  ] },
  { title: 'Fournisseur', fields: [
    { key: 'customerNumber', label: 'Notre n° de client chez lui' }, { key: 'onAccount', label: 'Achats en compte', type: 'bool' },
  ] },
  { title: 'Notes', fields: [{ key: 'note', label: 'Note', type: 'multiline' }] },
];

export default function ContactDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<D | null>(null);
  const load = useCallback(() => { apiGet<D>(`/api/contacts/${id}`).then(setD).catch(() => {}); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!d) return <Loading />;
  const c = d.contact;


  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 20 }}>
      <Stack.Screen options={{ title: c.name, headerBackTitle: tr('Retour') }} />
      <ScreenHeader title={c.name} eyebrow="Contact" description={[c.address, c.postalCode, c.city].filter(Boolean).join(' · ')}/>
      <EditButton title={c.name} sections={CONTACT_SECTIONS} values={c as unknown as Record<string, unknown>} path={`/api/contacts/${id}`} onSaved={load} />
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
