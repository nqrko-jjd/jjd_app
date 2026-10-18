import { NotificationSettings, unregisterNotifications } from '@/lib/notifications';
import { Alert } from 'react-native';
import { ScrollView, View, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/lib/AppText';
import { useSession } from '@/lib/session';
import { PrivacyLinks } from '@/lib/PrivacyLinks';
import { T } from '@/lib/theme';
import { loginLabel } from '@/lib/login-label';
import { LanguagePicker } from '@/lib/LanguagePicker';

export default function Compte() {
  const { user, person, signOut } = useSession();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={s.wrap}>
      <View style={s.card}>
        <Text style={s.label}>Connecté</Text>
        <Text style={s.name}>{person?.displayName || person?.firstName || loginLabel(user?.email)}</Text>
        <Text style={s.muted}>{loginLabel(user?.email)}</Text>
        <Text style={s.muted}>Rôle : {user?.role}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>Langue</Text>
        <LanguagePicker />
      </View>
      <View style={s.card}><NotificationSettings /></View>
      <PrivacyLinks />
      <Pressable style={s.btn} onPress={async () => {
        try { await unregisterNotifications(); await signOut(); }
        catch { Alert.alert('Connexion nécessaire', 'Reconnectez ce téléphone pour désactiver ses notifications avant de vous déconnecter.'); }
      }}>
        <Text style={s.btnTxt}>Déconnexion</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, backgroundColor: T.paper, padding: 16, gap: 14 },
  card: { backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: 16, gap: 4 },
  label: { fontSize: 12, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { fontSize: 18, fontWeight: '700', color: T.ink },
  muted: { color: T.ink2 },
  btn: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  btnTxt: { color: T.crit, fontWeight: '600' },
});
