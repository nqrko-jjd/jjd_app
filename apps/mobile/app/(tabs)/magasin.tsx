import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Card, Label, Muted, Loading, ScreenHeader } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Prep { id: string; ref: string; status: string; neededOn: string | null; worksite: { ref: string; title: string }; lineCount: number; doneLines: number }

/** Accueil magasinier : scanner d'abord, puis les préparations à faire, puis les articles et le stock bas. */
export default function Magasin() {
  const { user, person } = useSession();
  const router = useRouter();
  const go = (p: string) => router.push(p as never);
  const [preps, setPreps] = useState<Prep[] | null>(null);
  const [low, setLow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const [p, i] = await Promise.allSettled([apiGet<{ items: Prep[] }>('/api/stock-orders?status=open'), apiGet<{ items: { low: boolean }[] }>('/api/stock/items')]);
    if (p.status === 'fulfilled') setPreps(p.value.items);
    if (i.status === 'fulfilled') setLow(i.value.items.filter((x) => x.low).length);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!preps) return <Loading />;
  const first = person?.firstName ?? person?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0]?.replace(/^./, (c) => c.toUpperCase());
  const today = new Date().toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  const todayIso = new Date(); todayIso.setHours(23, 59, 59, 999);
  const urgent = preps.filter((p) => p.neededOn && new Date(p.neededOn) <= todayIso).length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, padding: 16, gap: 18 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ScreenHeader eyebrow={today} title={first ? `Bonjour ${first},` : 'Bonjour,'} description="Le magasin, en un geste." avatar={first?.slice(0, 1) || 'M'} />

      <Pressable accessibilityRole="button" accessibilityLabel="Scanner" onPress={() => go('/scan')} style={({ pressed }) => [pressed && { transform: [{ scale: 0.98 }] }]}>
        <LinearGradient colors={[T.heroFrom, T.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <View style={s.heroIc}><Feather name="maximize" size={30} color="#fff" /></View>
          <View style={{ flex: 1 }}><Text style={s.heroTitle}>Scanner</Text><Text style={s.heroSub}>Article, étiquette ou rack : entrée et sortie en quelques touches.</Text></View>
          <Feather name="chevron-right" size={24} color="rgba(255,255,255,0.8)" />
        </LinearGradient>
      </Pressable>

      <View style={s.tiles}>
        <Pressable accessibilityRole="button" onPress={() => go('/preparations')} style={({ pressed }) => [s.tile, urgent > 0 && s.tileAlert, pressed && { transform: [{ scale: 0.97 }] }]}>
          <View style={[s.tileIc, urgent > 0 && { backgroundColor: T.kpiWarnIconBg }]}><Feather name="package" size={19} color={urgent > 0 ? T.kpiWarnFg : T.primary} /></View>
          <Text style={[s.tileLbl, urgent > 0 && { color: T.kpiWarnFg }]}>Préparations</Text>
          <Text style={[s.tileVal, urgent > 0 && { color: T.kpiWarnFg }]}>{preps.length ? `${preps.length} à faire` : 'Rien à faire'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => go('/articles?low=1')} style={({ pressed }) => [s.tile, low > 0 && s.tileAlert, pressed && { transform: [{ scale: 0.97 }] }]}>
          <View style={[s.tileIc, low > 0 && { backgroundColor: T.kpiWarnIconBg }]}><Feather name="alert-triangle" size={19} color={low > 0 ? T.kpiWarnFg : T.primary} /></View>
          <Text style={[s.tileLbl, low > 0 && { color: T.kpiWarnFg }]}>Stock bas</Text>
          <Text style={[s.tileVal, low > 0 && { color: T.kpiWarnFg }]}>{low ? `${low} article${low > 1 ? 's' : ''}` : 'Tout va bien'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => go('/articles')} style={({ pressed }) => [s.tile, pressed && { transform: [{ scale: 0.97 }] }]}>
          <View style={s.tileIc}><Feather name="search" size={19} color={T.primary} /></View>
          <Text style={s.tileLbl}>Articles</Text>
          <Text style={s.tileVal}>Chercher</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => go('/messages')} style={({ pressed }) => [s.tile, pressed && { transform: [{ scale: 0.97 }] }]}>
          <View style={s.tileIc}><Feather name="message-circle" size={19} color={T.primary} /></View>
          <Text style={s.tileLbl}>Messages</Text>
          <Text style={s.tileVal}>Ouvrir</Text>
        </Pressable>
      </View>

      <View>
        <View style={s.head}><Label>À préparer</Label><Pressable accessibilityRole="button" onPress={() => go('/preparations')} hitSlop={10}><Text style={s.link}>Tout voir</Text></Pressable></View>
        {preps.length === 0 ? <Card><Muted>Aucune préparation en attente.</Muted></Card> : (
          <View style={{ gap: 10 }}>
            {preps.slice(0, 5).map((p) => (
              <Pressable key={p.id} accessibilityRole="button" onPress={() => go(`/preparation/${p.id}`)} style={({ pressed }) => [s.row, pressed && { opacity: 0.9 }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: T.ink, fontWeight: '700' }} numberOfLines={2}>{p.worksite.ref} · {p.worksite.title}</Text>
                  <Muted>{p.ref} · {p.doneLines}/{p.lineCount} prêts{p.neededOn ? ` · pour le ${new Date(p.neededOn).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })}` : ''}</Muted>
                </View>
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
  hero: { borderRadius: 24, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroIc: { width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: '#fff', fontSize: 24, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.78)', fontSize: 13, marginTop: 2 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { ...T.shadow, flexGrow: 1, flexBasis: '46%', backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 20, padding: 16, gap: 6, minHeight: 108 },
  tileAlert: { backgroundColor: T.kpiWarnBg, borderColor: T.kpiWarnBorder },
  tileIc: { width: 38, height: 38, borderRadius: 12, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  tileLbl: { fontSize: 12.5, color: T.ink2, fontWeight: '600' },
  tileVal: { fontSize: 17, fontWeight: '800', color: T.ink },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { color: T.primary, fontWeight: '700', fontSize: 13 },
  row: { ...T.shadow, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 18, padding: 14 },
});
