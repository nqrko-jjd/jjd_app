import { useEffect } from 'react';
import { TextInput } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  DMSans_800ExtraBold,
} from '@expo-google-fonts/dm-sans';
import { SessionProvider, useSession } from '@/lib/session';
import { T } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
// Les champs de saisie n'ont pas de variante custom par graisse — DM Sans normale suffit partout.
const TextInputAny = TextInput as any;
TextInputAny.defaultProps = { ...TextInputAny.defaultProps, style: [{ fontFamily: 'DMSans_400Regular' }, TextInputAny.defaultProps?.style] };

function Guard() {
  const { user, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const onLogin = segments[0] === 'login';
    if (!user && !onLogin) router.replace('/login');
    else if (user && onLogin) router.replace('/');
  }, [user, loading, segments, router]);

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: T.paper },
        headerStyle: { backgroundColor: T.surface },
        headerTitleStyle: { color: T.ink, fontWeight: '700', fontFamily: 'DMSans_700Bold' },
        headerTintColor: T.primary,
        headerShadowVisible: false,
        headerBackTitle: 'Retour',
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    DMSans_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Guard />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
