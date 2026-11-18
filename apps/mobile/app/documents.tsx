import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { ResourceList, Muted, Badge, eur, dateBE, useRouterPush } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface Doc {
  id: string; kind: string; number: string | null; draftRef: string | null; status: string;
  title: string | null; issuedOn: string | null; totalTtc: number;
  contact: { name: string } | null; worksite: { ref: string } | null;
}

const KIND: Record<string, string> = { quote: 'Devis', invoice: 'Facture', credit_note: 'Note de crédit', deposit_invoice: 'Acompte' };
const STATUS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', declined: 'Refusé', partial: 'Paiement partiel',
  overdue: 'En retard', paid: 'Payé', credited: 'Crédité', cancelled: 'Annulé', expired: 'Expiré',
};
const TONE: Record<string, 'ok' | 'warn' | 'crit' | 'primary' | undefined> = {
  paid: 'ok', accepted: 'ok', sent: 'primary', overdue: 'crit', declined: 'crit', partial: 'warn',
};
const TABS = [
  { key: 'quote', label: tr('Devis') },
  { key: 'invoice', label: tr('Factures') },
];
/** Filtres de statut par type de document. */
const STATUS_FILTERS: Record<string, string[]> = {
  quote: ['draft', 'sent', 'accepted', 'declined'],
  invoice: ['draft', 'sent', 'partial', 'overdue', 'paid', 'credited'],
};
/** Filtres venus des cases de l'accueil (mêmes définitions que les totaux du tableau de bord). */
const DASH: Record<string, { label: string; kind: 'quote' | 'invoice' }> = {
  invoiced: { label: 'Facturé ce mois', kind: 'invoice' },
  collected: { label: 'Encaissé ce mois', kind: 'invoice' },
  overdue: { label: 'Factures en retard', kind: 'invoice' },
  receivable: { label: 'Reste à encaisser', kind: 'invoice' },
  quotes: { label: 'Devis à relancer', kind: 'quote' },
};

export default function Documents() {
  const push = useRouterPush();
  const params = useLocalSearchParams<{ dashboard?: string }>();
  const [dash, setDash] = useState<string | undefined>(params.dashboard && DASH[params.dashboard] ? params.dashboard : undefined);
  const [kind, setKind] = useState<string>(dash ? DASH[dash]!.kind : 'quote');
  const [status, setStatus] = useState<string | null>(null);

  const query = dash ? `dashboard=${dash}` : `kind=${kind}${status ? `&status=${status}` : ''}`;

  return (
    <>
      <Stack.Screen options={{ title: tr('Devis & factures'), headerBackTitle: tr('Retour') }} />
      {dash ? (
        <View style={{ padding: 12, paddingBottom: 0, backgroundColor: T.paper }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDash(undefined)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: T.primary }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13.5 }}>{tr(DASH[dash]!.label)}</Text>
            <Feather name="x" size={16} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <View style={{ padding: 12, paddingBottom: 0, backgroundColor: T.paper, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {TABS.map((t) => (
              <Pressable
                key={t.key}
                accessibilityRole="button"
                onPress={() => { setKind(t.key); setStatus(null); }}
                style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: kind === t.key ? T.primary : T.surface2 }}
              >
                <Text style={{ color: kind === t.key ? '#fff' : T.ink2, fontWeight: '700', fontSize: 14 }}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[null, ...(STATUS_FILTERS[kind] ?? [])].map((st) => (
              <Pressable
                key={st ?? 'all'}
                accessibilityRole="button"
                onPress={() => setStatus(st)}
                style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: status === st ? T.primary : T.line, backgroundColor: status === st ? T.primarySoft : T.surface }}
              >
                <Text style={{ color: status === st ? T.primary : T.ink2, fontWeight: '700', fontSize: 13 }}>{st ? tr(STATUS[st] ?? st) : tr('Tous')}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      <ResourceList<Doc>
        // pageSize élevé : cet écran charge tout en une fois et filtre côté client (recherche en direct)
        endpoint={`/api/documents?${query}&pageSize=5000`}
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
            <View style={{ flexDirection: 'row' }}><Badge tone={TONE[d.status]}>{STATUS[d.status] ?? d.status}</Badge></View>
          </View>
        )}
      />
    </>
  );
}
