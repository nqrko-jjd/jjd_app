import { useCallback, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Muted, Badge, Row, Loading, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface Line {
  id: string; label: string | null; unitName: string | null; qty: number; price: number | null; receivedQty: number;
  stockItem: { name: string; ref: string | null; unit: string | null } | null;
}
interface Order {
  id: string; ref: string; status: string; orderedOn: string | null; expectedOn: string | null; supplierRef: string | null; note: string | null;
  contact: { name: string }; worksite: { ref: string; title?: string } | null; lines: Line[];
}
const STATUS: Record<string, string> = { draft: 'Brouillon', ordered: 'Commandée', partial: 'Partiellement reçue', received: 'Reçue', cancelled: 'Annulée' };
const TONE: Record<string, 'ok' | 'warn' | 'crit' | 'primary' | undefined> = { ordered: 'warn', partial: 'primary', received: 'ok', cancelled: 'crit' };
const num = (n: number) => String(Math.round(n * 100) / 100);

/** Fiche d'une commande fournisseur (lecture seule). */
export default function Commande() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [o, setO] = useState<Order | null>(null);
  const load = useCallback(async () => {
    try { setO((await apiGet<{ order: Order }>(`/api/purchasing/orders/${id}`)).order); } catch { /* hors ligne */ }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!o) return <Loading />;
  const total = o.lines.reduce((t, l) => t + l.qty * (l.price ?? 0), 0);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 16 }}>
      <Stack.Screen options={{ title: o.ref, headerBackTitle: tr('Retour') }} />
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: T.ink, flexShrink: 1 }}>{o.contact.name}</Text>
          <Badge tone={TONE[o.status]}>{STATUS[o.status] ?? o.status}</Badge>
        </View>
        <Row k={tr('Commandée le')} v={dateBE(o.orderedOn)} />
        <Row k={tr('Livraison attendue')} v={dateBE(o.expectedOn)} />
        {!!o.supplierRef && <Row k={tr('N° chez le fournisseur')} v={o.supplierRef} />}
        {!!o.worksite && <Row k={tr('Chantier')} v={o.worksite.ref} />}
        {!!o.note && <Muted>{o.note}</Muted>}
      </Card>
      <Label>{tr('Lignes')} ({o.lines.length})</Label>
      {o.lines.map((l) => {
        const done = l.receivedQty + 0.0001 >= l.qty;
        const unit = l.unitName ?? l.stockItem?.unit ?? '';
        return (
          <Card key={l.id} accent={done ? T.ok : undefined}>
            <Text style={{ fontWeight: '700', color: T.ink }}>{l.stockItem?.name ?? l.label ?? '—'}</Text>
            {!!l.stockItem?.ref && <Muted>{l.stockItem.ref}</Muted>}
            <Row k={tr('Commandé')} v={`${num(l.qty)} ${unit}`} />
            <Row k={tr('Reçu')} v={`${num(l.receivedQty)} ${unit}`} />
            <Row k={tr('Prix HT')} v={l.price != null ? `${eur(l.price)} → ${eur(Math.round(l.price * l.qty * 100) / 100)}` : '—'} />
          </Card>
        );
      })}
      <Card><Row k={tr('Total HT')} v={eur(Math.round(total * 100) / 100)} strong /></Card>
    </ScrollView>
  );
}
