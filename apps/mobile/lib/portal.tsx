import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { apiGet } from './api';
import { Loading } from './ui';
import { T } from './theme';

/** Espace client : l'API portail ne renvoie que ce que le client a le droit de voir (jamais de coûts internes). */
export const PORTAL_PWD_PROMPT = 'jjd_portal_pwd_prompt';

export const DOC_TONE: Record<string, 'ok' | 'warn' | 'crit' | 'primary' | undefined> = {
  sent: 'warn', accepted: 'ok', declined: 'crit', paid: 'ok', overdue: 'crit',
};
export const quoteLabel = (s: string) =>
  ({ sent: 'À valider', accepted: 'Accepté', declined: 'Décliné', expired: 'Expiré', draft: 'Brouillon' } as Record<string, string>)[s] ?? s;
export const invoiceLabel = (s: string) => (s === 'paid' ? 'Payée' : s === 'overdue' ? 'En retard' : 'À payer');
export const isInvoiceKind = (k: string) => k === 'invoice' || k === 'deposit_invoice';

/** Charge un endpoint portail à chaque retour sur l'écran, avec tirer-pour-rafraîchir. */
export function usePortalData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setData(await apiGet<T>(path)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Chargement impossible.'); }
  }, [path]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  return { data, error, load, refresh, refreshing };
}

/** Page de défilement standard de l'espace client (tirer pour rafraîchir, état de chargement / d'erreur). */
export function PortalScroll({ state, children }: { state: { data: unknown; error: string | null; refresh: () => Promise<void>; refreshing: boolean }; children: ReactNode }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={[T.content, { gap: 14 }]}
      refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={state.refresh} />}>
      {!state.data && !state.error ? <Loading /> : null}
      {state.error && !state.data ? (
        <Pressable onPress={state.refresh} style={{ padding: 20, alignItems: 'center', gap: 8 }}>
          <Feather name="wifi-off" size={22} color={T.ink2} />
          <Text style={{ color: T.ink2, textAlign: 'center' }}>{state.error}</Text>
          <Text style={{ color: T.primary, fontWeight: '700' }}>Réessayer</Text>
        </Pressable>
      ) : null}
      {state.data ? children : null}
    </ScrollView>
  );
}

export function BigButton({ label, onPress, busy, tone = 'primary', icon }: {
  label: string; onPress: () => void; busy?: boolean; tone?: 'primary' | 'ghost' | 'danger'; icon?: keyof typeof Feather.glyphMap;
}) {
  const bg = tone === 'primary' ? T.primary : T.surface;
  const fg = tone === 'primary' ? '#fff' : tone === 'danger' ? T.crit : T.primary;
  return (
    <Pressable accessibilityRole="button" disabled={busy} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', minHeight: 52, paddingHorizontal: 18, borderRadius: 14,
        backgroundColor: bg, borderWidth: tone === 'primary' ? 0 : 1, borderColor: tone === 'danger' ? T.crit : T.line, opacity: busy ? 0.5 : pressed ? 0.85 : 1 })}>
      {icon ? <Feather name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: T.headingFont, fontSize: 18, fontWeight: '700', color: T.ink, marginTop: 8 }}>{children}</Text>;
}

export function Line({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>{children}</View>;
}
