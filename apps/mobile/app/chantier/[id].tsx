import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useFocusEffect, Stack, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Card, HeroTile, Label, Loading, Badge, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

const STATUS_LABEL: Record<string, string> = {
  lead: 'Demande', to_plan: 'À planifier', scheduled: 'Planifié', in_progress: 'En cours',
  on_hold: 'En attente', done: 'Terminé', to_invoice: 'À facturer', invoiced: 'Facturé',
  closed: 'Clôturé', cancelled: 'Abandonné',
};

interface Margin {
  quotedHt: number; invoicedHt: number; paidHt: number; materialCost: number; labourCost: number;
  vehicleCost: number;
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
  const router = useRouter();
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

      <HeroTile>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <Text style={s.heroRef}>{w.ref}</Text>
          <View style={s.heroBadge}>
            <Text style={s.heroBadgeTxt}>{STATUS_LABEL[w.status] ?? w.statusRaw ?? w.status}</Text>
          </View>
        </View>
        <Text style={s.heroTitle}>{w.title}</Text>
        {w.client?.name && <Text style={s.heroSub}>{w.client.name}</Text>}
      </HeroTile>

      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Badge>{w.entity === 'tonton' ? 'Tonton' : w.entity === 'm7' ? 'M7' : 'JJD'}</Badge>
      </View>

      <Pressable
        style={{ backgroundColor: T.primary, borderRadius: 10, padding: 13, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}
        onPress={() => router.push(`/fil/${id}` as never)}
      >
        <Feather name="message-circle" size={16} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700' }}>Ouvrir le fil de chantier</Text>
      </Pressable>

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
          {data.margin.vehicleCost > 0 && <Row k="Coût véhicule" v={eur(data.margin.vehicleCost)} />}
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
  heroRef: { color: 'rgba(255,255,255,0.65)', fontWeight: '700', fontSize: 12.5, letterSpacing: 0.3 },
  heroTitle: { color: '#fff', fontSize: 19, fontWeight: '800', marginTop: 6, lineHeight: 24 },
  heroSub: { color: 'rgba(255,255,255,0.78)', fontSize: 13, marginTop: 4 },
  heroBadge: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  heroBadgeTxt: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 2 },
  k: { color: T.ink2, flexShrink: 0 },
  v: { color: T.ink, flex: 1, textAlign: 'right' },
});

