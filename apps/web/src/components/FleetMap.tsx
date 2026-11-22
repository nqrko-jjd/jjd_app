'use client';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

export interface MapVehicle { id: string; label: string; lat: number; lng: number; seenAgo: string; speed: number | null; stale: boolean }
export interface MapStop { lat: number; lng: number; label: string }
export interface MapJourney { points: [number, number][]; stops: { lat: number; lng: number; long: boolean; label: string }[] }
export interface MapReplay { lat: number; lng: number; idx: number; playing: boolean }
export interface MapFocus { a: [number, number]; b: [number, number] | null; n: number }
export interface MapSite { id: string; label: string; lat: number; lng: number; vehicleIds: string[] }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Carte (fond OpenStreetMap) : véhicules suivis en pastille verte qui pulse (grise si la position est ancienne),
 * chantiers du jour en repère doré, trait pointillé véhicule → chantier. `focusId` recentre la carte sur un véhicule ou un chantier ;
 * `selectedId` met le véhicule en évidence, `track` dessine son parcours du jour, `stops` numérote ses arrêts, `focusPoint` envole la carte vers un point précis.
 */
export default function FleetMap({ vehicles, sites, focusId, selectedId, track, stops, focusPoint, journey, replay, focusBounds }: {
  vehicles: MapVehicle[]; sites: MapSite[]; focusId?: string | null; selectedId?: string | null; track?: [number, number][] | null; stops?: MapStop[] | null; focusPoint?: { lat: number; lng: number; n: number } | null;
  /** Journal des trajets : tracé gris clair du jour, départ et arrêts numérotés (rouges si long arrêt). */
  journey?: MapJourney | null;
  /** Rejeu : marqueur mobile ; le tracé déjà parcouru (points 0..idx) est redessiné en foncé. */
  replay?: MapReplay | null;
  /** Cadre la carte sur un point (zoom 17) ou sur un trajet (a puis b). */
  focusBounds?: MapFocus | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const fitted = useRef(false);
  const coords = useRef(new Map<string, [number, number]>());
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const jLayerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const doneRef = useRef<import('leaflet').Polyline | null>(null);
  const carRef = useRef<import('leaflet').Marker | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([50.85, 4.35], 11);
        L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
        jLayerRef.current = L.layerGroup().addTo(mapRef.current);
        leafletRef.current = L;
        setReady(true);
      }
      const layer = layerRef.current!;
      layer.clearLayers();
      coords.current.clear();
      const points: [number, number][] = [];
      const byId = new Map(vehicles.map((v) => [v.id, v]));
      for (const s of sites) {
        points.push([s.lat, s.lng]); coords.current.set(s.id, [s.lat, s.lng]);
        for (const id of s.vehicleIds) {
          const v = byId.get(id);
          if (v) L.polyline([[v.lat, v.lng], [s.lat, s.lng]], { color: '#173f34', weight: 2, dashArray: '2 7', opacity: 0.55, lineCap: 'round' }).addTo(layer);
        }
        L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'fm-wrap', html: `<div class="fm-site"><span class="fm-pin"></span><span class="fm-lbl">${esc(s.label)}</span></div>`, iconSize: [0, 0] }), zIndexOffset: 100 }).addTo(layer);
      }
      if (track && track.length > 1) L.polyline(track, { color: '#b8862b', weight: 3, opacity: 0.85, lineJoin: 'round' }).addTo(layer);
      (stops ?? []).forEach((s, i) => L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'fm-wrap', html: `<div class="fm-stop" title="${esc(s.label)}">${i + 1}</div>`, iconSize: [0, 0] }), zIndexOffset: 500 }).addTo(layer));
      for (const v of vehicles) {
        points.push([v.lat, v.lng]); coords.current.set(v.id, [v.lat, v.lng]);
        const sub = `${v.speed != null && v.speed > 2 ? `${Math.round(v.speed)} km/h · ` : ''}${v.seenAgo}`;
        L.marker([v.lat, v.lng], { icon: L.divIcon({ className: 'fm-wrap', html: `<div class="fm-veh${v.stale ? ' stale' : ''}${v.id === selectedId ? ' sel' : ''}"><span class="fm-dot"></span><span class="fm-lbl"><b>${esc(v.label)}</b><small>${esc(sub)}</small></span></div>`, iconSize: [0, 0] }), zIndexOffset: 1000 }).addTo(layer);
      }
      if (!fitted.current && points.length) { mapRef.current!.fitBounds(points, { padding: [60, 60], maxZoom: 15 }); fitted.current = true; }
    })();
    return () => { cancelled = true; };
  }, [vehicles, sites, track, stops, selectedId]);

  // journal : tracé du jour, départ, arrêts numérotés
  useEffect(() => {
    const L = leafletRef.current, layer = jLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers(); doneRef.current = null; carRef.current = null;
    if (!journey || journey.points.length === 0) return;
    L.polyline(journey.points, { color: '#9fb3a9', weight: 5, opacity: 0.9, lineJoin: 'round' }).addTo(layer);
    L.circleMarker(journey.points[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#1f8f4e', fillOpacity: 1 }).bindTooltip('Départ').addTo(layer);
    journey.stops.forEach((s, i) => L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'fm-wrap', html: `<div class="fm-stop${s.long ? ' gps-trip-long' : ''}">${i + 1}</div>`, iconSize: [0, 0] }), zIndexOffset: 600 }).bindTooltip(esc(s.label)).addTo(layer));
  }, [journey, ready]);

  // rejeu : tracé parcouru en foncé + marqueur mobile
  useEffect(() => {
    const L = leafletRef.current, layer = jLayerRef.current, map = mapRef.current;
    if (!ready || !L || !layer || !map || !journey || !replay) return;
    const done: [number, number][] = [...journey.points.slice(0, replay.idx + 1), [replay.lat, replay.lng]];
    if (doneRef.current) doneRef.current.setLatLngs(done);
    else doneRef.current = L.polyline(done, { color: '#124b3a', weight: 5, lineJoin: 'round' }).addTo(layer);
    if (carRef.current) carRef.current.setLatLng([replay.lat, replay.lng]);
    else carRef.current = L.marker([replay.lat, replay.lng], { icon: L.divIcon({ className: 'fm-wrap', html: '<div class="gps-trip-car"></div>', iconSize: [0, 0] }), zIndexOffset: 900, interactive: false }).addTo(layer);
    if (replay.playing && !map.getBounds().pad(-0.2).contains([replay.lat, replay.lng])) map.panTo([replay.lat, replay.lng], { animate: true });
  }, [journey, replay, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!focusBounds || !map) return;
    if (focusBounds.b) map.fitBounds([focusBounds.a, focusBounds.b], { padding: [50, 50], maxZoom: 16 });
    else map.flyTo(focusBounds.a, 17, { duration: 0.6 });
  }, [focusBounds]);

  useEffect(() => {
    const p = focusId ? coords.current.get(focusId) : null;
    if (p && mapRef.current) mapRef.current.flyTo(p, Math.max(mapRef.current.getZoom(), 15), { duration: 0.8 });
  }, [focusId]);

  useEffect(() => {
    if (focusPoint && mapRef.current) mapRef.current.flyTo([focusPoint.lat, focusPoint.lng], Math.max(mapRef.current.getZoom(), 16), { duration: 0.8 });
  }, [focusPoint]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; layerRef.current = null; jLayerRef.current = null; leafletRef.current = null; doneRef.current = null; carRef.current = null; fitted.current = false; setReady(false); }, []);

  return <div ref={el} className="fm-map" role="img" aria-label="Carte des véhicules et des chantiers du jour" translate="no" />;
}
