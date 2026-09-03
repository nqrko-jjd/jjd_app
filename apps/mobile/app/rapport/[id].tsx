import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, Pressable, TextInput, Alert, Image, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import { apiGet, apiSend, apiUploadPhoto, API_URL } from '@/lib/api';
import { Card, Label, Loading, Muted } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Report {
  id: string; status: string; workDone: string | null; notes: string | null; clientName: string | null;
  photos: { id: string; url: string; thumbUrl: string | null }[];
}

export default function Rapport() {
  const { id: worksiteId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const sigRef = useRef<SignatureViewRef>(null);

  const [report, setReport] = useState<Report | null>(null);
  const [workDone, setWorkDone] = useState('');
  const [notes, setNotes] = useState('');
  const [clientName, setClientName] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'edit' | 'sign' | 'done'>('edit');

  useEffect(() => {
    (async () => {
      try {
        const list = await apiGet<{ items: Report[] }>(`/api/worksites/${worksiteId}/reports`);
        const draft = list.items.find((r) => r.status === 'draft');
        if (draft) {
          setReport(draft);
          setWorkDone(draft.workDone ?? '');
          setNotes(draft.notes ?? '');
        } else {
          const r = await apiSend<{ report: Report }>(`/api/worksites/${worksiteId}/reports`, 'POST', {}, false);
          if ('report' in r) setReport(r.report);
        }
      } catch {
        Alert.alert('Hors ligne', 'Le rapport a besoin de connexion pour être créé.');
        router.back();
      }
    })();
  }, [worksiteId]);

  async function save() {
    if (!report) return;
    await apiSend(`/api/reports/${report.id}`, 'PATCH', { workDone, notes });
  }

  async function addPhoto(fromCamera: boolean) {
    if (!report) return;
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true };
    if (!perm.granted) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.6 });
    if (res.canceled || !res.assets[0]) return;
    setBusy(true);
    try {
      await apiUploadPhoto(`/api/reports/${report.id}/photos`, res.assets[0].uri);
      const fresh = await apiGet<{ report: Report }>(`/api/reports/${report.id}`);
      setReport(fresh.report);
    } catch {
      Alert.alert('Erreur', 'Photo non envoyée.');
    } finally {
      setBusy(false);
    }
  }

  async function onSignature(sig: string) {
    if (!report || !clientName.trim()) { Alert.alert('Nom manquant', 'Indiquez le nom de la personne qui signe.'); return; }
    setBusy(true);
    try {
      await save();
      const r = await apiSend<{ report: Report }>(`/api/reports/${report.id}/sign`, 'POST', { clientName: clientName.trim(), signature: sig });
      if ('queued' in r) Alert.alert('Hors ligne', 'Le rapport signé partira au retour du réseau.');
      setMode('done');
    } catch (e) {
      Alert.alert('Erreur', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!report) return <Loading />;

  if (mode === 'done') {
    return (
      <View style={{ flex: 1, backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
        <Stack.Screen options={{ title: 'Rapport', headerBackTitle: 'Retour' }} />
        <Text style={{ fontSize: 44 }}>✅</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: T.ink, textAlign: 'center' }}>Rapport signé par {report.clientName || clientName}</Text>
        <Muted>Le bureau et le client y ont accès.</Muted>
        <Pressable style={{ backgroundColor: T.primary, borderRadius: 10, padding: 14, paddingHorizontal: 28 }} onPress={() => router.replace(`/fiche/${worksiteId}` as never)}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Terminer</Text>
        </Pressable>
      </View>
    );
  }

  if (mode === 'sign') {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <Stack.Screen options={{ title: 'Signature du client' }} />
        <View style={{ padding: 14, gap: 8 }}>
          <Label>Nom de la personne qui signe</Label>
          <TextInput
            value={clientName}
            onChangeText={setClientName}
            placeholder="ex. M. Dupont"
            style={{ borderWidth: 1, borderColor: T.line, borderRadius: 8, padding: 10, fontSize: 15 }}
          />
          <Muted>Faites signer le client au doigt dans le cadre ci-dessous.</Muted>
        </View>
        <View style={{ flex: 1 }}>
          <SignatureScreen
            ref={sigRef}
            onOK={onSignature}
            onEmpty={() => Alert.alert('Signature vide', 'Le client doit signer avant de valider.')}
            descriptionText=""
            clearText="Effacer"
            confirmText="Valider la signature"
            webStyle={`.m-signature-pad--footer { margin: 6px; } .m-signature-pad { box-shadow: none; border: 1px solid #ddd; }`}
          />
        </View>
        <Pressable style={{ padding: 14, alignItems: 'center' }} onPress={() => setMode('edit')}>
          <Text style={{ color: T.ink2 }}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Stack.Screen options={{ title: 'Rapport de chantier', headerBackTitle: 'Retour' }} />

      <Card>
        <Label>Travaux réalisés</Label>
        <TextInput
          value={workDone}
          onChangeText={setWorkDone}
          onBlur={save}
          multiline
          placeholder="Ce qui a été fait aujourd'hui…"
          style={{ minHeight: 110, fontSize: 15, color: T.ink, textAlignVertical: 'top' }}
        />
      </Card>

      <Card>
        <Label>Remarques / réserves (optionnel)</Label>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          onBlur={save}
          multiline
          placeholder="Points à signaler, matériel manquant…"
          style={{ minHeight: 70, fontSize: 15, color: T.ink, textAlignVertical: 'top' }}
        />
      </Card>

      <Card>
        <Label>Photos ({report.photos.length})</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {report.photos.map((p) => (
            <Image key={p.id} source={{ uri: `${API_URL}${p.thumbUrl ?? p.url}` }} style={{ width: 74, height: 74, borderRadius: 8, backgroundColor: T.surface2 }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Pressable style={btn} disabled={busy} onPress={() => addPhoto(true)}><Text style={btnT}>📷 Photo</Text></Pressable>
          <Pressable style={btn} disabled={busy} onPress={() => addPhoto(false)}><Text style={btnT}>🖼️ Galerie</Text></Pressable>
        </View>
        {busy && <ActivityIndicator style={{ marginTop: 8 }} color={T.primary} />}
      </Card>

      <Pressable
        style={{ backgroundColor: T.primary, borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 4 }}
        disabled={busy}
        onPress={async () => { await save(); setMode('sign'); }}
      >
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Faire signer le client</Text>
      </Pressable>
      <Muted style={{ textAlign: 'center' }}>Le rapport est enregistré automatiquement.</Muted>
    </ScrollView>
  );
}

const btn = { flex: 1, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line, borderRadius: 9, padding: 12, alignItems: 'center' as const };
const btnT = { color: T.ink, fontWeight: '700' as const };
