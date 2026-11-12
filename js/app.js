// Interface « Investir PEA » : état, rendu des écrans, actions.
import * as C from "./calculs.js";
import * as D from "./donnees.js";
import { actualiser as actualiserCours, provisoire, jourParis, rechercher, PLACES } from "./cours.js";
import { courbe, barres } from "./graphiques.js";
import { lirePageJustETF } from "./justetf.js";
import { FICHES } from "./fiches.js";

export const VERSION = "1.7.0";
// palette catégorielle validée (ordre fixe : la couleur suit la ligne, jamais son rang)
const COULEURS = ["var(--e1)", "var(--e2)", "var(--e3)", "var(--e4)", "var(--e5)", "var(--e6)", "var(--e7)", "var(--e8)"];
const CLE_BROUILLON = "investir-pea:brouillon";
const CLE_EXPORT = "investir-pea:dernier-export";

// ---------- utilitaires ----------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d) => v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (v, d = 2) => v == null || !isFinite(v) ? "—" : nf(v, d) + " €";
const eurS = (v, d = 0) => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d) + " €";
const pct = (v, signe = false, d = 1) => v == null || !isFinite(v) ? "—" : (signe && v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v) * 100, d) + " %";
const dFr = iso => iso ? iso.split("-").reverse().join("/") : "—";
const dCourt = iso => iso ? iso.slice(8) + "/" + iso.slice(5, 7) : "—";
const classeSigne = v => v == null ? "" : v >= 0 ? "pos" : "neg";
const aujourdhui = () => jourParis();
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const dLong = iso => iso ? `${+iso.slice(8)} ${MOIS[+iso.slice(5, 7) - 1]}` : "—";
const ico = nom => `<svg class="ico"><use href="#i-${nom}"/></svg>`;
const etatVide = (texte, icone = "plus") => `<div class="etat-vide">${ico(icone)}<span>${texte}</span></div>`;
const initiales = e => (e.ticker || e.court || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();

function toast(msg, erreur = false) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div"); t.className = "toast" + (erreur ? " erreur" : ""); t.textContent = msg;
  t.setAttribute("role", erreur ? "alert" : "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), erreur ? 7000 : 3500);
}
async function occupe(bouton, travail) {
  const t = bouton.textContent; bouton.disabled = true; bouton.textContent = "Patientez…";
  try { await travail(); } catch (e) { console.error(e); toast(e.message, true); } finally { bouton.disabled = false; bouton.textContent = t; }
}

// Fenêtres : feuilles qui montent du bas sur téléphone. Le bouton retour du téléphone les ferme.
let FEUILLES = [], RETOUR_IGNORE = 0;
function modale(html) {
  const v = document.createElement("div"); v.className = "voile";
  v.innerHTML = `<div class="modale" role="dialog" aria-modal="true"><div class="poignee"></div>${html}</div>`;
  document.body.appendChild(v);
  document.body.style.overflow = "hidden";
  const retirer = v.remove.bind(v);
  let ferme = false;
  v.fermer = (parRetour = false) => {
    if (ferme) return; ferme = true;
    FEUILLES = FEUILLES.filter(x => x !== v);
    if (!FEUILLES.length) document.body.style.overflow = "";
    v.classList.add("sortie"); setTimeout(retirer, 200);
    if (!parRetour && history.state?.feuille) { RETOUR_IGNORE++; history.back(); }
  };
  v.remove = () => v.fermer();
  FEUILLES.push(v);
  history.pushState({ ...(history.state || {}), feuille: FEUILLES.length }, "");
  v.addEventListener("click", e => { if (e.target === v) v.fermer(); });
  // glisser vers le bas pour fermer (depuis le haut de la feuille)
  const m = v.firstElementChild;
  let y0 = null, dy = 0;
  m.addEventListener("touchstart", e => { y0 = m.scrollTop <= 0 && !e.target.closest("input,textarea,select") ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  m.addEventListener("touchmove", e => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    m.style.transition = "none"; m.style.transform = dy ? `translateY(${dy}px)` : "";
  }, { passive: true });
  m.addEventListener("touchend", () => {
    if (y0 == null) return;
    m.style.transition = "transform .2s ease"; y0 = null;
    if (dy > 110) v.fermer(); else m.style.transform = "";
  });
  return v;
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && FEUILLES.length) FEUILLES[FEUILLES.length - 1].fermer(); });
function confirmer(titre, texte, libelleOk = "Confirmer", danger = false) {
  return new Promise(res => {
    const v = modale(`<h3>${titre}</h3><div class="texte">${texte}</div>
      <div class="pied"><button class="btn" data-r="0">Annuler</button><button class="btn ${danger ? "danger" : "primaire"}" data-r="1">${libelleOk}</button></div>`);
    v.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { v.remove(); res(b.dataset.r === "1"); });
  });
}

// ---------- état ----------
let DON = null;                       // données de l'utilisateur (persistées)
let COURS = D.chargerCours();         // cache des clôtures
let OPS = [];                         // achats en cours de saisie
let VERSE_MANUEL = null;              // montant versé saisi à la main (null = calcul auto)
let BUDGET = 0;                       // « montant à investir » (liquidités comprises) de la dernière proposition
let PERIODE = "max";
let VUE = { lignes: [], resume: null, hist: [] };

const etfs = () => DON.etf.liste;
const couleur = isin => COULEURS[Math.max(0, etfs().findIndex(e => e.isin === isin)) % COULEURS.length];
const nomEtf = isin => etfs().find(e => e.isin === isin)?.court || isin;
const ficheDe = isin => DON.fiches?.[isin] || FICHES[isin] || null;
const toutesFiches = () => Object.fromEntries(etfs().map(e => [e.isin, ficheDe(e.isin)]).filter(([, f]) => f));
const titresCours = () => etfs().map(e => ({ isin: e.isin, place: e.place || "XPAR" }));
const prixActuels = () => Object.fromEntries(etfs().map(e => [e.isin, C.dernierCours(COURS.closes[e.isin])?.prix ?? null]));

function sauver() { DON.modifie = D.maintenant(); D.enregistrer(DON); }
function sauverBrouillon() {
  try { localStorage.setItem(CLE_BROUILLON, JSON.stringify({ ops: OPS, verse: VERSE_MANUEL, budget: BUDGET })); } catch { /* plein */ }
}

function calculer() {
  VUE.lignes = C.positions(DON, prixActuels());
  VUE.resume = C.resume(DON, VUE.lignes);
  VUE.hist = C.historique(DON, COURS.closes);
}

function libelleCours() {
  const dates = etfs().map(e => C.dernierCours(COURS.closes[e.isin])?.date).filter(Boolean).sort();
  if (!dates.length) return "aucun cours";
  const d = dates[dates.length - 1];
  return provisoire(d) ? `séance du ${dFr(d)} en cours (provisoire)` : `clôture du ${dFr(d)}`;
}

// ---------- rendu ----------
function tout() {
  calculer();
  enTete(); accueil(); dessinerOps(); strategie(); journal(); sauvegarde();
  if (!panneau("graphiques").hidden) graphiques();
  if (!panneau("fiche").hidden && FICHE_ISIN) dessinerFiche();
}
const panneau = nom => document.querySelector(`[data-panneau="${nom}"]`);

function enTete() {
  const exp = localStorage.getItem(CLE_EXPORT);
  const b = $("bandeau");
  if (DON.achats.length && (!exp || (DON.modifie && DON.modifie > exp && C.joursEntre(exp.slice(0, 10), aujourdhui()) >= 30))) {
    b.hidden = ONGLET !== "accueil" || !panneau("fiche").hidden || !panneau("sauvegarde").hidden;
    b.innerHTML = `<span>${exp ? `Dernier export le ${dFr(exp.slice(0, 10))}` : "Aucun export depuis cet appareil"}</span>
      <button class="btn" id="bandeauExport">Exporter</button>`;
    $("bandeauExport").onclick = exporter;
  } else b.hidden = true;
}

let CHARGEMENT = false, PERIODE_MINI = 91;
const sansCours = () => VUE.lignes.some(l => l.parts > 0) && VUE.lignes.every(l => l.prix == null);
function accueil() {
  const r = VUE.resume;
  $("liqAchats").innerHTML = `<span class="${r.liquidites < -0.005 ? "neg" : ""}">${eur(r.liquidites)}</span>`;
  if (sansCours()) {   // premier lancement : cours pas encore reçus
    const sq = (l, h) => `<span class="sq" style="width:${l}px;height:${h}px"></span>`;
    $("kValeur").innerHTML = sq(180, 34); $("kJour").innerHTML = sq(140, 16);
    $("gMini").innerHTML = sq(2000, 170);
    $("kChiffres").innerHTML = "";
    $("posListe").innerHTML = VUE.lignes.filter(l => l.parts > 0).map(() => `<li><div class="ligne">${sq(40, 40)}<span class="ligne-t">${sq(120, 14)}${sq(80, 12)}</span><span class="ligne-v">${sq(80, 14)}${sq(50, 12)}</span></div></li>`).join("");
    if (!CHARGEMENT) $("kJour").textContent = "Cours indisponibles : touchez Actualiser.";
    return;
  }
  $("kValeur").textContent = eur(r.valeur);

  // variation de la dernière séance (hors achats du jour)
  const debutJour = C.debutPeriode("1j", VUE.hist);
  const fin = VUE.hist[VUE.hist.length - 1]?.date;
  if (debutJour && fin) {
    const t = C.variationsPeriode(DON, VUE.lignes, VUE.hist, debutJour).total;
    $("kJour").innerHTML = `<span class="${classeSigne(t.variation)}">${eurS(t.variation, 2)} (${pct(t.pct, true, 2)})</span>
      <span class="quand">${fin >= aujourdhui() ? "aujourd'hui" : "le " + dLong(fin)}</span>`;
  } else $("kJour").innerHTML = "&nbsp;";

  const liqNeg = r.liquidites < -0.005;
  $("kChiffres").innerHTML = `
    <div><span>Plus-value</span><b class="${classeSigne(r.pv)}">${eurS(r.pv)}</b><small class="${classeSigne(r.pv)}">${pct(r.pvPct, true)}</small></div>
    <div><span>Total versé</span><b>${eur(r.verse, 0)}</b><small class="info">investi ${eur(r.investi, 0)}</small></div>
    <button id="kLiq" aria-label="Liquidités : virement ou correction"><span>Liquidités ${ico("chevron")}</span><b class="${liqNeg ? "neg" : ""}">${eur(r.liquidites)}</b><small class="info">disponibles</small></button>`;
  $("kLiq").onclick = feuilleLiquidites;

  listePositions();
  courbeAccueil();
}

