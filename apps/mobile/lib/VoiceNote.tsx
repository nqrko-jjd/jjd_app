import { File } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { Feather } from '@expo/vector-icons';
import { Text } from './AppText';
import { API_URL, getToken } from './api';
import { T } from './theme';

export function VoicePlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause' : 'Écouter la note vocale'} style={{ padding: 12, backgroundColor: T.surface2, borderRadius: 12 }} onPress={async () => {
    try {
      if (status.playing) player.pause();
      else { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); if (status.didJustFinish) await player.seekTo(0); player.play(); }
    } catch { Alert.alert('Lecture indisponible', 'Vérifiez votre connexion.'); }
  }}><Text style={{ color: T.primary }}>{status.playing ? 'Ⅱ Pause' : '▶ Note vocale'} · {Math.floor(status.currentTime)} s</Text></Pressable>;
}

export function VoiceNote({ endpoint, onSent }: { endpoint: string; onSent: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const operation = useRef('');
  const lock = useRef(false);
  const active = useRef(false);
  const mounted = useRef(true);
  async function stop() {
    if (!active.current) return;
    active.current = false;
    if (mounted.current) setRecording(false);
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    if (mounted.current) setDraft(recorder.uri);
  }
  useFocusEffect(useCallback(() => () => { void stop().catch(() => {}); }, [recorder]));
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', s => { if (s !== 'active') void stop().catch(() => {}); });
    return () => { mounted.current = false; sub.remove(); if (active.current) void recorder.stop().catch(() => {}); void setAudioModeAsync({ allowsRecording: false }).catch(() => {}); };
  }, [recorder]);
  useEffect(() => { if (state.durationMillis >= 120000 && active.current) void stop().catch(() => {}); }, [state.durationMillis]);
  useEffect(() => {
    if (!recording) return;
    const limit = setTimeout(() => { void stop().catch(() => {}); }, 120000);
    return () => clearTimeout(limit);
  }, [recording]);
  async function toggle() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      if (active.current) await stop();
      else {
        if (!(await requestRecordingPermissionsAsync()).granted) { Alert.alert('Microphone désactivé', 'Autorisez le microphone dans les réglages pour enregistrer une note vocale.'); return; }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        operation.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        recorder.record(); active.current = true; setRecording(true);
      }
    } catch { active.current = false; setRecording(false); Alert.alert('Enregistrement indisponible', 'Réessayez après avoir vérifié le microphone.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function send() {
    if (!draft || lock.current) return;
    lock.current = true; setBusy(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const token = await getToken();
      const form = new FormData();
      form.append('file', new File(draft));
      form.append('requestId', operation.current);
      const res = await fetch(`${API_URL}${endpoint}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: form, signal: controller.signal });
      if (!res.ok) throw new Error('upload');
      setDraft(null); onSent();
    } catch { Alert.alert('Note non envoyée', 'Vérifiez votre connexion puis réessayez. La note reste disponible sur cet écran.'); }
    finally { clearTimeout(timeout); lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <View style={{ paddingHorizontal: 12, paddingVertical: 6, gap: 8, backgroundColor: T.surface }}>
    {draft ? <><VoicePlayer uri={draft} /><View style={{ flexDirection: 'row', gap: 20 }}>
      <Pressable disabled={busy} onPress={send} style={{ padding: 12 }} accessibilityRole="button"><Text style={{ color: T.primary }}>{busy ? 'Envoi…' : 'Envoyer la note'}</Text></Pressable>
      <Pressable disabled={busy} onPress={() => setDraft(null)} style={{ padding: 12 }} accessibilityRole="button"><Text>Supprimer</Text></Pressable>
    </View></> : <Pressable disabled={busy} onPress={toggle} style={{ flexDirection: 'row', gap: 10, padding: 10 }} accessibilityRole="button">
      <Feather name={recording ? 'square' : 'mic'} size={20} color={recording ? T.crit : T.primary} />
      <Text>{recording ? `Arrêter · ${Math.floor(state.durationMillis / 1000)} s` : 'Enregistrer une note vocale'}</Text>
    </Pressable>}
  </View>;
}
