import { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Image, ScrollView } from 'react-native';
import { Text } from '@/lib/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/lib/session';
import { LinearGradient } from 'expo-linear-gradient';
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
      setErr('Identifiant ou mot de passe incorrect.');
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.wrap}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex:1}}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.inner}>
        <LinearGradient colors={[T.heroFrom,T.heroTo]} style={s.hero}><Image source={require('../assets/splash-logo.png')} style={{width:58,height:64,resizeMode:'contain'}}/><Text style={s.brand}>JJD Consult</Text><Text style={s.heroText}>Votre équipe. Vos chantiers.
Tout au même endroit.</Text></LinearGradient>
        <Text style={{fontSize:26,fontWeight:'800',color:T.ink,marginTop:14}}>Bienvenue</Text>
        <Text style={s.sub}>Connectez-vous à votre espace de travail.</Text>
        <Text style={s.fieldLabel}>E-mail ou n° de GSM</Text>
        <TextInput
          style={s.input}
          placeholder="E-mail ou 0475 12 34 56"
          autoCapitalize="none"
          keyboardType="default"
          value={email}
          onChangeText={setEmail}
          placeholderTextColor={T.ink2}
        />
        <Text style={s.fieldLabel}>Mot de passe ou code</Text>
        <TextInput
          style={s.input}
          placeholder="Mot de passe ou code"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholderTextColor={T.ink2}
        />
        {err && <Text style={s.err}>{err}</Text>}
        <Pressable style={s.btn} onPress={submit} disabled={busy}>
          <Text style={s.btnTxt}>{busy ? 'Connexion…' : 'Se connecter'}</Text>
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 10, width: '100%', maxWidth: 540, alignSelf: 'center' },
  mark: { width: 34, height: 34, borderRadius: 9, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' },
  markT: { color: '#fff', fontWeight: '800', fontSize: 17 },
  hero: { borderRadius: 26, padding: 28, gap: 14 },
  heroText: { color: '#cbded1', fontSize: 15, lineHeight: 23 },
  fieldLabel: { color: T.ink2, fontSize: 12, fontWeight: '600', marginTop: 4 },
  brand: { fontSize: 28, fontWeight: '700', color: 'white' },
  sub: { color: T.ink2, marginBottom: 8 },
  input: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    color: T.ink,
  },
  err: { color: T.crit },
  btn: { backgroundColor: T.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 4 },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
