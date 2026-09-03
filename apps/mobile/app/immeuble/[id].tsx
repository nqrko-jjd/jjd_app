import { useCallback, useState } from 'react';
import { ScrollView, Text, Pressable, Linking, View } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Loading, Row, Badge, Muted, useRouterPush } from '@/lib/ui';
import { T } from '@/lib/theme';

const BUILDING_CONTACT_ROLE_LABEL: Record<string, string> = {
  concierge: 'Concierge', president: "Président d'assemblée", council: 'Membre du conseil',
  syndic_manager: 'Gestionnaire syndic', contact: 'Contact', owner_rep: 'Représentant des copropriétaires', other: 'Autre',
};
const OCCUPANT_KIND_LABEL: Record<string, string> = { owner: 'Propriétaire', tenant: 'Locataire', unknown: 'Inconnu' };

interface BContact { id: string; role: string; name: string; phone: string | null; email: string | null; note: string | null }
interface BUnit {
  id: string; label: string; floor: string | null; door: string | null;
  occupantName: string | null; occupantPhone: string | null; occupantEmail: string | null; occupantKind: string | null;
}
interface D {
  building: {
    name: string; address: string | null; city: string | null; postalCode: string | null;
    reference: string | null; lotCount: number | null; digicode: string | null; accessNote: string | null;
    syndic: { name: string; email: string | null; phone: string | null } | null;
    contacts: BContact[]; units: BUnit[];
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
        <Row k="Adresse" v={[b.address, [b.postalCode, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'} />
        {b.syndic && <Row k="Syndic" v={b.syndic.name} />}
        {b.syndic?.phone && <Row k="Tél. syndic" v={b.syndic.phone} />}
        {b.reference && <Row k="Référence" v={b.reference} />}
        {b.lotCount != null && <Row k="Lots" v={String(b.lotCount)} />}
        {b.digicode && <Row k="Digicode" v={b.digicode} />}
      </Card>
      {b.accessNote ? <Card><Label>Accès</Label><Text style={{ color: T.ink }}>{b.accessNote}</Text></Card> : null}

      {b.contacts.length > 0 && <Label>Contacts clés ({b.contacts.length})</Label>}
      {b.contacts.map((c) => (
        <Card key={c.id}>
          <Muted>{BUILDING_CONTACT_ROLE_LABEL[c.role] ?? c.role}</Muted>
          <Text style={{ fontWeight: '700', color: T.ink }}>{c.name}</Text>
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 4 }}>
            {c.phone ? <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`)}><Text style={{ color: T.primary, fontWeight: '600' }}>{c.phone}</Text></Pressable> : null}
            {c.email ? <Pressable onPress={() => Linking.openURL(`mailto:${c.email}`)}><Text style={{ color: T.primary }}>{c.email}</Text></Pressable> : null}
          </View>
          {c.note ? <Muted>{c.note}</Muted> : null}
        </Card>
      ))}

      {b.units.length > 0 && <Label>Lots & occupants ({b.units.length})</Label>}
      {b.units.map((u) => (
        <Card key={u.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', color: T.ink }}>{u.label}{u.floor ? ` · ${u.floor}` : ''}{u.door ? ` · ${u.door}` : ''}</Text>
            {u.occupantKind ? <Muted>{OCCUPANT_KIND_LABEL[u.occupantKind]}</Muted> : null}
          </View>
          {u.occupantName ? <Text style={{ color: T.ink }}>{u.occupantName}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 2 }}>
            {u.occupantPhone ? <Pressable onPress={() => Linking.openURL(`tel:${u.occupantPhone}`)}><Text style={{ color: T.primary, fontWeight: '600' }}>{u.occupantPhone}</Text></Pressable> : null}
            {u.occupantEmail ? <Text style={{ color: T.ink2 }}>{u.occupantEmail}</Text> : null}
          </View>
        </Card>
      ))}

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
