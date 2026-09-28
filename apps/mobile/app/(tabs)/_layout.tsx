import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/lib/session';
import { T } from '@/lib/theme';

type FeatherName = keyof typeof Feather.glyphMap;

// Pastille claire derrière l'icône active, comme la pilule de nav de la maquette de référence.
function Icon({ name, color, focused }: { name: FeatherName; color: ColorValue; focused: boolean }) {
  return (
    <View
      style={{
        width: 36,
        height: 28,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? T.primarySoft : 'transparent',
      }}
    >
      <Feather name={name} size={19} color={color} />
    </View>
  );
}

export default function TabsLayout() {
  const { user } = useSession();
  const insets = useSafeAreaInsets();
  const role = user?.role ?? 'worker';
  const worker = role === 'worker';
  const foreman = role === 'foreman';
  const office = role === 'admin' || role === 'office';
  const staff = foreman || office;

  const hide = { href: null as null } as const;
  const tab = (title: string, ic: FeatherName) => ({
    title,
    tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => <Icon name={ic} color={color} focused={focused} />,
  });

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: T.surface },
        headerTitleStyle: { color: T.ink, fontWeight: '700', fontFamily: 'DMSans_700Bold' },
        headerShadowVisible: false,
        tabBarActiveTintColor: T.primary,
        tabBarInactiveTintColor: T.ink2,
        // hauteur/marge basse calculées à partir de l'inset système (barre de navigation Android classique
        // à 3 boutons, home indicator iOS…) : un height fixe sans ça fait chevaucher les boutons système
        // sur la barre flottante, notamment sur les vieux Android sans navigation gestuelle.
        tabBarStyle: {
          backgroundColor: T.surface,
          borderTopWidth: 0,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          height: 56 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 8 + insets.bottom,
          shadowColor: '#0f2a20',
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 12,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', fontFamily: 'DMSans_600SemiBold' },
      }}
    >
      <Tabs.Screen name="index" options={worker || foreman ? tab('Aujourd’hui', 'grid') : hide} />
      <Tabs.Screen name="heures" options={worker ? tab('Mes heures', 'clock') : hide} />
      <Tabs.Screen name="dashboard" options={office ? tab('Bord', 'grid') : hide} />
      <Tabs.Screen name="chantiers" options={staff ? tab('Chantiers', 'home') : worker ? tab('Mes chantiers', 'home') : hide} />
      <Tabs.Screen name="planning" options={staff ? tab('Planning', 'calendar') : hide} />
      <Tabs.Screen name="valider" options={staff ? tab('Valider', 'check-square') : hide} />
      <Tabs.Screen name="plus" options={staff ? tab('Plus', 'more-horizontal') : hide} />
      <Tabs.Screen name="compte" options={worker ? tab('Compte', 'user') : hide} />
    </Tabs>
  );
}