function courbeAccueil() {
  const h = PERIODE_MINI === "max" ? VUE.hist : VUE.hist.filter(p => p.date > C.ajouterJours(VUE.hist[VUE.hist.length - 1]?.date || aujourdhui(), -PERIODE_MINI));
  const perf = h.length ? h[h.length - 1].indice / h[0].indice - 1 : 0;
  const coul = perf >= 0 ? "var(--vert)" : "var(--rouge)";
  courbe($("gMini"), { dates: h.map(p => p.date), titre: "Valeur du PEA", hauteur: 180, epure: true,
    series: [{ nom: "Valeur du PEA", couleur: coul, valeurs: h.map(p => p.valeur), aire: true }],
    format: v => eur(v, 0),
    bulle: i => [["Valeur", eur(h[i].valeur, 0)], ["Performance", pct(h[i].indice / h[0].indice - 1, true, 2)]] });
}
document.querySelectorAll("[data-pmini]").forEach(b => b.onclick = () => {
  PERIODE_MINI = b.dataset.pmini === "max" ? "max" : +b.dataset.pmini;
  document.querySelectorAll("[data-pmini]").forEach(x => x.classList.toggle("actif", x === b));
  courbeAccueil();
});

// ---------- positions (liste de l'Accueil) ----------
let PERIODE_POS = "creation";
function listePositions() {
  const r = VUE.resume;
  const total = r.titres + Math.max(0, r.liquidites);
  const vp = C.variationsPeriode(DON, VUE.lignes, VUE.hist, C.debutPeriode(PERIODE_POS, VUE.hist));
  const lignes = VUE.lignes.filter(l => l.parts > 0).map(l => ({ ...l, part: total ? (l.valeur || 0) / total : 0, ...vp.lignes[l.isin] }))
    .sort((a, b) => (b.valeur || 0) - (a.valeur || 0));
  const gain = (v, p) => v == null ? "—" : `${eurS(v)} · ${pct(p, true)}`;
  $("posListe").innerHTML = lignes.map(l => `<li><button class="ligne" data-isin="${esc(l.isin)}">
      <span class="avatar" style="--c:${couleur(l.isin)}">${esc(initiales(l))}</span>
      <span class="ligne-t"><b>${esc(l.court)}</b><small>${nf(l.parts, 0)} parts · ${pct(l.part)}</small></span>
      <span class="ligne-v"><b>${eur(l.valeur)}</b><small class="${classeSigne(l.total)}">${gain(l.total, l.totalPct)}</small></span>
    </button></li>`).join("")
    + `<li><button class="ligne" id="posLiq">
      <span class="avatar" style="--c:var(--doux)">${ico("euro")}</span>
      <span class="ligne-t"><b>Liquidités</b><small>${pct(total ? Math.max(0, r.liquidites) / total : 0)}</small></span>
      <span class="ligne-v"><b class="${r.liquidites < -0.005 ? "neg" : ""}">${eur(r.liquidites)}</b></span>
    </button></li>`;
  $("posLiq").onclick = feuilleLiquidites;
}
$("fPeriodePos").onchange = () => { PERIODE_POS = $("fPeriodePos").value; listePositions(); };

// ---------- saisie des achats ----------
function prixDuJour(isin, date) {
  const closes = COURS.closes[isin] || {};
  if (closes[date] != null) return { prix: closes[date], libelle: provisoire(date) ? "cours provisoire" : `clôture ${dCourt(date)}` };
  const avant = C.serie(closes).filter(([d]) => d <= date).pop();
  if (avant) return { prix: avant[1], libelle: `clôture ${dCourt(avant[0])}` };
  return { prix: null, libelle: "cours introuvable" };
}

function ajouterLigne(o = {}) {
  const l = { date: o.date || aujourdhui(), isin: o.isin || etfs().find(e => e.cible > 0)?.isin || etfs()[0].isin,
              parts: o.parts || 0, prix: o.prix ?? null, libelle: o.libelle || "", note: o.note || C.NOTE_ACHAT, verse: o.verse, prop: !!o.prop };
  if (l.prix == null) Object.assign(l, prixDuJour(l.isin, l.date));
  OPS.push(l);
  return l;
}

function dessinerOps() {
  const max = aujourdhui();
  $("opsCorps").innerHTML = OPS.length ? OPS.map((o, i) => `<div class="op" data-i="${i}">
      <label class="c-date"><span class="lbl">Date</span><input type="date" value="${o.date}" max="${max}" data-k="date" aria-label="Date"></label>
      <label class="c-etf"><span class="lbl">ETF</span><select data-k="isin" aria-label="ETF">${etfs().map(e => `<option value="${e.isin}" ${e.isin === o.isin ? "selected" : ""}>${esc(e.court)}</option>`).join("")}</select></label>
      <label class="c-parts n"><span class="lbl">Parts</span><input type="number" min="0" step="1" inputmode="numeric" value="${o.parts}" data-k="parts" aria-label="Parts"></label>
      <label class="c-prix n"><span class="lbl">Prix (€)</span><input type="number" min="0" step="0.0001" inputmode="decimal" value="${o.prix ?? ""}" data-k="prix" aria-label="Prix"><span class="libelle">${esc(o.libelle)}</span></label>
      <div class="c-montant n"><span class="lbl">Montant</span><span class="montant" data-montant>${eur((o.parts || 0) * (o.prix || 0))}</span></div>
      <div class="c-type"><span class="lbl">Type</span><button class="etiquette ${o.note === C.NOTE_PLAN ? "plan" : ""}" data-type title="Changer le type">${o.note === C.NOTE_PLAN ? "Plan" : "Ponctuel"}</button></div>
      <div class="c-sup"><button class="suppr" data-suppr title="Retirer cette ligne" aria-label="Retirer cette ligne">${ico("fermer")}</button></div>
    </div>`).join("")
    : etatVide("Aucun achat en cours. Ajoutez-en un ou demandez une proposition.");
  majTotaux();
  infoMontant();
}
const liqDispo = () => Math.max(0, VUE.resume.liquidites);
const virementPrevu = () => (BUDGET > 0 ? Math.max(0, BUDGET - liqDispo()) : null);
function infoMontant() {
  const m = parseFloat($("fMontant").value) || 0, liq = liqDispo();
  $("fMontant").placeholder = liq > 0.005 ? nf(liq, 2) : "";
  $("infoProposer").textContent = !m ? "Liquidités comprises"
    : m <= liq + 0.005 ? "Pris sur vos liquidités"
    : `Virement à faire : ${eur(m - liq)}`;
}
$("fMontant").addEventListener("input", infoMontant);

function majTotaux() {
  const auto = C.verseAuto(OPS, liqDispo(), virementPrevu());
  const verse = VERSE_MANUEL ?? auto;
  if (document.activeElement !== $("fVerse")) $("fVerse").value = OPS.length || VERSE_MANUEL != null ? verse.toFixed(2) : "";
  $("infoVerse").textContent = VERSE_MANUEL != null ? `Modifié à la main (auto : ${eur(auto)})` : OPS.length ? "Calculé automatiquement" : "";
  $("btnVerseAuto").hidden = VERSE_MANUEL == null;
  const dispo = verse + liqDispo();
  const investi = OPS.reduce((s, o) => s + (o.parts || 0) * (o.prix || 0), 0);
  const reste = dispo - investi;
  $("tDispo").textContent = eur(dispo); $("tInvesti").textContent = eur(investi);
  $("tReste").textContent = eur(reste); $("tReste").className = reste < -0.005 ? "neg" : "";
  const nb = OPS.filter(o => o.parts > 0).length;
  $("alerteOp").textContent = reste < -0.005 ? `Il manque ${eur(-reste)}.` : "";
  $("btnValider").textContent = nb ? `Valider ${nb} achat${nb > 1 ? "s" : ""}` : "Valider";
  $("btnValider").disabled = reste < -0.005 || !nb;
  sauverBrouillon();
}

$("opsCorps").addEventListener("input", ev => {
  const ligne = ev.target.closest(".op"), k = ev.target.dataset.k;
  if (!ligne || !["parts", "prix"].includes(k)) return;
  const o = OPS[ligne.dataset.i];
  if (k === "parts") o.parts = Math.max(0, parseInt(ev.target.value, 10) || 0);
  else { o.prix = parseFloat(ev.target.value) || null; o.libelle = "saisi à la main"; }
  ligne.querySelector("[data-montant]").textContent = eur((o.parts || 0) * (o.prix || 0));
  majTotaux();
});
$("opsCorps").addEventListener("change", ev => {
  const ligne = ev.target.closest(".op"), k = ev.target.dataset.k;
  if (!ligne || !["isin", "date"].includes(k)) return;
  const o = OPS[ligne.dataset.i];
  o[k] = ev.target.value;
  if (k === "date" && o.date > aujourdhui()) o.date = aujourdhui();
  Object.assign(o, prixDuJour(o.isin, o.date));
  dessinerOps();
});
$("opsCorps").addEventListener("click", ev => {
  const ligne = ev.target.closest(".op"); if (!ligne) return;
  const i = +ligne.dataset.i;
  if (ev.target.closest("[data-suppr]")) { OPS.splice(i, 1); dessinerOps(); }
  else if (ev.target.closest("[data-type]")) {
    const o = OPS[i];
    o.note = o.note === C.NOTE_PLAN ? C.NOTE_ACHAT : C.NOTE_PLAN;
    if (o.note === C.NOTE_PLAN && o.verse == null) o.verse = DON.plan.montants?.[o.isin] || (o.parts || 0) * (o.prix || 0);
    dessinerOps();
  }
});
$("btnAjouter").onclick = () => { ajouterLigne(); dessinerOps(); };
$("btnVider").onclick = () => { OPS = []; VERSE_MANUEL = null; BUDGET = 0; $("fMontant").value = ""; dessinerOps(); };
$("fVerse").addEventListener("input", () => { VERSE_MANUEL = parseFloat($("fVerse").value) || 0; majTotaux(); });
$("btnVerseAuto").onclick = () => { VERSE_MANUEL = null; majTotaux(); };


