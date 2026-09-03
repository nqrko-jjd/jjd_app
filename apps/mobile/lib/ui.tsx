import type { ReactNode } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { T } from './theme';

export function Card({ children, accent }: { children: ReactNode; accent?: string }) {
  return <View style={[st.card, accent ? { borderColor: accent, borderWidth: 2 } : null]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={st.label}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={st.muted}>{children}</Text>;
}

export function Loading() {
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <ActivityIndicator color={T.primary} />
    </View>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'crit' }) {
  const color = tone === 'ok' ? T.ok : tone === 'crit' ? T.crit : tone === 'warn' ? T.accent : T.ink2;
  return (
    <View style={[st.badge, { borderColor: color }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

export function eur(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toLocaleString('fr-BE', { maximumFractionDigits: 2 })} €`;
}

export function dateBE(d: string | null | undefined): string {
  if (!d) return '—';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const st = StyleSheet.create({
  card: {
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.line,
    padding: 14,
    gap: 5,
  },
  label: { fontSize: 12, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 },
  muted: { color: T.ink2 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
});
