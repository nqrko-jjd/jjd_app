import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';

// DM Sans est chargée en poids fixes (voir app/_layout.tsx) : contrairement à une police système,
// `fontWeight` seul ne suffit pas à obtenir le bon graisse, il faut pointer la bonne fontFamily.
const FAMILY_BY_WEIGHT: Record<string, string> = {
  '400': 'DMSans_400Regular',
  normal: 'DMSans_400Regular',
  '500': 'DMSans_500Medium',
  '600': 'DMSans_600SemiBold',
  '700': 'DMSans_700Bold',
  bold: 'DMSans_700Bold',
  '800': 'DMSans_800ExtraBold',
};

function flattenStyle(style: TextProps['style']): TextStyle {
  return StyleSheet.flatten(style) ?? {};
}

export function Text({ style, ...props }: TextProps) {
  const flat = flattenStyle(style);
  const weight = flat.fontWeight != null ? String(flat.fontWeight) : '400';
  const fontFamily = FAMILY_BY_WEIGHT[weight] ?? 'DMSans_400Regular';
  return <RNText {...props} style={[{ fontFamily, fontSize: 14, color: '#173b31' }, style]} />;
}