// « Montant à investir » = budget total, liquidités comprises (vide = toutes les liquidités).
// Une nouvelle proposition remplace la précédente ; les autres lignes saisies sont déduites du budget.
$("btnProposer").onclick = () => {
  const saisi = $("fMontant").value.trim();
  const montant = saisi ? parseFloat(saisi) || 0 : liqDispo();
  if (montant <= 0) return toast("Indiquez le montant à investir (ou ajoutez d'abord un virement).", true);
  OPS = OPS.filter(o => !o.prop);
  const autres = OPS.filter(o => o.note !== C.NOTE_PLAN).reduce((s, o) => s + (o.parts || 0) * (o.prix || 0), 0);
  const budget = montant - autres;
  BUDGET = montant; VERSE_MANUEL = null;
  if (budget <= 0) { dessinerOps(); return toast(`Les achats déjà saisis (${eur(autres)}) utilisent tout le montant.`, true); }
  const enCours = {};
  for (const o of OPS) enCours[o.isin] = (enCours[o.isin] || 0) + (o.parts || 0);
  const lignes = VUE.lignes.filter(l => l.prix).map(l => ({ isin: l.isin, parts: l.parts + (enCours[l.isin] || 0), prix: l.prix, cible: l.cible }));
  const r = C.repartir(lignes, budget);
  const achats = Object.entries(r.achats).filter(([, n]) => n > 0);
  if (!achats.length) { dessinerOps(); return toast("Montant trop faible pour acheter une part des lignes en retard."); }
  const t = aujourdhui();
  achats.forEach(([isin, n]) => ajouterLigne({ isin, parts: n, date: t, note: C.NOTE_ACHAT, prop: true, ...prixDuJour(isin, t) }));
  dessinerOps();
  const apres = C.poidsApres(lignes, r.achats);
  toast(`Proposition pour ${eur(montant)} · reste ${eur(r.reste)} · poids après : ${achats.map(([i]) => `${nomEtf(i)} ${pct(apres[i])}`).join(", ")}`);
};

$("btnValider").onclick = () => {
  const lignes = OPS.filter(o => o.parts > 0);
  if (!lignes.length) return toast("Ajoutez au moins un achat avec des parts.", true);
  if (lignes.some(o => !(o.prix > 0))) return toast("Il manque un prix.", true);
  if (lignes.some(o => o.date > aujourdhui())) return toast("Une date n'est pas encore arrivée.", true);
  const verse = VERSE_MANUEL ?? C.verseAuto(OPS, liqDispo(), virementPrevu());
  const investi = lignes.reduce((s, o) => s + o.parts * o.prix, 0);
  const liqAvant = VUE.resume.liquidites;
  const liqApres = liqAvant + verse - investi;
  if (liqApres < -0.005) return toast(`Vous ne pouvez pas investir plus que vos liquidités + le versé (il manque ${eur(-liqApres)}).`, true);
  const v = modale(`<h3>Enregistrer ${lignes.length} achat${lignes.length > 1 ? "s" : ""} ?</h3>
    <ul>${[...lignes].sort((a, b) => a.date.localeCompare(b.date)).map(o => `<li>${dFr(o.date)} · ${o.parts} × ${esc(nomEtf(o.isin))} à ${eur(o.prix, 4)} = <b>${eur(o.parts * o.prix)}</b> <span class="etiquette ${o.note === C.NOTE_PLAN ? "plan" : ""}">${o.note === C.NOTE_PLAN ? "Plan" : "Ponctuel"}</span></li>`).join("")}</ul>
    <dl class="totaux"><div><dt>Investi</dt><dd>${eur(investi)}</dd></div><div><dt>Versé</dt><dd>+${eur(verse)}</dd></div>
      <div><dt>Liquidités après</dt><dd class="${liqApres < -0.005 ? "neg" : ""}">${eur(liqApres)}</dd></div></dl>
    <div class="pied"><button class="btn" id="mAnnuler">Annuler</button><button class="btn primaire" id="mOk">Enregistrer</button></div>`);
  $("mAnnuler").onclick = () => v.remove();
  $("mOk").onclick = () => {
    const t = D.maintenant();
    for (const o of lignes) DON.achats.push({ id: D.nouvelId(), date: o.date, isin: o.isin, parts: o.parts, prix: o.prix, note: o.note, cree: t });
    for (const x of C.versementsParDate(lignes.concat(OPS.filter(o => !(o.parts > 0) && o.note === C.NOTE_PLAN)), verse)) {
      DON.versements.push({ id: D.nouvelId(), date: x.date, montant: x.montant, cree: t });
    }
    const plans = lignes.filter(o => o.note === C.NOTE_PLAN).map(o => o.date);
    if (plans.length) DON.plan = { ...DON.plan, dernier: [DON.plan.dernier, ...plans].filter(Boolean).sort().pop() };
    DON.achats.sort((a, b) => a.date.localeCompare(b.date));
    sauver();
    v.remove(); OPS = []; VERSE_MANUEL = null; BUDGET = 0; $("fMontant").value = "";
    tout();
    toast(`${lignes.length} achat${lignes.length > 1 ? "s" : ""} enregistré${lignes.length > 1 ? "s" : ""}`);
  };
};

// ---------- stratégie ----------
let CIBLES = {};
function strategie() {
  CIBLES = Object.fromEntries(etfs().map(e => [e.isin, Math.round(e.cible * 1000) / 10]));
  dessinerCibles();
  const pl = DON.plan, total = Object.values(pl.montants || {}).reduce((a, b) => a + b, 0);
  $("planInfo").textContent = total ? `${eur(total, 0)}/mois · le ${pl.jour}` : "";
  const age = pl.regle ? C.joursEntre(pl.regle, aujourdhui()) : null;
  $("planRappel").hidden = !(total && age != null && age >= 90);
  $("planRappel").textContent = `Répartition calculée il y a ${age} jours : à recalculer.`;
  $("planLignes").innerHTML = etfs().filter(e => (pl.montants?.[e.isin] || 0) > 0).map(e => {
    const prix = prixActuels()[e.isin];
    return `<div class="plan-ligne"><span class="avatar petit" style="--c:${couleur(e.isin)}">${esc(initiales(e))}</span>${esc(e.court)}
      <span class="m">${eur(pl.montants[e.isin], 0)}<small>${prix ? `≈ ${Math.floor(pl.montants[e.isin] / prix)} parts/mois` : ""}</small></span></div>`;
  }).join("") || etatVide("Aucun plan. Indiquez un montant puis recalculez.");
  if (!$("fMensuel").value) $("fMensuel").value = total || 500;
  $("fJour").innerHTML = Array.from({ length: 28 }, (_, i) => `<option ${i + 1 === pl.jour ? "selected" : ""}>${i + 1}</option>`).join("");
}
function dessinerCibles() {
  const valeurs = Object.fromEntries(VUE.lignes.map(l => [l.isin, l.valeur || 0]));
  const renf = etfs().filter(e => (CIBLES[e.isin] || 0) > 0).reduce((s, e) => s + valeurs[e.isin], 0);
  const total = Object.values(valeurs).reduce((a, b) => a + b, 0);
  $("ciblesCorps").innerHTML = etfs().map(e => {
    const c = CIBLES[e.isin] || 0, poids = c > 0 && renf ? valeurs[e.isin] / renf : null;
    const ecart = poids == null ? null : poids - c / 100;
    const retirable = !DON.achats.some(a => a.isin === e.isin);
    return `<tr><td><div class="etf"><span class="pastille" style="background:${couleur(e.isin)}"></span><button class="btn lien" data-fiche="${esc(e.isin)}">${esc(e.court)}</button>${retirable ? `<button class="suppr" data-retirer="${esc(e.isin)}" title="Retirer cette ligne (aucun achat)" aria-label="Retirer ${esc(e.court)}">${ico("fermer")}</button>` : ""}</div></td>
      <td class="n">${poids == null ? `<span class="info">${pct(total ? valeurs[e.isin] / total : null)}</span>` : pct(poids)}</td>
      <td class="n"><div class="cible-in"><input type="number" min="0" max="100" step="0.5" inputmode="decimal" value="${c}" data-cible="${e.isin}" aria-label="Cible ${esc(e.court)}"> %</div></td>
      <td class="n ${ecart == null ? "" : ecart < 0 ? "neg" : "pos"}">${ecart == null ? "—" : (ecart >= 0 ? "+" : "−") + nf(Math.abs(ecart * 100), 1) + " pt"}</td></tr>`;
  }).join("");
  majSomme();
}
function majSomme() {
  const s = Object.values(CIBLES).reduce((a, b) => a + (b || 0), 0);
  const change = etfs().some(e => Math.abs((CIBLES[e.isin] || 0) - e.cible * 100) > 0.001);
  const bon = Math.abs(s - 100) < 0.05;
  $("ciblesSomme").textContent = nf(s, 1) + " %";
  $("ciblesSomme").className = "somme " + (bon ? "pos" : "neg");
  $("btnCiblesOk").disabled = !change || !bon;
  $("ciblesNote").textContent = !bon ? `Le total doit faire 100 % (${s < 100 ? "il manque" : "il y a"} ${nf(Math.abs(100 - s), 1)} %${s < 100 ? "" : " de trop"}).`
    : change ? "Pensez ensuite à recalculer le plan." : "";
  $("btnCiblesOk").parentElement.hidden = !change;
}
$("ciblesCorps").addEventListener("input", ev => {
  if (!ev.target.dataset.cible) return;
  CIBLES[ev.target.dataset.cible] = Math.max(0, parseFloat(ev.target.value) || 0);
  majSomme();
});
$("ciblesCorps").addEventListener("change", dessinerCibles);
$("btnCiblesAnnuler").onclick = strategie;
$("btnCiblesOk").onclick = () => {
  DON.etf = { maj: D.maintenant(), liste: etfs().map(e => ({ ...e, cible: Math.round((CIBLES[e.isin] || 0) * 10) / 1000 })) };
  sauver(); tout();
  toast("Cibles enregistrées : recalculez le plan");
};
$("fJour").onchange = () => {
  DON.plan = { ...DON.plan, jour: +$("fJour").value, maj: D.maintenant() };
  sauver(); tout(); toast(`Jour d'exécution du plan : le ${DON.plan.jour} du mois.`);
};
$("btnRecalcul").onclick = () => {
  const mensuel = parseFloat($("fMensuel").value) || 0;
  if (mensuel <= 0) return toast("Indiquez le montant mensuel.", true);
  const lignes = VUE.lignes.filter(l => l.prix).map(l => ({ isin: l.isin, parts: l.parts, prix: l.prix, cible: l.cible }));
  if (lignes.length < etfs().length) return toast("Il manque des cours : actualisez-les d'abord.", true);
  const montants = C.repartitionPlan(lignes, mensuel);
  const parMois = Object.fromEntries(lignes.map(l => [l.isin, Math.floor(montants[l.isin] / l.prix)]));
  const projete = C.poidsApres(lignes, Object.fromEntries(Object.entries(parMois).map(([k, n]) => [k, C.HORIZON_PLAN * n])));
  const box = $("planProp"); box.hidden = false;
  box.innerHTML = `<b>Répartition conseillée · ${eur(mensuel, 0)}/mois</b>
    ${lignes.filter(l => l.cible > 0 || montants[l.isin] > 0).map(l => `<div class="plan-ligne"><span class="pastille" style="background:${couleur(l.isin)}"></span>${esc(nomEtf(l.isin))}
      <span class="m">${eur(montants[l.isin], 0)}<small>${pct(projete[l.isin])} dans ${C.HORIZON_PLAN} mois · cible ${pct(l.cible, false, 0)}</small></span></div>`).join("")}
    <div class="pied"><button class="btn" id="pAnnuler">Annuler</button><button class="btn primaire" id="pOk">Enregistrer ce plan</button></div>`;
  $("pAnnuler").onclick = () => { box.hidden = true; };
  $("pOk").onclick = () => {
    DON.plan = { ...DON.plan, montants: Object.fromEntries(Object.entries(montants).filter(([, v]) => v > 0)), regle: aujourdhui(), maj: D.maintenant() };
    sauver(); box.hidden = true; tout();
    toast("Plan enregistré : reportez-le dans Trade Republic");
  };
};

