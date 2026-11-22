import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Loading, Muted, eur } from '@/lib/ui';
import { TxList, MonthBars, Pills, type CardTx, type MonthSum } from '@/lib/CardTxList';
import { AccountCardView } from '@/lib/BankCard';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface Account { bank: string; iban: string | null; label: string | null; balance: number | null }
interface D { months: MonthSum[]; items: CardTx[] }

export default function CompteDetail() {
  const { bank } = useLocalSearchParams<{ bank: string }>();
  const [d, setD] = useState<D | null>(null);
  const [acc, setAcc] = useState<Account | null>(null);
  const [months, setMonths] = useState(3);
  const [dir, setDir] = useState<'all' | 'out' | 'in'>('all');
  const [todo, setTodo] = useState<'todo' | 'all'>('todo');
  const load = useCallback(() => {
    apiGet<D>(`/api/finance/cards/account-transactions?bank=${encodeURIComponent(String(bank))}&months=${months}`).then(setD).catch(() => {});
    apiGet<{ items: Account[] }>('/api/finance/cards/accounts').then((r) => setAcc(r.items.find((a) => a.bank === bank) ?? null)).catch(() => {});
  }, [bank, months]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!d) return <Loading />;
  const txs = d.items.filter((t) => (todo === 'all' || !t.justified) && (dir === 'all' || (dir === 'out' ? (t.amount ?? 0) < 0 : (t.amount ?? 0) > 0)));
  const out = d.items.filter((t) => (t.amount ?? 0) < 0).reduce((s, t) => s - (t.amount ?? 0), 0);
  const inc = d.items.filter((t) => (t.amount ?? 0) > 0).reduce((s, t) => s + (t.amount ?? 0), 0);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 16 }}>
      <Stack.Screen options={{ title: String(bank), headerBackTitle: tr('Retour') }} />
      <AccountCardView account={acc ?? { bank: String(bank), iban: null, label: null, balance: null }} />
      <Muted>{tr('Virements, domiciliations, prélèvements et paiements reçus. Les paiements par carte sont sous leur carte.')}</Muted>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: T.surface2, borderRadius: 12, padding: 10 }}>
          <Muted>{tr('Sorti')}</Muted><Text style={{ fontWeight: '800', fontSize: 17, color: T.ink, marginTop: 2 }}>{eur(out)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: T.surface2, borderRadius: 12, padding: 10 }}>
          <Muted>{tr('Entré')}</Muted><Text style={{ fontWeight: '800', fontSize: 17, color: T.ok, marginTop: 2 }}>{eur(inc)}</Text>
        </View>
      </View>
      <Card>
        <Label>{tr('Sorties et entrées par mois')}</Label>
        <MonthBars months={d.months} />
      </Card>
      <Pills items={[{ key: 1, label: tr('1 mois') }, { key: 3, label: tr('3 mois') }, { key: 12, label: tr('12 mois') }]} value={months} onChange={setMonths} />
      <Pills items={[{ key: 'all' as const, label: tr('Tout') }, { key: 'out' as const, label: tr('Sorties') }, { key: 'in' as const, label: tr('Entrées') }]} value={dir} onChange={setDir} />
      <Pills items={[{ key: 'todo' as const, label: tr('À justifier') }, { key: 'all' as const, label: tr('Tout') }]} value={todo} onChange={setTodo} />
      <TxList txs={txs} onlyTodo={todo === 'todo'} />
    </ScrollView>
  );
}
