import { useCallback, useState } from 'react';
import { ScrollView, View, Pressable, RefreshControl } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { ScreenHeader, Card, Muted, Loading, Badge, EmptyState, eur, dateBE } from '@/lib/ui';
import { Pills } from '@/lib/CardTxList';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface PersonRef { displayName: string | null; firstName: string; lastName: string | null }
interface PCard {
  id: string; network: 'bancontact' | 'visa'; last4: string; holderName: string | null; label: string | null; status: string;
  person: PersonRef | null;
  stats: { monthSpend: number; yearSpend: number; count: number; lastUsedAt: string | null; lastMerchant: string | null; toJustify: number; toJustifyAmount: number };
}
interface Account { bank: string; iban: string | null; label: string | null; balance: number | null; balanceAt: string | null; stats: { monthOut: number; monthIn: number; count: number; toJustify: number; toJustifyAmount: number } }

const STATUS: Record<string, { label: string; tone?: 'ok' | 'warn' | 'crit' }> = {
  active: { label: 'Active', tone: 'ok' }, blocked: { label: 'Bloquée', tone: 'warn' }, lost: { label: 'Perdue / volée', tone: 'crit' }, expired: { label: 'Expirée' },
};
const holder = (c: PCard) => c.person ? (c.person.displayName || [c.person.firstName, c.person.lastName].filter(Boolean).join(' ')) : c.holderName || tr('Titulaire à indiquer');

export default function Cartes() {
  const router = useRouter();
  const [tab, setTab] = useState<'cards' | 'accounts'>('cards');
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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: tr('Cartes & comptes'), headerBackTitle: tr('Retour') }} />
      <ScreenHeader title={tr('Cartes & comptes')} eyebrow={tr('Finances')} description={todoCards ? `${todoCards} ${tr('paiement(s) par carte sans justificatif')}` : tr('Tous les paiements par carte sont justifiés.')} />
      <Pills items={[{ key: 'cards' as const, label: tr('Cartes') }, { key: 'accounts' as const, label: tr('Comptes') }]} value={tab} onChange={setTab} />

      {tab === 'cards' && (cards.length === 0
        ? <EmptyState icon="credit-card" title={tr('Aucune carte')} description={tr('Les cartes apparaissent dès qu’elles servent sur un relevé.')} />
        : cards.map((c) => {
          const st = STATUS[c.status] ?? { label: c.status };
          return (
            <Pressable key={c.id} onPress={() => router.push(`/carte/${c.id}` as never)} accessibilityRole="button">
              <Card accent={c.stats.toJustify ? T.warn : undefined}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontWeight: '800', color: T.ink, fontSize: 16 }}>{c.network === 'visa' ? 'Visa' : 'Bancontact'} •••• {c.last4}</Text>
                  <Badge tone={st.tone}>{tr(st.label)}</Badge>
                </View>
                <Text style={{ color: T.ink, fontWeight: '600' }}>{holder(c)}{c.label ? ` · ${c.label}` : ''}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View><Muted>{tr('Ce mois')}</Muted><Text style={{ fontWeight: '800', color: T.ink }}>{eur(c.stats.monthSpend)}</Text></View>
                  <View><Muted>{tr('12 derniers mois')}</Muted><Text style={{ fontWeight: '800', color: T.ink }}>{eur(c.stats.yearSpend)}</Text></View>
                  <View><Muted>{tr('À justifier')}</Muted><Text style={{ fontWeight: '800', color: c.stats.toJustify ? T.crit : T.ok }}>{c.stats.toJustify ? `${c.stats.toJustify} · ${eur(c.stats.toJustifyAmount)}` : '0'}</Text></View>
                </View>
                {c.stats.lastUsedAt && <Muted numberOfLines={1}>{tr('Dernier paiement')} {dateBE(c.stats.lastUsedAt)}{c.stats.lastMerchant ? ` · ${c.stats.lastMerchant}` : ''}</Muted>}
              </Card>
            </Pressable>
          );
        }))}

      {tab === 'accounts' && (accounts.length === 0
        ? <EmptyState icon="briefcase" title={tr('Aucun compte')} />
        : accounts.map((a) => (
          <Pressable key={a.bank} onPress={() => router.push(`/carte/compte?bank=${encodeURIComponent(a.bank)}` as never)} accessibilityRole="button">
            <Card accent={a.stats.toJustify ? T.warn : undefined}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontWeight: '800', color: T.ink, fontSize: 16 }}>{a.label || a.bank}</Text>
                <Text style={{ fontWeight: '800', color: T.ink }}>{a.balance != null ? eur(a.balance) : '—'}</Text>
              </View>
              {a.iban && <Muted>{a.iban.replace(/(.{4})/g, '$1 ').trim()}</Muted>}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View><Muted>{tr('Sorti ce mois')}</Muted><Text style={{ fontWeight: '800', color: T.ink }}>{eur(a.stats.monthOut)}</Text></View>
                <View><Muted>{tr('Entré ce mois')}</Muted><Text style={{ fontWeight: '800', color: T.ok }}>{eur(a.stats.monthIn)}</Text></View>
                <View><Muted>{tr('À justifier')}</Muted><Text style={{ fontWeight: '800', color: a.stats.toJustify ? T.crit : T.ok }}>{a.stats.toJustify ? `${a.stats.toJustify} · ${eur(a.stats.toJustifyAmount)}` : '0'}</Text></View>
              </View>
            </Card>
          </Pressable>
        )))}
    </ScrollView>
  );
}