// ---------- liquidités ----------
function ajouterMouvement(m) {
  DON.versements.push({ id: D.nouvelId(), cree: D.maintenant(), ...m });
  DON.versements.sort((a, b) => a.date.localeCompare(b.date));
  sauver(); tout();
}
function feuilleLiquidites() {
  const r = VUE.resume;
  const v = modale(`<h3>Liquidités</h3>
    <div class="hero-v ${r.liquidites < -0.005 ? "neg" : ""}">${eur(r.liquidites)}</div>
    <div class="feuille-actions">
      <button class="btn primaire" data-a="virement">Ajouter un virement reçu</button>
      <button class="btn" data-a="corriger">Corriger le montant</button>
    </div>`);
  v.querySelector('[data-a="virement"]').onclick = () => { v.fermer(); setTimeout(modaleVirement, 220); };
  v.querySelector('[data-a="corriger"]').onclick = () => { v.fermer(); setTimeout(modaleCorriger, 220); };
}
function modaleVirement() {
  const v = modale(`<h3>Virement reçu</h3>
    <div class="texte">Ajouté au total versé et aux liquidités.</div>
    <div class="champs">
      <label>Montant (€) <input type="number" id="mvMontant" min="0" step="0.01" inputmode="decimal"></label>
      <label>Date <input type="date" id="mvDate" value="${aujourdhui()}" max="${aujourdhui()}"></label>
    </div>
    <div class="pied"><button class="btn" data-annuler>Annuler</button><button class="btn primaire" data-ok>Enregistrer</button></div>`);
  v.querySelector("[data-annuler]").onclick = () => v.remove();
  v.querySelector("#mvMontant").focus();
  v.querySelector("[data-ok]").onclick = () => {
    const montant = parseFloat(v.querySelector("#mvMontant").value), date = v.querySelector("#mvDate").value;
    if (!(montant > 0) || !date) return toast("Indiquez la date et un montant positif.", true);
    v.remove();
    ajouterMouvement({ date, montant: Math.round(montant * 100) / 100, note: "Virement" });
    toast(`Virement de ${eur(montant)} enregistré`);
  };
}
function modaleCorriger() {
  const actuel = VUE.resume.liquidites;
  const v = modale(`<h3>Corriger les liquidités</h3>
    <div class="texte">Montant affiché dans Trade Republic. L'écart ne compte pas dans le total versé.</div>
    <div class="champs">
      <label>Liquidités réelles (€) <input type="number" id="mcMontant" min="0" step="0.01" inputmode="decimal" value="${Math.max(0, actuel).toFixed(2)}"></label>
      <div class="info" id="mcEcart"></div>
    </div>
    <div class="pied"><button class="btn" data-annuler>Annuler</button><button class="btn primaire" data-ok>Enregistrer</button></div>`);
  const champ = v.querySelector("#mcMontant");
  const ecart = () => (parseFloat(champ.value) || 0) - actuel;
  champ.oninput = () => { v.querySelector("#mcEcart").textContent = `Correction : ${eurS(ecart(), 2)}`; };
  champ.oninput(); champ.select();
  v.querySelector("[data-annuler]").onclick = () => v.remove();
  v.querySelector("[data-ok]").onclick = () => {
    const e = Math.round(ecart() * 100) / 100;
    if (!(parseFloat(champ.value) >= 0)) return toast("Indiquez un montant positif ou nul.", true);
    v.remove();
    if (Math.abs(e) < 0.005) return toast("Liquidités déjà à jour.");
    ajouterMouvement({ date: aujourdhui(), montant: e, type: "ajustement", note: "Correction des liquidités" });
    toast(`Liquidités corrigées : ${eur(VUE.resume.liquidites)}`);
  };
}
document.querySelectorAll("[data-virement]").forEach(b => b.onclick = modaleVirement);
document.querySelectorAll("[data-corriger]").forEach(b => b.onclick = modaleCorriger);

// ---------- journal ----------
function journal() {
  const filtre = $("jFiltre").value;
  const achats = [...DON.achats].reverse().filter(a => !filtre || a.note === filtre);
  const nPlan = DON.achats.filter(a => a.note === C.NOTE_PLAN).length;
  $("jInfo").textContent = `${DON.achats.length} achats · ${nPlan} au plan`;
  const etf = isin => etfs().find(e => e.isin === isin) || { court: isin };
  $("jCorps").innerHTML = achats.map(a => `<li><div class="ligne" data-id="${esc(a.id)}">
      <span class="avatar petit" style="--c:${couleur(a.isin)}">${esc(initiales(etf(a.isin)))}</span>
      <span class="ligne-t"><b>${esc(nomEtf(a.isin))}</b><small>${dLong(a.date)} ${a.date.slice(0, 4)} · <button class="etiquette ${a.note === C.NOTE_PLAN ? "plan" : ""}" data-type title="Changer le type">${a.note === C.NOTE_PLAN ? "Plan" : "Ponctuel"}</button></small></span>
      <span class="ligne-v"><b>${eur(a.parts * a.prix)}</b><small>${a.parts} × ${eur(a.prix, a.prix < 10 ? 4 : 2)}</small></span>
      <button class="suppr" data-suppr title="Supprimer cet achat" aria-label="Supprimer cet achat">${ico("fermer")}</button>
    </div></li>`).join("") || `<li>${etatVide("Aucun achat.")}</li>`;
  const vs = [...DON.versements].reverse();
  $("vInfo").textContent = `Total versé ${eur(VUE.resume.verse)} · plafond ${eur(DON.reglages.plafond || 150000, 0)}`;
  $("vCorps").innerHTML = vs.map(v => `<li><div class="ligne" data-id="${esc(v.id)}">
      <span class="avatar petit" style="--c:${C.estDividende(v) ? "var(--vert)" : C.horsVerse(v) ? "var(--doux)" : "var(--marine)"}">${ico("euro")}</span>
      <span class="ligne-t"><b>${esc(v.note || "Versement")}</b><small>${dLong(v.date)} ${v.date.slice(0, 4)}${C.horsVerse(v) ? " · hors total versé" : ""}</small></span>
      <span class="ligne-v"><b class="${v.montant < 0 ? "neg" : ""}">${eurS(v.montant, 2)}</b></span>
      <button class="suppr" data-suppr title="Supprimer ce mouvement" aria-label="Supprimer ce mouvement">${ico("fermer")}</button>
    </div></li>`).join("") || `<li>${etatVide("Aucun versement.", "euro")}</li>`;
}
$("jFiltre").onchange = journal;
document.querySelectorAll("[data-jvue]").forEach(b => b.onclick = () => {
  document.querySelectorAll("[data-jvue]").forEach(x => x.classList.toggle("actif", x === b));
  $("jAchats").hidden = b.dataset.jvue !== "achats"; $("jVersements").hidden = b.dataset.jvue !== "versements";
});
$("jCorps").addEventListener("click", async ev => {
  const tr = ev.target.closest("[data-id]"); if (!tr) return;
  const a = DON.achats.find(x => x.id === tr.dataset.id); if (!a) return;
  if (ev.target.closest("[data-type]")) {
    a.note = a.note === C.NOTE_PLAN ? C.NOTE_ACHAT : C.NOTE_PLAN; a.modifie = D.maintenant();
    sauver(); journal();
  } else if (ev.target.closest("[data-suppr]")) {
    if (!await confirmer("Supprimer cet achat ?", `${dFr(a.date)} · ${a.parts} × ${esc(nomEtf(a.isin))} = ${eur(a.parts * a.prix)}.<br>
      Le versement associé reste dans « Versements ».`, "Supprimer", true)) return;
    DON.achats = DON.achats.filter(x => x.id !== a.id); DON.supprimes.push(a.id);
    sauver(); tout(); toast("Achat supprimé.");
  }
});
$("vCorps").addEventListener("click", async ev => {
  const tr = ev.target.closest("[data-id]"); if (!tr || !ev.target.closest("[data-suppr]")) return;
  const v = DON.versements.find(x => x.id === tr.dataset.id); if (!v) return;
  if (!await confirmer("Supprimer ce mouvement ?", `${dFr(v.date)} · ${eur(v.montant)}.`, "Supprimer", true)) return;
  DON.versements = DON.versements.filter(x => x.id !== v.id); DON.supprimes.push(v.id);
  sauver(); tout(); toast("Versement supprimé.");
});

