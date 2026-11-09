// Calculs purs (sans DOM ni stockage) : positions, rééquilibrage, plan d'épargne, historique.
// Repris de investir.py / app.py. Les dates sont des chaînes ISO « AAAA-MM-JJ ».

export const NOTE_PLAN = "Plan d'épargne";
export const NOTE_ACHAT = "Achat ponctuel";
export const MAX_LIGNES = 2;      // nombre max d'ETF achetés par versement ponctuel
export const HORIZON_PLAN = 3;    // mois : le plan vise les cibles à cet horizon, puis on le recalcule
export const PARTS_MIN_PLAN = 1.5;

const arrondi = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- dates ----------

export function isoLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const versDate = iso => { const [a, m, j] = iso.split("-").map(Number); return new Date(a, m - 1, j); };
export const ajouterJours = (iso, n) => { const d = versDate(iso); d.setDate(d.getDate() + n); return isoLocal(d); };
export const joursEntre = (a, b) => Math.round((versDate(b) - versDate(a)) / 864e5);

/** Jour d'exécution du plan pour un mois donné, reporté au lundi s'il tombe un samedi ou un dimanche. */
export function executionPlan(jour, annee, mois /* 1-12 */) {
  const fin = new Date(annee, mois, 0).getDate();
  const d = new Date(annee, mois - 1, Math.min(jour, fin));
  const js = d.getDay();                      // 0 = dimanche, 6 = samedi
  if (js === 6) d.setDate(d.getDate() + 2);
  if (js === 0) d.setDate(d.getDate() + 1);
  return isoLocal(d);
}

/** Exécutions du plan strictement après `debut` et jusqu'à `aujourdhui` inclus. */
export function executionsDepuis(debut, jour, aujourdhui) {
  const out = [];
  let [a, m] = debut.split("-").map(Number);
  while (`${a}-${String(m).padStart(2, "0")}` <= aujourdhui.slice(0, 7)) {
    const e = executionPlan(jour, a, m);
    if (e > debut && e <= aujourdhui) out.push(e);
    if (++m > 12) { m = 1; a++; }
  }
  return out;
}

// ---------- cours ----------

/** Clôtures d'un ETF triées : [[date, prix], ...] */
export const serie = closes => Object.entries(closes || {}).sort((x, y) => x[0].localeCompare(y[0]));

export function dernierCours(closes) {
  const s = serie(closes);
  return s.length ? { date: s[s.length - 1][0], prix: s[s.length - 1][1] } : null;
}

/** Clôture du jour ou, si marché fermé, de la séance suivante (comme le plan Trade Republic). */
export function coursAuOuApres(closes, iso) {
  const s = serie(closes).find(([d]) => d >= iso);
  return s ? { date: s[0], prix: s[1] } : null;
}

// ---------- positions ----------

/** Facteur à appliquer aux parts d'un achat pour les divisions survenues après lui. */
export function facteurDivision(divisions, isin, date) {
  return (divisions || []).filter(d => d.isin === isin && date < d.date).reduce((f, d) => f * d.ratio, 1);
}

export function positions(donnees, prix /* {isin: prix} */) {
  const lignes = donnees.etf.liste.map(e => {
    const siens = donnees.achats.filter(a => a.isin === e.isin);
    const parts = siens.reduce((s, a) => s + a.parts * facteurDivision(donnees.divisions, a.isin, a.date), 0);
    const cout = siens.reduce((s, a) => s + a.parts * a.prix, 0);
    const p = prix[e.isin] ?? null;
    const valeur = p == null ? null : parts * p;
    return { ...e, parts, cout, pru: parts ? cout / parts : null, prix: p, valeur,
             pv: valeur == null ? null : valeur - cout, pvPct: valeur == null || !cout ? null : valeur / cout - 1 };
  });
  const total = lignes.reduce((s, l) => s + (l.valeur || 0), 0);
  const renf = lignes.filter(l => l.cible > 0).reduce((s, l) => s + (l.valeur || 0), 0);
  for (const l of lignes) {
    l.poidsPEA = total ? (l.valeur || 0) / total : null;
    l.poids = l.cible > 0 && renf ? (l.valeur || 0) / renf : null;     // poids sur les seules lignes à cible > 0
    l.ecart = l.poids == null ? null : l.poids - l.cible;
  }
  return lignes;
}

