import { View, ScrollView } from 'react-native';
import { Text } from '@/lib/AppText';
import { T } from './theme';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const monthShort = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
export const compact = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1).replace('.', ',')} M` : a >= 10_000 ? `${Math.round(a / 1000)} k` : a >= 1000 ? `${(a / 1000).toFixed(1).replace('.', ',')} k` : String(Math.round(a));
  return `${n < 0 ? '−' : ''}${s}`;
};

/** Barres par mois, une ou deux séries côte à côte (ex. facturé / dépenses). Défile à l'horizontale quand il y a beaucoup de mois. */
export function MonthBars({ rows, series }: { rows: { month: string; a: number; b?: number }[]; series: { a: string; b?: string } }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b ?? 0]));
  const H = 120;
  const colW = series.b ? 44 : 34;
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 6 }}>
        {rows.map((r) => (
          <View key={r.month} style={{ width: colW, alignItems: 'center' }}>
            <View style={{ height: H, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
              <View style={{ width: series.b ? 16 : 22, height: Math.max(2, (r.a / max) * H), backgroundColor: T.primary, borderTopLeftRadius: 5, borderTopRightRadius: 5 }} />
              {series.b && <View style={{ width: 16, height: Math.max(2, ((r.b ?? 0) / max) * H), backgroundColor: T.gold, borderTopLeftRadius: 5, borderTopRightRadius: 5 }} />}
            </View>
            <Text style={{ fontSize: 10.5, color: T.ink2, marginTop: 4 }}>{monthShort(r.month)}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}>
        <Legend color={T.primary} label={series.a} />
        {series.b && <Legend color={T.gold} label={series.b} />}
      </View>
    </View>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} /><Text style={{ fontSize: 12, color: T.ink2 }}>{label}</Text></View>;
}

/** Barres horizontales étiquetées (répartition, classements). Les valeurs négatives passent en rouge. */
export function HBars({ rows, format }: { rows: { label: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((r, i) => (
        <View key={`${r.label}-${i}`} style={{ gap: 5 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
            <Text style={{ flex: 1, color: T.ink, fontSize: 13 }} numberOfLines={1}>{r.label}</Text>
            <Text style={{ color: r.value < 0 ? T.crit : T.ink, fontWeight: '700', fontSize: 13 }}>{format(r.value)}</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: T.surface2 }}>
            <View style={{ height: 8, borderRadius: 4, width: `${Math.max(3, (Math.abs(r.value) / max) * 100)}%`, backgroundColor: r.value < 0 ? T.crit : T.primary }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Mini courbe en barres (sans libellés) pour la page d'accueil. */
export function Spark({ values, color = 'rgba(255,255,255,0.85)', height = 44 }: { values: number[]; color?: string; height?: number }) {
  const max = Math.max(1, ...values);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5, height }}>
      {values.map((v, i) => (
        <View key={i} style={{ flex: 1, height: Math.max(3, (v / max) * height), borderRadius: 4, backgroundColor: color, opacity: i === values.length - 1 ? 1 : 0.45 }} />
      ))}
    </View>
  );
}
