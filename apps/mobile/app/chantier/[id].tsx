import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Card, Label, Loading, Badge, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Margin {
  quotedHt: number; invoicedHt: number; paidHt: number; materialCost: number; labourCost: number;
  realMargin: number; realMarginPct: number | null; leftToInvoice: number; partnerShare: number;
}
interface Detail {
  worksite: {
    ref: string; title: string; status: string; statusRaw: string | null; entity: string;
    address: string | null; city: string | null; startedOn: string | null; endedOn: string | null;
    client: { name: string } | null;
    building: { name: string; syndic: { name: string } | null } | null;
    manager: { displayName: string | null; firstName: string } | null;
  };
  margin: Margin | null;
}

export default function ChantierDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const [data, setData] = useState<Detail | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Detail>(`/api/worksites/${id}`));
    } catch {
      /* hors ligne */
    }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data) return <Loading />;
  const w = data.worksite;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Stack.Screen options={{ title: w.ref, headerBackTitle: 'Retour' }} />
      <Text style={s.h1}>{w.title}</Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Badge>{w.entity === 'tonton' ? 'Tonton' : w.entity === 'm7' ? 'M7' : 'JJD'}</Badge>
        {w.statusRaw ? <Badge>{w.statusRaw}</Badge> : <Badge>{w.status}</Badge>}
      </View>

      <Card>
        <Row k="Client" v={w.client?.name ?? '—'} />
        <Row k="Immeuble" v={w.building ? `${w.building.name}${w.building.syndic ? ` · ${w.building.syndic.name}` : ''}` : '—'} />
        <Row k="Chef" v={w.manager?.displayName ?? w.manager?.firstName ?? '—'} />
        <Row k="Adresse" v={[w.address, w.city].filter(Boolean).join(', ') || '—'} />
        <Row k="Début / Fin" v={`${dateBE(w.startedOn)} → ${dateBE(w.endedOn)}`} />
      </Card>

      {data.margin && user?.role !== 'worker' && (
        <Card accent={data.margin.realMargin >= 0 ? T.ok : T.crit}>
          <Label>Rentabilité — temps réel</Label>
          <Row k="Devisé HT" v={eur(data.margin.quotedHt)} />
          <Row k="Facturé / Encaissé" v={`${eur(data.margin.invoicedHt)} / ${eur(data.margin.paidHt)}`} />
          <Row k="Coût matériaux" v={eur(data.margin.materialCost)} />
          <Row k="Coût main-d’œuvre" v={eur(data.margin.labourCost)} />
          <Row k="Marge réelle" v={`${eur(data.margin.realMargin)}${data.margin.realMarginPct != null ? ` (${data.margin.realMarginPct} %)` : ''}`} strong />
          <Row k="Reste à facturer" v={eur(data.margin.leftToInvoice)} />
          {data.margin.partnerShare > 0 && <Row k="Part GT (33 %)" v={eur(data.margin.partnerShare)} />}
        </Card>
      )}
    </ScrollView>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.k}>{k}</Text>
      <Text style={[s.v, strong && { fontWeight: '700' }]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: '700', color: T.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 2 },
  k: { color: T.ink2, flexShrink: 0 },
  v: { color: T.ink, flex: 1, textAlign: 'right' },
});

