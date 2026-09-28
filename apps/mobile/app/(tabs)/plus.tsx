import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSession } from '@/lib/session';
import { API_URL } from '@/lib/api';
import { T } from '@/lib/theme';

type FeatherName = keyof typeof Feather.glyphMap;

const LINKS: { href: string; label: string; ic: FeatherName; roles?: string[] }[] = [
  { href: '/immeubles', label: 'Immeubles / Projets', ic: 'home' },
  { href: '/contacts', label: 'Contacts', ic: 'book-open' },
  { href: '/equipe', label: 'Équipe', ic: 'users' },
  { href: '/flotte', label: 'Flotte', ic: 'truck' },
  { href: '/pipeline', label: 'Pipeline commercial', ic: 'trending-up' },
  { href: '/documents', label: 'Devis & factures', ic: 'file-text', roles: ['admin', 'office'] },
  { href: '/decomptes', label: 'Décomptes du mois', ic: 'credit-card' },
  { href: '/controle', label: 'File de contrôle', ic: 'flag' },
];

export default function Plus() {
  const router = useRouter();
  const { user, person, signOut } = useSession();
  const links = LINKS.filter((l) => !l.roles || (user && l.roles.includes(user.role)));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 10 }}>
      <View style={s.card}>
        <Text style={s.name}>{person?.displayName || person?.firstName || user?.email}</Text>
        <Text style={s.muted}>{user?.email} · {user?.role}</Text>
      </View>

      <View style={s.group}>
        {links.map((l, i) => (
          <Pressable
            key={l.href}
            style={[s.row, i < links.length - 1 && s.rowBorder]}
            onPress={() => router.push(l.href as never)}
          >
            <View style={s.ic}><Feather name={l.ic} size={17} color={T.ink2} /></View>
            <Text style={s.label}>{l.label}</Text>
            <Feather name="chevron-right" size={18} color={T.ink3} />
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
  ic: { width: 20, alignItems: 'center' },
  label: { flex: 1, fontWeight: '600', color: T.ink },
  logout: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 14, alignItems: 'center' },
});
