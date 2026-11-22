import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Label, Loading, Muted, eur } from '@/lib/ui';
import { TxList, MonthBars, Pills, type CardTx, type MonthSum } from '@/lib/CardTxList';
import { PayCardView, bankOf, holderOf, type CardLike } from '@/lib/BankCard';
import { EditButton, type Section } from '@/lib/EditForm';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface D { card: CardLike & { id?: string; prefix: string | null; expiresOn: string | null; monthlyLimit: number | null; note: string | null }; months: MonthSum[]; items: CardTx[] }

const CARD_SECTIONS: Section[] = [
  { title: 'Carte', fields: [
    { key: 'label', label: 'Nom de la carte' },
    { key: 'holderName', label: 'Titulaire' },
    { key: 'status', label: 'Statut', type: 'select', required: true, options: [{ value: 'active', label: 'Active' }, { value: 'blocked', label: 'Bloquée' }, { value: 'lost', label: 'Perdue / volée' }, { value: 'expired', label: 'Expirée' }] },
    { key: 'expiresOn', label: 'Expire le', type: 'date' },
    { key: 'monthlyLimit', label: 'Plafond mensuel (€)', type: 'number' },
    { key: 'note', label: 'Note', type: 'multiline' },
  ] },
];

export default function CarteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<D | null>(null);
  const [months, setMonths] = useState(3);
  const [todo, setTodo] = useState<'todo' | 'all'>('todo');
  const load = useCallback(() => { apiGet<D>(`/api/finance/cards/${id}/transactions?months=${months}`).then(setD).catch(() => {}); }, [id, months]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!d) return <Loading />;
  const c = d.card;
  const title = `${c.network === 'visa' ? 'Visa' : 'Bancontact'} •••• ${c.last4}`;
  const out = d.items.filter((t) => (t.amount ?? 0) < 0);
  const spent = out.reduce((s, t) => s - (t.amount ?? 0), 0);
  const txs = d.items.filter((t) => todo === 'all' || (!t.justified && (t.amount ?? 0) < 0));
  const todoCount = out.filter((t) => !t.justified).length;
  const bank = bankOf(c);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 16 }}>
      <Stack.Screen options={{ title, headerBackTitle: tr('Retour') }} />
      <PayCardView card={c} />
      <Muted>{[holderOf(c), bank].filter(Boolean).join(' · ')}</Muted>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Kpi label={tr('Dépensé')} value={eur(spent)} />
        <Kpi label={tr('Paiements')} value={String(out.length)} />
        <Kpi label={tr('À justifier')} value={String(todoCount)} bad={todoCount > 0} />
      </View>
      {c.monthlyLimit ? <Muted>{tr('Plafond mensuel')} : {eur(c.monthlyLimit)}</Muted> : null}
      <Card>
        <Label>{tr('Dépenses par mois')}</Label>
        <MonthBars months={d.months} />
      </Card>
      <Pills items={[{ key: 1, label: tr('1 mois') }, { key: 3, label: tr('3 mois') }, { key: 12, label: tr('12 mois') }]} value={months} onChange={setMonths} />
      <Pills items={[{ key: 'todo' as const, label: tr('À justifier') }, { key: 'all' as const, label: tr('Tout') }]} value={todo} onChange={setTodo} />
      <TxList txs={txs} onlyTodo={todo === 'todo'} />
      <EditButton title={title} sections={CARD_SECTIONS} values={c as unknown as Record<string, unknown>} path={`/api/finance/cards/${c.id ?? id}`} onSaved={load} />
    </ScrollView>
  );
}

function Kpi({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: T.surface2, borderRadius: 12, padding: 10 }}>
      <Muted>{label}</Muted>
      <Text style={{ fontWeight: '800', fontSize: 17, color: bad ? T.crit : T.ink, marginTop: 2 }}>{value}</Text>
    </View>
  );
}
