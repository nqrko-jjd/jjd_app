import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/lib/session';
import { T } from '@/lib/theme';

export default function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
    } catch {
      setErr('E-mail ou mot de passe incorrect.');
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.wrap}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.inner}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <View style={s.mark}><Text style={s.markT}>J</Text></View>
          <Text style={s.brand}>JD Chantier</Text>
        </View>
        <Text style={s.sub}>Connecte-toi avec ton compte JJD.</Text>
        <TextInput
          style={s.input}
          placeholder="E-mail"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholderTextColor={T.ink2}
        />
        <TextInput
          style={s.input}
          placeholder="Mot de passe"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholderTextColor={T.ink2}
        />
        {err && <Text style={s.err}>{err}</Text>}
        <Pressable style={s.btn} onPress={submit} disabled={busy}>
          <Text style={s.btnTxt}>{busy ? 'Connexion…' : 'Se connecter'}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  inner: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  mark: { width: 34, height: 34, borderRadius: 9, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' },
  markT: { color: '#fff', fontWeight: '800', fontSize: 17 },
  brand: { fontSize: 24, fontWeight: '800', color: T.ink },
  sub: { color: T.ink2, marginBottom: 8 },
  input: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: T.ink,
  },
  err: { color: T.crit },
  btn: { backgroundColor: T.primary, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 4 },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
