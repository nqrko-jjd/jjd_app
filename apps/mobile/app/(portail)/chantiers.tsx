import { View } from 'react-native';
import { Text } from '@/lib/AppText';
import { useRouter } from 'expo-router';
import { Badge, Muted, ResourceList, ScreenHeader, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

interface W { id: string; ref: string; title: string; statusLabel: string; building: { name: string | null } | null; endedOn: string | null; urgent: boolean }

export default function Chantiers() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <View style={[T.content, { paddingBottom: 0 }]}>
        <ScreenHeader eyebrow="Espace client" title="Mes chantiers" />
      </View>
      <ResourceList<W>
        endpoint="/api/portal/worksites"
        search={(w, q) => `${w.title} ${w.ref} ${w.building?.name ?? ''}`.toLowerCase().includes(q)}
        searchPlaceholder="Rechercher un chantier…"
        onPress={(w) => router.push(`/espace/chantier/${w.id}` as never)}
        render={(w) => (<>
          <Text style={{ fontWeight: '700', fontSize: 15 }}>{w.title}</Text>
          <Muted>{[w.ref, w.building?.name].filter(Boolean).join(' · ')}</Muted>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge tone="primary">{w.statusLabel}</Badge>
            {w.urgent ? <Badge tone="warn">À suivre</Badge> : null}
            {w.endedOn ? <Badge>Terminé le {dateBE(w.endedOn)}</Badge> : null}
          </View>
        </>)}
      />
    </View>
  );
}
