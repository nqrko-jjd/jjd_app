import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSession } from '@/lib/session';
import { API_URL } from '@/lib/api';
import { T } from '@/lib/theme';

export default function Compte() {
  const { user, person, signOut } = useSession();
  return (
    <View style={s.wrap}>
      <View style={s.card}>
        <Text style={s.label}>Connecté</Text>
        <Text style={s.name}>{person?.displayName || person?.firstName || user?.email}</Text>
        <Text style={s.muted}>{user?.email}</Text>
        <Text style={s.muted}>Rôle : {user?.role}</Text>
      </View>
      <Text style={[s.muted, { fontSize: 12 }]}>API : {API_URL}</Text>
      <Pressable style={s.btn} onPress={signOut}>
        <Text style={s.btnTxt}>Déconnexion</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper, padding: 16, gap: 14 },
  card: { backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: 16, gap: 4 },
  label: { fontSize: 12, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { fontSize: 18, fontWeight: '700', color: T.ink },
  muted: { color: T.ink2 },
  btn: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  btnTxt: { color: T.crit, fontWeight: '600' },
});
