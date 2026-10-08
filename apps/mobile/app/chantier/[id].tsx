import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useFocusEffect, Stack, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Card, HeroTile, Label, Loading, Badge, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

const STATUS_LABEL: Record<string, string> = {
  lead: 'Demande', to_plan: 'À planifier', scheduled: 'Planifié', in_progress: 'En cours',
  on_hold: 'En attente', done: 'Terminé', to_invoice: 'À facturer', invoiced: 'Facturé',
  closed: 'Clôturé', cancelled: 'Abandonné',
};
const REQUEST_KIND_LABEL: Record<string, string> = {
  ponctuelle: 'Intervention ponctuelle', renovation: 'Rénovation / chantier long',
  entretien: 'Entretien / maintenance', sav: 'SAV / levée de réserves',
};
const CONTACT_ROLE_LABEL: Record<string, string> = {
  demandeur: 'Demandeur', gestionnaire: 'Gestionnaire / syndic', proprietaire: 'Propriétaire',
  locataire: 'Locataire / occupant', sur_place: 'Contact sur place', architecte: 'Architecte',
  facturation: 'Responsable facturation',
};
const CONTACT_FOR_LABEL: Record<string, string> = {
  demande: 'Demande et validation', rdv_acces: 'Rendez-vous / accès', suivi_technique: 'Suivi technique',
  factures: 'Factures', demande_acces_suivi: 'Demande, accès et suivi',
};

interface Margin {
  quotedHt: number; invoicedHt: number; paidHt: number; materialCost: number; labourCost: number;
  vehicleCost: number;
  realMargin: number; realMarginPct: number | null; leftToInvoice: number; partnerShare: number;
}
interface WsContact {
  id: string; role: string; name: string; phone: string | null; email: string | null; contactFor: string | null;
}
interface Ev {
  startAt: string; note: string | null;
  assignments: { person: { displayName: string | null; firstName: string } }[];
}
interface Activity { id: string; label: string; by: string | null; at: string }
interface Detail {
  worksite: {
    ref: string; title: string; status: string; statusRaw: string | null; entity: string;
    address: string | null; city: string | null; box: string | null; unitLabel: string | null;
    startedOn: string | null; endedOn: string | null;
    description: string | null; accessNotes: string | null; requestKind: string | null;
    billTo: string | null;
    ownerName: string | null; ownerPhone: string | null; ownerEmail: string | null;
    tenantName: string | null; tenantPhone: string | null; tenantPhone2: string | null; tenantEmail: string | null;
    client: { name: string } | null;
    building: { name: string; syndic: { name: string } | null } | null;
    manager: { displayName: string | null; firstName: string } | null;
    billToContact: { name: string } | null;
    contacts: WsContact[];
    events: Ev[];
  };
  margin: Margin | null;
  activity: Activity[];
}

