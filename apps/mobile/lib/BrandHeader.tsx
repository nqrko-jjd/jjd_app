import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from './AppText';
import { useSession } from './session';
import { T } from './theme';
import { tr } from './i18n';

/** Persistent brand and profile access, matching the Sites mobile concept. */
export function BrandHeader() {
  const router = useRouter();
  const { person, user } = useSession();
  const name = person?.firstName || person?.displayName || user?.email || 'J';
  return (
    <View style={s.bar}>
      <View style={s.brand} accessible accessibilityLabel="JJD Consult">
        <View style={s.mark}><Image source={require('../assets/splash-logo.png')} style={s.logo} /></View>
        <Text style={s.name}>JJD Consult</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('Mon compte')} onPress={() => router.push('/compte')} style={({ pressed }) => [s.profile, pressed && { opacity: 0.65 }]}>
        <Text style={s.initial}>{name.slice(0, 1).toUpperCase()}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8, minHeight: 64, borderBottomWidth: 1, borderBottomColor: T.line, backgroundColor: T.paper },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  mark: { width: 32, height: 36, borderRadius: 10, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 22, height: 27, resizeMode: 'contain' },
  name: { color: T.ink, fontSize: 18, fontWeight: '700', letterSpacing: -0.5 },
  profile: { width: 48, height: 48, borderRadius: 24, backgroundColor: T.primarySoft, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center' },
  initial: { color: T.primary, fontSize: 15, fontWeight: '700' },
});
