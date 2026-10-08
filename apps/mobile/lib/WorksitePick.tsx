import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Text } from '@/lib/AppText';
import { apiGet } from './api';
import { T } from './theme';

export interface Ws { id: string; name: string }

/** Choisir un chantier au doigt : les premiers s'affichent, une recherche (réf ou nom) affine. */
export function WorksitePick({ value, onChange, initial }: { value: Ws | null; onChange: (w: Ws | null) => void; initial?: Ws | null }) {
  const [all, setAll] = useState<Ws[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => { apiGet<{ worksites: Ws[] }>('/api/meta/pickers').then((r) => setAll(r.worksites)).catch(() => {}); }, []);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? all.filter((w) => w.name.toLowerCase().includes(s)) : all).slice(0, 5);
  }, [q, all]);
  const shown = value ?? initial ?? null;
  if (shown && (value || !q)) {
    return (
      <Pressable accessibilityRole="button" onPress={() => { onChange(null); setQ(''); }} style={s.picked}>
        <Text style={{ flex: 1, color: T.ink, fontWeight: '700' }} numberOfLines={2}>{shown.name}</Text>
        <Feather name="x" size={18} color={T.ink2} />
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <TextInput value={q} onChangeText={setQ} placeholder="Chercher un chantier (réf ou nom)" placeholderTextColor={T.ink3} style={s.search} />
      {hits.map((w) => <Pressable key={w.id} accessibilityRole="button" onPress={() => onChange(w)} style={s.option}><Text style={{ color: T.ink }} numberOfLines={2}>{w.name}</Text></Pressable>)}
    </View>
  );
}

const s = StyleSheet.create({
  search: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, paddingHorizontal: 14, fontSize: 15, color: T.ink },
  option: { padding: 14, borderRadius: 14, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: T.primarySoft, borderWidth: 1, borderColor: T.primary },
});
