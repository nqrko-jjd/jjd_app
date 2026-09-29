import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { ResourceList, Muted, Badge, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Expense {
  id: string; date: string | null; supplier: string | null; categoryLabel: string | null; docNumber: string | null;
  worksite: { ref: string } | null;
  vehicle: { code: string | null; plate: string | null; name: string | null } | null;
  ttc: number | null; ht: number; paid: boolean; hasPdf: boolean;
}

const TABS = [
  { key: '', label: 'Toutes' },
  { key: '0', label: 'Non payées' },
] as const;

export default function Achats() {
  const [paid, setPaid] = useState<(typeof TABS)[number]['key']>('');

  return (
    <>
      <Stack.Screen options={{ title: 'Achats & dépenses', headerBackTitle: 'Retour' }} />
      <View style={{ flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 0, backgroundColor: T.paper }}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setPaid(t.key)}
            style={{
              paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999,
              backgroundColor: paid === t.key ? T.primary : T.surface2,
            }}
          >
            <Text style={{ color: paid === t.key ? '#fff' : T.ink2, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <ResourceList<Expense>
        // pageSize élevé : filtre côté client (recherche en direct), comme Devis & factures
        endpoint={`/api/finance/expenses?pageSize=2000${paid ? `&paid=${paid}` : ''}`}
        search={(e, q) =>
          (e.supplier ?? '').toLowerCase().includes(q) ||
          (e.docNumber ?? '').toLowerCase().includes(q) ||
          (e.worksite?.ref ?? '').toLowerCase().includes(q)
        }
        searchPlaceholder="Fournisseur, n° facture, chantier…"
        render={(e) => (
          <View style={{ gap: 3 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', color: T.ink, flex: 1, marginRight: 8 }}>{e.supplier ?? '—'}</Text>
              <Text style={{ fontWeight: '700', color: T.ink }}>{eur(e.ttc ?? e.ht)}</Text>
            </View>
            <Muted>
              {dateBE(e.date)}{e.docNumber ? ` · ${e.docNumber}` : ''}{e.categoryLabel ? ` · ${e.categoryLabel}` : ''}
            </Muted>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Badge tone={e.paid ? 'ok' : 'warn'}>{e.paid ? 'Payée' : 'Non payée'}</Badge>
              {e.worksite && <Muted>{e.worksite.ref}</Muted>}
              {e.vehicle && <Muted>🚗 {e.vehicle.code ?? e.vehicle.plate ?? e.vehicle.name}</Muted>}
              {e.hasPdf && <Feather name="paperclip" size={12} color={T.ink3} />}
            </View>
          </View>
        )}
      />
    </>
  );
}
