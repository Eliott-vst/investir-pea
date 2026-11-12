// Service worker : l'application fonctionne hors ligne (fichiers en cache).
// Les cours Euronext ne passent pas par ici (autre domaine) : ils sont gardés par l'application elle-même.
// Changer VERSION à chaque mise à jour de l'application pour que les appareils la récupèrent.
const VERSION = "investir-pea-1.7.0";
const FICHIERS = [
  "./", "index.html", "styles.css", "manifest.webmanifest", "polices/inter-latin.woff2",
  "js/app.js", "js/calculs.js", "js/donnees.js", "js/cours.js", "js/graphiques.js", "js/fiches.js", "js/justetf.js",
  "icones/icone-180.png", "icones/icone-192.png", "icones/icone-512.png", "icones/icone-masquable-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(cles => Promise.all(cles.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })   // toujours revalider : jamais un mélange d'anciens et de nouveaux fichiers
      .then(r => { if (r.ok) { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});
