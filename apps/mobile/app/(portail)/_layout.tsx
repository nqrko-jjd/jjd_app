import { useCallback, useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiGet } from '@/lib/api';
import { T } from '@/lib/theme';

type FeatherName = keyof typeof Feather.glyphMap;

function Icon({ name, color, focused }: { name: FeatherName; color: ColorValue; focused: boolean }) {
  return (
    <View style={{ width: 40, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? T.primarySoft : 'transparent' }}>
      <Feather name={name} size={19} color={color} />
    </View>
  );
}

/** Onglets de l'espace client — groupe séparé de (tabs) pour ne jamais toucher aux écrans de l'équipe. */
export default function PortalTabs() {
  const insets = useSafeAreaInsets();
  const [unread, setUnread] = useState(0);
  const loadUnread = useCallback(async () => {
    try {
      const r = await apiGet<{ items: { unread: number }[] }>('/api/portal/messages');
      setUnread(r.items.reduce((n, i) => n + i.unread, 0));
    } catch { /* hors ligne */ }
  }, []);
  useEffect(() => {
    void loadUnread();
    const t = setInterval(loadUnread, 30000);
    return () => clearInterval(t);
  }, [loadUnread]);

  const tab = (title: string, ic: FeatherName, badge?: number) => ({
    title,
    headerShown: false,
    tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => <Icon name={ic} color={color} focused={focused} />,
    tabBarBadge: badge && badge > 0 ? badge : undefined,
    tabBarBadgeStyle: { backgroundColor: T.gold, color: '#241c05', fontSize: 10, fontWeight: '800' as const },
  });

  return (
    <Tabs
      screenLayout={({ children }) => <View style={{ flex: 1, backgroundColor: T.paper, paddingTop: insets.top }}>{children}</View>}
      screenOptions={{
        tabBarActiveTintColor: T.primary,
        tabBarInactiveTintColor: T.ink2,
        tabBarStyle: {
          backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.line,
          height: 68 + insets.bottom, paddingTop: 10, paddingBottom: 8 + insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600', fontFamily: 'DMSans_600SemiBold' },
      }}
    >
      <Tabs.Screen name="accueil" options={tab('Accueil', 'home')} />
      <Tabs.Screen name="chantiers" options={tab('Chantiers', 'tool')} />
      <Tabs.Screen name="devis" options={tab('Devis', 'file-text')} />
      <Tabs.Screen name="documents" options={tab('Documents', 'folder')} />
      <Tabs.Screen name="messages" options={tab('Messages', 'message-circle', unread)} />
      <Tabs.Screen name="compte" options={tab('Compte', 'user')} />
    </Tabs>
  );
}
