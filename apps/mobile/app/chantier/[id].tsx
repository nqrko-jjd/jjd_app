import { useCallback, useRef, useState, type ReactNode } from 'react';
import { View, ScrollView, StyleSheet, Pressable, RefreshControl, Linking, Platform } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useFocusEffect, Stack, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { openApiFile } from '@/lib/files';
import { useSession } from '@/lib/session';
import { Card, HeroTile, Loading, Badge, eur, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr, dateLocale, Alert } from '@/lib/i18n';
import { EditButton, type Section } from '@/lib/EditForm';


const STATUS_LABEL: Record<string, string> = {
  lead: 'Demande', quote_needed: 'Devis à faire', quote_sent: 'Devis envoyé', to_plan: 'À planifier', scheduled: 'Planifié', in_progress: 'En cours',
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

const WS_SECTIONS: Section[] = [
  { title: 'Chantier', fields: [
    { key: 'title', label: 'Titre', required: true },
    { key: 'status', label: 'Statut', type: 'select', required: true, options: [{ value: 'lead', label: 'Demande reçue' }, { value: 'quote_needed', label: 'Devis à faire' }, { value: 'quote_sent', label: 'Devis envoyé' }, { value: 'to_plan', label: 'À planifier' }, { value: 'scheduled', label: 'Planifié' }, { value: 'in_progress', label: 'En cours' }, { value: 'on_hold', label: 'En attente' }, { value: 'done', label: 'Terminé' }, { value: 'to_invoice', label: 'À facturer' }, { value: 'invoiced', label: 'Facturé' }, { value: 'closed', label: 'Clôturé' }, { value: 'cancelled', label: 'Annulé' }] },
    { key: 'priority', label: 'Priorité', type: 'select', required: true, options: [{ value: 'low', label: 'Basse' }, { value: 'normal', label: 'Normale' }, { value: 'high', label: 'Haute' }, { value: 'urgent', label: 'Urgente' }] },
    { key: 'requestKind', label: 'Type de demande', type: 'select', options: [{ value: 'ponctuelle', label: 'Ponctuelle' }, { value: 'renovation', label: 'Rénovation' }, { value: 'entretien', label: 'Entretien' }, { value: 'sav', label: 'SAV' }] },
    { key: 'description', label: 'Description', type: 'multiline' },
    { key: 'siteBrief', label: 'Consignes pour l’équipe', type: 'multiline' },
    { key: 'accessNotes', label: 'Accès / clés', type: 'multiline' },
    { key: 'startedOn', label: 'Début', type: 'date' },
    { key: 'endedOn', label: 'Fin', type: 'date' },
    { key: 'quotedHt', label: 'Montant du devis HTVA', type: 'number' },
    { key: 'quoteRef', label: 'Réf. devis' },
    { key: 'clientRef', label: 'Réf. du client' },
  ] },
  { title: 'Adresse', fields: [
    { key: 'address', label: 'Adresse' }, { key: 'box', label: 'Boîte / appartement' },
    { key: 'postalCode', label: 'Code postal' }, { key: 'city', label: 'Ville' }, { key: 'unitLabel', label: 'Lot / unité' },
  ] },
  { title: 'Facturation', fields: [
    { key: 'billTo', label: 'Facturé à' }, { key: 'billToAttn', label: 'À l’attention de' }, { key: 'billToEmail', label: 'E-mail de facturation', type: 'email' },
  ] },
  { title: 'Propriétaire', fields: [
    { key: 'ownerName', label: 'Nom' }, { key: 'ownerPhone', label: 'Téléphone', type: 'phone' }, { key: 'ownerEmail', label: 'E-mail', type: 'email' },
  ] },
  { title: 'Locataire / occupant', fields: [
    { key: 'tenantName', label: 'Nom' }, { key: 'tenantPhone', label: 'Téléphone', type: 'phone' }, { key: 'tenantPhone2', label: 'Téléphone 2', type: 'phone' }, { key: 'tenantEmail', label: 'E-mail', type: 'email' },
  ] },
];

interface Margin {
  quotedHt: number; invoicedHt: number; paidHt: number; materialCost: number; labourCost: number;
  vehicleCost: number;
  realMargin: number; realMarginPct: number | null; leftToInvoice: number; partnerShare: number;
}
interface WsContact {
  id: string; role: string; name: string; phone: string | null; email: string | null; contactFor: string | null;
}
interface Ev {
  id?: string; startAt: string; endAt?: string | null; note: string | null;
  assignments: { person: { displayName: string | null; firstName: string } }[];
}
interface WsDoc {
  id: string; kind: string; number: string | null; draftRef: string | null; status: string; title: string | null;
  totalHt: number | null; totalTtc: number | null; paidAmount: number | null; issuedOn: string | null; dueOn: string | null;
}
interface WsTask {
  id: string; title: string; status: string; priority?: string | null; dueOn: string | null; worksiteId: string | null;
  assignees?: { id: string; name: string }[];
}
interface WsExpense {
  id: string; date: string | null; supplier: string | null; categoryLabel: string | null; docNumber: string | null;
  ht: number; ttc: number | null; paid: boolean; hasPdf: boolean;
}
interface ExpensesRes { items: WsExpense[]; totals?: { ht: number; ttc: number; unpaidTtc: number } }
interface Activity { id: string; label: string; by: string | null; at: string }
interface Detail {
  worksite: {
    ref: string; title: string; status: string; statusRaw: string | null; entity: string;
    address: string | null; city: string | null; postalCode?: string | null; box: string | null; unitLabel: string | null;
    startedOn: string | null; endedOn: string | null;
    description: string | null; accessNotes: string | null; siteBrief?: string | null; requestKind: string | null;
    billTo: string | null;
    ownerName: string | null; ownerPhone: string | null; ownerEmail: string | null;
    tenantName: string | null; tenantPhone: string | null; tenantPhone2: string | null; tenantEmail: string | null;
    client: { name: string; phone?: string | null } | null;
    building: { name: string; syndic: { name: string } | null } | null;
    manager: { displayName: string | null; firstName: string } | null;
    billToContact: { name: string } | null;
    contacts: WsContact[];
    events: Ev[];
    documents?: WsDoc[];
    reports?: { id: string; signedAt: string | null }[];
  };
  margin: Margin | null;
  activity: Activity[];
}

const DOC_KIND: Record<string, string> = { quote: 'Devis', invoice: 'Facture', credit_note: 'Avoir', deposit_invoice: 'Acompte' };
const TASK_STATUS: Record<string, string> = { todo: 'À faire', doing: 'En cours', done: 'Terminée' };
/** Ce qu'il reste à faire selon le statut, quand aucune intervention n'est planifiée. */
const NEXT_STEP: Record<string, string> = {
  lead: 'Traiter la demande du client', quote_needed: 'Préparer et envoyer le devis', quote_sent: 'Attendre la réponse du client au devis',
  to_plan: 'Planifier l’intervention', scheduled: 'Intervention à venir', in_progress: 'Chantier en cours', on_hold: 'Chantier en attente : à relancer',
  done: 'Vérifier puis facturer', to_invoice: 'Envoyer la facture au client', invoiced: 'Suivre le paiement de la facture',
};

const money = (n: number | null | undefined) => eur(typeof n === 'number' && Number.isFinite(n) ? n : 0);
const num = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

function timeAgo(iso: string): string {
  return new Date(iso).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function dayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  const hm = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  return hm === '00:00' ? day : `${day} · ${hm}`;
}
function clean(phone: string) { return phone.replace(/[^\d+]/g, ''); }
function call(phone: string) { Linking.openURL(`tel:${clean(phone)}`).catch(() => undefined); }
function mailTo(email: string) { Linking.openURL(`mailto:${email}`).catch(() => undefined); }
function openMaps(q: string) {
  const enc = encodeURIComponent(q);
  const url = Platform.OS === 'ios' ? `http://maps.apple.com/?q=${enc}` : Platform.OS === 'android' ? `geo:0,0?q=${enc}` : `https://www.google.com/maps/search/?api=1&query=${enc}`;
  Linking.openURL(url).catch(() => undefined);
}

export default function ChantierDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  /** null = pas chargé ou échec : la section est alors masquée, sans casser l'écran. */
  const [tasks, setTasks] = useState<WsTask[] | null>(null);
  const [expenses, setExpenses] = useState<ExpensesRes | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ tasks: true, docs: true, planning: true, notes: true });
  const [more, setMore] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<ScrollView>(null);
  const ys = useRef<Record<string, number>>({});
  const worker = user?.role === 'worker';
  const isOffice = user?.role === 'admin' || user?.role === 'office'; // chiffres, documents, achats : bureau et admin seulement

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Detail>(`/api/worksites/${id}`));
    } catch {
      /* hors ligne */
    }
    // Compléments en parallèle : un échec ne casse pas l'écran, la section est simplement masquée.
    const [t, e] = await Promise.all([
      (worker
        ? apiGet<{ items: WsTask[] }>('/api/tasks?mine=1').then((r) => r.items.filter((x) => x.worksiteId === id))
        : apiGet<{ items: WsTask[] }>(`/api/worksites/${id}/tasks`).then((r) => r.items)
      ).catch(() => null),
      isOffice ? apiGet<ExpensesRes>(`/api/finance/expenses?worksiteId=${id}&pageSize=100`).catch(() => null) : Promise.resolve(null),
    ]);
    setTasks(t);
    setExpenses(e);
  }, [id, worker, isOffice]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const goTo = (k: string) => {
    setOpen((o) => ({ ...o, [k]: true }));
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, (ys.current[k] ?? 0) - 8), animated: true }), 60);
  };
  const at = (k: string) => ({ onLayout: (e: { nativeEvent: { layout: { y: number } } }) => { ys.current[k] = e.nativeEvent.layout.y; } });

  if (!data) return <Loading />;
  const w = data.worksite;
  const now = new Date();
  const sortedEvents = [...w.events].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcoming = sortedEvents.filter((e) => new Date(e.startAt) >= startOfDay);
  const past = sortedEvents.filter((e) => new Date(e.startAt) < startOfDay).reverse();
  const nextEvent = upcoming[0] ?? null;
  const teamOf = (e: Ev) => [...new Set(e.assignments.map((a) => a.person.displayName || a.person.firstName))].join(', ');

  const addressLine = [w.address, w.box && `bte ${w.box}`, w.unitLabel, [w.postalCode, w.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const mapsQuery = [w.address, w.postalCode, w.city].filter(Boolean).join(' ');

  // Personnes à joindre : contacts du chantier, puis propriétaire et occupant
  const people: { key: string; role: string; name: string; phone: string | null; email: string | null; note?: string }[] = [
    ...w.contacts.map((c) => ({ key: c.id, role: CONTACT_ROLE_LABEL[c.role] ?? c.role, name: c.name, phone: c.phone, email: c.email, note: c.contactFor ? CONTACT_FOR_LABEL[c.contactFor] ?? c.contactFor : undefined })),
    ...(w.ownerName ? [{ key: 'owner', role: 'Propriétaire', name: w.ownerName, phone: w.ownerPhone, email: w.ownerEmail }] : []),
    ...(w.tenantName ? [{ key: 'tenant', role: 'Locataire / occupant', name: w.tenantName, phone: w.tenantPhone || w.tenantPhone2, email: w.tenantEmail }] : []),
  ];
  const mainPhone = people.find((p) => p.phone)?.phone ?? w.client?.phone ?? null;
  const mainPhoneName = people.find((p) => p.phone)?.name ?? w.client?.name ?? '';

  const sortedTasks = tasks
    ? [...tasks].sort((a, b) => ['doing', 'todo', 'done'].indexOf(a.status) - ['doing', 'todo', 'done'].indexOf(b.status))
    : null;
  const openTasks = sortedTasks?.filter((t) => t.status !== 'done').length ?? 0;
  const docs = (w.documents ?? []);
  const showMargin = isOffice && !!data.margin;

  const hasNotes = !!(w.siteBrief || w.accessNotes || w.description);
  const reportsCount = w.reports?.length ?? 0;

  async function openPdf(d: WsDoc) {
    try { await openApiFile(`/api/documents/${d.id}/pdf`, `${d.number ?? d.draftRef ?? 'document'}.pdf`); }
    catch (e) { Alert.alert('PDF', (e as Error).message); }
  }
  async function openExpense(x: WsExpense) {
    if (!x.hasPdf) return;
    try { await openApiFile(`/api/finance/expenses/${x.id}/pdf`, `${x.docNumber ?? 'facture'}.pdf`); }
    catch (e) { Alert.alert('Pièce jointe', (e as Error).message); }
  }


  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: T.paper }}
      contentContainerStyle={{ ...T.content, gap: 18 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Stack.Screen options={{ title: w.ref, headerBackTitle: tr('Retour') }} />

      {!worker && <EditButton title={w.ref} sections={WS_SECTIONS} values={w as unknown as Record<string, unknown>} path={`/api/worksites/${id}`} onSaved={load} />}

      {/* ---------- En-tête ---------- */}
      <HeroTile>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <Text style={s.heroRef}>{w.ref}{w.entity === 'tonton' ? ' · Tonton' : w.entity === 'm7' ? ' · M7' : ''}</Text>
          <View style={s.heroBadge}>
            <Text style={s.heroBadgeTxt}>{tr(STATUS_LABEL[w.status] ?? w.statusRaw ?? w.status)}</Text>
          </View>
        </View>
        <Text style={s.heroTitle}>{w.title}</Text>
        {!!w.client?.name && <Text style={s.heroSub}>{w.client.name}</Text>}
        {!!addressLine && (
          <Pressable accessibilityRole="link" onPress={() => openMaps(mapsQuery || addressLine)} style={s.heroAddr}>
            <Feather name="map-pin" size={16} color="#fff" />
            <Text style={s.heroAddrTxt}>{addressLine}</Text>
            <Feather name="external-link" size={14} color="rgba(255,255,255,0.7)" />
          </Pressable>
        )}
      </HeroTile>

      {/* ---------- Prochaine étape / intervention ---------- */}
      {(nextEvent || NEXT_STEP[w.status]) && (
        <View style={s.next}>
          <View style={s.nextIcon}><Feather name={nextEvent ? 'calendar' : 'flag'} size={20} color={T.accent} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.nextLabel}>{tr(nextEvent ? 'Prochaine intervention' : 'Prochaine étape')}</Text>
            <Text style={s.nextMain}>{nextEvent ? dayTime(nextEvent.startAt) : tr(NEXT_STEP[w.status]!)}</Text>
            {!!nextEvent && !!(nextEvent.note || teamOf(nextEvent)) && (
              <Text style={s.nextSub}>{[nextEvent.note, teamOf(nextEvent) && `${tr('Équipe')} : ${teamOf(nextEvent)}`].filter(Boolean).join(' — ')}</Text>
            )}
          </View>
        </View>
      )}

      {/* ---------- Raccourcis ---------- */}
      <View style={s.tiles}>
        <Tile icon="message-circle" label="Messagerie" onPress={() => router.push(`/fil/${id}` as never)} />
        <Tile icon="camera" label="Photos" onPress={() => router.push(`/photos/${id}` as never)} />
        {!!mainPhone && <Tile icon="phone" label="Appeler" sub={mainPhoneName} onPress={() => call(mainPhone)} />}
        {isOffice
          ? <Tile icon="file-text" label="Documents" onPress={() => goTo('docs')} />
          : sortedTasks ? <Tile icon="check-square" label="Tâches" onPress={() => goTo('tasks')} /> : null}
        {isOffice && <Tile icon="mail" label="Suivi mails" onPress={() => router.push(`/suivi-mails/${id}` as never)} />}
      </View>

      {/* ---------- Les chiffres (bureau / admin) ---------- */}
      {showMargin && <Figures m={data.margin!} />}

      {/* ---------- Tâches ---------- */}
      {sortedTasks && (
        <Fold k="tasks" title={worker ? 'Mes tâches' : 'Tâches'} count={sortedTasks.length ? `${openTasks} à faire sur ${sortedTasks.length}` : '0'} icon="check-square" open={open.tasks} onToggle={toggle} at={at}>
          {sortedTasks.length === 0 && <Empty text={worker ? 'Aucune tâche ne vous est confiée sur ce chantier.' : 'Aucune tâche pour ce chantier. Elles se créent depuis le site web.'} />}
          {(more.tasks ? sortedTasks : sortedTasks.slice(0, 8)).map((t) => {
            const late = t.status !== 'done' && !!t.dueOn && new Date(t.dueOn) < startOfDay;
            const who = (t.assignees ?? []).map((a) => a.name).join(', ');
            return (
              <View key={t.id} style={s.item}>
                <Feather name={t.status === 'done' ? 'check-circle' : t.status === 'doing' ? 'play-circle' : 'circle'} size={22} color={t.status === 'done' ? T.ok : t.status === 'doing' ? T.accent : T.ink3} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[s.itemTitle, t.status === 'done' && { color: T.ink2, textDecorationLine: 'line-through' }]}>{t.title}</Text>
                  <View style={s.metaRow}>
                    <Badge tone={t.status === 'done' ? 'ok' : t.status === 'doing' ? 'warn' : undefined}>{tr(TASK_STATUS[t.status] ?? t.status)}</Badge>
                    {t.priority === 'urgent' && <Badge tone="crit">{tr('Urgent')}</Badge>}
                    {!!t.dueOn && <Badge tone={late ? 'crit' : undefined}>{`${late ? tr('En retard · ') : tr('Pour le ') }${dateBE(t.dueOn)}`}</Badge>}
                  </View>
                  {!!who && !worker && <Text style={s.itemSub}>{tr('Qui')} : {who}</Text>}
                </View>
              </View>
            );
          })}
          {sortedTasks.length > 8 && <MoreBtn open={!!more.tasks} onPress={() => setMore((m) => ({ ...m, tasks: !m.tasks }))} total={sortedTasks.length} />}
        </Fold>
      )}

      {/* ---------- Documents ---------- */}
      {isOffice && (
        <Fold k="docs" title="Documents" count={String(docs.length + reportsCount)} icon="file-text" open={open.docs} onToggle={toggle} at={at}>
          {docs.length === 0 && <Empty text="Aucun devis ni facture lié à ce chantier." />}
          {docs.map((d) => <DocRow key={d.id} d={d} onPdf={() => openPdf(d)} onDetail={() => router.push(`/document/${d.id}` as never)} />)}
          {reportsCount > 0 && (
            <Pressable accessibilityRole="button" onPress={() => router.push(`/rapport/${id}` as never)} style={s.linkRow}>
              <Feather name="clipboard" size={20} color={T.primary} />
              <Text style={s.linkTxt}>{tr('Rapports d’intervention')} ({reportsCount})</Text>
              <Feather name="chevron-right" size={20} color={T.ink3} />
            </Pressable>
          )}
        </Fold>
      )}

      {/* ---------- Achats et dépenses ---------- */}
      {isOffice && expenses && (
        <Fold k="exp" title="Achats & dépenses" count={String(expenses.items.length)} icon="shopping-cart" open={!!open.exp} onToggle={toggle} at={at}>
          {expenses.items.length === 0 && <Empty text="Aucun achat enregistré pour ce chantier." />}
          {(more.exp ? expenses.items : expenses.items.slice(0, 8)).map((x) => (
            <Pressable key={x.id} accessibilityRole={x.hasPdf ? 'button' : undefined} disabled={!x.hasPdf} onPress={() => openExpense(x)} style={s.item}>
              <Feather name="shopping-bag" size={20} color={T.ink2} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={s.itemTitle}>{x.supplier ?? tr('Fournisseur inconnu')}</Text>
                <Text style={s.itemSub}>{[x.categoryLabel, x.docNumber, x.date ? dateBE(x.date) : null].filter(Boolean).join(' · ')}</Text>
                <View style={s.metaRow}><Badge tone={x.paid ? 'ok' : 'warn'}>{tr(x.paid ? 'Payé' : 'À payer')}</Badge>{x.hasPdf && <Badge>{tr('PDF')}</Badge>}</View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.amount}>{money(x.ht)}</Text>
                <Text style={s.itemSub}>{tr('HTVA')}</Text>
              </View>
            </Pressable>
          ))}
          {expenses.items.length > 8 && <MoreBtn open={!!more.exp} onPress={() => setMore((m) => ({ ...m, exp: !m.exp }))} total={expenses.items.length} />}
          {expenses.items.length > 0 && (
            <View style={s.total}>
              <Text style={s.totalK}>{tr('Total des achats')}</Text>
              <Text style={s.totalV}>{money(expenses.totals?.ht)} {tr('HTVA')}</Text>
              {num(expenses.totals?.unpaidTtc) > 0.01 && <Text style={s.itemSub}>{tr('Encore à payer aux fournisseurs')} : {money(expenses.totals?.unpaidTtc)} TTC</Text>}
            </View>
          )}
        </Fold>
      )}

      {/* ---------- Planning ---------- */}
      <Fold k="planning" title="Planning" count={String(w.events.length)} icon="calendar" open={open.planning} onToggle={toggle} at={at}>
        {w.events.length === 0 && <Empty text="Aucune intervention planifiée pour l’instant." />}
        {upcoming.length > 0 && <Text style={s.subTitle}>{tr('À venir')}</Text>}
        {upcoming.slice(0, 5).map((e, i) => <EventRow key={`u${e.id ?? i}`} e={e} team={teamOf(e)} />)}
        {past.length > 0 && <Text style={s.subTitle}>{tr('Déjà passées')}</Text>}
        {(more.plan ? past : past.slice(0, 3)).map((e, i) => <EventRow key={`p${e.id ?? i}`} e={e} team={teamOf(e)} faded />)}
        {past.length > 3 && <MoreBtn open={!!more.plan} onPress={() => setMore((m) => ({ ...m, plan: !m.plan }))} total={past.length} />}
      </Fold>

      {/* ---------- Contacts ---------- */}
      <Fold k="contacts" title="Contacts" count={String(people.length)} icon="users" open={!!open.contacts} onToggle={toggle} at={at}>
        {people.length === 0 && <Empty text="Aucun contact enregistré sur ce chantier." />}
        {people.map((p) => (
          <View key={p.key} style={s.item}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.itemTitle}>{p.name}</Text>
              <Text style={s.itemSub}>{p.role}{p.note ? ` · ${p.note}` : ''}</Text>
              {!!p.phone && <Text style={s.itemSub}>{p.phone}</Text>}
            </View>
            {!!p.phone && <RoundBtn icon="phone" label={`${tr('Appeler')} ${p.name}`} onPress={() => call(p.phone!)} />}
            {!!p.email && <RoundBtn icon="mail" label={`${tr('Écrire à')} ${p.name}`} onPress={() => mailTo(p.email!)} />}
          </View>
        ))}
      </Fold>

      {/* ---------- Notes et consignes ---------- */}
      <Fold k="notes" title="Notes et consignes" count={hasNotes ? '' : '0'} icon="clipboard" open={open.notes} onToggle={toggle} at={at}>
        {!hasNotes && <Empty text="Aucune consigne ni description pour ce chantier." />}
        {!!w.siteBrief && <Note title="À faire sur place" text={w.siteBrief} />}
        {!!w.accessNotes && <Note title="Accès et clés" text={w.accessNotes} />}
        {!!w.description && <Note title="Description" text={w.description} />}
      </Fold>

      {/* ---------- Infos générales ---------- */}
      <Fold k="info" title="Infos du chantier" count="" icon="info" open={!!open.info} onToggle={toggle} at={at}>
        <InfoRow k="Client" v={w.client?.name} />
        <InfoRow k="Immeuble" v={w.building ? `${w.building.name}${w.building.syndic ? ` · ${w.building.syndic.name}` : ''}` : null} />
        <InfoRow k="Chef de chantier" v={w.manager?.displayName ?? w.manager?.firstName} />
        <InfoRow k="Début" v={w.startedOn ? dateBE(w.startedOn) : null} />
        <InfoRow k="Fin" v={w.endedOn ? dateBE(w.endedOn) : null} />
        {!worker && <InfoRow k="Facturé à" v={w.billToContact?.name ?? w.billTo} />}
        <InfoRow k="Type de demande" v={w.requestKind ? REQUEST_KIND_LABEL[w.requestKind] ?? w.requestKind : null} />
      </Fold>

      {/* ---------- Historique ---------- */}
      {data.activity.length > 0 && (
        <Fold k="activity" title="Historique" count={String(data.activity.length)} icon="activity" open={!!open.activity} onToggle={toggle} at={at}>
          {data.activity.map((a) => (
            <View key={a.id} style={{ paddingVertical: 6, gap: 2 }}>
              <Text style={s.itemTitle}>{a.label}</Text>
              <Text style={s.itemSub}>{a.by ? `${a.by} · ` : ''}{timeAgo(a.at)}</Text>
            </View>
          ))}
        </Fold>
      )}
    </ScrollView>
  );
}

