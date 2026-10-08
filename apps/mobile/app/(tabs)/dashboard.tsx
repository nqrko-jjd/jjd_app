import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Feather } from '@expo/vector-icons';
import { Card, Label, Muted, Loading, eur, ScreenHeader } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Dash {
  kpis: { invoicedMonth: number; paidMonth: number; overdueAmount: number; overdueCount: number; openWorksites: number; hoursWeek: number };
  alerts: { kind: string; severity: string; label: string; count: number; amount?: number }[];
}
interface Ev { id: string; title: string | null; startAt: string; allDay: boolean; worksite: { id?: string; ref: string; title: string; city: string | null }; assignments?: { person: { displayName: string | null; firstName: string } }[] }

const TODAY = new Date().toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
const hm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

/** Où mène chaque alerte : on touche la ligne, on arrive directement sur la liste utile. */
const ALERT_ROUTE: Record<string, string> = {
  overdue_invoices: '/documents', overdue_supplier_invoices: '/achats', to_invoice: '/chantiers?status=to_invoice', on_hold: '/chantiers?status=on_hold',
  quotes_follow: '/documents', crm_due: '/pipeline', expiring_docs: '/flotte', ct_expiring: '/flotte', planned_time: '/valider', project: '/chantiers',
};

/** Accueil direction / bureau : ce qu'il faut traiter aujourd'hui, pas des statistiques (celles-ci sont dans « Plus → Analyse »). */
export default function Dashboard() {
  const { person } = useSession();
  const router = useRouter();
  const go = (p: string) => router.push(p as never);
  const [data, setData] = useState<Dash | null>(null);
  const [today, setToday] = useState<Ev[]>([]);
  const [pending, setPending] = useState(0);
  const [leads, setLeads] = useState(0);
  const [inbox, setInbox] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const [d, p, v, l, ib] = await Promise.allSettled([
      apiGet<Dash>('/api/dashboard'),
      apiGet<{ items: Ev[] }>(`/api/planning?from=${start.toISOString()}&to=${end.toISOString()}`),
      apiGet<{ items: unknown[] }>('/api/timesheet/pending'),
      apiGet<{ columns: { stage: string; items: unknown[] }[] }>('/api/crm'),
      apiGet<{ total: number }>('/api/mail-suggestions/counts'),
    ]);
    if (ib.status === 'fulfilled') setInbox(ib.value.total);
    if (d.status === 'fulfilled') setData(d.value);
    if (p.status === 'fulfilled') setToday([...p.value.items].sort((x, y) => +new Date(x.startAt) - +new Date(y.startAt)));
    if (v.status === 'fulfilled') setPending(v.value.items.length);
    if (l.status === 'fulfilled') setLeads(l.value.columns.find((c) => c.stage === 'new')?.items.length ?? 0);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data) return <Loading />;
  const sevColor: Record<string, string> = { critical: T.crit, warning: T.accent, info: T.ink2 };
  const first = person?.firstName ?? person?.displayName?.split(' ')[0];

  // cases d'accès rapide : chacune est un bouton vers la liste correspondante, avec le chiffre qui compte
  const tiles: { icon: keyof typeof Feather.glyphMap; label: string; value: string; to: string; alert?: boolean }[] = [
    { icon: 'calendar', label: 'Aujourd’hui', value: `${today.length} intervention${today.length > 1 ? 's' : ''}`, to: '/planning' },
    { icon: 'check-square', label: 'À valider', value: pending ? `${pending} pointage${pending > 1 ? 's' : ''}` : 'Rien en attente', to: '/valider', alert: pending > 0 },
    { icon: 'inbox', label: 'Boîte IA', value: inbox ? `${inbox} à traiter` : 'Rien à traiter', to: '/boite-ia', alert: inbox > 0 },
    { icon: 'trending-up', label: 'Demandes', value: leads ? `${leads} nouvelle${leads > 1 ? 's' : ''}` : 'Aucune nouvelle', to: '/pipeline', alert: leads > 0 },
    { icon: 'flag', label: 'Impayés', value: data.kpis.overdueCount ? eur(data.kpis.overdueAmount) : 'Aucun', to: '/documents', alert: data.kpis.overdueCount > 0 },
    { icon: 'home', label: 'Chantiers', value: `${data.kpis.openWorksites} en cours`, to: '/chantiers?status=in_progress' },
    { icon: 'camera', label: 'Nouvelle dépense', value: 'Scanner un ticket', to: '/depense/nouvelle' },
    { icon: 'file-text', label: 'Devis & factures', value: 'Voir la liste', to: '/documents' },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ ...T.content, padding: 16, gap: 18 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <ScreenHeader eyebrow={TODAY} title={first ? `Bonjour ${first},` : 'Bonjour,'} description="Ce qui demande votre attention aujourd’hui." avatar={first?.slice(0, 1) || 'J'} />

      <View style={s.tiles}>
        {tiles.map((t) => (
          <Pressable key={t.label} accessibilityRole="button" accessibilityLabel={`${t.label} : ${t.value}`} onPress={() => go(t.to)} style={({ pressed }) => [s.tile, t.alert && s.tileAlert, pressed && { transform: [{ scale: 0.97 }] }]}>
            <View style={[s.tileIc, t.alert && { backgroundColor: T.kpiWarnIconBg }]}><Feather name={t.icon} size={19} color={t.alert ? T.kpiWarnFg : T.primary} /></View>
            <Text style={[s.tileLabel, t.alert && { color: T.kpiWarnFg }]}>{t.label}</Text>
            <Text style={[s.tileValue, t.alert && { color: T.kpiWarnFg }]} numberOfLines={1}>{t.value}</Text>
          </Pressable>
        ))}
      </View>

      <View>
        <View style={s.sectionHead}>
          <Label>Aujourd’hui sur le terrain</Label>
          <Pressable accessibilityRole="button" onPress={() => go('/planning')} hitSlop={10}><Text style={s.link}>Planning</Text></Pressable>
        </View>
        {today.length === 0 ? (
          <Card><Muted>Aucune intervention au planning aujourd’hui.</Muted></Card>
        ) : (
          <View style={{ gap: 10 }}>
            {today.slice(0, 6).map((e) => {
              const team = [...new Set((e.assignments ?? []).map((a) => a.person.displayName || a.person.firstName))];
              return (
                <Pressable key={e.id} accessibilityRole="button" onPress={() => (e.worksite.id ? go(`/chantier/${e.worksite.id}`) : go('/planning'))} style={({ pressed }) => [s.row, pressed && { opacity: 0.9 }]}>
                  <View style={s.time}><Text style={s.timeTxt}>{e.allDay ? 'Jour' : hm(e.startAt)}</Text></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.rowTitle} numberOfLines={2}>{e.worksite.ref} · {e.title || e.worksite.title}</Text>
                    <Muted>{[e.worksite.city, team.slice(0, 3).join(', ') + (team.length > 3 ? '…' : '')].filter(Boolean).join(' · ')}</Muted>
                  </View>
                  <Feather name="chevron-right" size={18} color={T.ink3} />
                </Pressable>
              );
            })}
            {today.length > 6 && <Pressable onPress={() => go('/planning')} hitSlop={8}><Text style={[s.link, { textAlign: 'center' }]}>Voir les {today.length - 6} autres</Text></Pressable>}
          </View>
        )}
      </View>

      <View>
        <Label>À suivre</Label>
        {data.alerts.length === 0 ? (
          <Card><Muted>Tout est à jour : aucune alerte à traiter.</Muted></Card>
        ) : (
          <View style={{ gap: 10 }}>
            {data.alerts.map((a) => (
              <Pressable key={a.kind} accessibilityRole="button" onPress={() => go(ALERT_ROUTE[a.kind] ?? '/chantiers')} style={({ pressed }) => [s.row, pressed && { opacity: 0.9 }]}>
                <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, backgroundColor: sevColor[a.severity] ?? T.ink2 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.rowTitle}>{a.label}</Text>
                  {a.amount != null && <Muted>{eur(a.amount)}</Muted>}
                </View>
                <Text style={s.count}>{a.count}</Text>
                <Feather name="chevron-right" size={18} color={T.ink3} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { ...T.shadow, flexGrow: 1, flexBasis: 150, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 20, padding: 16, gap: 6, minHeight: 112 },
  tileAlert: { backgroundColor: T.kpiWarnBg, borderColor: T.kpiWarnBorder },
  tileIc: { width: 38, height: 38, borderRadius: 12, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  tileLabel: { fontSize: 12.5, color: T.ink2, fontWeight: '600' },
  tileValue: { fontSize: 17, fontWeight: '800', color: T.ink, letterSpacing: -0.3 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { color: T.primary, fontWeight: '700', fontSize: 13 },
  row: { ...T.shadow, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 18, padding: 14 },
  time: { minWidth: 52, paddingVertical: 8, borderRadius: 12, backgroundColor: T.primarySoft, alignItems: 'center' },
  timeTxt: { color: T.primary, fontWeight: '800', fontSize: 13 },
  rowTitle: { color: T.ink, fontWeight: '700' },
  count: { fontWeight: '800', color: T.ink, fontSize: 16 },
});
