import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Image, Modal, FlatList, TextInput, useWindowDimensions, ActivityIndicator, StatusBar } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { apiGet, apiUploadPhoto, API_URL } from '@/lib/api';
import { openApiFile } from '@/lib/files';
import { Muted, Loading } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr, dateLocale } from '@/lib/i18n';

interface Msg { id: string; kind: string; body: string | null; fileUrl: string | null; thumbUrl: string | null; authorName: string | null; createdAt: string }
interface Photo { id: string; url: string; thumb: string; tag: string | null; caption: string; by: string | null; at: string }
interface Pending { uri: string; state: 'wait' | 'sending' | 'fail' }
const TAGS = ['Avant', 'Pendant', 'Après'] as const;
const abs = (u: string) => (u.startsWith('http') ? u : `${API_URL}${u}`);
const dayLabel = (iso: string) => { const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1); return d.toDateString() === t.toDateString() ? 'Aujourd’hui' : d.toDateString() === y.toDateString() ? 'Hier' : d.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' }); };

/** « Avant · mur nord » → étiquette + légende (l'étiquette vit dans la légende : aucun changement côté serveur). */
const parse = (m: Msg): Photo => {
  const raw = (m.body ?? '').trim();
  const hit = TAGS.find((t) => raw.toLowerCase().startsWith(`${t.toLowerCase()} ·`) || raw.toLowerCase() === t.toLowerCase());
  return { id: m.id, url: abs(m.fileUrl!), thumb: abs(m.thumbUrl ?? m.fileUrl!), tag: hit ?? null, caption: hit ? raw.slice(hit.length).replace(/^\s*·\s*/, '') : raw, by: m.authorName, at: m.createdAt };
};

