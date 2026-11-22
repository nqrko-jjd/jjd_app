import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, RefreshControl, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Text } from '@/lib/AppText';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Badge, Card, EmptyState, Loading, Muted } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface Vehicle {
  id: string; code: string | null; name: string | null; plate: string | null; brand: string | null; model: string | null;
  pajDeviceId: string | null; lastLat: number | null; lastLng: number | null; lastSeenAt: string | null; lastSpeed: number | null; lastBattery: number | null;
}
interface Data { pajConfigured: boolean; vehicles: Vehicle[] }
interface Day { km: number; firstMoveAt: string | null; stoppedSince: string | null; noMoveToday: boolean; track: [number, number][]; stops: { from: string; to: string | null; lat: number; lng: number }[] }
type VState = 'moving' | 'parked' | 'sleep';

const STALE_MS = 30 * 60_000;
const REFRESH_MS = 30_000;
const ROLES = ['admin', 'office', 'foreman'];
const STATE_LABEL: Record<VState, string> = { moving: 'En route', parked: 'À l’arrêt', sleep: 'Hors ligne' };
const STATE_COLOR: Record<VState, string> = { moving: '#1f8f4e', parked: '#a87529', sleep: '#87958d' };
const TONE: Record<VState, 'ok' | 'warn' | undefined> = { moving: 'ok', parked: 'warn', sleep: undefined };

const vState = (v: Vehicle, now: number): VState => {
  if (!v.lastSeenAt || now - new Date(v.lastSeenAt).getTime() > STALE_MS) return 'sleep';
  return v.lastSpeed != null && v.lastSpeed > 2 ? 'moving' : 'parked';
};
const hm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
const label = (v: Vehicle) => [v.code, v.name ?? [v.brand, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean).join(' · ') || tr('Véhicule');
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? tr('à l’instant') : m < 60 ? `${tr('il y a')} ${m} min` : m < 1440 ? `${tr('il y a')} ${Math.round(m / 60)} h` : `${tr('il y a')} ${Math.round(m / 1440)} j`;
};

