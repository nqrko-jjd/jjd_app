import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Text } from '@/lib/AppText';
import { apiGet, apiSend } from '@/lib/api';
import { Alert } from '@/lib/i18n';
import { Card, Label, Muted } from '@/lib/ui';
import { T } from '@/lib/theme';
import { BigButton } from '@/lib/portal';

const input = { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, padding: 16, fontSize: 16, color: T.ink } as const;
const URGENCY = [['normal', 'Pas pressé'], ['soon', 'Cette semaine'], ['urgent', 'Urgent']] as const;
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); });

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, backgroundColor: on ? T.primary : T.surface, borderWidth: 1, borderColor: T.line }}>
      <Text style={{ color: on ? '#fff' : T.ink, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export default function Demande() {
  const router = useRouter();
  const key = useRef(uuid()).current; // évite un doublon si on touche deux fois « Envoyer »
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [urgency, setUrgency] = useState<'normal' | 'soon' | 'urgent'>('normal');
  const [buildings, setBuildings] = useState<{ id: string; name: string }[]>([]);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ buildings: { id: string; name: string }[] }>('/api/portal/buildings').then((r) => setBuildings(r.buildings)).catch(() => {});
  }, []);

  async function submit() {
    setErr(null);
    if (title.trim().length < 3) return setErr('Décrivez votre demande en quelques mots.');
    setBusy(true);
    try {
      const r = await apiSend<{ reference: string }>('/api/portal/requests', 'POST',
        { title: title.trim(), details: details.trim() || null, urgency, buildingId, requestKey: key }, false) as { reference: string };
      Alert.alert('Demande envoyée', `Votre demande ${r.reference} a bien été transmise à JJD Consult. Nous revenons vers vous rapidement.`, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={[T.content, { gap: 12 }]} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Nouvelle demande' }} />
      <Card><Muted>Une fuite, une réparation, un nouveau projet… Dites-nous ce dont vous avez besoin, nous vous recontactons.</Muted></Card>
      <Label>Votre demande</Label>
      <TextInput style={input} value={title} onChangeText={setTitle} placeholder="Ex. : fuite dans la salle de bains" placeholderTextColor={T.ink2} />
      <Label>Précisions (facultatif)</Label>
      <TextInput style={[input, { minHeight: 110, textAlignVertical: 'top' }]} value={details} onChangeText={setDetails} multiline placeholder="Où, depuis quand, comment nous joindre…" placeholderTextColor={T.ink2} />
      <Label>Urgence</Label>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {URGENCY.map(([v, l]) => <Chip key={v} on={urgency === v} label={l} onPress={() => setUrgency(v)} />)}
      </View>
      {buildings.length > 0 && (<>
        <Label>Immeuble concerné</Label>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip on={buildingId === null} label="Aucun" onPress={() => setBuildingId(null)} />
          {buildings.map((b) => <Chip key={b.id} on={buildingId === b.id} label={b.name} onPress={() => setBuildingId(b.id)} />)}
        </View>
      </>)}
      {err ? <Text style={{ color: T.crit }}>{err}</Text> : null}
      <BigButton label={busy ? 'Envoi…' : 'Envoyer ma demande'} icon="send" busy={busy} onPress={submit} />
    </ScrollView>
  );
}
