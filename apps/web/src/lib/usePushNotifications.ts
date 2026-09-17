'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Abonnement Web Push du navigateur courant (mentions @) — un simple bouton on/off, l'état
 *  vient directement de l'API PushManager du navigateur, pas d'un flag stocké côté app. */
export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setSupported(true);
    navigator.serviceWorker.register('/push-sw.js')
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEnabled(!!sub))
      .catch(() => {});
  }, []);

  async function enable() {
    if (busy || enabled) return;
    setBusy(true);
    try {
      const { configured, publicKey } = await api<{ configured: boolean; publicKey: string | null }>('/api/push/public-key');
      if (!configured || !publicKey) { alert('Les notifications ne sont pas encore activées côté serveur.'); return; }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      const reg = await navigator.serviceWorker.register('/push-sw.js');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
      await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
      setEnabled(true);
    } catch {
      alert('Impossible d’activer les notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (busy || !enabled) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }

  return { supported, enabled, busy, enable, disable };
}
