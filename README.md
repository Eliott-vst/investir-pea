# Investir PEA

Application web installable (PWA) pour suivre et rééquilibrer mon PEA Trade Republic.
Elle tourne sur téléphone et ordinateur, sans serveur ni compte. **Aucune donnée personnelle dans ce dépôt** :
positions, achats et stratégie restent dans le stockage local de chaque appareil.

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css` | interface (français, thème clair/sombre, mise en page téléphone) |
| `js/calculs.js` | calculs : positions, PRU, rééquilibrage (2 ETF max), plan d'épargne, historique quotidien |
| `js/cours.js` | clôtures Euronext (EUR, ajustées des divisions) et recherche de titres depuis `live.euronext.com` |
| `js/donnees.js` | stockage local, export JSON/CSV, import avec fusion |
| `js/graphiques.js` | graphiques SVG (aucune bibliothèque) |
| `js/fiches.js` | fiches d'identité et composition des ETF (données statiques, à mettre à jour tous les 6 mois) |
| `js/justetf.js` | lecture d'une page justETF copiée-collée pour remplir une fiche |
| `sw.js`, `manifest.webmanifest`, `icones/` | installation et fonctionnement hors ligne |
| `tests/` (non publié) | tests locaux des calculs sur mes données réelles |

## Tester en local

```bash
python -m http.server 8770 --directory pea
```

puis ouvrir http://localhost:8770.

## Mettre en ligne (GitHub Pages, gratuit)

1. Créer un dépôt **public** sur GitHub (par exemple `investir-pea`) et y pousser le contenu de ce dossier.
2. Dans le dépôt : *Settings → Pages → Build and deployment → Deploy from a branch*, branche `main`, dossier `/ (root)`.
3. L'application est servie à `https://<utilisateur>.github.io/investir-pea/`.

À chaque mise à jour du code, augmenter `VERSION` dans `sw.js` pour que les appareils récupèrent la nouvelle version.

## Installer

- **Android (Chrome)** : ouvrir l'adresse → menu ⋮ → *Installer l'application*.
- **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.
- **PC (Chrome / Edge)** : icône d'installation dans la barre d'adresse.

Installée, l'application garde ses données durablement (stockage persistant) et fonctionne hors ligne ;
seule l'actualisation des cours demande internet.

## Synchroniser téléphone ↔ PC

Onglet **Sauvegarde** : *Exporter (JSON)* sur un appareil, envoyer le fichier sur l'autre, puis
*Importer et fusionner*. Les achats et versements sont réunis par identifiant (pas de doublon, suppressions
reportées) ; pour les cibles et le plan, la modification la plus récente l'emporte.

## Données

- Achats enregistrés tels qu'exécutés (parts et prix réels). Les divisions de parts (BNKE 1→80 le 26/10/2026)
  sont appliquées au calcul : les parts antérieures sont multipliées, le coût total est inchangé.
- Total versé = somme des versements ; liquidités = total versé − montant investi.
- L'historique quotidien n'est pas stocké : il est recalculé à partir du journal et des clôtures Euronext.
