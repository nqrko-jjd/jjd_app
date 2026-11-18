import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { ScreenHeader, Card, Label, Loading, Row, eur } from '@/lib/ui';
import { TxList, MonthBars, Pills, type CardTx, type MonthSum } from '@/lib/CardTxList';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface D { card: { network: string; last4: string; holderName: string | null; label: string | null; person: { displayName: string | null; firstName: string; lastName: string | null } | null }; months: MonthSum[]; items: CardTx[] }

export default function CarteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<D | null>(null);
  const [months, setMonths] = useState(3);
  const [todo, setTodo] = useState<'todo' | 'all'>('todo');
  const load = useCallback(() => { apiGet<D>(`/api/finance/cards/${id}/transactions?months=${months}`).then(setD).catch(() => {}); }, [id, months]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!d) return <Loading />;
  const name = d.card.person ? (d.card.person.displayName || [d.card.person.firstName, d.card.person.lastName].filter(Boolean).join(' ')) : d.card.holderName;
  const title = `${d.card.network === 'visa' ? 'Visa' : 'Bancontact'} •••• ${d.card.last4}`;
  const out = d.items.filter((t) => (t.amount ?? 0) < 0);
  const txs = d.items.filter((t) => todo === 'all' || (!t.justified && (t.amount ?? 0) < 0));
  const todoCount = out.filter((t) => !t.justified).length;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 16 }}>
      <Stack.Screen options={{ title, headerBackTitle: tr('Retour') }} />
      <ScreenHeader title={title} eyebrow={tr('Carte de paiement')} description={name ?? undefined} />
      <Card>
        <Row k={tr('Dépensé sur la période')} v={eur(out.reduce((s, t) => s - (t.amount ?? 0), 0))} />
        <Row k={tr('Paiements')} v={String(out.length)} />
        <Row k={tr('Sans justificatif')} v={String(todoCount)} strong />
        <Label>{tr('Dépenses par mois')}</Label>
        <MonthBars months={d.months} />
      </Card>
      <Pills items={[{ key: 1, label: tr('1 mois') }, { key: 3, label: tr('3 mois') }, { key: 12, label: tr('12 mois') }]} value={months} onChange={setMonths} />
      <Pills items={[{ key: 'todo' as const, label: tr('À justifier') }, { key: 'all' as const, label: tr('Tout') }]} value={todo} onChange={setTodo} />
      <TxList txs={txs} onlyTodo={todo === 'todo'} />
    </ScrollView>
  );
}
