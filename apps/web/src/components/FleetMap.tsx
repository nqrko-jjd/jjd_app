'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

export interface MapVehicle { id: string; label: string; lat: number; lng: number; seenAgo: string; speed: number | null; stale: boolean }
export interface MapSite { id: string; label: string; lat: number; lng: number; vehicleIds: string[] }

/** Carte (OpenStreetMap) : véhicules suivis en vert (grisés si la position est ancienne), chantiers du jour en or, trait pointillé véhicule → chantier. */
export default function FleetMap({ vehicles, sites }: { vehicles: MapVehicle[]; sites: MapSite[] }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(el.current, { zoomControl: true }).setView([50.85, 4.35], 11);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }
      const layer = layerRef.current!;
      layer.clearLayers();
      const points: [number, number][] = [];
      const byId = new Map(vehicles.map((v) => [v.id, v]));
      for (const s of sites) {
        points.push([s.lat, s.lng]);
        L.circleMarker([s.lat, s.lng], { radius: 8, color: '#8a6d1c', fillColor: '#d9b44a', fillOpacity: 0.9, weight: 2 }).bindTooltip(s.label, { direction: 'top' }).addTo(layer);
        for (const id of s.vehicleIds) {
          const v = byId.get(id);
          if (v) L.polyline([[v.lat, v.lng], [s.lat, s.lng]], { color: '#173f34', weight: 2, dashArray: '4 6', opacity: 0.6 }).addTo(layer);
        }
      }
      for (const v of vehicles) {
        points.push([v.lat, v.lng]);
        const color = v.stale ? '#8b8f8c' : '#173f34';
        L.circleMarker([v.lat, v.lng], { radius: 10, color: '#fff', fillColor: color, fillOpacity: 1, weight: 3 })
          .bindTooltip(`${v.label}${v.speed != null ? ` · ${Math.round(v.speed)} km/h` : ''} · ${v.seenAgo}`, { permanent: true, direction: 'right', offset: [10, 0] }).addTo(layer);
      }
      if (!fitted.current && points.length) { mapRef.current!.fitBounds(points, { padding: [40, 40], maxZoom: 15 }); fitted.current = true; }
    })();
    return () => { cancelled = true; };
  }, [vehicles, sites]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; layerRef.current = null; fitted.current = false; }, []);

  return <div ref={el} style={{ height: 'min(70vh, 560px)', width: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }} role="img" aria-label="Carte des véhicules et des chantiers du jour" translate="no" />;
}