export function resume(donnees, lignes) {
  const titres = lignes.reduce((s, l) => s + (l.valeur || 0), 0);
  const investi = lignes.reduce((s, l) => s + l.cout, 0);
  // « ajustement » = correction des liquidités (intérêts, écart constaté) : compte dans les liquidités, pas dans le total versé
  const verse = donnees.versements.filter(v => !estAjustement(v)).reduce((s, v) => s + v.montant, 0);
  const liquidites = arrondi(donnees.versements.reduce((s, v) => s + v.montant, 0) - investi);
  const dates = donnees.achats.map(a => a.date).sort();
  return {
    titres, investi, verse, liquidites, valeur: titres + liquidites,
    pv: titres - investi, pvPct: investi ? titres / investi - 1 : null,
    marge: (donnees.reglages.plafond || 150000) - verse,
    dernierAchat: dates[dates.length - 1] || null,
  };
}

// ---------- rééquilibrage ----------

/** Parts entières à acheter : on remplit d'abord les lignes les plus en retard sur leur cible (2 ETF max).
 *  lignes : [{isin, parts, prix, cible}]  → { achats: {isin: n}, reste } */
export function repartir(lignes, montant) {
  const valeur = Object.fromEntries(lignes.map(l => [l.isin, l.parts * l.prix]));
  const base = lignes.filter(l => l.cible > 0).reduce((s, l) => s + valeur[l.isin], 0) + montant;
  const manque = l => l.cible * base - valeur[l.isin];
  const retenues = lignes.filter(l => l.cible > 0 && l.prix > 0 && manque(l) > 0)
    .sort((a, b) => manque(b) - manque(a)).slice(0, MAX_LIGNES);
  const achats = Object.fromEntries(lignes.map(l => [l.isin, 0]));
  let reste = montant;
  for (;;) {
    const possibles = retenues.filter(l => l.prix <= reste + 1e-9 && manque(l) > 0);
    if (!possibles.length) break;
    const l = possibles.reduce((a, b) => (manque(b) > manque(a) ? b : a));
    achats[l.isin]++; valeur[l.isin] += l.prix; reste -= l.prix;
  }
  for (const l of [...retenues].sort((a, b) => a.prix - b.prix)) {   // reliquat sur la moins chère des lignes retenues
    while (l.prix <= reste + 1e-9) { achats[l.isin]++; valeur[l.isin] += l.prix; reste -= l.prix; }
  }
  return { achats, reste: arrondi(reste) };
}

/** Montant mensuel par ETF pour approcher les cibles dans HORIZON_PLAN mois (cours actuels).
 *  Au moins 1,5 part par mois par ligne retenue, montants arrondis à 5 €, total = montant mensuel. */
export function repartitionPlan(lignes, mensuel) {
  const valeur = Object.fromEntries(lignes.map(l => [l.isin, l.parts * l.prix]));
  const cibles = lignes.filter(l => l.cible > 0);
  if (!cibles.length || mensuel <= 0) return Object.fromEntries(lignes.map(l => [l.isin, 0]));
  const base = cibles.reduce((s, l) => s + valeur[l.isin], 0) + HORIZON_PLAN * mensuel;
  let manque = Object.fromEntries(cibles.map(l => [l.isin, Math.max(0, l.cible * base - valeur[l.isin])]));
  if (!Object.values(manque).some(v => v > 0)) manque = Object.fromEntries(cibles.map(l => [l.isin, l.cible]));
  const prix = Object.fromEntries(lignes.map(l => [l.isin, l.prix]));
  const retenues = Object.fromEntries(Object.entries(manque).filter(([, v]) => v > 0));
  let brut;
  for (;;) {
    const total = Object.values(retenues).reduce((a, b) => a + b, 0);
    brut = Object.fromEntries(Object.entries(retenues).map(([k, v]) => [k, mensuel * v / total]));
    const tropPetits = Object.keys(brut).filter(k => brut[k] < PARTS_MIN_PLAN * prix[k]);
    if (!tropPetits.length || Object.keys(retenues).length === 1) break;
    delete retenues[tropPetits.reduce((a, b) => (brut[b] < brut[a] ? b : a))];
  }
  const plan = Object.fromEntries(Object.entries(brut).map(([k, m]) => [k, 5 * Math.round(m / 5)]));
  const plusGros = Object.keys(plan).reduce((a, b) => (plan[b] > plan[a] ? b : a));
  plan[plusGros] = arrondi(plan[plusGros] + mensuel - Object.values(plan).reduce((a, b) => a + b, 0));
  return Object.fromEntries(lignes.map(l => [l.isin, plan[l.isin] || 0]));
}

