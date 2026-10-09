import { useState } from 'react';
import { Pressable, type StyleProp, type TextStyle } from 'react-native';
import { Text } from '@/lib/AppText';
import { T } from '@/lib/theme';

/** Texte d'un message du fil dans la langue de l'utilisateur, avec un appui pour voir l'original. */
export function MsgText({ body, translated, style }: { body: string; translated?: string | null; style?: StyleProp<TextStyle> }) {
  const [orig, setOrig] = useState(false);
  if (!translated) return <Text style={style}>{body}</Text>;
  return (
    <>
      <Text style={style}>{orig ? body : translated}</Text>
      <Pressable accessibilityRole="button" onPress={() => setOrig((v) => !v)} hitSlop={8}>
        <Text style={{ fontSize: 11.5, color: T.primary, fontWeight: '700' }}>{orig ? 'Voir la traduction' : 'Traduit · voir l’original'}</Text>
      </Pressable>
    </>
  );
}
