import { View } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack } from 'expo-router';
import { ResourceList, Muted, useRouterPush } from '@/lib/ui';
import { tr } from '@/lib/i18n';

interface C {
  id: string; name: string; kind: string | null; type: string; city: string | null;
  syndic: { name: string } | null;
  contactPersons?: { name: string; role: string | null; email: string | null; phone: string | null }[];
}
const KIND: Record<string, string> = { individual: 'Particulier', company: 'Société', acp: 'ACP', syndic: 'Syndic', public: 'Public' };

/** Personnes de contact (gestionnaire, comptable…) dont le nom, l'e-mail ou le téléphone correspond à la recherche. */
const personsMatching = (c: C, q: string) =>
  q ? (c.contactPersons ?? []).filter((p) => `${p.name} ${p.email ?? ''} ${p.phone ?? ''}`.toLowerCase().includes(q)) : [];

export default function Contacts() {
  const push = useRouterPush();
  return (
    <>
      <Stack.Screen options={{ title: 'Contacts', headerBackTitle: tr('Retour') }} />
      <ResourceList<C>
        endpoint="/api/contacts?type=all"
        search={(c, q) => c.name.toLowerCase().includes(q) || (c.city ?? '').toLowerCase().includes(q) || personsMatching(c, q).length > 0}
        searchPlaceholder="Nom, ville, personne de contact…"
        onPress={(c) => push(`/contact/${c.id}`)}
        render={(c, q) => (
          <View>
            <Text style={{ fontWeight: '600', color: '#26372f' }}>{c.name}</Text>
            <Muted>
              {c.kind ? KIND[c.kind] ?? c.kind : c.type === 'supplier' ? 'Fournisseur' : '—'}
              {c.syndic ? ` · c/o ${c.syndic.name}` : ''}{c.city ? ` · ${c.city}` : ''}
            </Muted>
            {personsMatching(c, q).slice(0, 3).map((p, i) => (
              <Muted key={i}>↳ {p.name}{p.role ? ` · ${p.role}` : ''}</Muted>
            ))}
          </View>
        )}
      />
    </>
  );
}