/** Poids (sur les lignes à cible > 0) après ajout de parts. */
export function poidsApres(lignes, ajout) {
  const v = Object.fromEntries(lignes.map(l => [l.isin, (l.parts + (ajout[l.isin] || 0)) * l.prix]));
  const renf = lignes.filter(l => l.cible > 0).reduce((s, l) => s + v[l.isin], 0);
  return Object.fromEntries(lignes.map(l => [l.isin, l.cible > 0 && renf ? v[l.isin] / renf : null]));
}

// ---------- plan : préremplissage ----------

export function debutPlan(plan) {
  return [plan.dernier, plan.regle].filter(Boolean).sort().pop() || null;
}

/** Une ligne par ETF et par exécution du plan depuis la dernière exécution enregistrée.
 *  Parts = arrondi inférieur (montant / clôture du jour d'exécution ou de la séance suivante). */
export function preremplirPlan(plan, closes, aujourdhui) {
  const debut = debutPlan(plan) || ajouterJours(aujourdhui, -31);
  const executions = executionsDepuis(debut, plan.jour, aujourdhui);
  const lignes = [];
  for (const e of executions) {
    for (const [isin, montant] of Object.entries(plan.montants || {})) {
      if (!(montant > 0)) continue;
      const c = coursAuOuApres(closes[isin], e) || dernierCours(closes[isin]);
      lignes.push({ date: e, isin, prix: c ? c.prix : null, coursDu: c ? c.date : null,
                    parts: c ? Math.floor(montant / c.prix) : 0, note: NOTE_PLAN, verse: montant });
    }
  }
  return { debut, executions, lignes };
}

export const estAjustement = v => v.type === "ajustement";

/** Versé prérempli : montants du plan (une fois par exécution et par ETF)
 *  + pour les achats ponctuels, le virement prévu par le « montant à investir » (budget au-delà des liquidités)
 *    ou, sans budget, ce qui manque une fois les liquidités utilisées. */
export function verseAuto(ops, liquidites = 0, virement = null) {
  const plan = ops.filter(o => o.note === NOTE_PLAN).reduce((s, o) => s + (o.verse || 0), 0);
  const ponctuel = ops.filter(o => o.note !== NOTE_PLAN).reduce((s, o) => s + (o.parts || 0) * (o.prix || 0), 0);
  // budget fixé (« montant à investir ») : le virement est plafonné à ce budget ; sinon on verse juste ce qui manque
  return arrondi(plan + (virement != null ? virement : Math.max(0, ponctuel - Math.max(0, liquidites))));
}

/** Répartit le versé par date (pour la courbe « total versé ») : montants du plan à leur date d'exécution,
 *  le reste à la date du dernier achat ponctuel (ou du dernier achat). */
export function versementsParDate(ops, verse) {
  if (!ops.length) return [];
  const parDate = {};
  let plan = 0;
  for (const o of ops.filter(o => o.note === NOTE_PLAN)) { parDate[o.date] = (parDate[o.date] || 0) + (o.verse || 0); plan += o.verse || 0; }
  const ponctuels = ops.filter(o => o.note !== NOTE_PLAN).map(o => o.date).sort();
  const dateReste = ponctuels.pop() || ops.map(o => o.date).sort().pop();
  parDate[dateReste] = (parDate[dateReste] || 0) + verse - plan;
  return Object.keys(parDate).sort().map(d => ({ date: d, montant: arrondi(parDate[d]) })).filter(v => Math.abs(v.montant) >= 0.005);
}

// ---------- historique quotidien ----------

/** Valeur du PEA jour par jour à partir des achats, versements et clôtures (ajustées des divisions).
 *  → [{date, titres, investi, verse, liquidites, valeur, pv, pvPct, parEtf: {isin: valeur}, achete,
 *      indice, repli}]
 *  indice : performance des titres hors effet des versements (base 1 au premier achat) ;
 *  repli : écart de cet indice avec son plus haut (≤ 0). */
