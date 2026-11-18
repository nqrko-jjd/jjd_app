import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { ScreenHeader, Card, Label, Loading, Row, eur } from '@/lib/ui';
import { TxList, MonthBars, Pills, type CardTx, type MonthSum } from '@/lib/CardTxList';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface D { months: MonthSum[]; items: CardTx[] }

export default function CompteDetail() {
  const { bank } = useLocalSearchParams<{ bank: string }>();
  const [d, setD] = useState<D | null>(null);
  const [months, setMonths] = useState(3);
  const [dir, setDir] = useState<'all' | 'out' | 'in'>('all');
  const [todo, setTodo] = useState<'todo' | 'all'>('todo');
  const load = useCallback(() => { apiGet<D>(`/api/finance/cards/account-transactions?bank=${encodeURIComponent(String(bank))}&months=${months}`).then(setD).catch(() => {}); }, [bank, months]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!d) return <Loading />;
  const txs = d.items.filter((t) => (todo === 'all' || !t.justified) && (dir === 'all' || (dir === 'out' ? (t.amount ?? 0) < 0 : (t.amount ?? 0) > 0)));
  const out = d.items.filter((t) => (t.amount ?? 0) < 0).reduce((s, t) => s - (t.amount ?? 0), 0);
  const inc = d.items.filter((t) => (t.amount ?? 0) > 0).reduce((s, t) => s + (t.amount ?? 0), 0);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 16 }}>
      <Stack.Screen options={{ title: String(bank), headerBackTitle: tr('Retour') }} />
      <ScreenHeader title={String(bank)} eyebrow={tr('Compte')} description={tr('Virements, domiciliations, prélèvements et paiements reçus. Les paiements par carte sont sous leur carte.')} />
      <Card>
        <Row k={tr('Sorti sur la période')} v={eur(out)} />
        <Row k={tr('Entré sur la période')} v={eur(inc)} />
        <Label>{tr('Sorties (vert foncé) et entrées par mois')}</Label>
        <MonthBars months={d.months} />
      </Card>
      <Pills items={[{ key: 1, label: tr('1 mois') }, { key: 3, label: tr('3 mois') }, { key: 12, label: tr('12 mois') }]} value={months} onChange={setMonths} />
      <Pills items={[{ key: 'all' as const, label: tr('Tout') }, { key: 'out' as const, label: tr('Sorties') }, { key: 'in' as const, label: tr('Entrées') }]} value={dir} onChange={setDir} />
      <Pills items={[{ key: 'todo' as const, label: tr('À justifier') }, { key: 'all' as const, label: tr('Tout') }]} value={todo} onChange={setTodo} />
      <TxList txs={txs} onlyTodo={todo === 'todo'} />
    </ScrollView>
  );
}
