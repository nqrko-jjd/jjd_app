import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/lib/AppText';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiGet, storageKey } from '@/lib/api';
import { Badge, Card, HeroTile, Muted, ScreenHeader, dateBE, eur } from '@/lib/ui';
import { T } from '@/lib/theme';
import { BigButton, DOC_TONE, PORTAL_PWD_PROMPT, PortalScroll, SectionTitle, invoiceLabel, isInvoiceKind, usePortalData } from '@/lib/portal';

interface Dashboard {
  greeting: { name: string };
  singleProject: { id: string; ref: string; title: string; building: string | null; statusLabel: string; progressPct: number; nextStep: string | null; manager: string | null } | null;
  kpis: { interventionsActive: number; quotesToValidate: number | null; urgent: number };
  recentInterventions: { id: string; ref: string; title: string; building: string | null; statusLabel: string }[];
  weekPlanning: { days: { label: string; date: string; items: { time: string; label: string; worksiteId: string | null }[] }[] };
  quotesToValidate: { id: string; number: string | null; title: string | null; totalHt: number | null; building: string | null; issuedOn: string | null }[];
}
interface Doc { id: string; kind: string; kindLabel: string; number: string | null; title: string | null; status: string; totalTtc: number | null; issuedOn: string | null; building: string | null }

export default function Accueil() {
  const router = useRouter();
  const dash = usePortalData<Dashboard>('/api/portal/dashboard');
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [askPwd, setAskPwd] = useState(false);

  useFocusEffect(useCallback(() => {
    apiGet<{ items: Doc[] }>('/api/portal/documents').then((r) => setDocs(r.items)).catch(() => setDocs([]));
    AsyncStorage.getItem(storageKey(PORTAL_PWD_PROMPT)).then((v) => setAskPwd(v === '1')).catch(() => {});
  }, []));

  const unpaid = (docs ?? []).filter((d) => isInvoiceKind(d.kind) && d.status !== 'paid');
  const d = dash.data;
  const go = (href: string) => router.push(href as never);

  return (
    <PortalScroll state={dash}>
      <ScreenHeader eyebrow="Espace client" title={d ? `Bonjour ${d.greeting.name}` : 'Bonjour'} description="Voici où en sont vos chantiers avec JJD Consult." />

      {askPwd && (
        <Card accent={T.gold}>
          <Text style={{ fontWeight: '800', fontSize: 16 }}>Choisissez un mot de passe</Text>
          <Muted>Choisissez un mot de passe pour vous connecter plus vite la prochaine fois.</Muted>
          <BigButton label="Choisir un mot de passe" icon="lock" onPress={() => go('/espace/mot-de-passe')} />
          <Pressable accessibilityRole="button" style={{ paddingVertical: 10, alignItems: 'center' }}
            onPress={async () => { await AsyncStorage.removeItem(storageKey(PORTAL_PWD_PROMPT)); setAskPwd(false); }}>
            <Text style={{ color: T.ink2, fontWeight: '600' }}>Plus tard</Text>
          </Pressable>
        </Card>
      )}

      {d?.singleProject && (
        <Pressable onPress={() => go(`/espace/chantier/${d.singleProject!.id}`)}>
          <HeroTile>
            <Text style={{ color: '#cbded1', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>VOTRE CHANTIER</Text>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{d.singleProject.title}</Text>
            <Text style={{ color: '#cbded1' }}>{d.singleProject.statusLabel}{d.singleProject.building ? ` · ${d.singleProject.building}` : ''}</Text>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)', marginTop: 8 }}>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: T.gold, width: `${Math.max(4, Math.min(100, d.singleProject.progressPct))}%` }} />
            </View>
            {d.singleProject.nextStep ? <Text style={{ color: '#fff', marginTop: 6 }}>Prochaine étape : {d.singleProject.nextStep}</Text> : null}
          </HeroTile>
        </Pressable>
      )}

      {d && (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable style={{ flex: 1 }} onPress={() => go('/chantiers')}>
            <Card><Text style={{ fontSize: 30, fontWeight: '800', color: T.primary }}>{d.kpis.interventionsActive}</Text><Muted>chantier(s) en cours</Muted></Card>
          </Pressable>
          {d.kpis.quotesToValidate != null && (
            <Pressable style={{ flex: 1 }} onPress={() => go('/devis')}>
              <Card accent={d.kpis.quotesToValidate > 0 ? T.gold : undefined}><Text style={{ fontSize: 30, fontWeight: '800', color: T.accent }}>{d.kpis.quotesToValidate}</Text><Muted>devis à valider</Muted></Card>
            </Pressable>
          )}
        </View>
      )}

      {d && d.quotesToValidate.length > 0 && (<>
        <SectionTitle>Devis à valider</SectionTitle>
        {d.quotesToValidate.map((q) => (
          <Pressable key={q.id} onPress={() => go('/devis')}>
            <Card>
              <Text style={{ fontWeight: '700' }}>{q.title || `Devis ${q.number}`}</Text>
              <Muted>{[q.number, q.building, dateBE(q.issuedOn)].filter(Boolean).join(' · ')}</Muted>
              <Badge tone="warn">À valider</Badge>
            </Card>
          </Pressable>
        ))}
      </>)}

      {unpaid.length > 0 && (<>
        <SectionTitle>Factures à payer</SectionTitle>
        {unpaid.slice(0, 5).map((f) => (
          <Pressable key={f.id} onPress={() => go('/documents')}>
            <Card>
              <Text style={{ fontWeight: '700' }}>Facture {f.number}</Text>
              <Muted>{[f.building, dateBE(f.issuedOn)].filter(Boolean).join(' · ')}</Muted>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Badge tone={DOC_TONE[f.status] ?? 'warn'}>{invoiceLabel(f.status)}</Badge>
                <Text style={{ fontWeight: '800' }}>{eur(f.totalTtc)}</Text>
              </View>
            </Card>
          </Pressable>
        ))}
      </>)}

      {d && d.recentInterventions.length > 0 && (<>
        <SectionTitle>Mes chantiers</SectionTitle>
        {d.recentInterventions.slice(0, 4).map((w) => (
          <Pressable key={w.id} onPress={() => go(`/espace/chantier/${w.id}`)}>
            <Card>
              <Text style={{ fontWeight: '700' }}>{w.title}</Text>
              <Muted>{[w.ref, w.building].filter(Boolean).join(' · ')}</Muted>
              <Badge tone="primary">{w.statusLabel}</Badge>
            </Card>
          </Pressable>
        ))}
      </>)}

      {d && d.weekPlanning.days.some((x) => x.items.length > 0) && (<>
        <SectionTitle>Cette semaine</SectionTitle>
        <Card>
          {d.weekPlanning.days.filter((x) => x.items.length > 0).map((day) => (
            <View key={day.date} style={{ gap: 2, paddingVertical: 4 }}>
              <Text style={{ fontWeight: '800', color: T.primary }}>{day.label} {day.date}</Text>
              {day.items.map((it, i) => <Muted key={i}>{it.time ? `${it.time} · ` : ''}{it.label}</Muted>)}
            </View>
          ))}
        </Card>
      </>)}

      {d && <BigButton label="Faire une nouvelle demande" icon="plus-circle" tone="ghost" onPress={() => go('/espace/demande')} />}
    </PortalScroll>
  );
}
