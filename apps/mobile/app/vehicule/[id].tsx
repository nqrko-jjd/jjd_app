import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Loading, Row, Badge, PhotoHeader, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

interface D {
  vehicle: {
    id: string; photoUrl: string | null;
    brand: string | null; model: string | null; plate: string | null; code: string | null;
    type: string | null; fuel: string | null; vin: string | null; km: string | null;
    nextInspection: string | null; driver: string | null; equipment: string | null; depot: string | null;
    acquisitionMode: string | null; purchasePriceHt: number | null; monthlyPayment: number | null;
    financeCompany: string | null; financeEndOn: string | null;
    insurances: { provider: string | null; monthlyAmount: number | null; annualAmount: number | null }[];
    fines: { id: string; date: string | null; type: string | null; amount: number | null; status: string | null }[];
    payments: { id: string; dueOn: string | null; amount: number | null; balance: number | null }[];
  };
}

export default function VehiculeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<D | null>(null);
  const load = useCallback(() => { apiGet<D>(`/api/vehicles/${id}`).then(setD).catch(() => {}); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!d) return <Loading />;
  const v = d.vehicle;
  const ins = v.insurances[0];
  const nextPay = v.payments.find((p) => p.dueOn && new Date(p.dueOn).getTime() >= Date.now());

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Stack.Screen options={{ title: [v.brand, v.model].filter(Boolean).join(' '), headerBackTitle: 'Retour' }} />
      <PhotoHeader basePath={`/api/vehicles/${v.id}`} photoUrl={v.photoUrl} onChange={load} />
      <Card>
        <Row k="Plaque" v={v.plate ?? '—'} />
        <Row k="Type / Carburant" v={`${v.type ?? '—'} · ${v.fuel ?? '—'}`} />
        <Row k="Conducteur" v={v.driver ?? '—'} />
        <Row k="Km" v={v.km ?? '—'} />
        <Row k="Contrôle technique" v={dateBE(v.nextInspection)} />
        <Row k="Équipements" v={v.equipment ?? '—'} />
        <Row k="Dépôt" v={v.depot ?? '—'} />
      </Card>

      <Card>
        <Label>Assurance</Label>
        {ins
          ? <Text style={{ color: T.ink }}>{ins.provider} · {eur(ins.monthlyAmount)}/mois ({eur(ins.annualAmount)}/an)</Text>
          : <Text style={{ color: T.ink2 }}>Aucune.</Text>}
      </Card>

      <Card>
        <Label>Financement — {v.acquisitionMode ?? '?'}</Label>
        <Row k="Prix HTVA" v={eur(v.purchasePriceHt)} />
        <Row k="Mensualité" v={eur(v.monthlyPayment)} />
        <Row k="Organisme" v={v.financeCompany ?? '—'} />
        <Row k="Fin" v={dateBE(v.financeEndOn)} />
        {nextPay && <Row k="Prochaine échéance" v={`${dateBE(nextPay.dueOn)} · solde ${eur(nextPay.balance)}`} />}
      </Card>

      {v.fines.length > 0 && (
        <>
          <Label>PV ({v.fines.length})</Label>
          {v.fines.slice(0, 10).map((f) => (
            <Card key={f.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: T.ink }}>{dateBE(f.date)} · {f.type ?? '—'} · {eur(f.amount)}</Text>
                <Badge tone={f.status === 'Payé' ? 'ok' : 'crit'}>{f.status === 'Payé' ? 'Payé' : 'Impayé'}</Badge>
              </View>
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}
