import { useState } from 'react';
import { Modal, View, Pressable, TextInput, Image, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { apiSend, apiUploadPhoto } from '@/lib/api';
import { T } from '@/lib/theme';
import { tr, Alert } from '@/lib/i18n';

/**
 * Fin de journée : quand on quitte le chantier, on PROPOSE (facultatif) d'ajouter un commentaire et des photos.
 * Tout part dans le fil de discussion du chantier : les photos restent donc utilisables pour être envoyées au client depuis le bureau.
 * Pas de rapport à remplir : le PV / rapport client se fait à part, à la demande.
 */
export function DayWrapUp({ worksite, onClose }: { worksite: { id: string; ref: string; title: string } | null; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function add(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true };
    if (!perm.granted) { Alert.alert('Permission refusée', fromCamera ? 'Accès à l’appareil photo requis.' : 'Accès aux photos requis.'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsMultipleSelection: true, mediaTypes: ['images'] });
    if (!res.canceled) setPhotos((p) => [...p, ...res.assets.map((a) => a.uri)].slice(0, 12));
  }
  function close() { setNote(''); setPhotos([]); onClose(); }

  async function send() {
    if (!worksite || busy) return;
    setBusy(true);
    try {
      if (note.trim()) await apiSend(`/api/worksites/${worksite.id}/thread/messages`, 'POST', { body: note.trim() });
      for (const uri of photos) await apiUploadPhoto(`/api/worksites/${worksite.id}/thread/photos`, uri);
      close();
    } catch {
      Alert.alert('Envoi impossible', 'Vérifie ta connexion et réessaie, ou passe cette étape : ton temps de présence est déjà enregistré.');
    } finally { setBusy(false); }
  }

  return (
    <Modal visible={!!worksite} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.scrim}>
        <View style={s.sheet}>
          <View style={s.grab} />
          <Text style={s.title}>Bonne fin de journée !</Text>
          <Text style={s.sub}>Un mot ou des photos pour l’équipe ? C’est facultatif.</Text>
          {!!worksite && <Text style={s.ws} numberOfLines={1}>{worksite.ref} — {worksite.title}</Text>}
          <TextInput value={note} onChangeText={setNote} multiline placeholder={tr('Ce qui a été fait, ce qui reste…')} placeholderTextColor={T.ink3} style={s.input} />
          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {photos.map((u, i) => (
                <View key={u + i}>
                  <Image source={{ uri: u }} style={s.thumb} />
                  <Pressable accessibilityRole="button" accessibilityLabel="Retirer la photo" onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))} style={s.rm}><Feather name="x" size={13} color="#fff" /></Pressable>
                </View>
              ))}
            </ScrollView>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable accessibilityRole="button" onPress={() => add(true)} style={s.photoBtn}><Feather name="camera" size={18} color={T.primary} /><Text style={s.photoTxt}>Prendre une photo</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => add(false)} style={s.photoBtn}><Feather name="image" size={18} color={T.primary} /><Text style={s.photoTxt}>Galerie</Text></Pressable>
          </View>
          <Pressable accessibilityRole="button" disabled={busy || (!note.trim() && photos.length === 0)} onPress={send} style={[s.send, (busy || (!note.trim() && photos.length === 0)) && { opacity: 0.45 }]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.sendTxt}>Envoyer dans le fil du chantier</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={close} style={{ paddingVertical: 12, alignItems: 'center' }}><Text style={{ color: T.ink2, fontWeight: '700' }}>Passer</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(15,42,32,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: T.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 28, gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: T.line, marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '800', color: T.ink },
  sub: { color: T.ink2, fontSize: 14 },
  ws: { color: T.primary, fontWeight: '700', fontSize: 13 },
  input: { minHeight: 90, maxHeight: 160, borderWidth: 1, borderColor: T.line, borderRadius: 16, padding: 14, fontSize: 15, color: T.ink, textAlignVertical: 'top', backgroundColor: T.paper },
  thumb: { width: 76, height: 76, borderRadius: 12 },
  rm: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: T.crit, alignItems: 'center', justifyContent: 'center' },
  photoBtn: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: T.primarySoft },
  photoTxt: { color: T.primary, fontWeight: '700', fontSize: 14 },
  send: { backgroundColor: T.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  sendTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
