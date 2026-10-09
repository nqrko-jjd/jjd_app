import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/lib/AppText';
import { T } from '@/lib/theme';
import { LOCALES, useLocale } from '@/lib/i18n';

/** Choix de la langue : drapeaux + nom, un appui suffit (l'appli entière change). */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  return (
    <View style={[s.row, compact && { justifyContent: 'center' }]}>
      {LOCALES.map((l) => {
        const on = l.code === locale;
        return (
          <Pressable key={l.code} accessibilityRole="button" accessibilityLabel={l.label} onPress={() => setLocale(l.code)} style={[s.btn, on && s.on]}>
            <Text style={{ fontSize: 20 }}>{l.flag}</Text>
            {!compact && <Text style={[s.txt, on && { color: '#fff' }]} numberOfLines={1}>{l.label}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface },
  on: { backgroundColor: T.primary, borderColor: T.primary },
  txt: { fontWeight: '700', color: T.ink, fontSize: 14 },
});