/* ================================================================ Composants */

function Tile({ icon, label, sub, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={tr(label)} onPress={onPress} style={({ pressed }) => [s.tile, pressed && { opacity: 0.85 }]}>
      <View style={s.tileIcon}><Feather name={icon} size={22} color={T.primary} /></View>
      <Text style={s.tileTxt} numberOfLines={1}>{tr(label)}</Text>
      {!!sub && <Text style={s.tileSub} numberOfLines={1}>{sub}</Text>}
    </Pressable>
  );
}

function Fold({ k, title, count, icon, open, onToggle, at, children }: {
  k: string; title: string; count: string; icon: keyof typeof Feather.glyphMap; open: boolean; onToggle: (k: string) => void;
  at: (k: string) => { onLayout: (e: { nativeEvent: { layout: { y: number } } }) => void }; children: ReactNode;
}) {
  return (
    <View {...at(k)}>
      <Card>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => onToggle(k)} style={s.foldHead}>
          <Feather name={icon} size={18} color={T.primary} />
          <Text style={s.foldTitle}>{tr(title)}</Text>
          {!!count && <View style={s.count}><Text style={s.countTxt}>{count}</Text></View>}
          <View style={{ flex: 1 }} />
          <Feather name={open ? 'chevron-up' : 'chevron-down'} size={22} color={T.ink3} />
        </Pressable>
        {open && <View style={{ gap: 4 }}>{children}</View>}
      </Card>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={s.empty}>{tr(text)}</Text>;
}

