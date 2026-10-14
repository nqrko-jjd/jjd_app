'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

export interface MapVehicle { id: string; label: string; lat: number; lng: number; seenAgo: string; speed: number | null; stale: boolean }
export interface MapSite { id: string; label: string; lat: number; lng: number; vehicleIds: string[] }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Carte (fond CARTO / OpenStreetMap) : véhicules suivis en pastille verte qui pulse (grise si la position est ancienne),
 * chantiers du jour en repère doré, trait pointillé véhicule → chantier. `focusId` recentre la carte sur un véhicule ou un chantier.
 */
export default function FleetMap({ vehicles, sites, focusId }: { vehicles: MapVehicle[]; sites: MapSite[]; focusId?: string | null }) {
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
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap · © CARTO' }).addTo(mapRef.current);
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
      for (const v of vehicles) {
        points.push([v.lat, v.lng]); coords.current.set(v.id, [v.lat, v.lng]);
        const sub = `${v.speed != null && v.speed > 2 ? `${Math.round(v.speed)} km/h · ` : ''}${v.seenAgo}`;
        L.marker([v.lat, v.lng], { icon: L.divIcon({ className: 'fm-wrap', html: `<div class="fm-veh${v.stale ? ' stale' : ''}"><span class="fm-dot"></span><span class="fm-lbl"><b>${esc(v.label)}</b><small>${esc(sub)}</small></span></div>`, iconSize: [0, 0] }), zIndexOffset: 1000 }).addTo(layer);
      }
      if (!fitted.current && points.length) { mapRef.current!.fitBounds(points, { padding: [60, 60], maxZoom: 15 }); fitted.current = true; }
    })();
    return () => { cancelled = true; };
  }, [vehicles, sites]);

  useEffect(() => {
    const p = focusId ? coords.current.get(focusId) : null;
    if (p && mapRef.current) mapRef.current.flyTo(p, Math.max(mapRef.current.getZoom(), 15), { duration: 0.8 });
  }, [focusId]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; layerRef.current = null; fitted.current = false; }, []);

  return <div ref={el} className="fm-map" role="img" aria-label="Carte des véhicules et des chantiers du jour" translate="no" />;
}
