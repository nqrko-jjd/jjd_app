import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { apiGet } from './api';
import { Text } from './AppText';
import { T } from './theme';

type Gif = { id: string; preview: string; url: string };
type Res = { enabled: boolean; gifs: Gif[] };

const MARK = '[gif]';
const GIPHY = /^https:\/\/media\d*\.giphy\.com\/\S+$/;

/** Un message GIF = texte « [gif]https://media….giphy.com/… » (aucun changement de base de données). */
export function gifUrl(body: string | null | undefined): string | null {
  if (!body?.startsWith(MARK)) return null;
  const u = body.slice(MARK.length).trim();
  return GIPHY.test(u) ? u : null;
}

export function GifImage({ url }: { url: string }) {
  return <Image source={{ uri: url }} style={{ width: 200, height: 150, borderRadius: 10, backgroundColor: T.surface2 }} resizeMode="contain" />;
}

/** Bouton GIF + sélecteur. Invisible tant que la clé Giphy n'est pas configurée côté serveur. */
export function GifButton({ onPick }: { onPick: (body: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(term: string) {
    setLoading(true);
    try {
      const r = await apiGet<Res>(`/api/gifs/search?q=${encodeURIComponent(term)}`);
      setEnabled(r.enabled);
      setGifs(r.gifs);
    } catch { setGifs([]); }
    setLoading(false);
  }
  useEffect(() => { void search(''); }, []);
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void search(q.trim()); }, 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, open]);

  if (!enabled) return null;
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Envoyer un GIF" onPress={() => setOpen(true)}
        style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: T.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontWeight: '800', color: T.primary, fontSize: 13 }}>GIF</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: T.paper, paddingTop: 50 }}>
          <View style={{ flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' }}>
            <TextInput value={q} onChangeText={setQ} placeholder="Rechercher un GIF…" placeholderTextColor={T.ink3} autoFocus
              style={{ flex: 1, backgroundColor: T.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: T.ink }} />
            <Pressable onPress={() => setOpen(false)} hitSlop={10}><Feather name="x" size={24} color={T.ink} /></Pressable>
          </View>
          {loading && <ActivityIndicator style={{ marginVertical: 8 }} />}
          <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 10 }} keyboardShouldPersistTaps="handled">
            {gifs.map((g) => (
              <Pressable key={g.id} onPress={() => { setOpen(false); onPick(`${MARK}${g.url}`); }} style={{ width: '48%' }}>
                <Image source={{ uri: g.preview }} style={{ width: '100%', height: 110, borderRadius: 8, backgroundColor: T.surface2 }} resizeMode="cover" />
              </Pressable>
            ))}
            {!loading && gifs.length === 0 && <Text style={{ color: T.ink2, padding: 10 }}>Aucun résultat.</Text>}
          </ScrollView>
          <Text style={{ color: T.ink3, fontSize: 11, textAlign: 'center', paddingBottom: 14 }}>Propulsé par GIPHY</Text>
        </View>
      </Modal>
    </>
  );
}
