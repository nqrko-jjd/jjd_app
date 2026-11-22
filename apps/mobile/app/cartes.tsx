import { useCallback, useState } from 'react';
import { ScrollView, View, Pressable, RefreshControl } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { ScreenHeader, Muted, Loading, EmptyState, eur } from '@/lib/ui';
import { PayCardView, AccountCardView, holderOf, type CardLike } from '@/lib/BankCard';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface PCard extends CardLike {
  id: string;
  stats: { monthSpend: number; prevMonthSpend?: number; yearSpend: number; count: number; lastUsedAt: string | null; lastMerchant: string | null; toJustify: number; toJustifyAmount: number };
}
interface Account { bank: string; iban: string | null; label: string | null; balance: number | null; balanceAt: string | null; stats: { monthOut: number; monthIn: number; count: number; toJustify: number; toJustifyAmount: number } }

export default function Cartes() {
  const router = useRouter();
  const [cards, setCards] = useState<PCard[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([
        apiGet<{ items: PCard[] }>('/api/finance/cards'),
        apiGet<{ items: Account[] }>('/api/finance/cards/accounts'),
      ]);
      setCards(c.items); setAccounts(a.items);
    } catch { /* hors ligne */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!cards || !accounts) return <Loading />;
  const todoCards = cards.reduce((s, c) => s + c.stats.toJustify, 0);
  const month = cards.reduce((s, c) => s + c.stats.monthSpend, 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: tr('Cartes & comptes'), headerBackTitle: tr('Retour') }} />
      <ScreenHeader title={tr('Cartes & comptes')} eyebrow={tr('Finances')}
        description={`${cards.length} ${tr('carte(s)')} · ${eur(month)} ${tr('dépensés ce mois')}${todoCards ? ` · ${todoCards} ${tr('paiement(s) sans justificatif')}` : ''}`} />

      {accounts.length > 0 && <Text style={s.section}>{tr('Comptes')} <Text style={s.sub}>· {tr('virements, domiciliations et entrées')}</Text></Text>}
      {accounts.map((a) => (
        <Pressable key={a.bank} onPress={() => router.push(`/carte/compte?bank=${encodeURIComponent(a.bank)}` as never)} accessibilityRole="button" style={s.tile}>
          <AccountCardView account={a} compact />
          <View style={s.meta}>
            <Muted>{a.stats.toJustify ? <Text style={{ color: T.crit, fontWeight: '800' }}>{a.stats.toJustify} <Text style={{ color: T.ink2, fontWeight: '400' }}>{tr('à justifier')}</Text></Text> : tr('Tout est justifié')}</Muted>
            <Text style={{ color: T.ink }}><Text style={{ fontWeight: '800' }}>{eur(a.stats.monthOut)}</Text> <Text style={s.sub}>{tr('sortis ce mois')}</Text></Text>
          </View>
        </Pressable>
      ))}

      <Text style={s.section}>{tr('Cartes')}</Text>
      {cards.length === 0 && <EmptyState icon="credit-card" title={tr('Aucune carte')} description={tr('Les cartes apparaissent dès qu’elles servent sur un relevé.')} />}
      {cards.map((c) => (
        <Pressable key={c.id} onPress={() => router.push(`/carte/${c.id}` as never)} accessibilityRole="button" style={s.tile}>
          <PayCardView card={c} compact />
          <View style={s.meta}>
            <Text style={{ color: T.ink, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{c.person || c.holderName ? holderOf(c) : tr('Non attribuée')}</Text>
            <Text style={{ color: T.ink }}><Text style={{ fontWeight: '800' }}>{eur(c.stats.monthSpend)}</Text> <Text style={s.sub}>{tr('ce mois')}</Text></Text>
          </View>
          {c.stats.toJustify > 0 && (
            <Text style={{ color: T.crit, fontWeight: '700', fontSize: 12.5, paddingHorizontal: 4 }}>{c.stats.toJustify} {tr('paiement(s) à justifier')} · {eur(c.stats.toJustifyAmount)}</Text>
          )}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = {
  section: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1.1, textTransform: 'uppercase' as const, color: T.ink2, marginTop: 6 },
  sub: { color: T.ink2, fontSize: 12.5, fontWeight: '400' as const, textTransform: 'none' as const, letterSpacing: 0 },
  tile: { gap: 8, padding: 8, borderRadius: 20, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line },
  meta: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 4 },
};
