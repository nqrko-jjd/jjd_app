import { useCallback, useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, FlatList, TextInput, RefreshControl, Image, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { apiGet, apiUploadPhoto, API_URL } from './api';
import { T } from './theme';

/** Bandeau photo (fiche véhicule / personne). `basePath` = /api/vehicles/<id> etc. */
export function PhotoHeader({
  basePath, photoUrl, round, onChange,
}: { basePath: string; photoUrl: string | null; round?: boolean; onChange?: () => void }) {
  const [busy, setBusy] = useState(false);
  const size = round ? 96 : undefined;

  async function upload(uri: string) {
    setBusy(true);
    try {
      await apiUploadPhoto(`${basePath}/photo`, uri);
      onChange?.();
    } catch (e) {
      Alert.alert('Erreur', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function choose() {
    Alert.alert('Photo', undefined, [
      {
        text: 'Prendre une photo',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) return;
          const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
          if (!r.canceled && r.assets[0]) upload(r.assets[0].uri);
        },
      },
      {
        text: 'Choisir dans la galerie',
        onPress: async () => {
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.6 });
          if (!r.canceled && r.assets[0]) upload(r.assets[0].uri);
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  const src = photoUrl ? `${API_URL}${photoUrl}` : null;

  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable onPress={choose} disabled={busy}>
        {src ? (
          <Image
            source={{ uri: src }}
            style={round
              ? { width: size, height: size, borderRadius: size! / 2, backgroundColor: T.surface2 }
              : { width: '100%', aspectRatio: 16 / 10, borderRadius: 14, backgroundColor: T.surface2 }}
          />
        ) : (
          <View style={round
            ? { width: size, height: size, borderRadius: size! / 2, backgroundColor: T.surface2, alignItems: 'center', justifyContent: 'center' }
            : { width: '100%', aspectRatio: 16 / 10, borderRadius: 14, backgroundColor: T.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 30 }}>📷</Text>
          </View>
        )}
      </Pressable>
      <Pressable onPress={choose} disabled={busy}>
        <Text style={{ color: T.primary, fontWeight: '700', fontSize: 13 }}>
          {busy ? 'Envoi…' : photoUrl ? 'Changer la photo' : 'Ajouter une photo'}
        </Text>
      </Pressable>
    </View>
  );
}

export function Card({ children, accent }: { children: ReactNode; accent?: string }) {
  return <View style={[st.card, accent ? { borderColor: accent, borderWidth: 1.5 } : null]}>{children}</View>;
}
export function Label({ children }: { children: ReactNode }) {
  return <Text style={st.label}>{children}</Text>;
}
export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[st.muted, style]}>{children}</Text>;
}
export function Loading() {
  return <View style={{ padding: 44, alignItems: 'center' }}><ActivityIndicator color={T.primary} /></View>;
}
export function Badge({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'crit' | 'primary' }) {
  const map = { ok: [T.ok, T.okSoft], warn: [T.warn, T.warnSoft], crit: [T.crit, T.critSoft], primary: [T.primary, T.primarySoft] } as const;
  const [fg, bg] = tone ? map[tone] : [T.ink2, T.surface2];
  return <View style={[st.badge, { backgroundColor: bg }]}><Text style={{ color: fg, fontSize: 11.5, fontWeight: '700' }}>{children}</Text></View>;
}

export function eur(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toLocaleString('fr-BE', { maximumFractionDigits: 2 })} €`;
}
export function dateBE(d: string | null | undefined): string {
  if (!d) return '—';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function Row({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  return (
    <View style={st.kv}>
      <Text style={st.kvK}>{k}</Text>
      <Text style={[st.kvV, strong && { fontWeight: '800' }]}>{v}</Text>
    </View>
  );
}

/** Écran-liste générique : fetch un endpoint, recherche client, tap -> détail. */
export function ResourceList<Item extends { id: string }>({
  endpoint,
  search,
  render,
  onPress,
  searchPlaceholder,
}: {
  endpoint: string;
  search?: (it: Item, q: string) => boolean;
  render: (it: Item) => ReactNode;
  onPress?: (it: Item) => void;
  searchPlaceholder?: string;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ items: Item[] }>(endpoint);
      setItems(r.items);
    } catch {
      /* hors ligne */
    }
  }, [endpoint]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!items) return <Loading />;
  const filtered = q && search ? items.filter((it) => search(it, q.toLowerCase())) : items;

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      {search && (
        <View style={{ padding: 12 }}>
          <TextInput
            style={st.search}
            placeholder={searchPlaceholder ?? 'Rechercher…'}
            value={q}
            onChangeText={setQ}
            placeholderTextColor={T.ink3}
          />
        </View>
      )}
      <FlatList
        data={filtered}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: 12, paddingTop: search ? 0 : 12, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<Muted>Aucun résultat.</Muted>}
        renderItem={({ item }) => (
          <Pressable style={st.listRow} onPress={() => onPress?.(item)} disabled={!onPress}>
            {render(item)}
          </Pressable>
        )}
      />
    </View>
  );
}

export function useRouterPush() {
  const router = useRouter();
  return (href: string) => router.push(href as never);
}

const st = StyleSheet.create({
  card: { backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: 14, gap: 6 },
  label: { fontSize: 12, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '700' },
  muted: { color: T.ink2 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 2 },
  kvK: { color: T.ink2, flexShrink: 0 },
  kvV: { color: T.ink, flex: 1, textAlign: 'right', fontWeight: '600' },
  search: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 12, color: T.ink },
  listRow: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 12 },
});
