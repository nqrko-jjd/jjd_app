import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { ResourceList, Muted, useRouterPush } from '@/lib/ui';

interface C {
  id: string; name: string; kind: string | null; type: string; city: string | null;
  syndic: { name: string } | null;
}
const KIND: Record<string, string> = { individual: 'Particulier', company: 'Société', acp: 'ACP', syndic: 'Syndic', public: 'Public' };

export default function Contacts() {
  const push = useRouterPush();
  return (
    <>
      <Stack.Screen options={{ title: 'Contacts', headerBackTitle: 'Retour' }} />
      <ResourceList<C>
        endpoint="/api/contacts?type=all"
        search={(c, q) => c.name.toLowerCase().includes(q) || (c.city ?? '').toLowerCase().includes(q)}
        searchPlaceholder="Nom, ville…"
        onPress={(c) => push(`/contact/${c.id}`)}
        render={(c) => (
          <View>
            <Text style={{ fontWeight: '600', color: '#1b2233' }}>{c.name}</Text>
            <Muted>
              {c.kind ? KIND[c.kind] ?? c.kind : c.type === 'supplier' ? 'Fournisseur' : '—'}
              {c.syndic ? ` · c/o ${c.syndic.name}` : ''}{c.city ? ` · ${c.city}` : ''}
            </Muted>
          </View>
        )}
      />
    </>
  );
}
