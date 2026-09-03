import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/lib/session';
import { API_URL } from '@/lib/api';
import { T } from '@/lib/theme';

const LINKS: { href: string; label: string; ic: string }[] = [
  { href: '/immeubles', label: 'Immeubles / ACP', ic: '⌂' },
  { href: '/contacts', label: 'Contacts', ic: '☰' },
  { href: '/equipe', label: 'Équipe', ic: '☺' },
  { href: '/flotte', label: 'Flotte', ic: '⛟' },
  { href: '/pipeline', label: 'Pipeline commercial', ic: '⇗' },
  { href: '/decomptes', label: 'Décomptes du mois', ic: '€' },
  { href: '/controle', label: 'File de contrôle', ic: '⚑' },
];

export default function Plus() {
  const router = useRouter();
  const { user, person, signOut } = useSession();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 10 }}>
      <View style={s.card}>
        <Text style={s.name}>{person?.displayName || person?.firstName || user?.email}</Text>
        <Text style={s.muted}>{user?.email} · {user?.role}</Text>
      </View>

      <View style={s.group}>
        {LINKS.map((l, i) => (
          <Pressable
            key={l.href}
            style={[s.row, i < LINKS.length - 1 && s.rowBorder]}
            onPress={() => router.push(l.href as never)}
          >
            <Text style={s.ic}>{l.ic}</Text>
            <Text style={s.label}>{l.label}</Text>
            <Text style={s.chev}>›</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[s.muted, { fontSize: 11 }]}>API : {API_URL}</Text>
      <Pressable style={s.logout} onPress={signOut}>
        <Text style={{ color: T.crit, fontWeight: '700' }}>Déconnexion</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: 14 },
  name: { fontSize: 17, fontWeight: '700', color: T.ink },
  muted: { color: T.ink2 },
  group: { backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: T.line },
  ic: { fontSize: 15, width: 20, textAlign: 'center', color: T.ink2 },
  label: { flex: 1, fontWeight: '600', color: T.ink },
  chev: { color: T.ink3, fontSize: 18 },
  logout: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 14, alignItems: 'center' },
});
