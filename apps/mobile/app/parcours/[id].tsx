import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, Switch, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from '@/lib/AppText';
import { apiGet } from '@/lib/api';
import { Loading, Muted } from '@/lib/ui';
import { T } from '@/lib/theme';
import { tr } from '@/lib/i18n';

interface Stop { type: 'stop'; from: string; to: string | null; minutes: number; lat: number; lng: number; label: string | null; worksite: string | null }
interface Trip { type: 'trip'; from: string; to: string; minutes: number; km: number; maxSpeed: number; avgSpeed: number; start: { lat: number; lng: number }; end: { lat: number; lng: number }; startPlace: string | null; endPlace: string | null }
type Seg = Stop | Trip;
interface Journey {
  date: string;
  summary: { km: number; driveMinutes: number; stopMinutes: number; maxSpeed: number; firstMoveAt: string | null; lastSignalAt: string | null };
  segments: Seg[];
  points: [number, number, number, number][];
}

const LONG_STOP_MIN = 60;
const hm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`);
const km1 = (n: number) => `${n.toFixed(1).replace('.', ',')} km`;
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayLabel = (d: Date) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return tr('Aujourd’hui');
  if (diff === 1) return tr('Hier');
  return d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
};

/** Carte + rejeu : lecteur (lecture, pause, vitesse, curseur) intégré à la page, alimenté par window.setDay(). */
const MAP_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
html,body,#m{height:100%;margin:0}body{font-family:-apple-system,Roboto,sans-serif}
#bar{position:absolute;left:8px;right:8px;bottom:8px;z-index:1000;background:rgba(255,255,255,.96);border-radius:14px;padding:8px 10px;box-shadow:0 2px 10px rgba(0,0,0,.25)}
#row1{display:flex;align-items:center;gap:10px}
#play{width:42px;height:42px;border-radius:21px;border:0;background:#124b3a;color:#fff;font-size:18px}
#slider{flex:1;min-width:0}
#info{font-size:13px;color:#173b31;font-weight:700;white-space:nowrap}
#row2{display:flex;gap:6px;margin-top:6px;align-items:center}
.sp{border:1px solid #cfd9d3;background:#fff;border-radius:999px;padding:5px 10px;font-size:12px;color:#173b31}
.sp.on{background:#124b3a;color:#fff;border-color:#124b3a}
#live{margin-left:auto;font-size:12px;color:#1f8f4e;font-weight:700}
.car{width:22px;height:22px;border-radius:50%;background:#124b3a;border:3px solid #fff;box-shadow:0 0 0 3px rgba(18,75,58,.35),0 1px 5px rgba(0,0,0,.5)}
.num{background:#a87529;color:#fff;border:2px solid #fff;border-radius:50%;width:24px;height:24px;text-align:center;font:700 12px/20px sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.4)}
.num.long{background:#c0392b}
</style></head>
<body><div id="m"></div>
<div id="bar"><div id="row1"><button id="play">▶</button><input id="slider" type="range" min="0" max="0" value="0"><span id="info">--:--</span></div>
<div id="row2"><button class="sp on" data-r="60">×1</button><button class="sp" data-r="300">×5</button><button class="sp" data-r="900">×15</button><span id="live"></span></div></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
var map=L.map('m',{zoomControl:false}).setView([50.84,4.35],10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var pts=[],all=null,done=null,car=null,stopsLayer=L.layerGroup().addTo(map),rate=60,vt=0,playing=false,last=0,live=false;
var slider=document.getElementById('slider'),info=document.getElementById('info'),btn=document.getElementById('play');
function pad(n){return n<10?'0'+n:''+n}
function clock(t){var d=new Date(t*1000);return pad(d.getHours())+':'+pad(d.getMinutes())}
function show(i,frac){
 if(!pts.length)return;i=Math.max(0,Math.min(pts.length-1,i));var a=pts[i],b=pts[Math.min(i+1,pts.length-1)];
 var lat=a[0]+(b[0]-a[0])*(frac||0),lng=a[1]+(b[1]-a[1])*(frac||0);
 if(car)car.setLatLng([lat,lng]);else car=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div class="car"></div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map);
 if(done)done.setLatLngs(pts.slice(0,i+1).map(function(p){return[p[0],p[1]]}).concat([[lat,lng]]));
 slider.value=i;info.textContent=clock(a[2]+(b[2]-a[2])*(frac||0))+' · '+Math.round(a[3])+' km/h';
 if(playing&&!map.getBounds().pad(-0.2).contains([lat,lng]))map.panTo([lat,lng],{animate:true});
}
function idxAt(t){var lo=0,hi=pts.length-1;while(lo<hi){var m=(lo+hi+1)>>1;if(pts[m][2]<=t)lo=m;else hi=m-1}return lo}
function frame(ts){
 if(!playing)return;var dt=(ts-last)/1000;last=ts;vt+=dt*rate;
 var end=pts[pts.length-1][2];if(vt>=end){vt=end;show(pts.length-1,0);stop();return}
 var i=idxAt(vt),a=pts[i],b=pts[Math.min(i+1,pts.length-1)],span=Math.max(1,b[2]-a[2]);show(i,Math.min(1,(vt-a[2])/span));requestAnimationFrame(frame)}
function play(){if(!pts.length)return;if(vt>=pts[pts.length-1][2]-1){vt=pts[0][2]}playing=true;btn.textContent='❚❚';last=performance.now();requestAnimationFrame(frame)}
function stop(){playing=false;btn.textContent='▶'}
btn.onclick=function(){playing?stop():play()};
slider.oninput=function(){stop();var i=+slider.value;vt=pts[i][2];show(i,0)};
Array.prototype.forEach.call(document.querySelectorAll('.sp'),function(b){b.onclick=function(){rate=+b.getAttribute('data-r');Array.prototype.forEach.call(document.querySelectorAll('.sp'),function(x){x.classList.remove('on')});b.classList.add('on')}});
window.setDay=function(d,keepView){
 stop();pts=d.points||[];if(all){map.removeLayer(all);all=null}if(done){map.removeLayer(done);done=null}stopsLayer.clearLayers();
 document.getElementById('live').textContent=d.live?'● En direct':'';live=!!d.live;
 if(!pts.length){info.textContent='Aucun point';slider.max=0;return}
 var ll=pts.map(function(p){return[p[0],p[1]]});
 all=L.polyline(ll,{color:'#9fb3a9',weight:5,opacity:.9}).addTo(map);done=L.polyline([],{color:'#124b3a',weight:5}).addTo(map);
 (d.stops||[]).forEach(function(s,i){L.marker([s.lat,s.lng],{icon:L.divIcon({className:'',html:'<div class="num'+(s.long?' long':'')+'">'+(i+1)+'</div>',iconSize:[24,24],iconAnchor:[12,12]})}).bindTooltip(s.label).addTo(stopsLayer)});
 L.circleMarker(ll[0],{radius:7,color:'#fff',weight:2,fillColor:'#1f8f4e',fillOpacity:1}).bindTooltip('Départ').addTo(stopsLayer);
 slider.max=pts.length-1;
 if(!keepView)map.fitBounds(all.getBounds(),{padding:[40,40],maxZoom:16});
 var i=live?pts.length-1:0;vt=pts[i][2];show(i,0);if(live&&!map.getBounds().contains(ll[ll.length-1]))map.panTo(ll[ll.length-1]);
};
window.focusAt=function(a,b,c,d){if(c!=null){map.fitBounds([[a,b],[c,d]],{padding:[50,50],maxZoom:16})}else{map.setView([a,b],17,{animate:true})}};
true;</script></body></html>`;

