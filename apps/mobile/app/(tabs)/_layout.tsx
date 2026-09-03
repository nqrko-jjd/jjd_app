import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '@/lib/session';
import { T } from '@/lib/theme';

function Icon({ label, color }: { label: string; color: string }) {
  return <Text style={{ color, fontSize: 17 }}>{label}</Text>;
}

export default function TabsLayout() {
  const { user } = useSession();
  const role = user?.role ?? 'worker';
  const worker = role === 'worker';
  const foreman = role === 'foreman';
  const office = role === 'admin' || role === 'office';
  const staff = foreman || office;

  const hide = { href: null as null } as const;
  const tab = (title: string, ic: string) => ({ title, tabBarIcon: ({ color }: { color: string }) => <Icon label={ic} color={color} /> });

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: T.surface },
        headerTitleStyle: { color: T.ink, fontWeight: '700' },
        headerShadowVisible: false,
        tabBarActiveTintColor: T.primary,
        tabBarInactiveTintColor: T.ink2,
        tabBarStyle: { backgroundColor: T.surface, borderTopColor: T.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={worker || foreman ? tab('Aujourd’hui', '⏱') : hide} />
      <Tabs.Screen name="heures" options={worker ? tab('Mes heures', '📋') : hide} />
      <Tabs.Screen name="dashboard" options={office ? tab('Bord', '▨') : hide} />
      <Tabs.Screen name="chantiers" options={staff ? tab('Chantiers', '🏗') : worker ? tab('Mes chantiers', '🏗') : hide} />
      <Tabs.Screen name="planning" options={staff ? tab('Planning', '🗓') : hide} />
      <Tabs.Screen name="valider" options={staff ? tab('Valider', '✓') : hide} />
      <Tabs.Screen name="plus" options={staff ? tab('Plus', '⋯') : hide} />
      <Tabs.Screen name="compte" options={worker ? tab('Compte', '👤') : hide} />
    </Tabs>
  );
}
