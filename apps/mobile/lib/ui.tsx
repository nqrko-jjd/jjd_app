import { useCallback, useState, type ReactNode } from 'react';
import { View, StyleSheet, ActivityIndicator, Pressable, FlatList, TextInput, RefreshControl, Image, Alert } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { apiGet, apiUploadPhoto, API_URL } from './api';
import { T } from './theme';

/** Bannière/tuile vert dégradé — mise en avant d'une métrique ou d'un titre de fiche (voir maquette). */
export function HeroTile({ children, icon }: { children: ReactNode; icon?: keyof typeof Feather.glyphMap }) {
  return (
    <LinearGradient colors={[T.heroFrom, T.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.hero}>
      {icon && (
        <View style={st.heroIcon}>
          <Feather name={icon} size={16} color="#fff" />
        </View>
      )}
      {children}
    </LinearGradient>
  );
}

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
      <Pressable onPress={choose} disabled={busy} style={round ? undefined : { width: '100%' }}>
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
            <Feather name="camera" size={26} color={T.ink3} />
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

export function ScreenHeader({title,eyebrow,description,avatar}: {title:string;eyebrow?:string;description?:string;avatar?:string}) {
 const router=useRouter();
 return <View style={{flexDirection:'row',alignItems:'flex-start',gap:16,marginBottom:6}}><View style={{flex:1}}>{eyebrow&&<Text style={{fontSize:10.5,color:T.ink2,letterSpacing:1.3,textTransform:'uppercase',fontWeight:'700',marginBottom:7}}>{eyebrow}</Text>}<Text accessibilityRole="header" style={{fontSize:28,fontWeight:'800',letterSpacing:-.9,color:T.ink,lineHeight:35}}>{title}</Text>{description&&<Text style={{fontSize:13,color:T.ink2,lineHeight:20,marginTop:6}}>{description}</Text>}</View>{avatar&&<Pressable accessibilityLabel="Ouvrir mon espace" onPress={()=>router.push('/plus' as never)} style={{width:44,height:44,borderRadius:16,backgroundColor:T.goldSoft,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:16,fontWeight:'700',color:T.primary}}>{avatar.slice(0,2).toUpperCase()}</Text></Pressable>}</View>;
}
export function EmptyState({title,description,icon='inbox'}:{title:string;description?:string;icon?:keyof typeof Feather.glyphMap}) {
 return <View style={{padding:30,backgroundColor:T.surface,borderRadius:20,borderWidth:1,borderColor:T.line,alignItems:'center',gap:12}}><View style={{padding:14,borderRadius:18,backgroundColor:T.primarySoft}}><Feather name={icon} size={24} color={T.primary}/></View><Text style={{fontWeight:'700',fontSize:16,textAlign:'center'}}>{title}</Text>{description&&<Text style={{color:T.ink2,fontSize:13,lineHeight:20,textAlign:'center'}}>{description}</Text>}</View>;
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
        <View style={[T.content, {paddingBottom: 12, paddingTop: 18}]}>
          <View style={st.searchWrap}><Feather name="search" size={18} color={T.ink3}/><TextInput
            style={st.search}
            placeholder={searchPlaceholder ?? 'Rechercher…'}
            value={q}
            onChangeText={setQ}
            placeholderTextColor={T.ink3}
          /></View>
        </View>
      )}
      <FlatList
        data={filtered}
        keyExtractor={(x) => x.id}
        contentContainerStyle={[T.content, { paddingTop: search ? 0 : 18, gap: 12 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<EmptyState title="Aucun résultat" description="Essayez un autre terme de recherche."/>}
        renderItem={({ item }) => (
          <Pressable style={st.listRow} onPress={() => onPress?.(item)} disabled={!onPress}>
<View style={{flex:1,minWidth:0,gap:6}}>{render(item)}</View>{onPress && <Feather name="chevron-right" size={18} color={T.ink3}/>}
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
  card: { ...T.shadow, backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: 20, gap: 10 },
  label: { fontSize: 11, color: T.ink2, textTransform: 'uppercase', letterSpacing: 1.1, fontWeight: '700', marginBottom: 3 },
  muted: { color: T.ink2, fontSize: 13, lineHeight: 20 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 8, alignItems: 'flex-start' },
  kvK: { color: T.ink2, fontSize: 12, flexShrink: 1, maxWidth: '42%', lineHeight: 19 },
  kvV: { color: T.ink, fontSize: 14, lineHeight: 21, flex: 1, textAlign: 'right', fontWeight: '600' },
  searchWrap: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: { flex: 1, minHeight: 48, paddingVertical: 12, fontSize: 14, color: T.ink },
  listRow: { ...T.shadow, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 18, padding: 18, gap: 14, flexDirection: 'row', alignItems: 'center', minHeight: 78 },
  hero: { borderRadius: 24, padding: 24, gap: 8, overflow: 'hidden' },
  heroIcon: {
    position: 'absolute', top: 20, right: 20, width: 34, height: 34, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },
});