export default function Parcours() {
  const { id, label } = useLocalSearchParams<{ id: string; label?: string }>();
  const [date, setDate] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [data, setData] = useState<Journey | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  const web = useRef<WebView>(null);
  const isToday = key(date) === key(new Date());
  const firstLoad = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setData(null); setErr(null); }
    try { setData(await apiGet<Journey>(`/api/gps/vehicles/${id}/journey?date=${key(date)}`)); setErr(null); }
    catch (e) { if (!silent) setErr((e as Error).message); }
  }, [id, date]);
  useEffect(() => { firstLoad.current = true; void load(); }, [load]);
  useEffect(() => { if (!isToday) setLive(false); }, [isToday]);
  // suivi en direct : on relit les points toutes les 20 s et le point se déplace
  useEffect(() => {
    if (!live || !isToday) return;
    const t = setInterval(() => { void load(true); }, 20_000);
    return () => clearInterval(t);
  }, [live, isToday, load]);

  const stops = useMemo(() => (data?.segments ?? []).filter((s): s is Stop => s.type === 'stop'), [data]);
  useEffect(() => {
    if (!ready || !data) return;
    const payload = {
      points: data.points, live: live && isToday,
      stops: stops.map((s) => ({ lat: s.lat, lng: s.lng, long: s.minutes >= LONG_STOP_MIN, label: `${hm(s.from)} → ${s.to ? hm(s.to) : tr('maintenant')} · ${dur(s.minutes)}${s.label ? ` · ${s.label}` : ''}` })),
    };
    const keep = !firstLoad.current;
    firstLoad.current = false;
    web.current?.injectJavaScript(`window.setDay(${JSON.stringify(payload)}, ${keep});true;`);
  }, [data, ready, live, isToday, stops]);

  const shift = (n: number) => setDate((d) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; });
  let stopNo = 0;

  return (
    <View style={{ flex: 1, backgroundColor: T.paper }}>
      <Stack.Screen options={{ title: label ? String(label) : tr('Trajets du véhicule'), headerBackTitle: tr('Retour') }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} nestedScrollEnabled>
        <View style={s.dayRow}>
          <Pressable accessibilityRole="button" onPress={() => shift(-1)} hitSlop={10} style={s.arrow}><Feather name="chevron-left" size={22} color={T.primary} /></Pressable>
          <Text style={s.dayTxt}>{dayLabel(date)}</Text>
          <Pressable accessibilityRole="button" onPress={() => shift(1)} disabled={isToday} hitSlop={10} style={[s.arrow, isToday && { opacity: 0.25 }]}><Feather name="chevron-right" size={22} color={T.primary} /></Pressable>
        </View>

        {isToday && (
          <View style={s.liveRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: T.ink }}>{tr('Suivre en direct')}</Text>
              <Muted>{tr('La position se met à jour toute seule toutes les 20 secondes.')}</Muted>
            </View>
            <Switch value={live} onValueChange={setLive} trackColor={{ true: T.primary }} />
          </View>
        )}

        <View style={s.mapWrap}>
          {Platform.OS === 'web' ? <View style={s.mapFallback}><Muted>{tr('La carte est disponible dans l’appli mobile.')}</Muted></View> : (
            <WebView ref={web} originWhitelist={['*']} source={{ html: MAP_HTML, baseUrl: 'https://new.jjd-consult.be' }} javaScriptEnabled domStorageEnabled
              onLoadEnd={() => setReady(true)} style={{ flex: 1, backgroundColor: T.surface2 }} nestedScrollEnabled />
          )}
        </View>

        {!data && !err && <Loading />}
        {err && <Text style={{ color: T.crit, padding: 16 }}>{err}</Text>}

        {data && (
          <View style={{ padding: 16, gap: 14 }}>
            <View style={s.kpis}>
              <Kpi label={tr('Parcourus')} value={km1(data.summary.km)} />
              <Kpi label={tr('En route')} value={dur(data.summary.driveMinutes)} />
              <Kpi label={tr('À l’arrêt')} value={dur(data.summary.stopMinutes)} />
              <Kpi label={tr('Vitesse max')} value={`${data.summary.maxSpeed} km/h`} />
            </View>
            {data.summary.firstMoveAt && <Muted>{tr('Premier départ')} {hm(data.summary.firstMoveAt)}{data.summary.lastSignalAt ? ` · ${tr('dernier signal')} ${hm(data.summary.lastSignalAt)}` : ''}</Muted>}

            <Text style={s.section}>{tr('Déroulé de la journée')}</Text>
            {data.segments.length === 0 && <Muted>{tr('Aucun déplacement enregistré ce jour-là.')}</Muted>}
            {data.segments.map((seg, i) => {
              if (seg.type === 'stop') {
                stopNo++;
                const long = seg.minutes >= LONG_STOP_MIN;
                return (
                  <Pressable key={i} onPress={() => web.current?.injectJavaScript(`window.focusAt(${seg.lat}, ${seg.lng});true;`)} style={[s.card, long && { borderColor: T.accent }]}>
                    <View style={[s.num, long && { backgroundColor: T.crit }]}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{stopNo}</Text></View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.title}>{seg.worksite ? tr('Sur chantier') : tr('Arrêt')} · {dur(seg.minutes)}{long ? ` · ${tr('long arrêt')}` : ''}</Text>
                      <Text style={s.sub}>{hm(seg.from)} → {seg.to ? hm(seg.to) : tr('maintenant')}</Text>
                      <Text style={s.place}>{seg.label ?? `${seg.lat.toFixed(4)}, ${seg.lng.toFixed(4)}`}</Text>
                    </View>
                  </Pressable>
                );
              }
              return (
                <Pressable key={i} onPress={() => web.current?.injectJavaScript(`window.focusAt(${seg.start.lat}, ${seg.start.lng}, ${seg.end.lat}, ${seg.end.lng});true;`)} style={s.card}>
                  <View style={s.carIcon}><Feather name="navigation" size={14} color={T.primary} /></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.title}>{tr('Trajet')} · {km1(seg.km)} · {dur(seg.minutes)}</Text>
                    <Text style={s.sub}>{hm(seg.from)} → {hm(seg.to)} · {tr('moy.')} {seg.avgSpeed} km/h · {tr('max')} {seg.maxSpeed} km/h</Text>
                    {(seg.startPlace || seg.endPlace) && <Text style={s.place}>{seg.startPlace ?? '…'} → {seg.endPlace ?? '…'}</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.kpi}>
      <Muted>{label}</Muted>
      <Text style={{ fontWeight: '800', fontSize: 16, color: T.ink, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dayTxt: { fontWeight: '800', fontSize: 16, color: T.ink, textTransform: 'capitalize' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line },
  mapWrap: { height: 400, backgroundColor: T.surface2 },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: { flexGrow: 1, flexBasis: '45%', backgroundColor: T.surface2, borderRadius: 12, padding: 10 },
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', color: T.ink2, marginTop: 4 },
  card: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, padding: 12 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  carIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  title: { fontWeight: '800', color: T.ink, fontSize: 14.5 },
  sub: { color: T.ink2, fontSize: 13 },
  place: { color: T.ink, fontSize: 13.5, marginTop: 2 },
});
