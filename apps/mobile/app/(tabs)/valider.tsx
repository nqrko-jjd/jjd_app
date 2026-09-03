import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { apiGet, apiSend } from '@/lib/api';
import { Card, Muted, Loading, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Pending {
  id: string; date: string | null; hours: number | null; amount: number | null; task: string | null;
  person: { displayName: string | null; firstName: string };
  worksite: { ref: string; title: string } | null;
}

export default function Valider() {
  const [items, setItems] = useState<Pending[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ items: Pending[] }>('/api/timesheet/pending');
      setItems(r.items);
    } catch {
      /* hors ligne */
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(id: string, action: 'approve' | 'reject') {
    setItems((cur) => cur?.filter((x) => x.id !== id) ?? null);
    await apiSend(`/api/timesheet/entries/${id}/${action}`, 'POST');
  }

  if (!items) return <Loading />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Text style={s.h}>Heures à valider</Text>
      {items.length === 0 && <Muted>Rien à valider. 👍</Muted>}
      {items.map((e) => (
        <Card key={e.id}>
          <View style={s.rowBetween}>
            <Text style={s.name}>{e.person.displayName || e.person.firstName}</Text>
            <Muted>{dateBE(e.date)}</Muted>
          </View>
          <Muted>{e.worksite ? `${e.worksite.ref} — ${e.worksite.title}` : 'Sans chantier'}</Muted>
          <Text style={{ color: T.ink }}>{e.hours != null ? `${e.hours} h` : '—'} · {eur(e.amount)}{e.task ? ` · ${e.task}` : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Pressable style={[s.btn, { backgroundColor: T.primary }]} onPress={() => act(e.id, 'approve')}>
              <Text style={s.btnTxt}>Valider</Text>
            </Pressable>
            <Pressable style={[s.btn, s.btnGhost]} onPress={() => act(e.id, 'reject')}>
              <Text style={[s.btnTxt, { color: T.crit }]}>Refuser</Text>
            </Pressable>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  h: { fontSize: 18, fontWeight: '700', color: T.ink },
  name: { fontWeight: '600', color: T.ink },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  btn: { flex: 1, borderRadius: 8, padding: 10, alignItems: 'center' },
  btnGhost: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line },
  btnTxt: { color: '#fff', fontWeight: '700' },
});
