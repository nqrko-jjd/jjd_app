import { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text } from '@/lib/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useSession } from '@/lib/session';
import { apiSend, storageKey } from '@/lib/api';
import { PORTAL_PWD_PROMPT } from '@/lib/portal';
import { T } from '@/lib/theme';

type Mode = 'password' | 'email' | 'code';

export default function PortailLogin() {
  const { signInPortal, signOut } = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mail = email.trim().toLowerCase();

  async function finish(token: string, askPassword: boolean) {
    if (askPassword) await AsyncStorage.setItem(storageKey(PORTAL_PWD_PROMPT), '1');
    try { await signInPortal(token); }
    catch { await signOut(); throw new Error('Connexion impossible pour le moment. Vérifiez votre réseau et réessayez.'); }
  }

  async function run(work: () => Promise<void>) {
    setErr(null); setBusy(true);
    try { await work(); } catch (e) { setErr(e instanceof Error ? e.message : 'Une erreur est survenue.'); }
    finally { setBusy(false); }
  }

  const loginWithPassword = () => run(async () => {
    if (!mail || !password) throw new Error('Saisissez votre e-mail et votre mot de passe.');
    const r = await apiSend<{ token: string }>('/api/portal/login', 'POST', { email: mail, password }, false) as { token: string };
    await finish(r.token, false);
  });

  const requestCode = () => run(async () => {
    if (!mail.includes('@')) throw new Error('Saisissez une adresse e-mail valide.');
    const r = await apiSend<{ ok: boolean; devCode?: string }>('/api/portal/request-code', 'POST', { email: mail }, false) as { devCode?: string };
    setCode(r.devCode ?? '');
    setInfo(r.devCode
      ? 'Compte de démonstration : le code a été rempli pour vous.'
      : 'Si cette adresse correspond à un compte client, un code à 6 chiffres vient d’être envoyé. Il est valable 10 minutes.');
    setMode('code');
  });

  const verifyCode = () => run(async () => {
    if (!/^\d{6}$/.test(code.trim())) throw new Error('Le code comporte 6 chiffres.');
    const r = await apiSend<{ token: string }>('/api/portal/verify-code', 'POST', { email: mail, code: code.trim() }, false) as { token: string };
    await finish(r.token, true);
  });

  const go = (m: Mode) => { setMode(m); setErr(null); setInfo(null); };

  return (
    <SafeAreaView style={s.wrap}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.inner}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={s.back}>
            <Feather name="chevron-left" size={20} color={T.primary} />
            <Text style={{ color: T.primary, fontWeight: '600' }}>Retour</Text>
          </Pressable>
          <Text style={s.title}>Espace client</Text>
          <Text style={s.sub}>Suivez vos chantiers, vos devis et vos factures JJD Consult.</Text>

          <Text style={s.label}>Votre adresse e-mail</Text>
          <TextInput style={s.input} value={email} onChangeText={setEmail} editable={mode !== 'code'} autoCapitalize="none" autoCorrect={false}
            keyboardType="email-address" textContentType="emailAddress" placeholder="vous@exemple.be" placeholderTextColor={T.ink2} />

          {mode === 'password' && (<View style={{ gap: 10 }}>
            <Text style={s.label}>Mot de passe</Text>
            <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
              textContentType="password" placeholder="Votre mot de passe" placeholderTextColor={T.ink2} onSubmitEditing={loginWithPassword} />
            {err && <Text style={s.err}>{err}</Text>}
            <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={loginWithPassword} disabled={busy}>
              <Text style={s.btnTxt}>{busy ? 'Connexion…' : 'Se connecter'}</Text>
            </Pressable>
            <Pressable onPress={() => go('email')} style={s.link}>
              <Text style={s.linkTxt}>Première connexion / mot de passe oublié ?</Text>
            </Pressable>
          </View>)}

          {mode === 'email' && (<View style={{ gap: 10 }}>
            <Text style={s.sub}>Nous vous envoyons un code à 6 chiffres par e-mail. Pas besoin de mot de passe.</Text>
            {err && <Text style={s.err}>{err}</Text>}
            <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={requestCode} disabled={busy}>
              <Text style={s.btnTxt}>{busy ? 'Envoi…' : 'Recevoir mon code'}</Text>
            </Pressable>
            <Pressable onPress={() => go('password')} style={s.link}><Text style={s.linkTxt}>J’ai un mot de passe</Text></Pressable>
          </View>)}

          {mode === 'code' && (<View style={{ gap: 10 }}>
            {info && <Text style={s.sub}>{info}</Text>}
            <Text style={s.label}>Code à 6 chiffres</Text>
            <TextInput style={[s.input, { fontSize: 26, letterSpacing: 8, textAlign: 'center', fontWeight: '700' }]} value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6}
              textContentType="oneTimeCode" autoComplete="sms-otp" placeholder="······" placeholderTextColor={T.ink2} />
            {err && <Text style={s.err}>{err}</Text>}
            <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={verifyCode} disabled={busy}>
              <Text style={s.btnTxt}>{busy ? 'Vérification…' : 'Valider le code'}</Text>
            </Pressable>
            <Pressable onPress={requestCode} disabled={busy} style={s.link}><Text style={s.linkTxt}>Renvoyer un code</Text></Pressable>
            <Pressable onPress={() => go('password')} style={s.link}><Text style={s.linkTxt}>Retour</Text></Pressable>
          </View>)}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 10, width: '100%', maxWidth: 540, alignSelf: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 8, alignSelf: 'flex-start' },
  title: { fontFamily: T.headingFont, fontSize: 30, fontWeight: '700', color: T.ink, marginTop: 6 },
  sub: { color: T.ink2, fontSize: 15, lineHeight: 22, marginBottom: 6 },
  label: { color: T.ink2, fontSize: 13, fontWeight: '600', marginTop: 4 },
  input: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, padding: 16, fontSize: 17, color: T.ink },
  err: { color: T.crit, fontSize: 14 },
  btn: { backgroundColor: T.primary, borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 6 },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 17 },
  link: { paddingVertical: 14, alignItems: 'center' },
  linkTxt: { color: T.primary, fontWeight: '600', fontSize: 15 },
});
