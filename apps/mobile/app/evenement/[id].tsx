import { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet, apiSend } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Muted, Loading } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr, dateLocale, Alert } from '@/lib/i18n';

interface Ev {
  id: string; title: string | null; startAt: string; endAt: string; allDay: boolean; status: string; kind: string;
  tasksNote: string | null; accessNote: string | null; materialsNote: string | null; note: string | null;
  meetingOnSite: boolean; meetingAddress: string | null; meetingPostalCode: string | null; meetingCity: string | null;
  worksite: { id: string; ref: string; title: string; city: string | null; address: string | null; postalCode: string | null };
  assignments: { person: { id: string; displayName: string | null; firstName: string; phone: string | null } }[];
  vehicles: { vehicle: { plate: string | null; model: string | null; brand: string | null; code: string | null }; driver: { displayName: string | null; firstName: string } | null }[];
}
const KIND = { intervention: { main: '#3d7fc4', soft: '#e4eef9', ink: '#1f5a96', label: tr('Intervention') }, meeting: { main: '#e0a800', soft: '#fbf1cc', ink: '#7a5c00', label: tr('Rendez-vous') } } as const;
const hm = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });

/** Fiche d'une intervention ou d'un rendez-vous : tout ce qu'il faut savoir, et les actions au pouce. */
export default function EvenementDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  const [e, setE] = useState<Ev | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => { try { setE((await apiGet<{ event: Ev }>(`/api/planning/${id}`)).event); } catch (x) { setMsg((x as Error).message); } }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!e) return msg ? <View style={{ padding: 20 }}><Text style={{ color: T.crit }}>{msg}</Text></View> : <Loading />;

  const k = e.kind === 'meeting' ? KIND.meeting : KIND.intervention;
  const day = new Date(e.startAt).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const addr = e.kind === 'meeting' && !e.meetingOnSite ? [e.meetingAddress, e.meetingPostalCode, e.meetingCity].filter(Boolean).join(' ') : [e.worksite.address, e.worksite.postalCode, e.worksite.city].filter(Boolean).join(' ');
  const canDelete = user?.role === 'admin' || user?.role === 'office';
  const vlabel = (v: Ev['vehicles'][number]) => [v.vehicle.model || v.vehicle.brand, v.vehicle.plate].filter(Boolean).join(' · ') || v.vehicle.code || 'Véhicule';

  async function confirmIt() { try { await apiSend(`/api/planning/${id}`, 'PATCH', { status: 'confirmed' }, false); setMsg('Confirmé.'); await load(); } catch (x) { setMsg((x as Error).message); } }
  const remove = () => Alert.alert('Supprimer du planning ?', e.kind === 'meeting' ? 'Ce rendez-vous sera supprimé.' : 'Cette intervention sera supprimée.', [{ text: 'Annuler', style: 'cancel' }, { text: 'Supprimer', style: 'destructive', onPress: async () => { try { await apiSend(`/api/planning/${id}`, 'DELETE', undefined, false); router.back(); } catch (x) { setMsg((x as Error).message); } } }]);
  const Info = ({ icon, label, children }: { icon: keyof typeof Feather.glyphMap; label: string; children: React.ReactNode }) => (
    <View style={s.info}><View style={s.infoIc}><Feather name={icon} size={16} color={k.ink} /></View><View style={{ flex: 1, gap: 2 }}><Text style={s.infoLbl}>{label}</Text>{children}</View></View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Stack.Screen options={{ title: k.label, headerBackTitle: tr('Retour') }} />
      <View style={[s.head, { backgroundColor: k.soft, borderLeftColor: k.main }]}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Text style={[s.kind, { color: k.ink }]}>{k.label}</Text>
          {e.status === 'tentative' && <View style={s.tent}><Text style={s.tentTxt}>À confirmer</Text></View>}
        </View>
        <Text style={s.title}>{e.title || e.worksite.title}</Text>
        <Text style={{ color: T.ink2, fontWeight: '700', textTransform: 'capitalize' }}>{day} · {e.allDay ? 'toute la journée' : `${hm(e.startAt)} – ${hm(e.endAt)}`}</Text>
      </View>

      {!!msg && <View style={s.flash}><Text style={{ color: T.ink, fontWeight: '700' }}>{msg}</Text></View>}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/evenement/edition?id=${e.id}` as never)} style={[s.main, { backgroundColor: k.main }]}><Feather name="edit-2" size={18} color="#fff" /><Text style={s.mainTxt}>Modifier</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/evenement/edition?dupFrom=${e.id}` as never)} style={s.sec}><Feather name="copy" size={18} color={T.primary} /><Text style={s.secTxt}>Dupliquer</Text></Pressable>
        {e.status === 'tentative' && <Pressable accessibilityRole="button" onPress={confirmIt} style={[s.sec, { backgroundColor: T.okSoft }]}><Feather name="check" size={18} color={T.ok} /><Text style={[s.secTxt, { color: T.ok }]}>Confirmer</Text></Pressable>}
      </View>

      <View style={s.card}>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/chantier/${e.worksite.id}` as never)}>
          <Info icon="home" label={tr("Chantier")}><Text style={s.val}>{e.worksite.ref} — {e.worksite.title}</Text><Text style={s.link}>Ouvrir la fiche chantier</Text></Info>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/photos/${e.worksite.id}` as never)}>
          <Info icon="camera" label="Photos"><Text style={s.link}>Voir et ajouter des photos du chantier</Text></Info>
        </Pressable>
        {!!addr && (
          <Pressable accessibilityRole="button" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`)}>
            <Info icon="navigation" label={tr("Adresse")}><Text style={s.val}>{addr}</Text><Text style={s.link}>Itinéraire</Text></Info>
          </Pressable>
        )}
        <Info icon="users" label={`Équipe (${e.assignments.length})`}>
          {e.assignments.length === 0 ? <Muted>Aucun ouvrier affecté.</Muted> : e.assignments.map((a) => (
            <Pressable key={a.person.id} accessibilityRole="button" disabled={!a.person.phone} onPress={() => a.person.phone && Linking.openURL(`tel:${a.person.phone.replace(/\s/g, '')}`)} style={s.person}>
              <Text style={s.val}>{a.person.displayName || a.person.firstName}</Text>
              {!!a.person.phone && <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><Feather name="phone" size={13} color={T.primary} /><Text style={s.link}>{a.person.phone}</Text></View>}
            </Pressable>
          ))}
        </Info>
        {e.vehicles.length > 0 && <Info icon="truck" label={tr("Véhicules")}>{e.vehicles.map((v, i) => <Text key={i} style={s.val}>{vlabel(v)}{v.driver ? ` · ${v.driver.displayName || v.driver.firstName}` : ''}</Text>)}</Info>}
        {!!e.tasksNote && <Info icon="check-square" label={tr("Mission")}><Text style={s.val}>{e.tasksNote}</Text></Info>}
        {!!e.accessNote && <Info icon="key" label={tr("Accès")}><Text style={s.val}>{e.accessNote}</Text></Info>}
        {!!e.materialsNote && <Info icon="tool" label={tr("Matériel")}><Text style={s.val}>{e.materialsNote}</Text></Info>}
        {!!e.note && <Info icon="phone-call" label={e.kind === 'meeting' ? 'Avec' : 'Contact sur place'}><Text style={s.val}>{e.note}</Text></Info>}
      </View>

      {canDelete && <Pressable accessibilityRole="button" onPress={remove} style={s.del}><Feather name="trash-2" size={18} color={T.crit} /><Text style={{ color: T.crit, fontWeight: '800' }}>Supprimer du planning</Text></Pressable>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  head: { borderRadius: 20, borderLeftWidth: 8, padding: 16, gap: 6 },
  kind: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  tent: { backgroundColor: T.warnSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  tentTxt: { fontSize: 11.5, fontWeight: '800', color: T.warn },
  title: { fontSize: 21, fontWeight: '800', color: T.ink, lineHeight: 27 },
  flash: { backgroundColor: T.surface2, borderRadius: 14, padding: 12 },
  main: { flex: 1.3, flexDirection: 'row', gap: 8, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  mainTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  sec: { flex: 1, flexDirection: 'row', gap: 8, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: T.primarySoft },
  secTxt: { color: T.primary, fontWeight: '800', fontSize: 14 },
  card: { backgroundColor: T.surface, borderRadius: 20, borderWidth: 1, borderColor: T.line, padding: 14, gap: 16 },
  info: { flexDirection: 'row', gap: 12 },
  infoIc: { width: 34, height: 34, borderRadius: 11, backgroundColor: T.surface2, alignItems: 'center', justifyContent: 'center' },
  infoLbl: { fontSize: 11.5, fontWeight: '800', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 },
  val: { fontSize: 15.5, color: T.ink, fontWeight: '600', lineHeight: 22 },
  link: { fontSize: 13, color: T.primary, fontWeight: '800' },
  person: { paddingVertical: 4, gap: 2 },
  del: { flexDirection: 'row', gap: 8, backgroundColor: T.critSoft, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
});
