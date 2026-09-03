import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Loading, Row, Badge, PhotoHeader, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

interface D {
  person: {
    id: string; photoUrl: string | null;
    firstName: string; lastName: string | null; displayName: string | null;
    role: string; contractType: string; hourlyRate: number | null;
    phone: string | null; email: string | null; languages: string[] | null; emergencyContact: string | null;
    legalDocs: { id: string; type: string; label: string | null; expiresOn: string | null }[];
    user: { email: string } | null;
  };
  monthStatement: { hours: number; amount: number };
}
const DOC: Record<string, string> = { a1: 'A1', limosa: 'Limosa', vca: 'VCA', driving_license: 'Permis', id_card: 'CI', medical: 'Médical', contract: 'Contrat', work_permit: 'Permis travail' };

export default function PersonneDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<D | null>(null);
  const load = useCallback(() => { apiGet<D>(`/api/people/${id}`).then(setD).catch(() => {}); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!d) return <Loading />;
  const p = d.person;
  const soon = Date.now() + 30 * 86400000;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Stack.Screen options={{ title: p.displayName || p.firstName, headerBackTitle: 'Retour' }} />
      <PhotoHeader basePath={`/api/people/${p.id}`} photoUrl={p.photoUrl} round onChange={load} />
      <Card>
        <Row k="Taux horaire" v={p.hourlyRate != null ? eur(p.hourlyRate) : 'à définir'} />
        <Row k="Téléphone" v={p.phone ?? '—'} />
        <Row k="E-mail" v={p.email ?? '—'} />
        <Row k="Langues" v={(p.languages ?? []).join(', ') || '—'} />
        <Row k="Contact urgence" v={p.emergencyContact ?? '—'} />
        <Row k="Compte appli" v={p.user ? p.user.email : 'aucun'} />
      </Card>

      <Card>
        <Label>Décompte du mois</Label>
        <Text style={{ fontSize: 22, fontWeight: '800', color: T.ink }}>
          {d.monthStatement.hours} h · {eur(d.monthStatement.amount)}
        </Text>
      </Card>

      <Label>Documents légaux</Label>
      {p.legalDocs.length === 0 && <Text style={{ color: T.ink2 }}>Aucun.</Text>}
      {p.legalDocs.map((doc) => {
        const exp = doc.expiresOn ? new Date(doc.expiresOn).getTime() : null;
        return (
          <Card key={doc.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', color: T.ink }}>{doc.label || DOC[doc.type] || doc.type}</Text>
              {doc.expiresOn && <Badge tone={exp && exp < soon ? 'crit' : undefined}>{dateBE(doc.expiresOn)}</Badge>}
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}
