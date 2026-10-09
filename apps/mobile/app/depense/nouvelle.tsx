import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, TextInput, Image, ActivityIndicator, Switch } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { apiGet, apiSend, apiUploadPhoto } from '@/lib/api';
import { Muted } from '@/lib/ui';
import { WorksitePick, type Ws } from '@/lib/WorksitePick';
import { T } from '@/lib/theme';
import { tr, dateLocale } from '@/lib/i18n';

interface Meta { categories: { code: string; label: string }[]; suppliers: { id: string; name: string }[] }
interface Extract { extraction: { supplierName?: string | null; contactId?: string | null; contactName?: string | null; issuedOn?: string | null; totalTtc?: number | null; totalHt?: number | null; vatRate?: number | null; docNumber?: string | null } | null; suggestedCategory: { code: string; label: string } | null; note?: string }

const dayStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return dayStr(d); };
const num = (s: string) => Number(s.replace(',', '.').replace(/[^\d.]/g, ''));
const r2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => n.toLocaleString(dateLocale(), { style: 'currency', currency: 'EUR' });

/** Nouvelle dépense à la volée : photo du ticket (lue automatiquement quand l'IA est disponible) ou saisie rapide au pouce. */
export default function NouvelleDepense() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [supplier, setSupplier] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const [date, setDate] = useState(daysAgo(0));
  const [ttc, setTtc] = useState('');
  const [vat, setVat] = useState(0.21);
  const [cat, setCat] = useState<string | null>(null);
  const [catQ, setCatQ] = useState('');
  const [ws, setWs] = useState<Ws | null>(null);
  const [paid, setPaid] = useState(true);
  const [docNumber, setDocNumber] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { apiGet<Meta>('/api/finance/expenses/meta').then(setMeta).catch(() => {}); }, []);

  async function pick(camera: boolean) {
    setErr(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr('Autorise l’accès à l’appareil photo ou aux photos pour continuer.'); return; }
    const r = camera ? await ImagePicker.launchCameraAsync({ quality: 0.6 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (r.canceled || !r.assets[0]) return;
    const uri = r.assets[0].uri;
    setPhoto(uri); setReading(true); setNote(null);
    try {
      const x = await apiUploadPhoto<Extract>('/api/finance/expenses/extract', uri);
      if (x.note) setNote(x.note);
      const e = x.extraction;
      if (e) {
        if (e.supplierName) setSupplier(e.contactName ?? e.supplierName);
        if (e.contactId) setContactId(e.contactId);
        if (e.issuedOn) setDate(e.issuedOn);
        if (e.totalTtc) setTtc(String(e.totalTtc).replace('.', ','));
        if (e.vatRate != null) setVat(e.vatRate);
        if (e.docNumber) setDocNumber(e.docNumber);
      }
      if (x.suggestedCategory) setCat(x.suggestedCategory.code);
    } catch { setNote('Lecture automatique indisponible : complète les champs à la main.'); } finally { setReading(false); }
  }

  const total = num(ttc);
  const ht = total > 0 ? r2(total / (1 + vat)) : 0;
  const suppliers = useMemo(() => { const s = supplier.trim().toLowerCase(); return !s || contactId ? [] : (meta?.suppliers ?? []).filter((x) => x.name.toLowerCase().includes(s)).slice(0, 4); }, [supplier, meta, contactId]);
  const cats = useMemo(() => { const s = catQ.trim().toLowerCase(); const all = meta?.categories ?? []; return (s ? all.filter((c) => c.label.toLowerCase().includes(s)) : all).slice(0, 8); }, [catQ, meta]);
  const catLabel = meta?.categories.find((c) => c.code === cat)?.label;
  const ok = total > 0 && supplier.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await apiSend<{ expense: { id: string } }>('/api/finance/expenses', 'POST', {
        date, ht, ttc: total, vatRate: vat, vatRecup: r2(total - ht), supplierName: supplier.trim(), contactId, docNumber: docNumber.trim() || null,
        categoryCode: cat, worksiteId: ws?.id ?? null, paymentStatus: paid ? 'Payé' : 'Non payé', notes: comment.trim() || null,
      }, false);
      if ('expense' in r && photo) { try { await apiUploadPhoto(`/api/finance/expenses/${r.expense.id}/pdf`, photo); } catch { /* la dépense est créée ; la photo pourra être rajoutée sur le site */ } }
      setDone(true);
    } catch (e) { setErr((e as Error).message || 'Enregistrement impossible'); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <View style={s.doneWrap}>
        <Stack.Screen options={{ title: tr('Dépense'), headerBackTitle: tr('Retour') }} />
        <View style={s.doneIc}><Feather name="check" size={40} color="#fff" /></View>
        <Text style={s.doneTitle}>Dépense enregistrée</Text>
        <Muted>{supplier} · {eur(total)}</Muted>
        <Pressable accessibilityRole="button" onPress={() => { setDone(false); setPhoto(null); setSupplier(''); setContactId(null); setTtc(''); setCat(null); setWs(null); setDocNumber(''); setComment(''); setDate(daysAgo(0)); setNote(null); }} style={s.go}><Feather name="camera" size={20} color="#fff" /><Text style={s.goTxt}>Scanner un autre ticket</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={s.ghost}><Text style={{ color: T.primary, fontWeight: '800', fontSize: 15 }}>Terminer</Text></Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ ...T.content, padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: tr('Nouvelle dépense'), headerBackTitle: tr('Retour') }} />

      {!photo ? (
        <View style={{ gap: 10 }}>
          <Pressable accessibilityRole="button" onPress={() => pick(true)} style={({ pressed }) => [s.hero, pressed && { transform: [{ scale: 0.98 }] }]}>
            <View style={s.heroIc}><Feather name="camera" size={30} color="#fff" /></View>
            <View style={{ flex: 1 }}><Text style={s.heroTitle}>Photographier un ticket</Text><Text style={s.heroSub}>Les montants sont lus pour toi, tu vérifies et tu enregistres.</Text></View>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => pick(false)} style={s.ghost}><Feather name="image" size={18} color={T.primary} /><Text style={{ color: T.primary, fontWeight: '800' }}>Choisir une photo existante</Text></Pressable>
          <Muted>Ou saisis la dépense directement ci-dessous.</Muted>
        </View>
      ) : (
        <View style={s.photoRow}>
          <Image source={{ uri: photo }} style={s.thumb} />
          <View style={{ flex: 1, gap: 4 }}>
            {reading ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator color={T.primary} /><Text style={{ color: T.ink, fontWeight: '700' }}>Lecture du ticket…</Text></View> : <Text style={{ color: T.ok, fontWeight: '800' }}>Ticket joint</Text>}
            {!!note && <Text style={{ color: T.ink2, fontSize: 12.5 }}>{note}</Text>}
            <Pressable accessibilityRole="button" onPress={() => setPhoto(null)}><Text style={{ color: T.primary, fontWeight: '700' }}>Changer de photo</Text></Pressable>
          </View>
        </View>
      )}

      <View style={s.card}>
        <Text style={s.lbl}>Fournisseur</Text>
        <TextInput value={supplier} onChangeText={(t) => { setSupplier(t); setContactId(null); }} placeholder={tr("Brico, station-service, quincaillerie…")} placeholderTextColor={T.ink3} style={s.input} />
        {suppliers.map((x) => <Pressable key={x.id} accessibilityRole="button" onPress={() => { setSupplier(x.name); setContactId(x.id); }} style={s.option}><Text style={{ color: T.ink }}>{x.name}</Text></Pressable>)}

        <Text style={s.lbl}>Montant TTC</Text>
        <View style={s.amountRow}><TextInput value={ttc} onChangeText={setTtc} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={T.ink3} style={s.amount} /><Text style={s.cur}>€</Text></View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[0.21, 0.12, 0.06, 0].map((v) => <Pressable key={v} accessibilityRole="button" onPress={() => setVat(v)} style={[s.chip, vat === v && s.chipOn]}><Text style={[s.chipTxt, vat === v && { color: '#fff' }]}>{Math.round(v * 100)} %</Text></Pressable>)}
        </View>
        {total > 0 && <Muted>HT {eur(ht)} · TVA {eur(r2(total - ht))}</Muted>}

        <Text style={s.lbl}>Date</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {([['Aujourd’hui', daysAgo(0)], ['Hier', daysAgo(1)], ['Avant-hier', daysAgo(2)]] as const).map(([l, d]) => <Pressable key={l} accessibilityRole="button" onPress={() => setDate(d)} style={[s.chip, date === d && s.chipOn]}><Text style={[s.chipTxt, date === d && { color: '#fff' }]}>{l}</Text></Pressable>)}
        </View>
        <TextInput value={date} onChangeText={setDate} placeholder="AAAA-MM-JJ" placeholderTextColor={T.ink3} style={s.input} />
      </View>

      <View style={s.card}>
        <Text style={s.lbl}>Catégorie</Text>
        {catLabel ? (
          <Pressable accessibilityRole="button" onPress={() => setCat(null)} style={s.picked}><Text style={{ flex: 1, color: T.ink, fontWeight: '700' }}>{catLabel}</Text><Feather name="x" size={18} color={T.ink2} /></Pressable>
        ) : (
          <>
            <TextInput value={catQ} onChangeText={setCatQ} placeholder={tr("Chercher une catégorie")} placeholderTextColor={T.ink3} style={s.input} />
            {cats.map((c) => <Pressable key={c.code} accessibilityRole="button" onPress={() => setCat(c.code)} style={s.option}><Text style={{ color: T.ink }}>{c.label}</Text></Pressable>)}
          </>
        )}
        <Text style={s.lbl}>Chantier (facultatif)</Text>
        <WorksitePick value={ws} onChange={setWs} />
        <View style={s.switchRow}><View style={{ flex: 1 }}><Text style={{ color: T.ink, fontWeight: '700' }}>Déjà payé</Text><Muted>Ticket de caisse, carte ou espèces</Muted></View><Switch value={paid} onValueChange={setPaid} trackColor={{ true: T.primary }} /></View>
        <TextInput value={docNumber} onChangeText={setDocNumber} placeholder={tr("N° du ticket ou de la facture (facultatif)")} placeholderTextColor={T.ink3} style={s.input} />
        <TextInput value={comment} onChangeText={setComment} placeholder={tr("Note (facultatif)")} placeholderTextColor={T.ink3} style={s.input} />
      </View>

      {err && <Text style={{ color: T.crit, fontWeight: '700' }}>{err}</Text>}
      <Pressable accessibilityRole="button" disabled={!ok || busy || reading} onPress={save} style={({ pressed }) => [s.go, (!ok || busy || reading) && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.98 }] }]}>
        <Feather name="check-circle" size={22} color="#fff" /><Text style={s.goTxt}>{busy ? 'Enregistrement…' : total > 0 ? `Enregistrer · ${eur(total)}` : 'Enregistrer la dépense'}</Text>
      </Pressable>
      {!ok && <Muted>Indique au moins le fournisseur et le montant.</Muted>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: T.primary, borderRadius: 24, padding: 20 },
  heroIc: { width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.78)', fontSize: 13, marginTop: 2 },
  ghost: { flexDirection: 'row', gap: 8, backgroundColor: T.primarySoft, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  photoRow: { flexDirection: 'row', gap: 14, backgroundColor: T.surface, borderRadius: 20, borderWidth: 1, borderColor: T.line, padding: 12, alignItems: 'center' },
  thumb: { width: 84, height: 112, borderRadius: 12, backgroundColor: T.surface2 },
  card: { backgroundColor: T.surface, borderRadius: 20, borderWidth: 1, borderColor: T.line, padding: 14, gap: 10 },
  lbl: { fontSize: 12, fontWeight: '800', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 },
  input: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, paddingHorizontal: 14, fontSize: 15.5, color: T.ink },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amount: { flex: 1, minWidth: 0, width: 0, height: 66, borderRadius: 18, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, paddingHorizontal: 16, fontSize: 32, fontWeight: '800', color: T.ink },
  cur: { fontSize: 28, fontWeight: '800', color: T.ink2 },
  chip: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 999, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line },
  chipOn: { backgroundColor: T.primary, borderColor: T.primary },
  chipTxt: { fontWeight: '700', color: T.ink },
  option: { padding: 13, borderRadius: 14, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: T.primarySoft, borderWidth: 1, borderColor: T.primary },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  go: { flexDirection: 'row', gap: 10, backgroundColor: T.primary, borderRadius: 20, paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  goTxt: { color: '#fff', fontWeight: '800', fontSize: 17 },
  doneWrap: { flex: 1, backgroundColor: T.paper, alignItems: 'stretch', justifyContent: 'center', padding: 24, gap: 14 },
  doneIc: { alignSelf: 'center', width: 84, height: 84, borderRadius: 42, backgroundColor: T.ok, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { textAlign: 'center', fontSize: 24, fontWeight: '800', color: T.ink },
});