/** Photos d'un chantier : on photographie à la chaîne, on classe (avant / pendant / après), on retrouve tout par jour, on ouvre en grand. */
export default function Photos() {
  const { id, camera } = useLocalSearchParams<{ id: string; camera?: string }>();
  const { width } = useWindowDimensions();
  const cols = width >= 1000 ? 7 : width >= 700 ? 5 : 3;
  const size = Math.floor((Math.min(width, 1200) - 32 - (cols - 1) * 6) / cols);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [tag, setTag] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState<{ n: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const started = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ messages: Msg[] }>(`/api/worksites/${id}/thread`);
      setPhotos(r.messages.filter((m) => m.kind === 'photo' && m.fileUrl).map(parse).sort((a, b) => +new Date(b.at) - +new Date(a.at)));
    } catch { setPhotos((x) => x ?? []); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function shoot() {
    setErr(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setErr('Autorise l’appareil photo pour prendre des photos.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!r.canceled && r.assets[0]) setPending((p) => [...p, { uri: r.assets[0]!.uri, state: 'wait' }]);
  }
  async function library() {
    setErr(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr('Autorise l’accès aux photos pour en choisir.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 12, quality: 0.7 });
    if (!r.canceled) setPending((p) => [...p, ...r.assets.map((a) => ({ uri: a.uri, state: 'wait' as const }))]);
  }
  // depuis « Photo » sur l'accueil : l'appareil s'ouvre tout de suite
  useEffect(() => { if (camera === '1' && !started.current) { started.current = true; shoot(); } }, [camera]);

  async function send() {
    const queue = pending.filter((p) => p.state !== 'sending');
    if (!queue.length) return;
    setErr(null); setSending({ n: 0, total: queue.length });
    const cap = [tag, caption.trim()].filter(Boolean).join(' · ');
    let ok = 0;
    const left: Pending[] = [];
    for (const p of queue) {
      try { await apiUploadPhoto(`/api/worksites/${id}/thread/photos`, p.uri, cap || undefined); ok++; }
      catch { left.push({ ...p, state: 'fail' }); }
      setSending({ n: ok + left.length, total: queue.length });
    }
    setPending(left); setSending(null);
    if (left.length) setErr(`${left.length} photo${left.length > 1 ? 's n’ont' : ' n’a'} pas pu partir (réseau ?). Réessaie.`); else { setCaption(''); setTag(null); }
    await load();
  }

  const shown = useMemo(() => (photos ?? []).filter((p) => !filter || (filter === '_none' ? !p.tag : p.tag === filter)), [photos, filter]);
  const groups = useMemo(() => {
    const m = new Map<string, Photo[]>();
    for (const p of shown) { const k = dayLabel(p.at); m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m];
  }, [shown]);
  if (!photos) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <Stack.Screen options={{ title: 'Photos', headerBackTitle: tr('Retour') }} />
      <ScrollView contentContainerStyle={{ ...T.content, padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable accessibilityRole="button" onPress={shoot} style={({ pressed }) => [s.shoot, pressed && { transform: [{ scale: 0.98 }] }]}><Feather name="camera" size={24} color="#fff" /><Text style={s.shootTxt}>Prendre une photo</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={tr("Choisir dans la galerie")} onPress={library} style={s.lib}><Feather name="image" size={22} color={T.primary} /></Pressable>
        </View>

        {pending.length > 0 && (
          <View style={s.tray}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {pending.map((p, i) => (
                <View key={p.uri + i}>
                  <Image source={{ uri: p.uri }} style={[s.pthumb, p.state === 'fail' && { borderColor: T.crit, borderWidth: 2 }]} />
                  <Pressable accessibilityRole="button" accessibilityLabel={tr("Retirer")} onPress={() => setPending((x) => x.filter((_, j) => j !== i))} style={s.rm}><Feather name="x" size={13} color="#fff" /></Pressable>
                </View>
              ))}
              <Pressable accessibilityRole="button" onPress={shoot} style={s.more}><Feather name="plus" size={24} color={T.primary} /></Pressable>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {TAGS.map((t) => <Pressable key={t} accessibilityRole="button" onPress={() => setTag(tag === t ? null : t)} style={[s.tagBtn, tag === t && s.tagOn]}><Text style={[s.tagTxt, tag === t && { color: '#fff' }]}>{t}</Text></Pressable>)}
            </View>
            <TextInput value={caption} onChangeText={setCaption} placeholder={tr("Légende (facultatif) : mur nord, compteur…")} placeholderTextColor={T.ink3} style={s.input} />
            <Pressable accessibilityRole="button" disabled={!!sending} onPress={send} style={({ pressed }) => [s.send, !!sending && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.98 }] }]}>
              {sending ? <><ActivityIndicator color="#fff" /><Text style={s.sendTxt}>Envoi {sending.n} / {sending.total}…</Text></> : <><Feather name="upload" size={20} color="#fff" /><Text style={s.sendTxt}>Envoyer {pending.length} photo{pending.length > 1 ? 's' : ''}</Text></>}
            </Pressable>
          </View>
        )}
        {err && <Text style={{ color: T.crit, fontWeight: '700' }}>{err}</Text>}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {([['', 'Toutes'], ['Avant', 'Avant'], ['Pendant', 'Pendant'], ['Après', 'Après'], ['_none', 'Sans étiquette']] as const).map(([k, label]) => <Pressable key={label} accessibilityRole="button" onPress={() => setFilter(k)} style={[s.chip, filter === k && s.chipOn]}><Text style={[s.chipTxt, filter === k && { color: '#fff' }]}>{label}</Text></Pressable>)}
        </ScrollView>

        {shown.length === 0 && <Muted>{photos.length ? 'Aucune photo pour ce filtre.' : 'Aucune photo pour l’instant. Prends la première !'}</Muted>}
        {groups.map(([label, list]) => (
          <View key={label} style={{ gap: 8 }}>
            <Text style={s.day}>{label} · {list.length}</Text>
            <View style={s.grid}>
              {list.map((p) => (
                <Pressable key={p.id} accessibilityRole="button" onPress={() => setViewer(shown.indexOf(p))}>
                  <Image source={{ uri: p.thumb }} style={{ width: size, height: size, borderRadius: 12, backgroundColor: T.surface2 }} />
                  {!!p.tag && <View style={s.badge}><Text style={s.badgeTxt}>{p.tag}</Text></View>}
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={viewer !== null} animationType="fade" onRequestClose={() => setViewer(null)} statusBarTranslucent>
        <StatusBar hidden />
        {viewer !== null && <Viewer list={shown} start={viewer} onClose={() => setViewer(null)} />}
      </Modal>
    </View>
  );
}

function Viewer({ list, start, onClose }: { list: Photo[]; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [i, setI] = useState(start);
  const [err, setErr] = useState<string | null>(null);
  const p = list[i]!;
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <FlatList
        data={list}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        initialScrollIndex={start}
        getItemLayout={(_, k) => ({ length: width, offset: width * k, index: k })}
        keyExtractor={(x) => x.id}
        onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <ScrollView style={{ width, height }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} maximumZoomScale={4} minimumZoomScale={1} bouncesZoom centerContent>
            <Image source={{ uri: item.url }} style={{ width, height: height * 0.8 }} resizeMode="contain" />
          </ScrollView>
        )}
      />
      <View style={v.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr("Fermer")} onPress={onClose} style={v.btn}><Feather name="x" size={24} color="#fff" /></Pressable>
        <Text style={{ color: '#fff', fontWeight: '700' }}>{i + 1} / {list.length}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={tr("Partager")} onPress={async () => { setErr(null); try { await openApiFile(p.url.replace(API_URL, ''), `photo-${p.id}.webp`, 'image/webp'); } catch (e) { setErr((e as Error).message); } }} style={v.btn}><Feather name="share" size={22} color="#fff" /></Pressable>
      </View>
      <View style={v.bottom}>
        {!!p.tag && <Text style={v.tag}>{p.tag}</Text>}
        {!!p.caption && <Text style={v.cap}>{p.caption}</Text>}
        <Text style={v.meta}>{[p.by, new Date(p.at).toLocaleString(dateLocale(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}</Text>
        {!!err && <Text style={{ color: '#ff8d85' }}>{err}</Text>}
      </View>
    </View>
  );
}

const v = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 44, paddingHorizontal: 12, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.35)' },
  btn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 18, paddingBottom: 30, gap: 4, backgroundColor: 'rgba(0,0,0,0.45)' },
  tag: { color: T.gold, fontWeight: '800', textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.5 },
  cap: { color: '#fff', fontSize: 16, lineHeight: 22 },
  meta: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5 },
});
const s = StyleSheet.create({
  shoot: { flex: 1, flexDirection: 'row', gap: 12, backgroundColor: T.primary, borderRadius: 22, paddingVertical: 20, alignItems: 'center', justifyContent: 'center' },
  shootTxt: { color: '#fff', fontWeight: '800', fontSize: 18 },
  lib: { width: 72, borderRadius: 22, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  tray: { backgroundColor: T.surface, borderRadius: 20, borderWidth: 1, borderColor: T.line, padding: 12, gap: 12 },
  pthumb: { width: 84, height: 84, borderRadius: 14, backgroundColor: T.surface2 },
  rm: { position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: T.crit, alignItems: 'center', justifyContent: 'center' },
  more: { width: 84, height: 84, borderRadius: 14, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  tagBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line, alignItems: 'center' },
  tagOn: { backgroundColor: T.primary, borderColor: T.primary },
  tagTxt: { fontWeight: '800', color: T.ink },
  input: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, paddingHorizontal: 14, fontSize: 15, color: T.ink },
  send: { flexDirection: 'row', gap: 10, backgroundColor: T.primary, borderRadius: 18, paddingVertical: 17, alignItems: 'center', justifyContent: 'center' },
  sendTxt: { color: '#fff', fontWeight: '800', fontSize: 16.5 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line },
  chipOn: { backgroundColor: T.primary, borderColor: T.primary },
  chipTxt: { fontWeight: '700', color: T.ink, fontSize: 13 },
  day: { fontSize: 12.5, fontWeight: '800', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(18,75,58,0.9)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTxt: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
});
