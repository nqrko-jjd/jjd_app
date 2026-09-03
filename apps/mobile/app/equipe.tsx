import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { ResourceList, Muted, eur, useRouterPush } from '@/lib/ui';

interface P {
  id: string; firstName: string; lastName: string | null; displayName: string | null;
  role: string; contractType: string; hourlyRate: number | null; active: boolean;
}
const ROLE: Record<string, string> = { foreman: 'Chef de chantier', worker: 'Ouvrier' };
const CT: Record<string, string> = { employee: 'Salarié', subcontractor: 'Sous-traitant', interim: 'Intérim' };

export default function Equipe() {
  const push = useRouterPush();
  return (
    <>
      <Stack.Screen options={{ title: 'Équipe', headerBackTitle: 'Retour' }} />
      <ResourceList<P>
        endpoint="/api/people?active=1"
        search={(p, q) => `${p.firstName} ${p.lastName ?? ''} ${p.displayName ?? ''}`.toLowerCase().includes(q)}
        searchPlaceholder="Nom…"
        onPress={(p) => push(`/personne/${p.id}`)}
        render={(p) => (
          <View>
            <Text style={{ fontWeight: '600', color: '#1b2233' }}>{p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim()}</Text>
            <Muted>
              {ROLE[p.role] ?? p.role} · {CT[p.contractType] ?? p.contractType}
              {p.hourlyRate != null ? ` · ${eur(p.hourlyRate)}/h` : ' · taux à définir'}
            </Muted>
          </View>
        )}
      />
    </>
  );
}
