import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { T } from '@/lib/theme';

function Icon({ label, color }: { label: string; color: string }) {
  return <Text style={{ color, fontSize: 18 }}>{label}</Text>;
}

export default function TabsLayout() {
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
      <Tabs.Screen
        name="index"
        options={{ title: 'Aujourd’hui', tabBarIcon: ({ color }) => <Icon label="⏱" color={color} /> }}
      />
      <Tabs.Screen
        name="heures"
        options={{ title: 'Mes heures', tabBarIcon: ({ color }) => <Icon label="📋" color={color} /> }}
      />
      <Tabs.Screen
        name="compte"
        options={{ title: 'Compte', tabBarIcon: ({ color }) => <Icon label="👤" color={color} /> }}
      />
    </Tabs>
  );
}
