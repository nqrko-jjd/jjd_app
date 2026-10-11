import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import { apiGet, apiSend } from '@/lib/api';
import { openApiFile } from '@/lib/files';
import { Card, Label, Loading, Muted } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr, Alert } from '@/lib/i18n';

interface Reserve { id: string; description: string; liftedAt: string | null }
interface Pv {
  id: string; status: string; receptionResult: string | null; presentParties: string | null; quoteRef: string | null; notes: string | null; clientName: string | null;
  reserves: Reserve[]; worksite: { id: string; ref: string; title: string; client: { name: string } | null };
}
const RESULTS = [['none', 'Sans réserve'], ['with_reserves', 'Avec réserve(s)'], ['refused', 'Refusée']] as const;

/** PV de réception des travaux, sur place avec le client : résultat, réserves, signature au doigt, puis PDF à partager. */
export default function PvScreen() {
  const { id, worksite } = useLocalSearchParams<{ id: string; worksite?: string }>();
  const router = useRouter();
  const sigRef = useRef<SignatureViewRef>(null);
  const [pv, setPv] = useState<Pv | null>(null);
  const [parties, setParties] = useState('');
  const [quoteRef, setQuoteRef] = useState('');
  const [notes, setNotes] = useState('');
  const [reserve, setReserve] = useState('');
  const [clientName, setClientName] = useState('');
  const [mode, setMode] = useState<'edit' | 'sign'>('edit');
  const [busy, setBusy] = useState(false);

  function load(p: Pv) {
    setPv(p); setParties(p.presentParties ?? ''); setQuoteRef(p.quoteRef ?? ''); setNotes(p.notes ?? ''); setClientName(p.clientName ?? p.worksite.client?.name ?? '');
  }
  useEffect(() => {
    (async () => {
      try {
        if (id === 'new') {
          const r = await apiSend<{ report: Pv }>('/api/pv', 'POST', { worksiteId: worksite }, false);
          if ('report' in r) router.replace(`/pv/${r.report.id}` as never);
        } else {
          load((await apiGet<{ report: Pv }>(`/api/pv/${id}`)).report);
        }
      } catch {
        Alert.alert('Hors ligne', 'Le PV a besoin de connexion pour être créé.');
        router.back();
      }
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pv) return <Loading />;
  const signed = pv.status === 'signed';
  const call = async (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: object) => {
    setBusy(true);
    try {
      const r = await apiSend<{ report: Pv }>(`/api/pv/${pv.id}${path}`, method, body, false);
      if ('report' in r) setPv(r.report);
    } catch (e) { Alert.alert('Erreur', (e as Error).message); } finally { setBusy(false); }
  };
  const save = () => (signed ? Promise.resolve() : call('', 'PATCH', { presentParties: parties, quoteRef, notes }));

  async function onSignature(sig: string) {
    if (clientName.trim().length < 2) { Alert.alert('Nom manquant', 'Indiquez le nom de la personne qui signe.'); return; }
    await call('/sign', 'POST', { clientName: clientName.trim(), signature: sig });
    setMode('edit');
  }

  if (mode === 'sign') {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <Stack.Screen options={{ title: tr('Signature du client') }} />
        <View style={{ padding: 14, gap: 8 }}>
          <Label>Nom de la personne qui signe</Label>
          <TextInput value={clientName} onChangeText={setClientName} placeholder={tr('ex. M. Dupont')} style={{ borderWidth: 1, borderColor: T.line, borderRadius: 8, padding: 10, fontSize: 15 }} />
          <Muted>Faites signer le client au doigt dans le cadre ci-dessous.</Muted>
        </View>
        <View style={{ flex: 1 }}>
          <SignatureScreen ref={sigRef} onOK={onSignature} onEmpty={() => Alert.alert('Signature vide', 'Le client doit signer avant de valider.')} descriptionText="" clearText="Effacer" confirmText="Valider la signature" webStyle=".m-signature-pad--footer { margin: 6px; } .m-signature-pad { box-shadow: none; border: 1px solid #ddd; }" />
        </View>
        <Pressable style={{ padding: 14, alignItems: 'center' }} onPress={() => setMode('edit')}><Text style={{ color: T.ink2 }}>Retour</Text></Pressable>
      </View>
    );
  }

  const open = pv.reserves.filter((r) => !r.liftedAt).length;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 18 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: tr('PV de réception'), headerBackTitle: tr('Retour') }} />
      <Muted>{pv.worksite.ref} — {pv.worksite.title}</Muted>
      {signed && <Card><Text style={{ color: T.ok, fontWeight: '800' }}>✓ Signé par {pv.clientName}</Text><Muted>{open ? `${open} réserve(s) à lever` : pv.reserves.length ? 'Toutes les réserves sont levées.' : 'Aucune réserve.'}</Muted></Card>}

      <Card>
        <Label>Résultat de la réception</Label>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {RESULTS.map(([k, label]) => {
            const on = pv.receptionResult === k;
            return (
              <Pressable key={k} accessibilityRole="button" disabled={signed || busy} onPress={() => call('', 'PATCH', { receptionResult: k })} style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: on ? T.primary : T.surface2, borderWidth: 1, borderColor: on ? T.primary : T.line }}>
                <Text style={{ color: on ? '#fff' : T.ink, fontWeight: '800' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card>
        <Label>Réserves ({pv.reserves.length})</Label>
        {pv.reserves.length === 0 && <Muted>Aucune réserve.</Muted>}
        {pv.reserves.map((r, i) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: T.line }}>
            <Text style={{ flex: 1, color: T.ink, textDecorationLine: r.liftedAt ? 'line-through' : 'none' }}>{i + 1}. {r.description}</Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => call(`/reserves/${r.id}`, 'PATCH', { lifted: !r.liftedAt })} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: r.liftedAt ? T.okSoft : T.warnSoft }}>
              <Text style={{ fontWeight: '800', color: r.liftedAt ? T.ok : T.warn, fontSize: 12.5 }}>{r.liftedAt ? 'Levée ✓' : 'Marquer levée'}</Text>
            </Pressable>
            {!signed && <Pressable accessibilityRole="button" accessibilityLabel="Supprimer la réserve" disabled={busy} onPress={() => call(`/reserves/${r.id}`, 'DELETE')}><Feather name="trash-2" size={18} color={T.crit} /></Pressable>}
          </View>
        ))}
        {!signed && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TextInput value={reserve} onChangeText={setReserve} placeholder={tr('Décrire la réserve…')} placeholderTextColor={T.ink3} style={{ flex: 1, minWidth: 0, width: 0, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 10, fontSize: 15, color: T.ink }} />
            <Pressable accessibilityRole="button" disabled={busy || reserve.trim().length < 3} onPress={async () => { await call('/reserves', 'POST', { description: reserve.trim() }); setReserve(''); }} style={{ backgroundColor: T.primary, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center', opacity: reserve.trim().length < 3 ? 0.45 : 1 }}>
              <Feather name="plus" size={20} color="#fff" />
            </Pressable>
          </View>
        )}
      </Card>

      <Card>
        <Label>Devis / marché concerné</Label>
        <TextInput value={quoteRef} onChangeText={setQuoteRef} onBlur={save} editable={!signed} placeholder="D2026-…" placeholderTextColor={T.ink3} style={{ fontSize: 15, color: T.ink, paddingVertical: 6 }} />
        <Label>Personnes présentes</Label>
        <TextInput value={parties} onChangeText={setParties} onBlur={save} editable={!signed} placeholder={tr('ex. M. Dupont, Julien')} placeholderTextColor={T.ink3} style={{ fontSize: 15, color: T.ink, paddingVertical: 6 }} />
        <Label>Remarques</Label>
        <TextInput value={notes} onChangeText={setNotes} onBlur={save} editable={!signed} multiline style={{ minHeight: 70, fontSize: 15, color: T.ink, textAlignVertical: 'top' }} />
      </Card>

      {busy && <ActivityIndicator color={T.primary} />}
      {!signed && (
        <Pressable accessibilityRole="button" disabled={busy} onPress={async () => { await save(); setMode('sign'); }} style={{ backgroundColor: T.primary, borderRadius: 16, padding: 16, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Faire signer le client</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={() => openApiFile(`/api/pv/${pv.id}/pdf`, `PV-reception-${pv.worksite.ref}.pdf`).catch((e) => Alert.alert('Erreur', (e as Error).message))} style={{ backgroundColor: T.primarySoft, borderRadius: 16, padding: 15, alignItems: 'center' }}>
        <Text style={{ color: T.primary, fontWeight: '800' }}>Ouvrir le PDF du PV</Text>
      </Pressable>
      {signed && pv.reserves.length > 0 && (
        <Pressable accessibilityRole="button" onPress={() => openApiFile(`/api/pv/${pv.id}/pdf?lifted=1`, `PV-levee-reserves-${pv.worksite.ref}.pdf`).catch((e) => Alert.alert('Erreur', (e as Error).message))} style={{ backgroundColor: T.surface2, borderRadius: 16, padding: 15, alignItems: 'center', borderWidth: 1, borderColor: T.line }}>
          <Text style={{ color: T.ink, fontWeight: '800' }}>PDF du PV de levée des réserves</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