// ---------- graphiques ----------
let VUE_GRAPH = "evolution";
$("fMesurePerf").onchange = () => graphiques();
document.querySelectorAll("[data-vue]").forEach(b => b.onclick = () => {
  VUE_GRAPH = b.dataset.vue;
  document.querySelectorAll("[data-vue]").forEach(x => x.classList.toggle("actif", x === b));
  graphiques();
});
function graphiques() {
  $("vueEvolution").hidden = VUE_GRAPH !== "evolution";
  $("vueAllocation").hidden = VUE_GRAPH !== "allocation";
  if (VUE_GRAPH === "allocation") return allocationVue();
  let h = VUE.hist;
  const fin = h.length ? h[h.length - 1].date : aujourdhui();
  if (PERIODE === "ytd") h = h.filter(p => p.date >= fin.slice(0, 4) + "-01-01");
  else if (PERIODE !== "max") h = h.filter(p => p.date > C.ajouterJours(fin, -PERIODE));
  const dates = h.map(p => p.date);
  const k = v => Math.abs(v) >= 10000 ? nf(v / 1000, 0) + " k€" : Math.abs(v) >= 1000 ? nf(v / 1000, 1) + " k€" : nf(v, 0) + " €";

  // graphique de performance : variation relative (hors versements), performance absolue (€) ou plus-value / investi
  const der = h[h.length - 1], prem = h[0];
  const mesure = $("fMesurePerf").value;
  const axePct = v => nf(Math.round(v * 100) || 0, 0) + " %";
  if (h.length) {
    const serieP = mesure === "relative" ? h.map(p => p.indice / prem.indice - 1)
      : mesure === "absolue" ? h.map(p => p.pv - (PERIODE === "max" ? 0 : prem.pv)) : h.map(p => p.pvPct);
    const fmt = mesure === "absolue" ? v => eurS(v, 2) : v => pct(v, true, 2);
    const fin = serieP[serieP.length - 1];
    $("gPvInfo").innerHTML = `<span class="${classeSigne(fin)}">${fmt(fin)}</span>`;
    $("gPvNote").textContent = {
      relative: "Hors effet des versements, comme justETF.",
      absolue: "Valeur des titres moins le montant investi.",
      investi: "Plus-value rapportée au montant investi.",
    }[mesure];
    courbe($("gPv"), { dates, titre: "Graphique de performance", zero: true,
      series: [{ nom: "Performance", couleur: "var(--vert)", valeurs: serieP, signe: true }],
      format: fmt, formatAxe: mesure === "absolue" ? k : axePct,
      bulle: i => [["Performance", fmt(serieP[i]), serieP[i] >= 0 ? "var(--vert)" : "var(--rouge)"], ["Valeur du PEA", eur(h[i].valeur, 0)]] });
  } else $("gPv").innerHTML = "";

  $("gValInfo").textContent = "";
  courbe($("gVal"), { dates, titre: "Valeur du PEA et total versé",
    series: [{ nom: "Valeur du PEA", couleur: "var(--e1)", valeurs: h.map(p => p.valeur) },
             { nom: "Total versé", couleur: "var(--verse)", valeurs: h.map(p => p.verse), pointille: true }],
    format: v => eur(v, 0), formatAxe: k,
    bulle: i => [["Valeur du PEA", eur(h[i].valeur, 0), "var(--e1)"], ["Total versé", eur(h[i].verse, 0), "var(--verse)"], ["Écart", eurS(h[i].valeur - h[i].verse)]] });

  // performance comparée : chaque ETF et le PEA (hors versements), base 100 au début de la période
  const series = etfs().map(e => {
    let dernier = null, base = null;
    const valeurs = dates.map(d => {
      const c = COURS.closes[e.isin]?.[d];
      if (c != null) dernier = c;
      if (dernier == null) return null;
      base ??= dernier;
      return dernier / base * 100;
    });
    return { nom: e.court, couleur: couleur(e.isin), valeurs };
  });
  const base = prem?.indice;
  series.unshift({ nom: "Mon PEA", couleur: "var(--encre)", epaisseur: 2.5, valeurs: h.map(p => p.indice / base * 100) });
  courbe($("gPerf"), { dates, titre: "Performance comparée, base 100",
    series, format: v => (v >= 100 ? "+" : "−") + nf(Math.abs(v - 100), 1) + " %", formatAxe: v => nf(v, 0) });

  // repli depuis le plus haut (indice hors versements)
  const pire = h.reduce((a, p) => (p.repli < a.repli ? p : a), h[0] || { repli: 0 });
  $("gRepliInfo").textContent = h.length ? `pire ${pct(pire.repli, true)} le ${dLong(pire.date)}` : "";
  courbe($("gRepli"), { dates, titre: "Repli depuis le plus haut", zero: true, hauteur: 180,
    series: [{ nom: "Repli", couleur: "var(--rouge)", valeurs: h.map(p => p.repli), aire: true }],
    format: v => pct(v, true), formatAxe: v => nf(Math.round(v * 100) || 0, 0) + " %" });

  // répartition dans le temps (lignes à cible > 0) + cibles en pointillés
  const suivies = etfs().filter(e => e.cible > 0);
  const poids = h.map(p => {
    const t = suivies.reduce((s, e) => s + (p.parEtf[e.isin] || 0), 0);
    return Object.fromEntries(suivies.map(e => [e.isin, t ? (p.parEtf[e.isin] || 0) / t : null]));
  });
  courbe($("gRepart"), { dates, titre: "Répartition dans le temps",
    series: [...suivies.map(e => ({ nom: e.court, couleur: couleur(e.isin), valeurs: poids.map(p => p[e.isin]) })),
             ...suivies.map(e => ({ nom: `cible ${e.court}`, couleur: couleur(e.isin), valeurs: dates.map(() => e.cible), pointille: true, legende: false, epaisseur: 1.5, opacite: 0.7 }))],
    format: v => pct(v), formatAxe: v => nf(Math.round(v * 100) || 0, 0) + " %",
    bulle: i => suivies.map(e => [e.court, `${pct(poids[i][e.isin])} / ${pct(e.cible, false, 0)}`, couleur(e.isin)]) });

}


document.querySelectorAll("[data-periode]").forEach(b => b.onclick = () => {
  PERIODE = b.dataset.periode === "max" || b.dataset.periode === "ytd" ? b.dataset.periode : +b.dataset.periode;
  document.querySelectorAll("[data-periode]").forEach(x => x.classList.toggle("actif", x === b));
  graphiques();
});

// ---------- sauvegarde ----------
function sauvegarde() {
  const exp = localStorage.getItem(CLE_EXPORT);
  $("infoSauvegarde").textContent = `${DON.achats.length} achats · ${exp ? `dernier export le ${dFr(exp.slice(0, 10))}` : "jamais exporté"}`;
  $("fOuverture").value = DON.reglages.ouverture || "";
  if (DON.reglages.ouverture) {
    const [a, m, j] = DON.reglages.ouverture.split("-");
    $("infoOuverture").textContent = `5 ans le ${j}/${m}/${+a + 5}`;
  }
  $("infoCours").textContent = `Euronext · ${libelleCours()}`;
  $("infoDivisions").innerHTML = (DON.divisions || []).map(d => `${esc(nomEtf(d.isin))} : 1 → ${d.ratio} le ${dFr(d.date)}`).join("<br>") || "Aucune";
  $("fCoursEtf").innerHTML = etfs().map(e => `<option value="${e.isin}">${esc(e.court)}</option>`).join("");
  if (!$("fCoursDate").value) $("fCoursDate").value = aujourdhui();
  navigator.storage?.persisted?.().then(p => {
    $("infoApp").textContent = `Version ${VERSION} · stockage ${p ? "persistant" : "non garanti"}`;
  }).catch(() => { $("infoApp").textContent = `Version ${VERSION}.`; });
}
function exporter() {
  const t = D.maintenant();
  D.telecharger(`investir-pea_${aujourdhui()}.json`, D.exportJSON(DON), "application/json");
  localStorage.setItem(CLE_EXPORT, t);
  enTete(); sauvegarde();
  toast("Sauvegarde exportée");
}
$("btnExport").onclick = exporter;
$("btnExportCSV").onclick = () => D.telecharger(`journal-pea_${aujourdhui()}.csv`, D.exportCSV(DON), "text/csv;charset=utf-8");
let MODE_IMPORT = "fusion";
$("btnImport").onclick = () => { MODE_IMPORT = "fusion"; $("fFichier").click(); };
$("btnRemplacer").onclick = () => { MODE_IMPORT = "remplacer"; $("fFichier").click(); };
$("btnImportInitial").onclick = () => { MODE_IMPORT = DON ? "fusion" : "initial"; $("fFichier").click(); };
$("fFichier").onchange = async () => {
  const f = $("fFichier").files[0]; $("fFichier").value = "";
  if (!f) return;
  try {
    const autre = D.valider(JSON.parse(await f.text()));
    if (MODE_IMPORT === "initial") {
      DON = autre; delete DON.exporte; sauver(); demarrer();
      toast(`Sauvegarde importée ✓  ${DON.achats.length} achats.`);
    } else if (MODE_IMPORT === "remplacer") {
      if (!await confirmer("Remplacer toutes vos données ?", `Les ${DON.achats.length} achats de cet appareil seront remplacés par les ${autre.achats.length} du fichier « ${esc(f.name)} ». Exportez d'abord si vous avez un doute.`, "Remplacer", true)) return;
      DON = autre; delete DON.exporte; sauver(); tout();
      toast(`Données remplacées ✓  ${DON.achats.length} achats.`);
    } else {
      const { donnees, ajouts } = D.fusionner(DON, autre);
      DON = donnees; sauver(); tout();
      toast(`Fusion terminée ✓  ${ajouts.achats >= 0 ? "+" : ""}${ajouts.achats} achat(s), ${ajouts.versements >= 0 ? "+" : ""}${ajouts.versements} versement(s).`);
    }
  } catch (e) { toast(e instanceof SyntaxError ? "Fichier illisible (JSON invalide)." : e.message, true); }
};
$("fOuverture").onchange = () => {
  DON.reglages = { ...DON.reglages, ouverture: $("fOuverture").value || null, maj: D.maintenant() };
  sauver(); sauvegarde();
};
$("btnCoursManuel").onclick = () => {
  const isin = $("fCoursEtf").value, date = $("fCoursDate").value, prix = parseFloat($("fCoursPrix").value);
  if (!date || !(prix > 0)) return toast("Indiquez une date et un prix.", true);
  (COURS.closes[isin] ||= {})[date] = prix;
  D.enregistrerCours(COURS); $("fCoursPrix").value = "";
  tout(); toast(`Cours enregistré : ${nomEtf(isin)} ${eur(prix, 4)} le ${dFr(date)}.`);
};


// ---------- fiche d'un titre ----------
let FICHE_ISIN = null, PERIODE_FICHE = 365;
function ouvrirFiche(isin) {
  FICHE_ISIN = isin;
  pageSecondaire({ fiche: isin });
  ouvrirOnglet("fiche");
  dessinerFiche();
}
$("posListe").addEventListener("click", ev => { const b = ev.target.closest("[data-isin]"); if (b) ouvrirFiche(b.dataset.isin); });

const liste = (items, fmt = v => nf(v, 1) + " %") => barresHtml(items.map(([nom, v]) => ({ nom, valeur: v, texte: fmt(v) })));
function barresHtml(items, couleurBarre = "var(--e1)") {
  const div = document.createElement("div");
  barres(div, items.map(i => ({ ...i, couleur: i.couleur || couleurBarre })), { pastilles: false });
  return div.innerHTML;
}