function MoreBtn({ open, onPress, total }: { open: boolean; onPress: () => void; total: number }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={s.more}>
      <Text style={s.moreTxt}>{open ? tr('Voir moins') : `${tr('Voir tout')} (${total})`}</Text>
    </Pressable>
  );
}

function RoundBtn({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.round, pressed && { opacity: 0.8 }]}>
      <Feather name={icon} size={20} color={T.primary} />
    </Pressable>
  );
}

function Note({ title, text }: { title: string; text: string }) {
  return (
    <View style={{ paddingVertical: 6, gap: 4 }}>
      <Text style={s.subTitle}>{tr(title)}</Text>
      <Text style={{ color: T.ink, fontSize: 15, lineHeight: 22 }}>{text}</Text>
    </View>
  );
}

function InfoRow({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <View style={s.row}>
      <Text style={s.k}>{tr(k)}</Text>
      <Text style={s.v}>{v}</Text>
    </View>
  );
}

function EventRow({ e, team, faded }: { e: Ev; team: string; faded?: boolean }) {
  return (
    <View style={[s.item, faded && { opacity: 0.7 }]}>
      <Feather name="clock" size={20} color={T.ink2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.itemTitle}>{dayTime(e.startAt)}</Text>
        {!!e.note && <Text style={s.itemSub}>{e.note}</Text>}
        <Text style={s.itemSub}>{team ? `${tr('Équipe')} : ${team}` : tr('Équipe non précisée')}</Text>
      </View>
    </View>
  );
}

