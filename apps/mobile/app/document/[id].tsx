import { useCallback, useState } from 'react';
import { ScrollView, Text, View, Pressable, Alert } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { apiGet, apiSend } from '@/lib/api';
import { Card, Label, Loading, Row, Badge, Muted, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Line {
  id?: string; kind: string; label: string; description: string | null;
  qty: number; unit: string | null; unitPriceHt: number; discountPct: number; vatRate: number;
}
interface Doc {
  id: string; kind: string; number: string | null; draftRef: string | null; status: string;
  title: string | null; issuedOn: string | null; dueOn: string | null; validUntil: string | null;
  totalHt: number; totalVat: number; totalTtc: number; paidAmount: number; structuredComm: string | null;
  lockedAt: string | null; source: string | null;
  billingName: string | null; billingVat: string | null; billingAddress: string | null;
  contact: { name: string; vat: string | null } | null;
  worksite: { ref: string; title: string } | null;
  lines: Line[];
}
const KIND: Record<string, string> = { quote: 'Devis', invoice: 'Facture', credit_note: 'Note de crédit', deposit_invoice: 'Acompte' };

export default function DocumentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { apiGet<{ document: Doc }>(`/api/documents/${id}`).then((r) => setD(r.document)).catch(() => {}); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!d) return <Loading />;

  const isInvoice = d.kind === 'invoice' || d.kind === 'deposit_invoice';

  async function act(path: string, body: unknown, label: string) {
    setBusy(true);
    try {
      const r = await apiSend<{ note?: string }>(`/api/documents/${id}${path}`, 'POST', body);
      if ('queued' in r) Alert.alert('Hors ligne', 'Action mise en file, elle partira au retour du réseau.');
      else Alert.alert(label, (r as { note?: string }).note ?? 'Fait.');
      load();
    } catch (e) {
      Alert.alert('Erreur', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Stack.Screen options={{ title: `${KIND[d.kind]} ${d.number ?? ''}`.trim(), headerBackTitle: 'Retour' }} />

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: T.ink }}>{d.number ?? d.draftRef ?? '—'}</Text>
          <Badge>{d.status}</Badge>
        </View>
        {d.title ? <Text style={{ color: T.ink, marginTop: 4 }}>{d.title}</Text> : null}
        <View style={{ height: 8 }} />
        <Row k="Client" v={d.billingName ?? d.contact?.name ?? '—'} />
        {d.worksite ? <Row k="Chantier" v={`${d.worksite.ref} — ${d.worksite.title}`} /> : null}
        {d.issuedOn ? <Row k="Émis le" v={dateBE(d.issuedOn)} /> : null}
        {d.kind === 'quote' && d.validUntil ? <Row k="Validité" v={dateBE(d.validUntil)} /> : null}
        {d.dueOn ? <Row k="Échéance" v={dateBE(d.dueOn)} /> : null}
        {d.structuredComm ? <Row k="Communication" v={d.structuredComm} /> : null}
      </Card>

      <Label>Lignes</Label>
      {d.lines.length === 0 ? (
        <Card><Muted>Détail non repris (document importé). Le PDF d’origine est dans TrustUp.</Muted></Card>
      ) : (
        d.lines.map((l, i) => (
          <Card key={l.id ?? i}>
            {l.kind === 'section' ? (
              <Text style={{ fontWeight: '800', color: T.ink }}>{l.label}</Text>
            ) : l.kind === 'text' ? (
              <Muted>{l.label}</Muted>
            ) : (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '600', color: T.ink, flex: 1 }}>{l.label}</Text>
                  <Text style={{ fontWeight: '600', color: T.ink }}>{eur(l.qty * l.unitPriceHt * (1 - l.discountPct / 100))}</Text>
                </View>
                <Muted>{l.qty} {l.unit ?? ''} × {eur(l.unitPriceHt)}{l.discountPct ? ` − ${l.discountPct}%` : ''} · TVA {Math.round(l.vatRate * 100)}%</Muted>
              </>
            )}
          </Card>
        ))
      )}

      <Card>
        <Row k="Total HT" v={eur(d.totalHt)} />
        <Row k="TVA" v={eur(d.totalVat)} />
        <Row k="Total TTC" v={eur(d.totalTtc)} strong />
        {d.paidAmount > 0 ? <Row k="Payé" v={eur(d.paidAmount)} /> : null}
      </Card>

      {d.lockedAt && (
        <View style={{ gap: 8 }}>
          {isInvoice && d.status !== 'paid' && (
            <Pressable style={btn} disabled={busy} onPress={() => act('/mark-paid', {}, 'Encaissement')}>
              <Text style={btnT}>Marquer payée</Text>
            </Pressable>
          )}
          {d.status !== 'sent' && (
            <Pressable style={btn} disabled={busy} onPress={() => act('/send', { peppol: isInvoice }, 'Envoi')}>
              <Text style={btnT}>{isInvoice ? 'Envoyer' : 'Marquer envoyé'}</Text>
            </Pressable>
          )}
        </View>
      )}
      {!d.lockedAt && <Muted>Brouillon — la création et l’édition des lignes se font sur la version web.</Muted>}
      {isInvoice && (
        <Muted>Transmission Peppol pas encore active — TrustUp reste l’émetteur officiel.</Muted>
      )}
    </ScrollView>
  );
}

const btn = { backgroundColor: T.primary, borderRadius: 10, padding: 13, alignItems: 'center' as const };
const btnT = { color: '#fff', fontWeight: '700' as const };
