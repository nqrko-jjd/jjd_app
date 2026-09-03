import { useCallback, useState } from 'react';
import { ScrollView, Text, View, Pressable, StyleSheet } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Card, Loading, eur } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Team {
  year: number; month: number; totalAmount: number;
  rows: { personId: string; name: string; hours: number; amount: number; pending: number }[];
}
const M = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function Decomptes() {
  const now = new Date();
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(now.getMonth() + 1);
  const [d, setD] = useState<Team | null>(null);

  const load = useCallback(async () => {
    try { setD(await apiGet<Team>(`/api/statements?year=${y}&month=${m}`)); } catch {}
  }, [y, m]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function shift(delta: number) {
    const nd = new Date(y, m - 1 + delta, 1);
    setY(nd.getFullYear());
    setM(nd.getMonth() + 1);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 10 }}>
      <Stack.Screen options={{ title: 'Décomptes du mois', headerBackTitle: 'Retour' }} />
      <View style={s.nav}>
        <Pressable style={s.btn} onPress={() => shift(-1)}><Text style={s.btnT}>←</Text></Pressable>
        <Text style={{ fontWeight: '700', color: T.ink }}>{M[m - 1]} {y}</Text>
        <Pressable style={s.btn} onPress={() => shift(1)}><Text style={s.btnT}>→</Text></Pressable>
      </View>
      {!d ? <Loading /> : (
        <>
          <Card>
            <Text style={{ color: T.ink2, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '700' }}>Total à payer</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: T.ink }}>{eur(d.totalAmount)}</Text>
          </Card>
          {d.rows.map((r) => (
            <Card key={r.personId}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '600', color: T.ink }}>{r.name}</Text>
                <Text style={{ fontWeight: '700', color: T.ink }}>{eur(r.amount)}</Text>
              </View>
              <Text style={{ color: T.ink2 }}>{r.hours} h{r.pending > 0 ? ` · ${r.pending} à valider` : ''}</Text>
            </Card>
          ))}
          {d.rows.length === 0 && <Text style={{ color: T.ink2 }}>Aucune heure ce mois.</Text>}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btn: { borderWidth: 1, borderColor: T.line, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: T.surface },
  btnT: { fontSize: 16, color: T.ink },
});
