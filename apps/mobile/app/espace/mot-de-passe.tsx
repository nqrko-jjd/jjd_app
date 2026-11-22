import { useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '@/lib/AppText';
import { apiSend, storageKey } from '@/lib/api';
import { Alert } from '@/lib/i18n';
import { Card, Label, Muted } from '@/lib/ui';
import { T } from '@/lib/theme';
import { BigButton, PORTAL_PWD_PROMPT } from '@/lib/portal';

const input = { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, padding: 16, fontSize: 17, color: T.ink } as const;

export default function MotDePasse() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [pwd, setPwd] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(null);
    if (pwd.length < 10) return setErr('Le mot de passe doit contenir au moins 10 caractères.');
    if (pwd !== again) return setErr('Les deux mots de passe ne sont pas identiques.');
    setBusy(true);
    try {
      await apiSend('/api/portal/password', 'POST', { password: pwd, ...(current ? { currentPassword: current } : {}) }, false);
      await AsyncStorage.removeItem(storageKey(PORTAL_PWD_PROMPT));
      Alert.alert('Mot de passe enregistré', 'Vous pourrez vous connecter avec votre e-mail et ce mot de passe.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={[T.content, { gap: 12 }]} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Mot de passe' }} />
      <Card>
        <Text style={{ fontWeight: '800', fontSize: 16 }}>Choisissez un mot de passe</Text>
        <Muted>Choisissez un mot de passe pour vous connecter plus vite la prochaine fois. Au moins 10 caractères.</Muted>
      </Card>
      <Label>Mot de passe actuel (si vous en avez déjà un)</Label>
      <TextInput style={input} value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      <Label>Nouveau mot de passe</Label>
      <TextInput style={input} value={pwd} onChangeText={setPwd} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" />
      <Label>Confirmez le nouveau mot de passe</Label>
      <TextInput style={input} value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" />
      {err ? <Text style={{ color: T.crit }}>{err}</Text> : null}
      <BigButton label={busy ? 'Enregistrement…' : 'Enregistrer'} busy={busy} onPress={save} />
    </ScrollView>
  );
}
