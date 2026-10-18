import { Alert, Linking, Pressable, View } from 'react-native';
import { Text } from './AppText';
import { T } from './theme';

export function PrivacyLinks() {
  async function open(url: string) {
    try { await Linking.openURL(url); }
    catch { Alert.alert('Contact JJD Consult', 'Contactez info@jjd-consult.be pour toute question concernant vos données.'); }
  }
  return <View style={{ gap: 4 }}>
    <Pressable accessibilityRole="link" onPress={() => open('https://new.jjd-consult.be/confidentialite-mobile.html')} style={{ paddingVertical: 12 }}>
      <Text style={{ color: T.primary, textDecorationLine: 'underline' }}>Confidentialité et données personnelles</Text>
    </Pressable>
    <Pressable accessibilityRole="link" onPress={() => open('https://new.jjd-consult.be/confidentialite-mobile.html#droits')} style={{ paddingVertical: 12 }}>
      <Text style={{ color: T.primary, textDecorationLine: 'underline' }}>Demander la suppression de mon compte</Text>
    </Pressable>
  </View>;
}
