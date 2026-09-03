import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { T } from '@/lib/theme';

interface Entry {
  id: string;
  date: string | null;
  hours: number | null;
  amount: number | null;
  status: string;
  task: string | null;
  worksite: { ref: string; title: string } | null;
}
interface Statement {
  totalHours: number;
  totalAmount: number;
  pendingCount: number;
  byWorksite: { ref: string; title: string; hours: number; amount: number }[];
}

const STATUS: Record<string, string> = {
  running: 'en cours', submitted: 'à valider', approved: 'validé', rejected: 'refusé',
};

export default function Heures() {
  const { person } = useSession();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!person) return;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    try {
      const [mine, stmt] = await Promise.all([
        apiGet<{ items: Entry[] }>(`/api/timesheet/mine?from=${from}`),
        apiGet<Statement>(`/api/statements/${person.id}?year=${now.getFullYear()}&month=${now.getMonth() + 1}`),
      ]);
      setEntries(mine.items);
      setStatement(stmt);
    } catch {
      /* hors ligne */
    }
  }, [person]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      {statement && (
        <View style={s.card}>
          <Text style={s.label}>Ce mois-ci</Text>
          <View style={s.rowBetween}>
            <Text style={s.big}>{statement.totalHours} h</Text>
            <Text style={s.big}>{statement.totalAmount.toLocaleString('fr-BE')} €</Text>
          </View>
          {statement.pendingCount > 0 && (
            <Text style={{ color: T.accent }}>{statement.pendingCount} pointage(s) en attente de validation</Text>
          )}
        </View>
      )}

      <Text style={s.section}>Détail</Text>
      {entries.length === 0 && <Text style={s.muted}>Aucun pointage ce mois.</Text>}
      {entries.map((e) => (
        <View key={e.id} style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.wsRef}>{e.worksite?.ref ?? '—'}</Text>
            <Text style={s.muted}>
              {e.date ? new Date(e.date).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' }) : ''}
            </Text>
          </View>
          <Text style={s.muted}>{e.worksite?.title}</Text>
          <View style={s.rowBetween}>
            <Text style={s.ink}>{e.hours != null ? `${e.hours} h` : '—'} · {e.amount != null ? `${e.amount} €` : '—'}</Text>
            <Text style={[s.tag, e.status === 'approved' && { color: T.ok }, e.status === 'rejected' && { color: T.crit }]}>
              {STATUS[e.status] ?? e.status}
            </Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: 14, gap: 5 },
  label: { fontSize: 12, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 },
  section: { fontSize: 13, fontWeight: '700', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  big: { fontSize: 26, fontWeight: '800', color: T.ink },
  wsRef: { fontSize: 15, fontWeight: '600', color: T.ink },
  ink: { color: T.ink },
  muted: { color: T.ink2 },
  tag: { fontWeight: '600', color: T.ink2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
