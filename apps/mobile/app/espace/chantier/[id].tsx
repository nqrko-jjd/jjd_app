import { useCallback, useState } from 'react';
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { Text } from '@/lib/AppText';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { API_URL, apiGet, apiSend } from '@/lib/api';
import { Alert, dateLocale } from '@/lib/i18n';
import { Badge, Card, EmptyState, HeroTile, Loading, Muted, Row, dateBE, eur } from '@/lib/ui';
import { T } from '@/lib/theme';
import { BigButton, DOC_TONE, SectionTitle, invoiceLabel } from '@/lib/portal';
import { QuoteCard, openPortalPdf, type PortalQuote } from '@/lib/portal-quote';

interface Detail {
  worksite: { id: string; ref: string; title: string; statusLabel: string; address: string; building: { name: string | null } | null; startedOn: string | null; endedOn: string | null; description: string | null; nextStep: string | null };
  manager: { name: string | null; phone: string | null } | null;
  quotes: PortalQuote[];
  invoices: { id: string; number: string | null; status: string; hasPdf: boolean; totalTtc: number | null; paidAmount: number | null; issuedOn: string | null; dueOn: string | null }[];
  photos: { id: string; url: string; thumbUrl: string | null; caption: string | null }[];
  reports: { id: string; date: string; workDone: string | null; notes: string | null }[];
  messages: { id: string; body: string | null; authorName: string | null; createdAt: string; fromClient: boolean }[];
  threadClosed: boolean;
}
interface PlanItem { id: string; startAt: string; endAt: string; allDay: boolean; title: string | null; worksiteId: string | null; team: string | null }

const src = (u: string) => (u.startsWith('http') ? u : `${API_URL}${u}`);
const dt = (iso: string, allDay: boolean) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return allDay ? day : `${day}, ${d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}`;
};

export default function ChantierClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setD(await apiGet<Detail>(`/api/portal/worksites/${id}`));
      setError(null);
      apiGet<{ items: PlanItem[] }>('/api/portal/planning').then((r) => setPlan(r.items.filter((p) => p.worksiteId === id))).catch(() => {});
    } catch (e) { setError((e as Error).message); }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await apiSend(`/api/portal/worksites/${id}/messages`, 'POST', { body }, false);
      setText('');
      await load();
    } catch (e) { Alert.alert('Message non envoyé', (e as Error).message); }
    finally { setSending(false); }
  }

  const w = d?.worksite;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: T.paper }} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: 'Mon chantier' }} />
      <ScrollView contentContainerStyle={[T.content, { gap: 14 }]} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {!d && !error ? <Loading /> : null}
        {error && !d ? <EmptyState icon="alert-circle" title="Chantier introuvable" description={error} /> : null}
        {d && w && (<>
          <HeroTile>
            <Text style={{ color: '#cbded1', fontSize: 12, fontWeight: '700' }}>{w.ref}</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{w.title}</Text>
            <Text style={{ color: '#fff' }}>{w.statusLabel}</Text>
            {w.nextStep ? <Text style={{ color: '#cbded1' }}>Prochaine étape : {w.nextStep}</Text> : null}
          </HeroTile>

          <Card>
            {w.building?.name ? <Row k="Immeuble" v={w.building.name} /> : null}
            {w.address ? <Row k="Adresse" v={w.address} /> : null}
            {w.startedOn ? <Row k="Début" v={dateBE(w.startedOn)} /> : null}
            {w.endedOn ? <Row k="Fin" v={dateBE(w.endedOn)} /> : null}
            {d.manager?.name ? <Row k="Votre contact JJD" v={d.manager.name} /> : null}
            {w.description ? <Muted>{w.description}</Muted> : null}
            {d.manager?.phone ? <BigButton label={`Appeler ${d.manager.name ?? 'JJD'}`} icon="phone" tone="ghost" onPress={() => void Linking.openURL(`tel:${d.manager!.phone}`)} /> : null}
          </Card>

          {plan.length > 0 && (<>
            <SectionTitle>Planning</SectionTitle>
            <Card>
              {plan.map((p) => (
                <View key={p.id} style={{ paddingVertical: 4 }}>
                  <Text style={{ fontWeight: '700', textTransform: 'capitalize' }}>{dt(p.startAt, p.allDay)}</Text>
                  {p.title || p.team ? <Muted>{[p.title, p.team].filter(Boolean).join(' · ')}</Muted> : null}
                </View>
              ))}
            </Card>
          </>)}

          {d.quotes.length > 0 && (<>
            <SectionTitle>Devis</SectionTitle>
            {d.quotes.map((q) => <QuoteCard key={q.id} q={q} onChanged={load} />)}
          </>)}

          {d.invoices.length > 0 && (<>
            <SectionTitle>Factures</SectionTitle>
            {d.invoices.map((f) => (
              <Card key={f.id}>
                <Text style={{ fontWeight: '700' }}>Facture {f.number}</Text>
                <Muted>{[f.issuedOn ? `émise le ${dateBE(f.issuedOn)}` : null, f.dueOn ? `à payer avant le ${dateBE(f.dueOn)}` : null].filter(Boolean).join(' · ')}</Muted>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Badge tone={DOC_TONE[f.status] ?? 'warn'}>{invoiceLabel(f.status)}</Badge>
                  <Text style={{ fontWeight: '800' }}>{eur(f.totalTtc)}</Text>
                </View>
                {f.hasPdf ? <BigButton label="Voir la facture (PDF)" icon="file-text" tone="ghost" onPress={() => void openPortalPdf(f.id, f.number)} /> : null}
              </Card>
            ))}
          </>)}

          {d.photos.length > 0 && (<>
            <SectionTitle>Photos</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {d.photos.filter((p) => p.thumbUrl || p.url).slice(0, 24).map((p) => (
                <Image key={p.id} source={{ uri: src(p.thumbUrl ?? p.url) }} style={{ width: '31.5%', aspectRatio: 1, borderRadius: 12, backgroundColor: T.surface2 }} />
              ))}
            </View>
          </>)}

          {d.reports.length > 0 && (<>
            <SectionTitle>Rapports d’intervention</SectionTitle>
            {d.reports.map((r) => (
              <Card key={r.id}>
                <Text style={{ fontWeight: '700' }}>{dateBE(r.date)}</Text>
                {r.workDone ? <Muted>{r.workDone}</Muted> : null}
                {r.notes ? <Muted>{r.notes}</Muted> : null}
              </Card>
            ))}
          </>)}

          <SectionTitle>Messages</SectionTitle>
          {d.messages.length === 0 ? <Muted>Aucun message pour le moment.</Muted> : d.messages.slice(-30).map((m) => (
            <View key={m.id} style={{ alignSelf: m.fromClient ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: m.fromClient ? T.primarySoft : T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 16, padding: 12, gap: 2 }}>
              <Text style={{ fontSize: 11, color: T.ink2, fontWeight: '700' }}>{m.fromClient ? 'Vous' : m.authorName ?? 'JJD'} · {dateBE(m.createdAt)}</Text>
              {m.body ? <Text>{m.body}</Text> : null}
            </View>
          ))}
          {d.threadClosed ? <Muted>Cette conversation est clôturée.</Muted> : (
            <Card>
              <TextInput value={text} onChangeText={setText} multiline placeholder="Écrire un message à JJD…" placeholderTextColor={T.ink2}
                style={{ minHeight: 80, fontSize: 16, color: T.ink, textAlignVertical: 'top' }} />
              <BigButton label={sending ? 'Envoi…' : 'Envoyer'} icon="send" busy={sending || !text.trim()} onPress={send} />
            </Card>
          )}
        </>)}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