/** Page Leaflet/OpenStreetMap : reçoit la liste des véhicules (window.setVehicles) et la sélection (window.focusVehicle). */
const MAP_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#m{height:100%;margin:0}.pin{width:22px;height:22px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)}.pin.sel{width:28px;height:28px;margin:-3px;box-shadow:0 0 0 4px rgba(18,75,58,.35),0 1px 5px rgba(0,0,0,.45)}.leaflet-container{font-family:sans-serif}</style></head>
<body><div id="m"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
var map=L.map('m',{zoomControl:true}).setView([50.84,4.35],10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var markers={},sel=null,fitted=false,last=[];
function icon(v){return L.divIcon({className:'',html:'<div class="pin'+(v.id===sel?' sel':'')+'" style="background:'+v.color+'"></div>',iconSize:[22,22],iconAnchor:[11,11]})}
window.setVehicles=function(list){last=list;var seen={};
 list.forEach(function(v){seen[v.id]=1;var m=markers[v.id];
  if(m){m.setLatLng([v.lat,v.lng]);m.setIcon(icon(v));}
  else{m=L.marker([v.lat,v.lng],{icon:icon(v)}).addTo(map);m.on('click',function(){window.ReactNativeWebView.postMessage(v.id)});markers[v.id]=m;}
  m.bindTooltip(v.label);});
 Object.keys(markers).forEach(function(id){if(!seen[id]){map.removeLayer(markers[id]);delete markers[id]}});
 if(!fitted&&list.length){fitted=true;var b=L.latLngBounds(list.map(function(v){return[v.lat,v.lng]}));map.fitBounds(b,{padding:[40,40],maxZoom:15});}};
window.focusVehicle=function(id){sel=id;last.forEach(function(v){if(markers[v.id])markers[v.id].setIcon(icon(v))});
 var v=last.filter(function(x){return x.id===id})[0];if(v)map.setView([v.lat,v.lng],Math.max(map.getZoom(),15),{animate:true});};
var trackLayer=null;
window.setTrack=function(track,stops){if(trackLayer){map.removeLayer(trackLayer);trackLayer=null}
 if(!track||track.length<2&&(!stops||!stops.length))return;trackLayer=L.layerGroup().addTo(map);
 if(track&&track.length>1){var pl=L.polyline(track,{color:'#124b3a',weight:4,opacity:.8}).addTo(trackLayer);map.fitBounds(pl.getBounds(),{padding:[40,40],maxZoom:16});
  L.circleMarker(track[0],{radius:6,color:'#fff',weight:2,fillColor:'#1f8f4e',fillOpacity:1}).bindTooltip('Départ').addTo(trackLayer);}
 (stops||[]).forEach(function(s,i){L.marker([s.lat,s.lng],{icon:L.divIcon({className:'',html:'<div style="background:#a87529;color:#fff;border:2px solid #fff;border-radius:50%;width:22px;height:22px;text-align:center;font:700 12px/18px sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.4)">'+(i+1)+'</div>',iconSize:[22,22],iconAnchor:[11,11]})}).bindTooltip(s.label).addTo(trackLayer)});};
window.fitAll=function(){if(last.length)map.fitBounds(L.latLngBounds(last.map(function(v){return[v.lat,v.lng]})),{padding:[40,40],maxZoom:15})};
true;</script></body></html>`;

export default function SuiviGps() {
  const router = useRouter();
  const { user } = useSession();
  const allowed = ROLES.includes(user?.role ?? '');
  const [data, setData] = useState<Data | null>(null);
  const [drivers, setDrivers] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const web = useRef<WebView>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [dayErr, setDayErr] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<Data>('/api/gps');
      setData(d); setErr(null); setNow(Date.now());
    } catch (e) { setErr((e as Error).message); }
  }, []);

  // conducteurs (facultatif : la liste des véhicules les connaît)
  useEffect(() => {
    if (!allowed) return;
    apiGet<{ items: { id: string; driver: string | null }[] }>('/api/vehicles')
      .then((r) => setDrivers(Object.fromEntries(r.items.filter((x) => x.driver).map((x) => [x.id, x.driver as string]))))
      .catch(() => {});
  }, [allowed]);

  // rafraîchissement automatique toutes les 30 s, seulement tant que l'écran est affiché
  useFocusEffect(useCallback(() => {
    if (!allowed) return;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, allowed]));

  const tracked = useMemo(
    () => (data?.vehicles ?? []).filter((v) => v.pajDeviceId && v.lastLat != null && v.lastLng != null && v.lastSeenAt),
    [data],
  );
  const untracked = (data?.vehicles ?? []).length - tracked.length;
  const mapVehicles = useMemo(
    () => tracked.map((v) => ({ id: v.id, label: label(v), lat: v.lastLat, lng: v.lastLng, color: STATE_COLOR[vState(v, now)] })),
    [tracked, now],
  );
  const selected = tracked.find((v) => v.id === sel) ?? null;

  const push = useCallback((js: string) => web.current?.injectJavaScript(`${js};true;`), []);
  useEffect(() => { if (mapReady) push(`window.setVehicles(${JSON.stringify(mapVehicles)})`); }, [mapVehicles, mapReady, push]);
  useEffect(() => { if (mapReady && sel) push(`window.focusVehicle(${JSON.stringify(sel)})`); }, [sel, mapReady, push]);

  // Journée du véhicule sélectionné : tracé, arrêts, kilomètres (lu à la demande chez le fournisseur GPS)
  useEffect(() => {
    setDay(null); setDayErr(false);
    if (!sel || !allowed) return;
    let off = false;
    apiGet<Day>(`/api/gps/vehicles/${sel}/day`).then((d) => { if (!off) setDay(d); }).catch(() => { if (!off) setDayErr(true); });
    return () => { off = true; };
  }, [sel, allowed]);
  useEffect(() => {
    if (!mapReady) return;
    const stops = (day?.stops ?? []).map((st) => ({ lat: st.lat, lng: st.lng, label: `${hm(st.from)} → ${st.to ? hm(st.to) : 'maintenant'}` }));
    push(`window.setTrack(${JSON.stringify(day?.track ?? [])}, ${JSON.stringify(stops)})`);
  }, [day, mapReady, push]);

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: T.paper, padding: 18 }}>
        <Stack.Screen options={{ title: tr('Suivi GPS'), headerBackTitle: tr('Retour') }} />
        <EmptyState title={tr('Accès réservé')} description={tr('Le suivi GPS est réservé au bureau et aux chefs de chantier.')} icon="lock" />
      </View>
    );
  }
  if (!data && !err) return <Loading />;

  const counts = tracked.reduce((a, v) => { a[vState(v, now)]++; return a; }, { moving: 0, parked: 0, sleep: 0 } as Record<VState, number>);

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <Stack.Screen options={{ title: tr('Suivi GPS'), headerBackTitle: tr('Retour') }} />
      <View style={s.mapWrap}>
        {Platform.OS === 'web' ? (
          <View style={s.mapFallback}><Muted>{tr('La carte est disponible dans l’appli mobile.')}</Muted></View>
        ) : (
          <WebView
            ref={web}
            originWhitelist={['*']}
            source={{ html: MAP_HTML, baseUrl: 'https://new.jjd-consult.be' }}
            javaScriptEnabled
            domStorageEnabled
            onLoadEnd={() => setMapReady(true)}
            onMessage={(e) => setSel(e.nativeEvent.data)}
            style={{ flex: 1, backgroundColor: T.surface2 }}
            nestedScrollEnabled
          />
        )}
        {tracked.length > 1 && (
          <Pressable accessibilityRole="button" accessibilityLabel={tr('Tout voir')} style={s.fit} onPress={() => { setSel(null); push('window.fitAll()'); }}>
            <Feather name="maximize" size={18} color={T.primary} />
          </Pressable>
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {err && <Card accent={T.crit}><Text style={{ color: T.crit, fontWeight: '600' }}>{err}</Text></Card>}
        {data && !data.pajConfigured && <Muted>{tr('Aucune source GPS n’est configurée sur le serveur.')}</Muted>}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['moving', 'parked', 'sleep'] as VState[]).map((k) => (
            <View key={k} style={s.chip}>
              <View style={[s.dot, { backgroundColor: STATE_COLOR[k] }]} />
              <Text style={s.chipText}>{counts[k]} {tr(STATE_LABEL[k]).toLowerCase()}</Text>
            </View>
          ))}
        </View>

        {selected && (
          <Card accent={T.primary}>
            <Text style={s.selTitle}>{label(selected)}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Badge tone={TONE[vState(selected, now)]}>{tr(STATE_LABEL[vState(selected, now)])}</Badge>
              <Muted>{tr('Vu')} {ago(selected.lastSeenAt!)}</Muted>
            </View>
            <Info icon="user" text={drivers[selected.id] ?? tr('Conducteur non renseigné')} />
            {selected.lastSpeed != null && <Info icon="activity" text={`${Math.round(selected.lastSpeed)} km/h`} />}
            {selected.lastBattery != null && <Info icon="battery" text={`${tr('Batterie du traceur')} ${Math.round(selected.lastBattery)} %`} />}
            {dayErr && <Muted>{tr('Journée indisponible pour le moment.')}</Muted>}
            {!day && !dayErr && <Muted>{tr('Chargement de la journée…')}</Muted>}
            {day && (
              <View style={{ gap: 8 }}>
                <Text style={s.section}>{tr('Aujourd’hui')}</Text>
                <Info icon="navigation" text={`${day.km.toFixed(1).replace('.', ',')} km ${tr('parcourus')}`} />
                {day.firstMoveAt && <Info icon="log-out" text={`${tr('Première sortie')} ${hm(day.firstMoveAt)}`} />}
                {day.noMoveToday && <Info icon="pause-circle" text={tr('Le véhicule n’a pas bougé aujourd’hui')} />}
                {day.stoppedSince && !day.noMoveToday && <Info icon="clock" text={`${tr('À l’arrêt depuis')} ${hm(day.stoppedSince)}`} />}
                {day.stops.length > 0 && <Text style={s.section}>{tr('Arrêts')}</Text>}
                {day.stops.map((st, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={s.stopNum}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{i + 1}</Text></View>
                    <Text style={{ color: T.ink, fontSize: 14 }}>{hm(st.from)} → {st.to ? hm(st.to) : tr('maintenant')}</Text>
                  </View>
                ))}
              </View>
            )}
            <Pressable accessibilityRole="button" style={s.cta} onPress={() => router.push({ pathname: '/parcours/[id]', params: { id: selected.id, label: label(selected) } } as never)}>
              <Feather name="play-circle" size={16} color="#fff" />
              <Text style={s.ctaText}>{tr('Trajets, arrêts et rejeu du parcours')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={[s.cta, { backgroundColor: T.surface2 }]} onPress={() => router.push(`/vehicule/${selected.id}` as never)}>
              <Text style={[s.ctaText, { color: T.primary }]}>{tr('Ouvrir la fiche du véhicule')}</Text>
              <Feather name="chevron-right" size={16} color={T.primary} />
            </Pressable>
          </Card>
        )}

        <Text style={s.section}>{tr('Véhicules suivis')}</Text>
        {tracked.length === 0 && <EmptyState title={tr('Aucune position')} description={tr('Aucun véhicule n’a encore envoyé de position.')} icon="map-pin" />}
        {tracked.map((v) => {
          const st = vState(v, now);
          return (
            <Pressable key={v.id} accessibilityRole="button" onPress={() => setSel(v.id)} style={[s.row, sel === v.id && { borderColor: T.primary, borderWidth: 1.5 }]}>
              <View style={[s.dotBig, { backgroundColor: STATE_COLOR[st] }]} />
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={s.rowTitle} numberOfLines={2}>{label(v)}</Text>
                <Muted numberOfLines={1}>
                  {tr(STATE_LABEL[st])}{st === 'moving' && v.lastSpeed != null ? ` · ${Math.round(v.lastSpeed)} km/h` : ''} · {ago(v.lastSeenAt!)}
                </Muted>
                {drivers[v.id] ? <Muted numberOfLines={1}>{drivers[v.id]}</Muted> : null}
              </View>
              <Feather name="crosshair" size={18} color={T.ink3} />
            </Pressable>
          );
        })}
        {untracked > 0 && <Muted>{untracked} {tr('véhicule(s) sans traceur ou sans position')}</Muted>}
      </ScrollView>
    </View>
  );
}

function Info({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Feather name={icon} size={15} color={T.ink2} />
      <Text style={{ color: T.ink, fontSize: 14, flex: 1 }}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  mapWrap: { height: 300, backgroundColor: T.surface2, borderBottomWidth: 1, borderBottomColor: T.line },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fit: { position: 'absolute', right: 12, bottom: 12, width: 44, height: 44, borderRadius: 14, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center', ...T.shadow, borderWidth: 1, borderColor: T.line },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { color: T.ink, fontSize: 13, fontWeight: '600' },
  stopNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotBig: { width: 14, height: 14, borderRadius: 7 },
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', color: T.ink2, marginTop: 4 },
  selTitle: { fontSize: 17, fontWeight: '800', color: T.ink, lineHeight: 24 },
  cta: { minHeight: 48, borderRadius: 14, backgroundColor: T.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  row: { ...T.shadow, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 18, padding: 16, gap: 14, flexDirection: 'row', alignItems: 'center', minHeight: 72 },
  rowTitle: { color: T.ink, fontSize: 15, fontWeight: '700', lineHeight: 21 },
});
