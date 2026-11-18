import { useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack } from 'expo-router';
import { ResourceList, Muted, Badge, eur, dateBE, useRouterPush } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface Order {
  id: string; ref: string; status: string; expectedOn: string | null; orderedOn: string | null; supplierRef: string | null;
  contact: { name: string }; worksite: { ref: string } | null; lineCount: number; receivedLines: number; totalHt: number;
}
const STATUS: Record<string, string> = { draft: 'Brouillon', ordered: 'Commandée', partial: 'Partiellement reçue', received: 'Reçue', cancelled: 'Annulée' };
const TONE: Record<string, 'ok' | 'warn' | 'crit' | 'primary' | undefined> = { ordered: 'warn', partial: 'primary', received: 'ok', cancelled: 'crit' };
const TABS = [
  { key: 'open', label: 'À réceptionner' },
  { key: 'draft', label: 'Brouillons' },
  { key: 'received', label: 'Reçues' },
  { key: 'all', label: 'Toutes' },
];

/** Commandes fournisseurs (lecture seule) : même liste que Stock → Commandes sur le site. */
export default function Commandes() {
  const push = useRouterPush();
  const [tab, setTab] = useState('open');
  return (
    <>
      <Stack.Screen options={{ title: tr('Commandes fournisseurs'), headerBackTitle: tr('Retour') }} />
      <View style={{ backgroundColor: T.paper }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
          {TABS.map((t) => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[s.pill, tab === t.key && s.pillOn]}>
              <Text style={[s.pillTxt, tab === t.key && { color: '#fff' }]}>{tr(t.label)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <ResourceList<Order>
        key={tab}
        endpoint={`/api/purchasing/orders?status=${tab}`}
        search={(o, q) => `${o.ref} ${o.contact.name} ${o.supplierRef ?? ''} ${o.worksite?.ref ?? ''}`.toLowerCase().includes(q)}
        searchPlaceholder="Réf., fournisseur, chantier…"
        onPress={(o) => push(`/commande/${o.id}`)}
        render={(o) => (
          <View style={{ gap: 3 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ fontWeight: '700', color: T.ink }}>{o.ref}</Text>
              <Text style={{ fontWeight: '700', color: T.ink }}>{eur(o.totalHt)} HT</Text>
            </View>
            <Text style={{ color: T.ink }}>{o.contact.name}</Text>
            <Muted>
              {o.receivedLines}/{o.lineCount} {tr('lignes reçues')}{o.worksite ? ` · ${o.worksite.ref}` : ''}{o.expectedOn ? ` · ${tr('attendue')} ${dateBE(o.expectedOn)}` : ''}
            </Muted>
            <View style={{ flexDirection: 'row' }}><Badge tone={TONE[o.status]}>{STATUS[o.status] ?? o.status}</Badge></View>
          </View>
        )}
      />
    </>
  );
}
const s = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line },
  pillOn: { backgroundColor: T.primary, borderColor: T.primary },
  pillTxt: { color: T.ink2, fontWeight: '600', fontSize: 13 },
});
