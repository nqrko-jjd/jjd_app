import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Badge, Card, EmptyState, Muted, ScreenHeader, dateBE, eur } from '@/lib/ui';
import { T } from '@/lib/theme';
import { DOC_TONE, PortalScroll, invoiceLabel, isInvoiceKind, quoteLabel, usePortalData } from '@/lib/portal';
import { openPortalPdf } from '@/lib/portal-quote';

interface Doc { id: string; kind: string; kindLabel: string; number: string | null; title: string | null; status: string; totalTtc: number | null; issuedOn: string | null; hasPdf: boolean; building: string | null }
type Filter = 'all' | 'invoice' | 'quote';

export default function Documents() {
  const st = usePortalData<{ items: Doc[] }>('/api/portal/documents');
  const [f, setF] = useState<Filter>('all');
  const forbidden = !!st.error && /limit/i.test(st.error);
  const items = (st.data?.items ?? []).filter((d) => f === 'all' || (f === 'invoice' ? isInvoiceKind(d.kind) : d.kind === 'quote'));

  return (
    <PortalScroll state={forbidden ? { ...st, data: {}, error: null } : st}>
      <ScreenHeader eyebrow="Espace client" title="Mes documents" description="Devis, factures et autres documents. Touchez un document pour l’ouvrir." />
      {forbidden ? <EmptyState icon="lock" title="Accès limité" description="Votre compte ne permet pas de consulter les documents. Contactez JJD Consult." /> : (<>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['Tous', 'all'], ['Factures', 'invoice'], ['Devis', 'quote']] as const).map(([label, v]) => (
            <Pressable key={v} accessibilityRole="button" onPress={() => setF(v)}
              style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: f === v ? T.primary : T.surface, borderWidth: 1, borderColor: T.line }}>
              <Text style={{ color: f === v ? '#fff' : T.ink, fontWeight: '700' }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {items.length === 0 ? <EmptyState icon="folder" title="Aucun document" /> : items.map((d) => (
          <Pressable key={d.id} disabled={!d.hasPdf} onPress={() => void openPortalPdf(d.id, d.number)}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontWeight: '700' }}>{d.kindLabel} {d.number}</Text>
                  <Muted>{[d.title, d.building, dateBE(d.issuedOn)].filter(Boolean).join(' · ')}</Muted>
                </View>
                {d.hasPdf ? <Feather name="download" size={20} color={T.primary} /> : null}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                {isInvoiceKind(d.kind) ? <Badge tone={DOC_TONE[d.status] ?? 'warn'}>{invoiceLabel(d.status)}</Badge>
                  : d.kind === 'quote' ? <Badge tone={DOC_TONE[d.status]}>{quoteLabel(d.status)}</Badge> : <View />}
                {d.totalTtc != null ? <Text style={{ fontWeight: '800' }}>{eur(d.totalTtc)}</Text> : null}
              </View>
            </Card>
          </Pressable>
        ))}
      </>)}
    </PortalScroll>
  );
}