export function historique(donnees, closes) {
  const achats = [...donnees.achats].sort((a, b) => a.date.localeCompare(b.date));
  if (!achats.length) return [];
  const versements = [...donnees.versements].sort((a, b) => a.date.localeCompare(b.date));
  const isins = donnees.etf.liste.map(e => e.isin);
  const debut = [achats[0].date, versements[0]?.date].filter(Boolean).sort()[0];
  const jours = [...new Set(isins.flatMap(i => Object.keys(closes[i] || {})))].filter(d => d >= debut).sort();
  const parts = Object.fromEntries(isins.map(i => [i, 0]));
  const dernier = Object.fromEntries(isins.map(i => [i, null]));
  // cours connu juste avant le début (pour ne pas valoriser à 0 une ligne sans séance ce jour-là)
  for (const i of isins) {
    const avant = serie(closes[i]).filter(([d]) => d < debut).pop();
    if (avant) dernier[i] = avant[1];
  }
  let ia = 0, iv = 0, investi = 0, verse = 0, ajuste = 0, titresVeille = 0, indice = 1, plusHaut = 1;
  const out = [];
  for (const d of jours) {
    let achete = 0;
    while (ia < achats.length && achats[ia].date <= d) {
      const a = achats[ia++];
      parts[a.isin] = (parts[a.isin] || 0) + a.parts * facteurDivision(donnees.divisions, a.isin, a.date);
      investi += a.parts * a.prix;
      achete += a.parts * a.prix;
    }
    while (iv < versements.length && versements[iv].date <= d) {
      const v = versements[iv++];
      if (estAjustement(v)) ajuste += v.montant; else verse += v.montant;
    }
    let titres = 0;
    const parEtf = {};
    for (const i of isins) {
      const c = closes[i]?.[d];
      if (c != null) dernier[i] = c;
      parEtf[i] = parts[i] && dernier[i] != null ? parts[i] * dernier[i] : 0;
      titres += parEtf[i];
    }
    const base = titresVeille + achete;               // ce que valaient hier les titres + ce qui a été acheté
    if (base > 0) indice *= titres / base;
    plusHaut = Math.max(plusHaut, indice);
    titresVeille = titres;
    const liquidites = verse + ajuste - investi;
    out.push({ date: d, titres, investi, verse, liquidites, valeur: titres + liquidites,
               pv: titres - investi, pvPct: investi ? titres / investi - 1 : null,
               parEtf, achete, indice, repli: indice / plusHaut - 1 });
  }
  return out;
}

// ---------- projection ----------

/** Valeur future mois par mois avec un versement mensuel et un rendement annuel (capitalisation mensuelle).
 *  → [{mois, valeur, verse}] (mois 0 = aujourd'hui) */
export function projection(valeur, verse, mensuel, rendementAnnuel, mois = 120) {
  const r = (1 + rendementAnnuel) ** (1 / 12) - 1;
  const out = [{ mois: 0, valeur, verse }];
  for (let m = 1; m <= mois; m++) {
    valeur = valeur * (1 + r) + mensuel;
    verse += mensuel;
    out.push({ mois: m, valeur, verse });
  }
  return out;
}

/** Montant investi par mois, séparé plan d'épargne / achats ponctuels. → [{mois: "AAAA-MM", plan, ponctuel}] */
export function investiParMois(achats) {
  const m = {};
  for (const a of achats) {
    const k = a.date.slice(0, 7);
    m[k] ||= { mois: k, plan: 0, ponctuel: 0 };
    m[k][a.note === NOTE_PLAN ? "plan" : "ponctuel"] += a.parts * a.prix;
  }
  const cles = Object.keys(m).sort();
  if (!cles.length) return [];
  const out = [];
  let [an, mo] = cles[0].split("-").map(Number);
  const fin = cles[cles.length - 1];
  for (;;) {                                           // mois sans achat inclus (barre vide)
    const k = `${an}-${String(mo).padStart(2, "0")}`;
    out.push(m[k] || { mois: k, plan: 0, ponctuel: 0 });
    if (k >= fin) break;
    if (++mo > 12) { mo = 1; an++; }
  }
  return out;
}
