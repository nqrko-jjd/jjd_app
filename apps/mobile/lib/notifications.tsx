import { useEffect, useState } from 'react';
import { AppState, Alert, Linking, Platform, Pressable, Switch, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { apiGet, apiSend, getToken, storageKey } from './api';
import { useSession } from './session';
import { Text } from './AppText';
import { T } from './theme';

const TOKEN = 'jjd_push_token';
const ENABLED = 'jjd_push_enabled';
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });

let deviceQueue: Promise<unknown> = Promise.resolve();
function serializeDevice<T>(work: () => Promise<T>): Promise<T> {
  const result = deviceQueue.then(work, work);
  deviceQueue = result.catch(() => {});
  return result;
}
function register(ask: boolean) { return serializeDevice(() => registerDevice(ask)); }
async function registerDevice(ask: boolean) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') throw new Error('Disponible dans l’application installée.');
  if (Platform.OS === 'android' && !Constants.expoConfig?.extra?.nativePushConfigured) throw new Error('Les notifications Android attendent la configuration Firebase de JJD.');
  const auth = await getToken();
  if (!auth) return;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('jjd', { name: 'Messages et planning JJD', importance: Notifications.AndroidImportance.HIGH });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && ask) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Autorisez les notifications de JJD Chantier dans les réglages du téléphone.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (await getToken() !== auth) return;
  await apiSend('/api/push/native/subscribe', 'POST', { token }, false);
  // If logout raced with the HTTP response, do not mark another session registered.
  if (await getToken() !== auth) return;
  await AsyncStorage.multiSet([[storageKey(TOKEN), token], [storageKey(ENABLED), '1']]);
}

export function unregisterNotifications() { return serializeDevice(unregisterDevice); }
async function unregisterDevice() {
  const token = await AsyncStorage.getItem(storageKey(TOKEN));
  if (token) await apiSend('/api/push/native/unsubscribe', 'POST', { token }, false);
  await AsyncStorage.multiRemove([storageKey(TOKEN), storageKey(ENABLED)]);
  await Notifications.dismissAllNotificationsAsync();
}

export function NotificationBridge() {
  const { user } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!user) return;
    const refresh = async () => { if (await AsyncStorage.getItem(storageKey(ENABLED)) === '1') await register(false); };
    void refresh().catch(() => {});
    const state = AppState.addEventListener('change', s => { if (s === 'active') void refresh().catch(() => {}); });
    let last: string | null = null;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || response.notification.request.identifier === last) return;
      last = response.notification.request.identifier;
      const data = response.notification.request.content.data;
      if (!data || data.userId !== user.id || typeof data.route !== 'string') return;
      if (data.route === '/planning' || data.route === '/achats' || data.route === '/fil-general' || /^\/fil\/[a-zA-Z0-9_-]+$/.test(data.route)) router.push(data.route as never);
      void Notifications.clearLastNotificationResponseAsync();
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const listener = Notifications.addNotificationResponseReceivedListener(open);
    return () => { state.remove(); listener.remove(); };
  }, [user?.id, router]);
  return null;
}

type Prefs = { messages: boolean; planning: boolean; departure: boolean; peppol: boolean };
const PREF_ROWS: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'messages', label: 'Messages', hint: 'Nouveau message dans la messagerie ou un chantier' },
  { key: 'planning', label: 'Planning', hint: 'Votre planning a été mis à jour' },
  { key: 'departure', label: 'Rappel de départ', hint: 'Avant une intervention, au moment de partir' },
  { key: 'peppol', label: 'Factures Peppol', hint: 'Nouvelle facture fournisseur reçue (bureau)' },
];

export function NotificationSettings() {
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState('Activez les alertes sur ce téléphone.');
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  async function change(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (enabled) await register(true); else await unregisterNotifications();
      setOn(enabled);
      setStatus(enabled ? 'Notifications activées sur ce téléphone.' : 'Notifications désactivées sur ce téléphone.');
    } catch (e) { Alert.alert('Notifications', e instanceof Error ? e.message : 'Vérifiez votre connexion.'); }
    finally { setBusy(false); }
  }
  async function toggle(key: keyof Prefs, value: boolean) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    try { await apiSend('/api/push/native/prefs', 'PATCH', { [key]: value }, false); }
    catch { setPrefs(before); Alert.alert('Notifications', 'Réglage non enregistré (connexion ?).'); }
  }
  useEffect(() => {
    void AsyncStorage.getItem(storageKey(ENABLED)).then(v => { if (v === '1') { setOn(true); setStatus('Notifications activées. Vérifiez aussi les autorisations du téléphone.'); } });
    void apiGet<{ prefs: Prefs }>('/api/push/native/prefs').then(r => setPrefs(r.prefs)).catch(() => {});
  }, []);
  const btn = { paddingVertical: 14, borderRadius: 12, alignItems: 'center' as const };
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontWeight: '800', fontSize: 16 }}>Notifications</Text>
      <Text style={{ color: T.ink2 }}>{status}</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => change(!on)} style={{ ...btn, backgroundColor: on ? T.surface2 : T.primary, opacity: busy ? 0.6 : 1 }}>
        <Text style={{ color: on ? T.ink : '#fff', fontWeight: '800' }}>{busy ? 'Mise à jour…' : on ? 'Désactiver sur ce téléphone' : 'Activer les notifications'}</Text>
      </Pressable>
      {prefs && (
        <View style={{ gap: 2, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, paddingHorizontal: 14 }}>
          <Text style={{ fontWeight: '700', paddingTop: 12, color: T.ink2 }}>Quelles alertes recevoir ?</Text>
          {PREF_ROWS.map((r, i) => (
            <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: T.line }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: T.ink }}>{r.label}</Text>
                <Text style={{ color: T.ink2, fontSize: 12.5 }}>{r.hint}</Text>
              </View>
              <Switch value={prefs[r.key]} onValueChange={(v) => toggle(r.key, v)} trackColor={{ true: T.primary }} />
            </View>
          ))}
        </View>
      )}
      <Pressable accessibilityRole="link" onPress={() => Linking.openSettings()} style={{ ...btn, borderWidth: 1, borderColor: T.line }}>
        <Text style={{ color: T.ink, fontWeight: '700' }}>Réglages du téléphone</Text>
      </Pressable>
    </View>
  );
}
