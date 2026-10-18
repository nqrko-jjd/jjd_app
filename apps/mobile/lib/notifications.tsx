import { useEffect, useState } from 'react';
import { AppState, Alert, Linking, Platform, Pressable, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { apiSend, getToken } from './api';
import { useSession } from './session';
import { Text } from './AppText';
import { T } from './theme';

const TOKEN = 'jjd_push_token';
const ENABLED = 'jjd_push_enabled';
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });

async function register(ask: boolean) {
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
  await AsyncStorage.multiSet([[TOKEN, token], [ENABLED, '1']]);
}

export async function unregisterNotifications() {
  const token = await AsyncStorage.getItem(TOKEN);
  if (token) await apiSend('/api/push/native/unsubscribe', 'POST', { token }, false);
  await AsyncStorage.multiRemove([TOKEN, ENABLED]);
  await Notifications.dismissAllNotificationsAsync();
}

export function NotificationBridge() {
  const { user } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!user) return;
    const refresh = async () => { if (await AsyncStorage.getItem(ENABLED) === '1') await register(false); };
    void refresh().catch(() => {});
    const state = AppState.addEventListener('change', s => { if (s === 'active') void refresh().catch(() => {}); });
    let last: string | null = null;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || response.notification.request.identifier === last) return;
      last = response.notification.request.identifier;
      const data = response.notification.request.content.data;
      if (!data || data.userId !== user.id || typeof data.route !== 'string') return;
      if (data.route === '/planning' || data.route === '/fil-general' || /^\/fil\/[a-zA-Z0-9_-]+$/.test(data.route)) router.push(data.route as never);
      void Notifications.clearLastNotificationResponseAsync();
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const listener = Notifications.addNotificationResponseReceivedListener(open);
    return () => { state.remove(); listener.remove(); };
  }, [user?.id, router]);
  return null;
}

export function NotificationSettings() {
  const [status, setStatus] = useState('Activez les alertes de messages et de planning sur ce téléphone.');
  const [busy, setBusy] = useState(false);
  async function change(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (enabled) await register(true); else await unregisterNotifications();
      setStatus(enabled ? 'Notifications activées sur ce téléphone.' : 'Notifications désactivées sur ce téléphone.');
    } catch (e) { Alert.alert('Notifications', e instanceof Error ? e.message : 'Vérifiez votre connexion.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void AsyncStorage.getItem(ENABLED).then(v => { if (v === '1') setStatus('Notifications activées dans JJD. Vérifiez aussi les autorisations du téléphone.'); }); }, []);
  return <View style={{ gap: 4 }}><Text style={{ fontWeight: '700' }}>Notifications</Text><Text>{status}</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => change(true)} style={{ paddingVertical: 12 }}><Text style={{ color: T.primary }}>{busy ? 'Mise à jour…' : 'Activer les notifications'}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => change(false)} style={{ paddingVertical: 12 }}><Text>Désactiver sur ce téléphone</Text></Pressable>
    <Pressable accessibilityRole="link" onPress={() => Linking.openSettings()} style={{ paddingVertical: 12 }}><Text>Réglages du téléphone</Text></Pressable>
  </View>;
}
