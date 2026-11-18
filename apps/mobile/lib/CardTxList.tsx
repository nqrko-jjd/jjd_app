import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { Card, Badge, Muted, EmptyState, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

export interface CardTx {
  id: string; date: string | null; amount: number | null; merchant: string; justified: boolean;
  settlement?: boolean; detail?: string | null;
  links: { id: string | null; label: string; worksiteRef: string | null }[];
}
export interface MonthSum { month: string; spend: number; income?: number }

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Petit histogramme par mois (dépenses, et entrées pour un compte). */
export function MonthBars({ months }: { months: MonthSum[] }) {
  if (!months.length) return null;
  const max = Math.max(1, ...months.flatMap((m) => [m.spend, m.income ?? 0]));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 90 }}>
      {months.map((m) => (
        <View key={m.month} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 66 }}>
            <View style={{ width: 9, height: Math.max(3, (m.spend / max) * 66), backgroundColor: T.primary, borderRadius: 3 }} />
            {m.income != null && <View style={{ width: 9, height: Math.max(3, (m.income / max) * 66), backgroundColor: T.ok, borderRadius: 3 }} />}
          </View>
          <Text style={{ fontSize: 10, color: T.ink2 }}>{MONTHS[Number(m.month.slice(5)) - 1]}</Text>
        </View>
      ))}
    </View>
  );
}

/** Liste d'opérations : tap = détail (liens vers factures/dépenses, chantier). Lecture seule. */
export function TxList({ txs, onlyTodo }: { txs: CardTx[]; onlyTodo?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!txs.length) {
    return <EmptyState icon="check-circle" title={onlyTodo ? tr('Tout est justifié') : tr('Aucune opération')} description={tr('Sur cette période.')} />;
  }
  return (
    <View style={{ gap: 10 }}>
      {txs.map((t) => {
        const isOpen = open === t.id;
        const out = (t.amount ?? 0) < 0;
        return (
          <Pressable key={t.id} onPress={() => setOpen(isOpen ? null : t.id)} accessibilityRole="button">
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontWeight: '700', color: T.ink }} numberOfLines={isOpen ? undefined : 2}>{t.merchant}</Text>
                  <Muted>{dateBE(t.date)}</Muted>
                </View>
                <Text style={{ fontWeight: '800', color: out ? T.ink : T.ok }}>{eur(t.amount)}</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {t.settlement ? <Badge>{tr('Relevé carte')}</Badge> : t.justified ? <Badge tone="ok">{tr('Justifié')}</Badge> : <Badge tone="warn">{tr('À justifier')}</Badge>}
              </View>
              {isOpen && (
                <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: T.line, paddingTop: 8 }}>
                  {t.links.length > 0
                    ? t.links.map((l, i) => <Muted key={i}>{[l.label, l.worksiteRef].filter(Boolean).join(' → ')}</Muted>)
                    : <Muted>{t.detail || tr('Aucune facture ni dépense liée.')}</Muted>}
                </View>
              )}
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pastilles de choix (passent à la ligne, jamais coupées). */
export function Pills<K extends string | number>({ items, value, onChange }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map((i) => (
        <Pressable key={String(i.key)} onPress={() => onChange(i.key)} accessibilityRole="button"
          style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: value === i.key ? T.primary : T.line, backgroundColor: value === i.key ? T.primary : T.surface }}>
          <Text style={{ color: value === i.key ? '#fff' : T.ink2, fontWeight: '700', fontSize: 13 }}>{i.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
