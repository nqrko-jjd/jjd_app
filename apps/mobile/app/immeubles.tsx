import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { ResourceList, Muted, useRouterPush } from '@/lib/ui';

interface B {
  id: string; name: string; city: string | null;
  syndic: { name: string } | null;
  _count: { worksites: number };
}

export default function Immeubles() {
  const push = useRouterPush();
  return (
    <>
      <Stack.Screen options={{ title: 'Immeubles / ACP', headerBackTitle: 'Retour' }} />
      <ResourceList<B>
        endpoint="/api/buildings"
        search={(b, q) => b.name.toLowerCase().includes(q) || (b.city ?? '').toLowerCase().includes(q)}
        searchPlaceholder="Nom, ville…"
        onPress={(b) => push(`/immeuble/${b.id}`)}
        render={(b) => (
          <View>
            <Text style={{ fontWeight: '600', color: '#1b2233' }}>{b.name}</Text>
            <Muted>{b.syndic?.name ?? '—'}{b.city ? ` · ${b.city}` : ''} · {b._count.worksites} interventions</Muted>
          </View>
        )}
      />
    </>
  );
}