function timeAgo(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ChantierDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Detail>(`/api/worksites/${id}`));
    } catch {
      /* hors ligne */
    }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data) return <Loading />;
  const w = data.worksite;
  const now = new Date();
  const nextEvent = [...w.events].filter((e) => new Date(e.startAt) >= now).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))[0]
    ?? w.events[0] ?? null;
  const team = nextEvent ? [...new Set(nextEvent.assignments.map((a) => a.person.displayName || a.person.firstName))].join(', ') : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, gap: 20 }}>
      <Stack.Screen options={{ title: w.ref, headerBackTitle: 'Retour' }} />

      <HeroTile>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <Text style={s.heroRef}>{w.ref}</Text>
          <View style={s.heroBadge}>
            <Text style={s.heroBadgeTxt}>{STATUS_LABEL[w.status] ?? w.statusRaw ?? w.status}</Text>
          </View>
        </View>
        <Text style={s.heroTitle}>{w.title}</Text>
        {!!w.client?.name && <Text style={s.heroSub}>{w.client.name}</Text>}
      </HeroTile>

      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Badge>{w.entity === 'tonton' ? 'Tonton' : w.entity === 'm7' ? 'M7' : 'JJD'}</Badge>
      </View>

      <Pressable
        style={{ backgroundColor: T.primary, borderRadius: 10, padding: 13, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}
        onPress={() => router.push(`/fil/${id}` as never)}
      >
        <Feather name="message-circle" size={16} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700' }}>Ouvrir le fil de chantier</Text>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={() => router.push(`/photos/${id}` as never)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 18, padding: 14 }, pressed && { opacity: 0.9 }]}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Feather name="camera" size={19} color={T.primary} /></View>
        <View style={{ flex: 1 }}><Text style={{ color: T.ink, fontWeight: '800' }}>Photos du chantier</Text><Text style={{ color: T.ink2, fontSize: 12.5 }}>Prendre des photos, voir celles de l’équipe par jour</Text></View>
        <Feather name="chevron-right" size={20} color={T.ink3} />
      </Pressable>

      {(user?.role === 'admin' || user?.role === 'office') && (
        <Pressable accessibilityRole="button" onPress={() => router.push(`/suivi-mails/${id}` as never)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 18, padding: 14 }, pressed && { opacity: 0.9 }]}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Feather name="mail" size={19} color={T.primary} /></View>
          <View style={{ flex: 1 }}><Text style={{ color: T.ink, fontWeight: '800' }}>Suivi mails</Text><Text style={{ color: T.ink2, fontSize: 12.5 }}>Mails et notes de ce chantier, avec les pièces jointes</Text></View>
          <Feather name="chevron-right" size={20} color={T.ink3} />
        </Pressable>
      )}

      <Card>
        <Row k="Client" v={w.client?.name ?? '—'} />
        <Row k="Immeuble" v={w.building ? `${w.building.name}${w.building.syndic ? ` · ${w.building.syndic.name}` : ''}` : '—'} />
        <Row k="Chef" v={w.manager?.displayName ?? w.manager?.firstName ?? '—'} />
        <Row k="Localisation" v={[w.address, w.box && `bte ${w.box}`, w.unitLabel, w.city].filter(Boolean).join(', ') || '—'} />
        {!!team && <Row k="Équipe affectée" v={team} />}
        <Row k="Début / Fin" v={`${dateBE(w.startedOn)} → ${dateBE(w.endedOn)}`} />
        {(w.billToContact || w.billTo) && <Row k="Facturé à" v={w.billToContact?.name ?? w.billTo ?? '—'} />}
        {!!w.requestKind && <Row k="Type de demande" v={REQUEST_KIND_LABEL[w.requestKind] ?? w.requestKind} />}
        {!!w.accessNotes && <Row k="Accès et RDV" v={w.accessNotes} />}
      </Card>

      {!!w.description && (
        <Card>
          <Label>Description</Label>
          <Text style={{ color: T.ink }}>{w.description}</Text>
        </Card>
      )}

      {w.contacts.length > 0 && (
        <Card>
          <Label>Personnes de contact</Label>
          {w.contacts.map((c) => (
            <Row
              key={c.id}
              k={CONTACT_ROLE_LABEL[c.role] ?? c.role}
              v={`${c.name}${c.phone ? ` · ${c.phone}` : ''}${c.contactFor ? ` — ${CONTACT_FOR_LABEL[c.contactFor] ?? c.contactFor}` : ''}`}
            />
          ))}
        </Card>
      )}

      {(w.ownerName || w.tenantName) && (
        <Card>
          {!!w.ownerName && <Row k="Propriétaire" v={`${w.ownerName}${w.ownerPhone ? ` · ${w.ownerPhone}` : ''}`} />}
          {!!w.tenantName && <Row k="Locataire (sur place)" v={`${w.tenantName}${w.tenantPhone ? ` · ${w.tenantPhone}` : ''}${w.tenantPhone2 ? ` / ${w.tenantPhone2}` : ''}`} />}
        </Card>
      )}

      {nextEvent && (
        <Card>
          <Label>Prochaine étape</Label>
          <Text style={{ color: T.ink, fontWeight: '700' }}>{nextEvent.note || 'Intervention planifiée'}</Text>
          <Text style={{ color: T.ink2, fontSize: 13 }}>{dateBE(nextEvent.startAt)}</Text>
        </Card>
      )}

      {data.activity.length > 0 && (
        <Card>
          <Label>Dernière activité</Label>
          {data.activity.map((a) => (
            <View key={a.id} style={{ paddingVertical: 4 }}>
              <Text style={{ color: T.ink }}>{a.label}</Text>
              <Text style={{ color: T.ink3, fontSize: 11.5 }}>{a.by ? `${a.by} · ` : ''}{timeAgo(a.at)}</Text>
            </View>
          ))}
        </Card>
      )}

      {data.margin && user?.role !== 'worker' && (
        <Card accent={data.margin.realMargin >= 0 ? T.ok : T.crit}>
          <Label>Rentabilité — temps réel</Label>
          <Row k="Devisé HT" v={eur(data.margin.quotedHt)} />
          <Row k="Facturé / Encaissé" v={`${eur(data.margin.invoicedHt)} / ${eur(data.margin.paidHt)}`} />
          <Row k="Coût matériaux" v={eur(data.margin.materialCost)} />
          <Row k="Coût main-d’œuvre" v={eur(data.margin.labourCost)} />
          {data.margin.vehicleCost > 0 && <Row k="Coût véhicule" v={eur(data.margin.vehicleCost)} />}
          <Row k="Marge réelle" v={`${eur(data.margin.realMargin)}${data.margin.realMarginPct != null ? ` (${data.margin.realMarginPct} %)` : ''}`} strong />
          <Row k="Reste à facturer" v={eur(data.margin.leftToInvoice)} />
          {data.margin.partnerShare > 0 && <Row k="Part GT (33 %)" v={eur(data.margin.partnerShare)} />}
        </Card>
      )}
    </ScrollView>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.k}>{k}</Text>
      <Text style={[s.v, strong && { fontWeight: '700' }]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  heroRef: { color: 'rgba(255,255,255,0.65)', fontWeight: '700', fontSize: 12.5, letterSpacing: 0.3 },
  heroTitle: { color: '#fff', fontSize: 19, fontWeight: '800', marginTop: 6, lineHeight: 24 },
  heroSub: { color: 'rgba(255,255,255,0.78)', fontSize: 13, marginTop: 4 },
  heroBadge: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  heroBadgeTxt: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 2 },
  k: { color: T.ink2, flexShrink: 0 },
  v: { color: T.ink, flex: 1, textAlign: 'right' },
});