function DocRow({ d, onPdf, onDetail }: { d: WsDoc; onPdf: () => void; onDetail: () => void }) {
  const isInvoice = d.kind === 'invoice' || d.kind === 'deposit_invoice';
  const total = num(d.totalTtc);
  const paid = num(d.paidAmount);
  let label = ''; let tone: 'ok' | 'warn' | 'crit' | 'primary' | undefined;
  if (d.status === 'draft') label = 'Brouillon';
  else if (d.status === 'cancelled') label = 'Annulé';
  else if (isInvoice) {
    if (d.status === 'paid') { label = 'Payé'; tone = 'ok'; }
    else if (d.status === 'credited') { label = 'Crédité'; tone = 'ok'; }
    else if (d.status === 'overdue') { label = 'Impayé · en retard'; tone = 'crit'; }
    else if (d.status === 'partial') { label = `Partiellement payé (${money(paid)})`; tone = 'warn'; }
    else { label = 'Impayé'; tone = 'warn'; }
  } else if (d.kind === 'quote') {
    label = ({ sent: 'Envoyé au client', accepted: 'Accepté', declined: 'Refusé', expired: 'Expiré' } as Record<string, string>)[d.status] ?? d.status;
    tone = d.status === 'accepted' ? 'ok' : d.status === 'declined' ? 'crit' : d.status === 'sent' ? 'primary' : undefined;
  } else label = d.status;
  const late = isInvoice && d.status !== 'paid' && d.status !== 'credited' && d.status !== 'draft' && !!d.dueOn && new Date(d.dueOn) < new Date();
  return (
    <View style={s.item}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${tr('Ouvrir le PDF')} ${d.number ?? ''}`} onPress={onPdf} style={{ flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 }}>
        <Feather name="file-text" size={22} color={T.primary} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.itemTitle}>{tr(DOC_KIND[d.kind] ?? d.kind)} {d.number ?? d.draftRef ?? ''}</Text>
          {!!d.title && <Text style={s.itemSub} numberOfLines={1}>{d.title}</Text>}
          <View style={s.metaRow}>
            <Badge tone={tone}>{tr(label)}</Badge>
            {!!d.issuedOn && <Badge>{dateBE(d.issuedOn)}</Badge>}
            {late && <Badge tone="crit">{`${tr('Échéance dépassée')} ${dateBE(d.dueOn)}`}</Badge>}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.amount}>{money(d.totalHt)}</Text>
          <Text style={s.itemSub}>{tr('HTVA')}</Text>
        </View>
      </Pressable>
      <RoundBtn icon="chevron-right" label={tr('Voir le détail')} onPress={onDetail} />
    </View>
  );
}

/** « Les chiffres » : devis, facturé, encaissé, coûts, marge — une phrase simple sous chaque ligne. */
function Figures({ m }: { m: Margin }) {
  const quoted = num(m.quotedHt); const invoiced = num(m.invoicedHt); const paid = num(m.paidHt);
  const mat = num(m.materialCost); const lab = num(m.labourCost); const veh = num(m.vehicleCost);
  const cost = mat + lab + veh;
  const left = num(m.leftToInvoice);
  const pct = quoted > 0 ? Math.max(0, Math.min(100, Math.round((invoiced / quoted) * 100))) : 0;
  const margin = num(m.realMargin);
  const marginPct = m.realMarginPct;
  const known = paid > 0 && marginPct != null; // sans encaissement, le % n'a pas de sens
  const tone = !known ? T.ink2 : margin < 0 || (marginPct ?? 0) < 8 ? T.crit : (marginPct ?? 0) < 20 ? T.warn : T.ok;
  const toneSoft = !known ? T.surface2 : tone === T.crit ? T.critSoft : tone === T.warn ? T.warnSoft : T.okSoft;
  const verdict = !known ? 'Pas encore calculable' : tone === T.crit ? (margin < 0 ? 'On perd de l’argent' : 'Marge faible') : tone === T.warn ? 'Marge correcte' : 'Bonne marge';
  const forecast = quoted - cost;
  return (
    <Card>
      <Text style={s.sectionCaps}>{tr('Les chiffres')}</Text>
      <Text style={s.help}>{tr('Tous les montants sont HTVA (hors TVA).')}</Text>

      <Fig k="Devis accepté" v={money(quoted)} help={quoted > 0 ? 'Le prix convenu avec le client pour ce chantier.' : 'Aucun devis accepté n’est enregistré pour ce chantier.'} />
      <Fig k="Déjà facturé" v={money(invoiced)} help="Ce qu’on a déjà mis en facture auprès du client." />
      {quoted > 0 && (
        <View style={{ gap: 6, paddingBottom: 6 }}>
          <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
          <Text style={s.help}>{pct} % {tr('du devis est facturé')}</Text>
        </View>
      )}
      <Fig k="Déjà encaissé" v={money(paid)} help={invoiced > 0 && paid < invoiced ? `Argent réellement reçu. Il reste ${money(invoiced - paid)} de factures à encaisser.` : 'Argent réellement reçu sur notre compte.'} />
      <Fig k="Reste à facturer" v={money(left)} help={left > 0 ? 'Ce qui n’est pas encore facturé du devis.' : left < 0 ? 'On a facturé plus que le devis (travaux en plus).' : 'Tout le devis est facturé.'} />

      <View style={s.sep} />
      <Text style={s.sectionCaps}>{tr('Ce que ça nous coûte')}</Text>
      <Fig k="Matériel" v={money(mat)} help="Achats et fournitures pour ce chantier." />
      <Fig k="Main-d’œuvre" v={money(lab)} help="Heures pointées par l’équipe, valorisées au coût horaire." />
      {veh > 0 && <Fig k="Véhicules" v={money(veh)} help="Coût d’utilisation des véhicules sur ce chantier." />}
      <Fig k="Total des coûts" v={money(cost)} help="Matériel + main-d’œuvre + véhicules." strong />

      <View style={s.sep} />
      <View style={[s.marginBox, { backgroundColor: toneSoft, borderColor: tone }]}>
        <Text style={s.sectionCaps}>{tr('Marge')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <Text style={[s.marginBig, { color: tone }]}>{money(margin)}{known ? `  (${marginPct} %)` : ''}</Text>
          <View style={[s.verdict, { backgroundColor: tone }]}><Text style={s.verdictTxt}>{tr(verdict)}</Text></View>
        </View>
        <Text style={s.help}>{tr('Marge = ce qu’il reste après les coûts : l’argent encaissé moins le total des coûts.')}</Text>
        {!known && <Text style={s.help}>{tr('Rien n’est encore encaissé : la marge se précisera au fil des paiements.')}</Text>}
        {quoted > 0 && <Text style={s.help}>{tr('Si tout le devis est payé, la marge sera d’environ')} {money(forecast)}.</Text>}
        {num(m.partnerShare) > 0 && <Text style={s.help}>{tr('Part du partenaire (33 %)')} : {money(m.partnerShare)}.</Text>}
      </View>
    </Card>
  );
}

function Fig({ k, v, help, strong }: { k: string; v: string; help: string; strong?: boolean }) {
  return (
    <View style={{ paddingVertical: 5, gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <Text style={[s.figK, strong && { fontWeight: '800' }]}>{tr(k)}</Text>
        <Text style={[s.figV, strong && { fontWeight: '800' }]}>{v}</Text>
      </View>
      <Text style={s.help}>{tr(help)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  heroRef: { color: 'rgba(255,255,255,0.65)', fontWeight: '700', fontSize: 13, letterSpacing: 0.3 },
  heroTitle: { color: '#fff', fontSize: 21, fontWeight: '800', marginTop: 6, lineHeight: 27 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 15, marginTop: 2 },
  heroBadge: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  heroBadgeTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  heroAddr: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, minHeight: 44, paddingVertical: 6 },
  heroAddrTxt: { color: '#fff', fontSize: 14.5, flex: 1, textDecorationLine: 'underline' },
  next: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: T.kpiWarnBg, borderColor: T.kpiWarnBorder, borderWidth: 1, borderRadius: 18, padding: 16 },
  nextIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: T.goldSoft, alignItems: 'center', justifyContent: 'center' },
  nextLabel: { fontSize: 12, color: T.kpiWarnFg, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700' },
  nextMain: { fontSize: 16.5, color: T.ink, fontWeight: '800', lineHeight: 22 },
  nextSub: { fontSize: 14, color: T.ink2, lineHeight: 20 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '30%', minWidth: 96, minHeight: 88, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', gap: 6, ...T.shadow },
  tileIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  tileTxt: { color: T.ink, fontWeight: '700', fontSize: 14 },
  tileSub: { color: T.ink2, fontSize: 12.5, marginTop: -4 },
  sectionCaps: { fontSize: 12, color: T.ink2, textTransform: 'uppercase', letterSpacing: 1.1, fontWeight: '700' },
  help: { color: T.ink2, fontSize: 14, lineHeight: 20 },
  figK: { color: T.ink, fontSize: 15.5, fontWeight: '700', flexShrink: 1 },
  figV: { color: T.ink, fontSize: 18, fontWeight: '700' },
  sep: { height: 1, backgroundColor: T.line, marginVertical: 6 },
  bar: { height: 12, borderRadius: 6, backgroundColor: T.surface2, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 6, backgroundColor: T.primary },
  marginBox: { borderWidth: 1.5, borderRadius: 16, padding: 16, gap: 8 },
  marginBig: { fontSize: 26, fontWeight: '800' },
  verdict: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  verdictTxt: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  foldTitle: { fontSize: 13, color: T.ink, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '800' },
  count: { backgroundColor: T.primarySoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  countTxt: { color: T.primary, fontSize: 13, fontWeight: '700' },
  empty: { color: T.ink2, fontSize: 14.5, lineHeight: 21, paddingVertical: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  itemTitle: { color: T.ink, fontSize: 15.5, fontWeight: '700', lineHeight: 21 },
  itemSub: { color: T.ink2, fontSize: 14, lineHeight: 20 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  amount: { color: T.ink, fontSize: 15.5, fontWeight: '700' },
  subTitle: { fontSize: 12.5, color: T.ink2, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700', marginTop: 6 },
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  moreTxt: { color: T.primary, fontWeight: '700', fontSize: 14.5 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  linkTxt: { flex: 1, color: T.ink, fontWeight: '700', fontSize: 15 },
  total: { borderTopWidth: 1, borderTopColor: T.line, paddingTop: 10, gap: 2 },
  totalK: { color: T.ink2, fontSize: 14 },
  totalV: { color: T.ink, fontSize: 18, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  k: { color: T.ink2, fontSize: 14, flexShrink: 0 },
  v: { color: T.ink, fontSize: 14.5, flex: 1, textAlign: 'right', fontWeight: '600' },
});