function dessinerFiche() {
  const e = etfs().find(x => x.isin === FICHE_ISIN);
  if (!e) return ouvrirOnglet(ONGLET);
  const l = VUE.lignes.find(x => x.isin === e.isin) || {};
  const f = ficheDe(e.isin) || {};
  const st = C.statsCours(COURS.closes[e.isin]);
  const achats = DON.achats.filter(a => a.isin === e.isin);
  const divs = DON.versements.filter(v => C.estDividende(v) && v.isin === e.isin);
  const premier = achats[0]?.date;
  const varJour = st?.veille ? st.prix / st.veille - 1 : null;
  const perfAchat = premier && st ? (() => { const c = C.serie(COURS.closes[e.isin]).filter(([d]) => d <= premier).pop(); return c ? st.prix / c[1] - 1 : null; })() : null;
  const chiffre = (lib, val, cls = "") => `<div><span>${lib}</span><b class="${cls}">${val}</b></div>`;
  const perf = v => `<span class="${classeSigne(v)}">${pct(v, true)}</span>`;
  const coutAnnuel = f.frais != null && l.valeur ? l.valeur * f.frais / 100 : null;
  const dl = [["Émetteur", f.emetteur], ["Indice", f.indice], ["Frais", f.frais != null ? `${nf(f.frais, 2)} %${coutAnnuel != null ? ` · ${eur(coutAnnuel, 0)}/an` : ""}` : null],
    ["Encours", f.encours], ["Réplication", f.replication], ["Dividendes", f.dividendes],
    ...(e.place && e.place !== "XPAR" ? [["Cotation", `Euronext ${PLACES[e.place]}`]] : [])]
    .filter(([, v]) => v != null && v !== "");
  $("titrePage").textContent = e.court;
  $("ficheContenu").innerHTML = `
    <section class="carte">
      <div class="fiche-tete"><span class="avatar" style="--c:${couleur(e.isin)}">${esc(initiales(e))}</span>
        <div><h2>${esc(e.nom || e.court)}</h2><div class="sous">${esc(e.isin)} · ${esc(e.ticker || "")}</div></div>
      </div>
      <div class="fiche-prix"><b>${eur(st?.prix, st?.prix < 10 ? 4 : 2)}</b><small>${st ? `${perf(varJour)} <span class="info">${st.date >= aujourdhui() ? "aujourd'hui" : "le " + dLong(st.date)}</span>` : "aucun cours"}</small></div>
      <div id="fGraphe"></div>
      <div class="puces" role="group" aria-label="Période du graphique">
        ${[[30, "1M"], [182, "6M"], [365, "1A"], ["max", "Max"]].map(([v, t]) => `<button data-pfiche="${v}" class="${String(PERIODE_FICHE) === String(v) ? "actif" : ""}">${t}</button>`).join("")}
      </div>
      <div class="grille-chiffres">
        ${chiffre("1 mois", perf(st?.perf.m1))}${chiffre("6 mois", perf(st?.perf.m6))}${chiffre("1 an", perf(st?.perf.a1))}
        ${chiffre("Cette année", perf(st?.perf.ytd))}${chiffre("Volatilité 1 an", st?.volatilite == null ? "—" : pct(st.volatilite))}${chiffre("Depuis mon achat", perf(perfAchat))}
      </div>
    </section>
    <div class="grille">
      <section class="carte">
        <h2>Ma ligne</h2>
        <div class="grille-chiffres">
          ${chiffre("Valeur", eur(l.valeur, 0))}${chiffre("Plus-value", `${eurS(l.pv)}`, classeSigne(l.pv))}${chiffre("Rendement", pct(l.pvPct, true), classeSigne(l.pv))}
          ${chiffre("Parts", nf(l.parts || 0, 0))}${chiffre("PRU", l.pru == null ? "—" : nf(l.pru, l.pru < 10 ? 4 : 2) + " €")}
          ${chiffre(e.cible > 0 ? "Poids / cible" : "Poids", e.cible > 0 ? `${pct(l.poids)} / ${pct(e.cible, false, 0)}` : pct(l.poidsPEA))}
        </div>
        <details><summary>${achats.length} achat${achats.length > 1 ? "s" : ""}${divs.length ? ` · ${eur(divs.reduce((t, d) => t + d.montant, 0))} de dividendes` : ""}</summary>
          <table><tbody>${[...achats].reverse().map(a => `<tr><td>${dFr(a.date)}</td><td class="n">${a.parts} × ${eur(a.prix, a.prix < 10 ? 4 : 2)}</td><td class="n">${eur(a.parts * a.prix)}</td></tr>`).join("")}</tbody></table>
          <button class="btn lien ajouter" id="btnDividende">${ico("plus")}Dividende reçu</button>
        </details>
      </section>
      <section class="carte">
        <div class="titre-carte"><h2>Identité</h2><span class="aide">${f.au ? `au ${dFr(f.au)}` : "à compléter"}</span></div>
        <dl class="identite">${dl.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        ${f.note ? `<div class="note-graphe">${esc(f.note)}</div>` : ""}
        <div class="pied">${f.source ? `<a class="btn lien" href="${esc(f.source)}" target="_blank" rel="noopener">Source</a>` : ""}<button class="btn" id="btnModifierFiche">Modifier la fiche</button></div>
      </section>
    </div>
    ${f.top?.length || f.pays?.length || f.secteurs?.length ? `<div class="grille">
      ${f.top?.length ? `<section class="carte"><div class="titre-carte"><h2>Principales positions</h2><span class="aide">${nf(f.top.reduce((t, x) => t + x[1], 0), 1)} % du fonds</span></div>${liste(f.top)}</section>` : ""}
      ${f.pays?.length ? `<section class="carte"><h2>Pays</h2>${liste(f.pays)}</section>` : ""}
      ${f.secteurs?.length ? `<section class="carte"><h2>Secteurs</h2>${liste(f.secteurs)}</section>` : ""}
    </div>` : ""}`;
  // graphique du cours avec mon PRU
  const s = C.serie(COURS.closes[e.isin]);
  const fin = s.length ? s[s.length - 1][0] : aujourdhui();
  const vue = PERIODE_FICHE === "max" ? s : s.filter(([d]) => d > C.ajouterJours(fin, -PERIODE_FICHE));
  const parDate = {};
  for (const a of achats) parDate[a.date] = (parDate[a.date] || 0) + a.parts;
  courbe($("fGraphe"), { dates: vue.map(x => x[0]), titre: `Cours de ${e.court}`, hauteur: 200,
    series: [{ nom: "Cours", couleur: couleur(e.isin), valeurs: vue.map(x => x[1]), aire: true },
             ...(l.pru ? [{ nom: "Mon PRU", couleur: "var(--verse)", valeurs: vue.map(() => l.pru), pointille: true, epaisseur: 1.5 }] : [])],
    format: v => eur(v, v < 10 ? 4 : 2), formatAxe: v => nf(v, v < 10 ? 2 : 0),
    bulle: i => [["Cours", eur(vue[i][1], vue[i][1] < 10 ? 4 : 2), couleur(e.isin)], ...(l.pru ? [["Mon PRU", nf(l.pru, 4) + " €", "var(--verse)"]] : []),
                 ...(parDate[vue[i][0]] ? [["Mon achat", `${parDate[vue[i][0]]} part(s)`]] : [])] });
  document.querySelectorAll("[data-pfiche]").forEach(b => b.onclick = () => { PERIODE_FICHE = b.dataset.pfiche === "max" ? "max" : +b.dataset.pfiche; dessinerFiche(); });
  $("btnModifierFiche").onclick = () => modifierFiche(e.isin);
  $("btnDividende").onclick = () => modaleDividende(e);
}

function modaleDividende(e) {
  const v = modale(`<h3>Dividende reçu</h3>
    <div class="texte">${esc(e.court)} · montant net crédité. Ajouté aux liquidités, pas au total versé.</div>
    <div class="champs">
      <label>Montant (€) <input type="number" id="mdMontant" min="0" step="0.01" inputmode="decimal"></label>
      <label>Date <input type="date" id="mdDate" value="${aujourdhui()}" max="${aujourdhui()}"></label>
    </div>
    <div class="pied"><button class="btn" data-annuler>Annuler</button><button class="btn primaire" data-ok>Enregistrer</button></div>`);
  v.querySelector("[data-annuler]").onclick = () => v.remove();
  v.querySelector("#mdMontant").focus();
  v.querySelector("[data-ok]").onclick = () => {
    const montant = parseFloat(v.querySelector("#mdMontant").value), date = v.querySelector("#mdDate").value;
    if (!(montant > 0) || !date) return toast("Indiquez la date et un montant positif.", true);
    v.remove();
    ajouterMouvement({ date, montant: Math.round(montant * 100) / 100, type: "dividende", isin: e.isin, note: `Dividende ${e.court}` });
    toast(`Dividende de ${eur(montant)} enregistré`);
  };
}

