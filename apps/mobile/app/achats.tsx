import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { ResourceList, Muted, Badge, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr, Alert } from '@/lib/i18n';
import { openApiFile } from '@/lib/files';

interface Expense {
  id: string; date: string | null; supplier: string | null; categoryLabel: string | null; docNumber: string | null;
  worksite: { ref: string } | null;
  vehicle: { code: string | null; plate: string | null; name: string | null; brand?: string | null; model?: string | null } | null;
  ttc: number | null; ht: number; paid: boolean; hasPdf: boolean;
}

const TABS = [
  { key: '', label: tr('Toutes') },
  { key: '0', label: tr('Non payées') },
] as const;

async function openPiece(e: Expense) {
  try { await openApiFile(`/api/finance/expenses/${e.id}/pdf`, `${e.docNumber ?? 'facture'}.pdf`); }
  catch (err) { Alert.alert('Pièce jointe', (err as Error).message); }
}

export default function Achats() {
  const [paid, setPaid] = useState<(typeof TABS)[number]['key']>('');

  return (
    <>
      <Stack.Screen options={{ title: tr('Achats & dépenses'), headerBackTitle: tr('Retour') }} />
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
        onPress={(e) => { if (e.hasPdf) openPiece(e); }}
        render={(e) => (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '800', color: T.ink, fontSize: 16, flex: 1, marginRight: 8 }}>{e.supplier ?? '—'}</Text>
              <Text style={{ fontWeight: '800', color: T.ink, fontSize: 16 }}>{eur(e.ttc ?? e.ht)}</Text>
            </View>
            <Muted>
              {tr('Facture')}{e.docNumber ? ` • ${e.docNumber}` : ''} · {dateBE(e.date)}{e.categoryLabel ? ` · ${e.categoryLabel}` : ''}
            </Muted>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <Badge tone={e.paid ? 'ok' : 'crit'}>{e.paid ? 'Payée' : 'Non payée'}</Badge>
              {e.worksite && <Badge>{e.worksite.ref}</Badge>}
              {e.vehicle && <Muted>🚗 {e.vehicle.model || e.vehicle.brand || e.vehicle.name || e.vehicle.plate || e.vehicle.code}</Muted>}
            </View>
            {e.hasPdf && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
                <Feather name="file" size={16} color={T.ink2} />
                <Text style={{ flex: 1, color: T.ink2, fontWeight: '600' }} numberOfLines={1}>{tr('Facture')} {e.docNumber ?? ''}</Text>
                <Feather name="eye" size={18} color={T.primary} />
              </View>
            )}
          </View>
        )}
      />
    </>
  );
}
