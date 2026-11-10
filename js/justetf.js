// Lecture d'une page justETF copiée-collée (Ctrl+A puis Ctrl+C sur la page du fonds) pour remplir une fiche.
// justETF n'autorise pas la lecture directe depuis une application web : le copier-coller est le seul moyen sans serveur.

const MOIS = { janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8,
  septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12 };

// libellés justETF → libellés communs à toutes les fiches (pour que l'allocation regroupe bien)
const LIBELLES = {
  "autre": "Autres", "autres": "Autres", "soins de santé": "Santé", "biens de consommation non cycliques": "Consommation non cyclique",
  "biens de consommation cycliques": "Consommation cyclique", "grande-bretagne": "Royaume-Uni", "services de télécommunications": "Télécommunications",
  "services aux collectivités": "Services publics", "matériaux de base": "Matériaux",
};
export const normaliserLibelle = n => LIBELLES[n.trim().toLowerCase()] || n.trim();

const nombre = s => parseFloat(s.replace(/\s/g, "").replace(",", "."));
const champ = (t, re) => { const m = re.exec(t); return m ? m[1].trim() : null; };

function dateFr(s) {
  if (!s) return null;
  let m = /(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i.exec(s);
  if (m && MOIS[m[2].toLowerCase()]) return `${m[3]}-${String(MOIS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Paires « Nom <tab/retour> 12,34% » d'un bloc de texte. */
function paires(bloc, normaliser = true) {
  const out = [];
  if (!bloc) return out;
  const re = /([^\n\t%]+?)\t?\s*\n\s*(-?\d[\d\s]*(?:,\d+)?)\s*%/g;
  let m;
  while ((m = re.exec(bloc))) {
    const nom = m[1].trim();
    if (!nom || /^(sur \d+|poids des)/i.test(nom)) continue;
    out.push([normaliser ? normaliserLibelle(nom) : nom, nombre(m[2])]);
  }
  return out;
}

function entre(t, debut, fins) {
  const i = t.indexOf(debut);
  if (i < 0) return null;
  const reste = t.slice(i + debut.length);
  const j = Math.min(...fins.map(f => { const k = reste.indexOf(f); return k < 0 ? Infinity : k; }));
  return isFinite(j) ? reste.slice(0, j) : reste.slice(0, 3000);
}

/** Texte de la page justETF → champs de fiche trouvés (les absents sont omis). */
export function lirePageJustETF(texte) {
  const t = texte.replace(/\r/g, "").replace(/ /g, " ");
  const f = {};
  const isin = champ(t, /ISIN\s+([A-Z]{2}[A-Z0-9]{9}\d)/);
  if (isin) f.isin = isin;
  const ter = champ(t, /\(TER\)\s*\n?\s*(\d+(?:,\d+)?)\s*%/) || champ(t, /\bTER\s*\n\s*(\d+(?:,\d+)?)\s*%/);
  if (ter) f.frais = nombre(ter);
  const taille = champ(t, /Taille du fonds\s*\n\s*EUR\s+([\d\s,]+)\s*M/);
  if (taille) f.encours = `${taille.trim()} M€`;
  const rep = champ(t, /Méthode de réplication\t([^\n]+)/);
  if (rep) f.replication = rep.replace("Swap non financé", "swap").replace("Réplication complète", "complète");
  const lancement = dateFr(champ(t, /Date de lancement[^\t\n]*\t([^\n]+)/) || champ(t, /Date de lancement\s*\n([^\n]+)/));
  if (lancement) f.creation = lancement;
  const dist = champ(t, /\nDistribution\t([^\n]+)/);
  if (dist) f.dividendes = dist;
  const dom = champ(t, /Domiciliation du fonds\t([^\n]+)/);
  if (dom) f.domicile = dom;
  const em = champ(t, /\nÉmetteur\t([^\n]+)/);
  if (em) f.emetteur = em.replace(/ ETF$/, "");
  const indice = champ(t, /\nIndice\t\s*\n?([^\n]+)/);
  if (indice) f.indice = indice.replace(/®/g, "");
  const pea = champ(t, /Éligible au PEA\t\s*(Oui|Non)/);
  if (pea) f.pea = pea === "Oui";
  const top = paires(entre(t, "Les 10 principales positions", ["\nPays\n", "\nSecteurs\n", "Afficher plus"]), false);
  if (top.length) f.top = top;
  const pays = paires(entre(t, "\nPays\n", ["\nSecteurs\n", "Afficher plus", "État :"]));
  if (pays.length) f.pays = pays;
  const secteurs = paires(entre(t, "\nSecteurs\n", ["Afficher plus", "État :", "\nPays\n"]));
  if (secteurs.length) f.secteurs = secteurs;
  const etat = dateFr(champ(t, /État\s*:\s*(\d{2}\/\d{2}\/\d{4})/));
  if (etat) f.au = etat;
  return f;
}
