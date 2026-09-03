import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '@/lib/session';
import { T } from '@/lib/theme';

function Guard() {
  const { user, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inApp = segments[0] === '(tabs)';
    if (!user && inApp) router.replace('/login');
    else if (user && !inApp) router.replace('/');
  }, [user, loading, segments, router]);

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: T.paper },
        headerStyle: { backgroundColor: T.surface },
        headerTitleStyle: { color: T.ink, fontWeight: '700' },
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
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Guard />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
