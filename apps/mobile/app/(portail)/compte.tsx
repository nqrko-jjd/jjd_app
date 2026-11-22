import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/lib/session';
import { Card, Label, Muted, ScreenHeader } from '@/lib/ui';
import { Text } from '@/lib/AppText';
import { PrivacyLinks } from '@/lib/PrivacyLinks';
import { T } from '@/lib/theme';
import { BigButton } from '@/lib/portal';

export default function CompteClient() {
  const { user, signOut } = useSession();
  const router = useRouter();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={[T.content, { gap: 14 }]}>
      <ScreenHeader eyebrow="Espace client" title="Mon compte" />
      <Card>
        <Label>Connecté en tant que</Label>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{user?.label ?? user?.email}</Text>
        <Muted>{user?.email}</Muted>
      </Card>
      <BigButton label="Mot de passe" icon="lock" tone="ghost" onPress={() => router.push('/espace/mot-de-passe' as never)} />
      <PrivacyLinks />
      <BigButton label="Se déconnecter" icon="log-out" tone="danger" onPress={() => void signOut()} />
    </ScrollView>
  );
}
