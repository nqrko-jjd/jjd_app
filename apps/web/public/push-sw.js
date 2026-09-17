// Service worker dédié aux notifications push (mentions @) — ne fait QUE ça, pas de
// mise en cache/offline. Nom de fichier distinct de "sw.js" pour rester repérable si un
// jour un vrai service worker PWA (cache offline) est ajouté à côté.

self.addEventListener('push', (event) => {
  let data = { title: 'JJD Consult', body: 'Nouveau message', url: '/app/messagerie' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* payload non-JSON, on garde le défaut */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url },
      tag: data.url, // regroupe les notifs d'un même fil au lieu d'empiler
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/app/messagerie';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});
