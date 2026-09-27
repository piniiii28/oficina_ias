// Service worker mínimo: permite instalar la app. No guarda nada en caché
// porque la oficina siempre corre en tu propio computador.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
