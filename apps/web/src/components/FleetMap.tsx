'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

export interface MapVehicle { id: string; label: string; lat: number; lng: number; seenAgo: string; speed: number | null; stale: boolean }
export interface MapStop { lat: number; lng: number; label: string }
export interface MapSite { id: string; label: string; lat: number; lng: number; vehicleIds: string[] }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Carte (fond OpenStreetMap) : véhicules suivis en pastille verte qui pulse (grise si la position est ancienne),
 * chantiers du jour en repère doré, trait pointillé véhicule → chantier. `focusId` recentre la carte sur un véhicule ou un chantier ;
 * `selectedId` met le véhicule en évidence, `track` dessine son parcours du jour, `stops` numérote ses arrêts, `focusPoint` envole la carte vers un point précis.
 */
export default function FleetMap({ vehicles, sites, focusId, selectedId, track, stops, focusPoint }: {
  vehicles: MapVehicle[]; sites: MapSite[]; focusId?: string | null; selectedId?: string | null; track?: [number, number][] | null; stops?: MapStop[] | null; focusPoint?: { lat: number; lng: number; n: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const fitted = useRef(false);
  const coords = useRef(new Map<string, [number, number]>());

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

  useEffect(() => {
    const p = focusId ? coords.current.get(focusId) : null;
    if (p && mapRef.current) mapRef.current.flyTo(p, Math.max(mapRef.current.getZoom(), 15), { duration: 0.8 });
  }, [focusId]);

  useEffect(() => {
    if (focusPoint && mapRef.current) mapRef.current.flyTo([focusPoint.lat, focusPoint.lng], Math.max(mapRef.current.getZoom(), 16), { duration: 0.8 });
  }, [focusPoint]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; layerRef.current = null; fitted.current = false; }, []);

  return <div ref={el} className="fm-map" role="img" aria-label="Carte des véhicules et des chantiers du jour" translate="no" />;
}
