import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './AppText';
import { eur } from './ui';
import { tr } from './i18n';

/** Banque de la carte : celle lue sur les relevés, sinon déduite des 6 premiers chiffres (BIN). */
const BIN_BANK: Record<string, string> = { '525506': 'Belfius', '524435': 'ING' };
export function bankOf(c: { bank?: string | null; prefix?: string | null }): string | null {
  const b = (c.bank ?? '').trim();
  if (/belfius/i.test(b)) return 'Belfius';
  if (/\bing\b/i.test(b)) return 'ING';
  if (b) return b;
  return c.prefix ? BIN_BANK[c.prefix] ?? null : null;
}
export const BANK_COLOR: Record<string, string> = { Belfius: '#d4002a', ING: '#ff6200' };

export interface CardLike {
  network: 'bancontact' | 'visa'; bank?: string | null; prefix?: string | null; last4: string;
  holderName: string | null; label: string | null; status: string;
  person?: { displayName: string | null; firstName: string; lastName: string | null } | null;
}
export const holderOf = (c: CardLike) => c.holderName || (c.person ? (c.person.displayName || [c.person.firstName, c.person.lastName].filter(Boolean).join(' ')) : '') || 'JJD CONSULT';

/** La carte elle-même, dessinée comme dans une appli bancaire (mêmes couleurs que sur le site). */
export function PayCardView({ card, compact }: { card: CardLike; compact?: boolean }) {
  const off = card.status !== 'active';
  const bank = bankOf(card);
  const colors = card.network === 'visa' ? ['#1c2430', '#2c3a4d', '#45566d'] : ['#124b3a', '#1d6b52', '#2f8a6c'];
  return (
    <LinearGradient colors={colors as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ borderRadius: 16, padding: compact ? 14 : 18, aspectRatio: 1.586, justifyContent: 'space-between', overflow: 'hidden', opacity: off ? 0.6 : 1 }}>
      <View style={{ position: 'absolute', right: -60, top: -80, width: 200, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,255,255,0.08)' }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13, flexShrink: 1 }} numberOfLines={1}>{card.label || (card.network === 'visa' ? tr('Carte de crédit') : tr('Carte de débit'))}</Text>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          {off && <View style={{ backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{card.status === 'blocked' ? tr('Bloquée') : card.status === 'lost' ? tr('Perdue / volée') : tr('Expirée')}</Text></View>}
          {bank && (
            <View style={{ backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: BANK_COLOR[bank] ?? '#87958d' }} />
              <Text style={{ color: '#173b31', fontSize: 12, fontWeight: '800' }}>{bank}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={{ width: 38, height: 28, borderRadius: 6, backgroundColor: '#d9bf84' }} />
      <Text style={{ color: '#fff', fontSize: compact ? 16 : 19, letterSpacing: 2, fontVariant: ['tabular-nums'] }}>•••• •••• •••• {card.last4}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 }}>
        <Text style={{ color: '#fff', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', flexShrink: 1 }} numberOfLines={1}>{holderOf(card)}</Text>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16, fontStyle: card.network === 'visa' ? 'italic' : 'normal' }}>{card.network === 'visa' ? 'VISA' : 'Bancontact'}</Text>
      </View>
    </LinearGradient>
  );
}

export interface AccountLike { bank: string; iban: string | null; label: string | null; balance: number | null }

/** Compte bancaire : même style que sur le site (carte beige). */
export function AccountCardView({ account, compact }: { account: AccountLike; compact?: boolean }) {
  const bank = bankOf({ bank: account.bank }) ?? account.bank;
  return (
    <LinearGradient colors={['#f6f1e4', '#efe4c8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ borderRadius: 16, padding: compact ? 14 : 18, aspectRatio: 1.586, justifyContent: 'space-between', overflow: 'hidden', borderWidth: 1, borderColor: '#e3d5ae' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: '#173b31', fontWeight: '700', fontSize: 13, flexShrink: 1 }} numberOfLines={1}>{account.label || tr('Compte courant')}</Text>
        <View style={{ backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: BANK_COLOR[bank] ?? '#87958d' }} />
          <Text style={{ color: '#173b31', fontSize: 12, fontWeight: '800' }}>{bank}</Text>
        </View>
      </View>
      <View>
        <Text style={{ color: '#173b31', opacity: 0.7, fontSize: 12 }}>{tr('Solde')}</Text>
        <Text style={{ color: '#173b31', fontSize: compact ? 24 : 28, fontWeight: '800' }}>{account.balance != null ? eur(account.balance) : '—'}</Text>
      </View>
      <Text style={{ color: '#173b31', fontSize: 12, letterSpacing: 1 }} numberOfLines={1}>{account.iban ? account.iban.replace(/(.{4})/g, '$1 ').trim() : 'JJD CONSULT'}</Text>
    </LinearGradient>
  );
}
