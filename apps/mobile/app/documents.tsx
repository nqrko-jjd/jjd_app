import { useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { Stack } from 'expo-router';
import { ResourceList, Muted, Badge, eur, dateBE, useRouterPush } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Doc {
  id: string; kind: string; number: string | null; draftRef: string | null; status: string;
  title: string | null; issuedOn: string | null; totalTtc: number;
  contact: { name: string } | null; worksite: { ref: string } | null;
}

const KIND: Record<string, string> = { quote: 'Devis', invoice: 'Facture', credit_note: 'Note de crédit', deposit_invoice: 'Acompte' };
const TONE: Record<string, 'ok' | 'warn' | 'crit' | 'primary' | undefined> = {
  paid: 'ok', accepted: 'ok', sent: 'primary', overdue: 'crit', declined: 'crit', partial: 'warn',
};
const TABS = [
  { key: 'quote', label: 'Devis' },
  { key: 'invoice', label: 'Factures' },
];

export default function Documents() {
  const push = useRouterPush();
  const [kind, setKind] = useState('quote');

  return (
    <>
      <Stack.Screen options={{ title: 'Devis & factures', headerBackTitle: 'Retour' }} />
      <View style={{ flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 0, backgroundColor: T.paper }}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setKind(t.key)}
            style={{
              paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999,
              backgroundColor: kind === t.key ? T.primary : T.surface2,
            }}
          >
            <Text style={{ color: kind === t.key ? '#fff' : T.ink2, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <ResourceList<Doc>
        endpoint={`/api/documents?kind=${kind}`}
        search={(d, q) =>
          (d.number ?? d.draftRef ?? '').toLowerCase().includes(q) ||
          (d.title ?? '').toLowerCase().includes(q) ||
          (d.contact?.name ?? '').toLowerCase().includes(q)
        }
        searchPlaceholder="N°, client, objet…"
        onPress={(d) => push(`/document/${d.id}`)}
        render={(d) => (
          <View style={{ gap: 3 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', color: T.ink }}>{d.number ?? d.draftRef ?? '—'}</Text>
              <Text style={{ fontWeight: '700', color: T.ink }}>{eur(d.totalTtc)}</Text>
            </View>
            <Text style={{ color: T.ink }}>{d.title ?? KIND[d.kind]}</Text>
            <Muted>{d.contact?.name ?? '—'}{d.worksite ? ` · ${d.worksite.ref}` : ''}{d.issuedOn ? ` · ${dateBE(d.issuedOn)}` : ''}</Muted>
            <View style={{ flexDirection: 'row' }}><Badge tone={TONE[d.status]}>{d.status}</Badge></View>
          </View>
        )}
      />
    </>
  );
}
