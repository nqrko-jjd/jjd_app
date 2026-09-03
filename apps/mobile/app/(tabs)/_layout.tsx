import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '@/lib/session';
import { T } from '@/lib/theme';

function Icon({ label, color }: { label: string; color: string }) {
  return <Text style={{ color, fontSize: 17 }}>{label}</Text>;
}

export default function TabsLayout() {
  const { user } = useSession();
  const isStaff = user && ['admin', 'office', 'foreman'].includes(user.role);
  const isField = user && ['worker', 'foreman'].includes(user.role);

  const hide = { href: null as null } as const;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: T.surface },
        headerTitleStyle: { color: T.ink },
        tabBarActiveTintColor: T.primary,
        tabBarInactiveTintColor: T.ink2,
        tabBarStyle: { backgroundColor: T.surface, borderTopColor: T.line },
      }}
    >
      {/* Terrain */}
      <Tabs.Screen name="index" options={isField ? { title: 'Aujourd’hui', tabBarIcon: ({ color }) => <Icon label="⏱" color={color} /> } : hide} />
      <Tabs.Screen name="heures" options={isField ? { title: 'Mes heures', tabBarIcon: ({ color }) => <Icon label="📋" color={color} /> } : hide} />

      {/* Bureau / admin */}
      <Tabs.Screen name="dashboard" options={isStaff ? { title: 'Tableau de bord', tabBarIcon: ({ color }) => <Icon label="▨" color={color} /> } : hide} />
      <Tabs.Screen name="chantiers" options={isStaff ? { title: 'Chantiers', tabBarIcon: ({ color }) => <Icon label="🏗" color={color} /> } : hide} />
      <Tabs.Screen name="planning" options={isStaff ? { title: 'Planning', tabBarIcon: ({ color }) => <Icon label="🗓" color={color} /> } : hide} />
      <Tabs.Screen name="valider" options={isStaff ? { title: 'Valider', tabBarIcon: ({ color }) => <Icon label="✓" color={color} /> } : hide} />

      <Tabs.Screen name="compte" options={{ title: 'Compte', tabBarIcon: ({ color }) => <Icon label="👤" color={color} /> }} />
    </Tabs>
  );
}
