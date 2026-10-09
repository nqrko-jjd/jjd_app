import { View } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack } from 'expo-router';
import { ResourceList, Muted, dateBE, useRouterPush } from '@/lib/ui';
import { tr } from '@/lib/i18n';

interface V {
  id: string; code: string | null; brand: string | null; model: string | null; plate: string | null;
  type: string | null; driver: string | null; nextInspection: string | null; status: string;
}

export default function Flotte() {
  const push = useRouterPush();
  return (
    <>
      <Stack.Screen options={{ title: tr('Flotte'), headerBackTitle: tr('Retour') }} />
      <ResourceList<V>
        endpoint="/api/vehicles"
        search={(v, q) => `${v.brand} ${v.model} ${v.plate} ${v.driver}`.toLowerCase().includes(q)}
        searchPlaceholder="Marque, plaque, conducteur…"
        onPress={(v) => push(`/vehicule/${v.id}`)}
        render={(v) => (
          <View>
            <Text style={{ fontWeight: '600', color: '#26372f' }}>
              {[v.brand, v.model].filter(Boolean).join(' ')} {v.plate ? `· ${v.plate}` : ''}
            </Text>
            <Muted>
              {v.type ?? '—'}{v.driver ? ` · ${v.driver}` : ''}
              {v.nextInspection ? ` · CT ${dateBE(v.nextInspection)}` : ''}
            </Muted>
          </View>
        )}
      />
    </>
  );
}