const versTexte = l => (l || []).map(([n, v]) => `${n} ; ${String(v).replace(".", ",")}`).join("\n");
function depuisTexte(t) {
  const out = [];
  for (const ligne of t.split(/\r?\n/)) {
    const m = /^(.+?)[;\t]\s*(-?[\d\s]+(?:[.,]\d+)?)\s*%?\s*$/.exec(ligne.trim());
    if (m) out.push([m[1].trim(), parseFloat(m[2].replace(/\s/g, "").replace(",", "."))]);
    else if (ligne.trim()) throw new Error(`Ligne illisible : « ${ligne.trim()} » (format attendu : Nom ; 12,3)`);
  }
  return out;
}
function modifierFiche(isin) {
  const e = etfs().find(x => x.isin === isin), f = ficheDe(isin) || {};
  const champ = (id, lib, val, type = "text") => `<label>${lib}<input id="${id}" type="${type}" value="${esc(val ?? "")}"${type === "number" ? ' step="0.01" inputmode="decimal"' : ""}></label>`;
  const v = modale(`<h3>Fiche ${esc(e.court)}</h3>
    <details class="coller" ${f.au ? "" : "open"}>
      <summary>Remplir depuis justETF</summary>
      <ol class="texte">
        <li>Ouvrez <a href="https://www.justetf.com/fr/etf-profile.html?isin=${esc(isin)}" target="_blank" rel="noopener">sa page justETF</a>, copiez toute la page.</li>
        <li>Collez-la ci-dessous, puis « Lire la page ».</li>
      </ol>
      <textarea id="mfColle" placeholder="Collez ici le texte de la page justETF"></textarea>
      <div class="pied"><span class="note" id="mfColleInfo"></span><button class="btn primaire" data-lire>Lire la page</button></div>
    </details>
    <div class="champs">
      <div class="deux">${champ("mfCourt", "Nom court", e.court)}${champ("mfAu", "Données au", f.au, "date")}</div>
      ${champ("mfNom", "Nom complet", e.nom)}
      <div class="deux">${champ("mfEmetteur", "Émetteur", f.emetteur)}${champ("mfIndice", "Indice suivi", f.indice)}</div>
      <div class="deux">${champ("mfFrais", "Frais annuels (%)", f.frais, "number")}${champ("mfEncours", "Encours", f.encours)}</div>
      <div class="deux">${champ("mfReplication", "Réplication", f.replication)}${champ("mfCreation", "Création", f.creation, "date")}</div>
      <div class="deux">${champ("mfDomicile", "Domicile", f.domicile)}${champ("mfDividendes", "Dividendes", f.dividendes)}</div>
      <label>Éligible PEA <select id="mfPea"><option value="">?</option><option value="1" ${f.pea === true ? "selected" : ""}>Oui</option><option value="0" ${f.pea === false ? "selected" : ""}>Non</option></select></label>
      <label>10 premières positions<textarea id="mfTop">${esc(versTexte(f.top))}</textarea></label>
      <div class="deux"><label>Pays<textarea id="mfPays">${esc(versTexte(f.pays))}</textarea></label>
        <label>Secteurs<textarea id="mfSecteurs">${esc(versTexte(f.secteurs))}</textarea></label></div>
      <label>Note<input id="mfNote" value="${esc(f.note || "")}"></label>
      <label>Lien source<input id="mfSource" type="url" value="${esc(f.source || "")}"></label>
    </div>
    <div class="pied">${DON.fiches?.[isin] && FICHES[isin] ? `<button class="btn danger" data-origine>Fiche d'origine</button>` : ""}
      <button class="btn" data-annuler>Annuler</button><button class="btn primaire" data-ok>Enregistrer</button></div>`);
  const val = id => v.querySelector("#" + id).value.trim();
  v.querySelector("[data-annuler]").onclick = () => v.remove();
  v.querySelector("[data-lire]").onclick = () => {
    const lu = lirePageJustETF(v.querySelector("#mfColle").value);
    if (lu.isin && lu.isin !== isin) return toast(`Cette page concerne ${lu.isin}, pas ${isin}.`, true);
    const ecrire = (id, x) => { if (x != null && x !== "") v.querySelector("#" + id).value = x; };
    ecrire("mfAu", lu.au || aujourdhui()); ecrire("mfEmetteur", lu.emetteur); ecrire("mfIndice", lu.indice);
    ecrire("mfFrais", lu.frais); ecrire("mfEncours", lu.encours); ecrire("mfReplication", lu.replication);
    ecrire("mfCreation", lu.creation); ecrire("mfDomicile", lu.domicile); ecrire("mfDividendes", lu.dividendes);
    if (lu.pea != null) v.querySelector("#mfPea").value = lu.pea ? "1" : "0";
    if (lu.top) ecrire("mfTop", versTexte(lu.top));
    if (lu.pays) ecrire("mfPays", versTexte(lu.pays));
    if (lu.secteurs) ecrire("mfSecteurs", versTexte(lu.secteurs));
    if (lu.top || lu.pays || lu.secteurs) { ecrire("mfNote", lu.replication?.startsWith("Synth") ? "Composition de l'indice suivi (ETF synthétique), d'après justETF." : "D'après justETF."); }
    ecrire("mfSource", `https://www.justetf.com/fr/etf-profile.html?isin=${isin}`);
    const n = Object.keys(lu).filter(k => k !== "isin").length;
    v.querySelector("#mfColleInfo").textContent = !n ? "Rien de reconnu : avez-vous copié toute la page ?"
      : `${n} information(s) remplie(s)${lu.top || lu.pays ? "" : " · pas de composition sur cette page (justETF ne la publie pas pour ce fonds) : les listes actuelles sont gardées"}. Vérifiez puis « Enregistrer ».`;
  };
  v.querySelector("[data-origine]")?.addEventListener("click", () => {
    delete DON.fiches[isin]; sauver(); v.remove(); tout(); toast("Fiche d'origine rétablie.");
  });
  v.querySelector("[data-ok]").onclick = () => {
    try {
      const frais = val("mfFrais") === "" ? null : parseFloat(val("mfFrais").replace(",", "."));
      const nouvelle = { maj: D.maintenant(), au: val("mfAu") || null, emetteur: val("mfEmetteur"), indice: val("mfIndice"), frais,
        encours: val("mfEncours"), replication: val("mfReplication"), creation: val("mfCreation") || null, domicile: val("mfDomicile"),
        dividendes: val("mfDividendes"), pea: val("mfPea") === "" ? null : val("mfPea") === "1",
        top: depuisTexte(val("mfTop")), pays: depuisTexte(val("mfPays")), secteurs: depuisTexte(val("mfSecteurs")),
        note: val("mfNote"), source: val("mfSource") };
      DON.fiches = { ...(DON.fiches || {}), [isin]: nouvelle };
      if (val("mfCourt") && (val("mfCourt") !== e.court || val("mfNom") !== (e.nom || ""))) {
        DON.etf = { maj: D.maintenant(), liste: etfs().map(x => x.isin === isin ? { ...x, court: val("mfCourt"), nom: val("mfNom") } : x) };
      }
      sauver(); v.remove(); tout(); toast("Fiche enregistrée ✓");
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- ajouter / retirer une ligne ----------
$("btnAjouterLigne").onclick = () => {
  const v = modale(`<h3>Ajouter un titre</h3>
    <div class="texte">Recherche Euronext. Vérifiez vous-même l'éligibilité au PEA.</div>
    <div class="champ-ligne"><input id="mlRecherche" type="search" enterkeyhint="search" placeholder="ISIN, nom ou mnémonique" style="flex:1;min-width:0;font-size:16px">
      <button class="btn primaire" data-chercher>Rechercher</button></div>
    <div class="resultats" id="mlResultats"></div>`);
  const champ = v.querySelector("#mlRecherche"), zone = v.querySelector("#mlResultats");
  let resultats = [];
  const chercher = async () => {
    const q = champ.value.trim();
    if (q.length < 2) return;
    zone.innerHTML = Array.from({ length: 3 }, () => `<div class="resultat"><span class="sq" style="width:70%;height:16px"></span></div>`).join("");
    try {
      resultats = await rechercher(q);
      zone.innerHTML = resultats.length ? resultats.map((r, i) => `<button class="resultat" data-i="${i}">
          <div><b>${esc(r.nom)}</b><small>${esc(r.type)} · ${esc(r.isin)} · ${esc(r.ticker)} · Euronext ${esc(PLACES[r.place])}</small></div></button>`).join("")
        : `<div class="info">Aucun titre trouvé sur les places Euronext prises en charge.</div>`;
    } catch (e) { zone.innerHTML = `<div class="info neg">Recherche impossible : ${esc(e.message)}</div>`; }
  };
  v.querySelector("[data-chercher]").onclick = chercher;
  champ.addEventListener("keydown", ev => { if (ev.key === "Enter") chercher(); });
  champ.focus();
  zone.addEventListener("click", async ev => {
    const b = ev.target.closest(".resultat"); if (!b) return;
    const r = resultats[+b.dataset.i];
    if (etfs().some(x => x.isin === r.isin)) return toast(`${r.nom} est déjà dans vos lignes.`, true);
    const court = prompt("Nom court affiché dans l'application :", r.nom.length > 24 ? r.nom.slice(0, 24) : r.nom);
    if (court === null) return;
    zone.innerHTML = `<div class="resultat"><span class="sq" style="width:60%;height:16px"></span></div>`;
    const depuis = C.ajouterJours([DON.reglages.ouverture, DON.achats[0]?.date].filter(Boolean).sort()[0] || C.ajouterJours(aujourdhui(), -400), -7);
    const erreurs = await actualiserCours(COURS, [{ isin: r.isin, place: r.place }], depuis);
    if (erreurs.length || !Object.keys(COURS.closes[r.isin] || {}).length) {
      zone.innerHTML = `<div class="info neg">Impossible de récupérer les cours de ce titre sur Euronext ${esc(PLACES[r.place])}. Ligne non ajoutée.</div>`;
      return;
    }
    D.enregistrerCours(COURS);
    DON.etf = { maj: D.maintenant(), liste: [...etfs(), { isin: r.isin, court: court.trim() || r.nom, nom: r.nom, ticker: r.ticker, place: r.place, type: r.type, cible: 0 }] };
    sauver(); v.remove(); tout();
    toast(`${court.trim() || r.nom} ajouté (cible 0 %)`);
  });
};
$("ciblesCorps").addEventListener("click", async ev => {
  const fiche = ev.target.closest("[data-fiche]");
  if (fiche) return ouvrirFiche(fiche.dataset.fiche);
  const b = ev.target.closest("[data-retirer]"); if (!b) return;
  const isin = b.dataset.retirer, e = etfs().find(x => x.isin === isin);
  if (DON.achats.some(a => a.isin === isin)) return toast("Impossible : cette ligne a des achats.", true);
  if (!await confirmer(`Retirer ${esc(e.court)} ?`, "La ligne n'a aucun achat. Elle disparaît des cibles, des achats et des graphiques.", "Retirer", true)) return;
  DON.etf = { maj: D.maintenant(), liste: etfs().filter(x => x.isin !== isin) };
  if (DON.plan.montants?.[isin]) { const m = { ...DON.plan.montants }; delete m[isin]; DON.plan = { ...DON.plan, montants: m, maj: D.maintenant() }; }
  sauver(); tout(); toast(`${e.court} retiré.`);
});

// ---------- mon allocation ----------
function allocationVue() {
  const lignes = VUE.lignes.filter(l => l.valeur > 0);
  const fiches = toutesFiches();
  const fr = C.fraisPonderes(lignes, fiches);
  const total = lignes.reduce((t, l) => t + l.valeur, 0);
  $("aFrais").textContent = fr.taux == null ? "—" : nf(fr.taux, 2) + " %";
  $("aFraisS").textContent = fr.taux == null ? "fiches à compléter" : `≈ ${eur(fr.coutAnnuel, 0)} par an`;
  // volatilité : du portefeuille (indice hors versements) et de chaque ligne (à partir de ses cours)
  const volPea = C.volatiliteAnnuelle(VUE.hist.map(p => [p.date, p.indice]));
  const vols = lignes.map(l => ({ ...l, vol: C.statsCours(COURS.closes[l.isin])?.volatilite ?? null }));
  const volMoy = vols.filter(l => l.vol != null).reduce((t, l) => t + l.vol * l.valeur, 0) / (vols.filter(l => l.vol != null).reduce((t, l) => t + l.valeur, 0) || 1);
  $("aVol").textContent = volPea == null ? "—" : pct(volPea);
  $("aVolS").textContent = volPea == null ? "moins d'1 an d'historique" : `lignes seules : ${pct(volMoy)}`;
  barres($("aGVol"), C.TRANCHES_VOL.map(([min, max, nom]) => {
    const dedans = vols.filter(l => l.vol != null && l.vol >= min && l.vol < max);
    const part = dedans.reduce((t, l) => t + l.valeur, 0) / (total || 1);
    return { nom, valeur: part, texte: pct(part), couleur: "var(--e1)", sous: dedans.map(l => `${l.court} ${nf(l.vol * 100, 0)} %`).join(" · ") };
  }).filter(i => i.valeur > 0), { pastilles: false });
  const pays = C.allocation(lignes, fiches, "pays"), secteurs = C.allocation(lignes, fiches, "secteurs");
  const premier = l => l.find(([n]) => n !== C.AUTRES && n !== C.NON_RENSEIGNE);
  const [p1, s1] = [premier(pays), premier(secteurs)];
  $("aPays").textContent = p1 ? p1[0] : "—"; $("aPaysS").textContent = p1 ? pct(p1[1]) : "";
  $("aSecteur").textContent = s1 ? s1[0] : "—"; $("aSecteurS").textContent = s1 ? pct(s1[1]) : "";
  const items = l => l.map(([nom, v]) => ({ nom, valeur: v, texte: pct(v), couleur: nom === C.AUTRES || nom === C.NON_RENSEIGNE ? "var(--verse)" : "var(--e1)" }));
  const sp = { pastilles: false };
  barres($("aGPays"), items(pays), sp);
  barres($("aGSecteurs"), items(secteurs), sp);
  barres($("aGTop"), items(C.positionsCumulees(lignes, fiches)), sp);
  $("aGEmetteurs").innerHTML = "<h3>Émetteurs</h3>"; const d1 = document.createElement("div"); barres(d1, items(C.repartitionPar(lignes, fiches, "emetteur")), sp); $("aGEmetteurs").appendChild(d1);
  $("aGReplication").innerHTML = "<h3>Réplication</h3>"; const d2 = document.createElement("div"); barres(d2, items(C.repartitionPar(lignes, fiches, "replication")), sp); $("aGReplication").appendChild(d2);
  const dates = Object.values(fiches).map(f => f.au).filter(Boolean).sort();
  const approx = etfs().filter(e => /approximation/i.test(fiches[e.isin]?.note || "")).map(e => e.court);
  $("aNote").textContent = `D'après les fiches des ETF${dates.length ? ` (${dFr(dates[0])})` : ""}.`
    + (approx.length ? ` ${approx.join(", ")} : composition approchée.` : "");
}

// ---------- cours ----------
async function chargerCours(manuel = false) {
  if (CHARGEMENT) return;
  if (!navigator.onLine) { if (manuel) toast("Pas de connexion : derniers cours connus utilisés.", true); return; }
  CHARGEMENT = true; $("btnActualiser").classList.add("tourne");
  if (sansCours()) accueil();
  try {
    const depuis = [DON.reglages.ouverture, DON.achats[0]?.date].filter(Boolean).sort()[0] || C.ajouterJours(aujourdhui(), -400);
    const erreurs = await actualiserCours(COURS, titresCours(), C.ajouterJours(depuis, -7));
    D.enregistrerCours(COURS);
    CHARGEMENT = false;
    tout();
    if (erreurs.length) toast(`Cours non mis à jour pour ${erreurs.length} ligne${erreurs.length > 1 ? "s" : ""} : Euronext injoignable.`, true);
    else if (manuel) toast(`Cours à jour · ${libelleCours()}`);
  } catch (e) { console.error(e); toast(e.message, true); }
  finally { CHARGEMENT = false; $("btnActualiser").classList.remove("tourne"); if (sansCours()) accueil(); }
}
$("btnActualiser").onclick = () => chargerCours(true);

// tirer vers le bas en haut de page pour actualiser (téléphone)
(() => {
  const ind = $("tirer");
  let y0 = null, dy = 0;
  const reinit = () => { ind.style.opacity = 0; ind.style.transform = ""; ind.classList.remove("pret"); };
  addEventListener("touchstart", e => {
    y0 = scrollY <= 0 && !FEUILLES.length && !e.target.closest(".graphe-zone,input,select,textarea") ? e.touches[0].clientY : null; dy = 0;
  }, { passive: true });
  addEventListener("touchmove", e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || scrollY > 0) return reinit();
    const d = Math.min(dy * 0.5, 90);
    ind.style.transition = "none";
    ind.style.opacity = Math.min(1, d / 50);
    ind.style.transform = `translateY(${d - 40}px) rotate(${d * 4}deg)`;
    ind.classList.toggle("pret", d >= 64);
  }, { passive: true });
  addEventListener("touchend", () => {
    if (y0 == null) return;
    y0 = null;
    ind.style.transition = "transform .25s ease, opacity .25s ease";
    if (Math.min(dy * 0.5, 90) >= 64 && !CHARGEMENT) {
      ind.style.transform = "translateY(24px)"; ind.classList.add("tourne");
      chargerCours(true).finally(() => { ind.classList.remove("tourne"); reinit(); });
    } else reinit();
  });
})();

// ---------- thème : automatique (comme le téléphone / PC) → clair → sombre ----------
const CLE_THEME = "investir-pea:theme";
const THEMES = {
  auto: { nom: "automatique", svg: '<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor"/>' },
  light: { nom: "clair", svg: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>' },
  dark: { nom: "sombre", svg: '<path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z"/>' },
};
const SOMBRE = matchMedia("(prefers-color-scheme: dark)"), TELEPHONE = matchMedia("(max-width:720px)");
function couleurBarre() {
  const sombre = THEME === "dark" || (THEME === "auto" && SOMBRE.matches);
  document.querySelector('meta[name="theme-color"]').content = sombre ? "#0b0f14" : TELEPHONE.matches ? "#ffffff" : "#f4f5f7";
}
function appliquerTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else { delete document.documentElement.dataset.theme; t = "auto"; }
  try { localStorage.setItem(CLE_THEME, t); } catch { /* */ }
  $("btnTheme").innerHTML = `<svg class="ico" viewBox="0 0 24 24">${THEMES[t].svg}</svg>`;
  $("btnTheme").title = `Thème ${THEMES[t].nom}`;
  return t;
}
let THEME = (() => { try { return localStorage.getItem(CLE_THEME) || "auto"; } catch { return "auto"; } })();
THEME = appliquerTheme(THEME); couleurBarre();
SOMBRE.addEventListener?.("change", couleurBarre); TELEPHONE.addEventListener?.("change", couleurBarre);
$("btnTheme").onclick = () => {
  THEME = appliquerTheme({ auto: "light", light: "dark", dark: "auto" }[THEME]);
  couleurBarre();
  if (VUE.resume) tout();
  toast(`Thème ${THEMES[THEME].nom}`);
};

// ---------- navigation ----------
// Onglets de la barre du bas ; « fiche » et « sauvegarde » (réglages) sont des pages secondaires avec retour arrière.
const TITRES = { accueil: "Mon PEA", achats: "Achats", graphiques: "Graphiques", strategie: "Stratégie", journal: "Journal", sauvegarde: "Réglages", fiche: "" };
const SECONDAIRES = ["fiche", "sauvegarde"];
const surSecondaire = () => !!(history.state?.fiche || history.state?.reglages);
let ONGLET = "accueil";
function pageSecondaire(etat) {
  if (surSecondaire()) history.replaceState(etat, ""); else history.pushState(etat, "");
}
function ouvrirOnglet(nom) {
  const secondaire = SECONDAIRES.includes(nom);
  const avant = document.querySelector("[data-panneau]:not([hidden])")?.dataset.panneau;
  if (!secondaire) { ONGLET = nom; FICHE_ISIN = null; }
  document.querySelectorAll(".onglets button").forEach(x => x.classList.toggle("actif", x.dataset.onglet === (nom === "fiche" ? ONGLET : nom)));
  document.querySelectorAll("[data-panneau]").forEach(p => { p.hidden = p.dataset.panneau !== nom; });
  const p = panneau(nom);
  if (avant && avant !== nom) { p.classList.remove("entre", "glisse"); void p.offsetWidth; p.classList.add(secondaire ? "glisse" : "entre"); }
  $("titrePage").textContent = TITRES[nom];
  $("btnRetour").hidden = !secondaire;
  document.querySelector(".barre").classList.toggle("retour", secondaire);
  $("btnReglages").hidden = nom === "sauvegarde";
  if (!secondaire) try { sessionStorage.setItem("onglet", nom); } catch { /* */ }
  if (nom === "graphiques") graphiques();
  if (nom === "accueil") accueil();
  if (DON) enTete();
  window.scrollTo({ top: 0 });
}
$("btnRetour").onclick = () => (surSecondaire() ? history.back() : ouvrirOnglet(ONGLET));
$("btnReglages").onclick = () => { pageSecondaire({ reglages: true }); ouvrirOnglet("sauvegarde"); };
document.querySelectorAll(".onglets button").forEach(b => b.onclick = () => {
  if (surSecondaire()) { RETOUR_IGNORE++; history.back(); }   // quitte la page secondaire sans laisser d'entrée dans l'historique
  ouvrirOnglet(b.dataset.onglet);
});
window.addEventListener("popstate", ev => {
  if (RETOUR_IGNORE) { RETOUR_IGNORE--; return; }
  if (FEUILLES.length) { FEUILLES[FEUILLES.length - 1].fermer(true); return; }
  const s = ev.state || {};
  if (s.fiche) { FICHE_ISIN = s.fiche; ouvrirOnglet("fiche"); dessinerFiche(); }
  else if (s.reglages) ouvrirOnglet("sauvegarde");
  else if (SECONDAIRES.includes(document.querySelector("[data-panneau]:not([hidden])")?.dataset.panneau)) ouvrirOnglet(ONGLET);
});
const barre = document.querySelector(".barre");
addEventListener("scroll", () => barre.classList.toggle("ombre", scrollY > 4), { passive: true });
let attente;
window.addEventListener("resize", () => {
  if (!VUE.resume) return;
  clearTimeout(attente);
  attente = setTimeout(() => {
    if (!panneau("graphiques").hidden) graphiques();
    if (!panneau("accueil").hidden) accueil();
    if (!panneau("fiche").hidden && FICHE_ISIN) dessinerFiche();
  }, 150);
});

// ---------- démarrage ----------
function demarrer() {
  $("ecranVide").hidden = true;
  if (history.state || location.hash) history.replaceState(null, "", location.pathname + location.search);   // état laissé par une session précédente
  try {
    const b = JSON.parse(localStorage.getItem(CLE_BROUILLON) || "null");
    if (b?.ops?.length) { OPS = b.ops; VERSE_MANUEL = b.verse ?? null; BUDGET = b.budget || 0; }
  } catch { /* brouillon illisible */ }
  tout();
  let onglet = "accueil";
  try { onglet = sessionStorage.getItem("onglet") || "accueil"; } catch { /* */ }
  ouvrirOnglet(SECONDAIRES.includes(onglet) || !panneau(onglet) ? "accueil" : onglet);
  D.demanderPersistance().then(() => sauvegarde());
  const ancien = !COURS.maj || Date.now() - new Date(COURS.maj) > 15 * 60e3;
  if (ancien) chargerCours(false);
}

DON = D.charger();
if (DON) demarrer();
else {
  $("ecranVide").hidden = false;
  $("btnDemarrerVide").onclick = () => { DON = D.vide(); sauver(); demarrer(); };
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(e => console.warn("Service worker :", e));
}
