// Interface « Investir PEA » : état, rendu des écrans, actions.
import * as C from "./calculs.js";
import * as D from "./donnees.js";
import { actualiser as actualiserCours, provisoire, jourParis, rechercher, PLACES } from "./cours.js";
import { courbe, colonnes, barres } from "./graphiques.js";
import { FICHES } from "./fiches.js";

export const VERSION = "1.4.0";
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

function toast(msg, erreur = false) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div"); t.className = "toast" + (erreur ? " erreur" : ""); t.textContent = msg;
  t.setAttribute("role", erreur ? "alert" : "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), erreur ? 8000 : 5000);
}
async function occupe(bouton, travail) {
  const t = bouton.textContent; bouton.disabled = true; bouton.textContent = "Patientez…";
  try { await travail(); } catch (e) { console.error(e); toast(e.message, true); } finally { bouton.disabled = false; bouton.textContent = t; }
}
function modale(html) {
  const v = document.createElement("div"); v.className = "voile";
  v.innerHTML = `<div class="modale" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(v);
  v.addEventListener("click", e => { if (e.target === v) v.remove(); });
  return v;
}
function confirmer(titre, texte, libelleOk = "Confirmer", danger = false) {
  return new Promise(res => {
    const v = modale(`<h3>${titre}</h3><div class="texte">${texte}</div>
      <div class="pied"><button class="btn" data-r="0">Annuler</button><button class="btn ${danger ? "danger" : "vert"}" data-r="1">${libelleOk}</button></div>`);
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
  const r = VUE.resume;
  $("sousTitre").textContent = `Cours : ${libelleCours()} · Dernier achat saisi : ${r.dernierAchat ? `${dFr(r.dernierAchat)} (il y a ${C.joursEntre(r.dernierAchat, aujourdhui())} j)` : "aucun"}`;
  const exp = localStorage.getItem(CLE_EXPORT);
  const b = $("bandeau");
  if (DON.achats.length && (!exp || (DON.modifie && DON.modifie > exp && C.joursEntre(exp.slice(0, 10), aujourdhui()) >= 30))) {
    b.hidden = false;
    b.innerHTML = `<span>${exp ? `Dernière sauvegarde exportée le ${dFr(exp.slice(0, 10))}.` : "Aucune sauvegarde exportée depuis cet appareil."} Pensez à exporter vos données.</span>
      <button class="btn" id="bandeauExport">Exporter maintenant</button>`;
    $("bandeauExport").onclick = exporter;
  } else b.hidden = true;
}

function accueil() {
  const r = VUE.resume;
  $("kValeur").textContent = eur(r.valeur, 0);
  $("kValeurS").textContent = `titres ${eur(r.titres, 0)}`;
  $("kPv").innerHTML = `<span class="${classeSigne(r.pv)}">${eurS(r.pv)}</span>`;
  $("kPvS").textContent = `${pct(r.pvPct, true)} du montant investi (${eur(r.investi, 0)})`;
  $("kVerse").textContent = eur(r.verse, 0);
  $("kVerseS").textContent = `marge sous le plafond : ${eur(r.marge, 0)}`;
  $("kLiq").innerHTML = `<span class="${r.liquidites < -0.005 ? "neg" : ""}">${eur(r.liquidites)}</span>`;
  $("liqAchats").innerHTML = `Liquidités disponibles : <b class="${r.liquidites < -0.005 ? "neg" : ""}">${eur(r.liquidites)}</b>`;

  const echelle = Math.max(0.6, ...VUE.lignes.map(l => Math.max(l.poids || 0, l.cible)));
  $("posCorps").innerHTML = VUE.lignes.map(l => {
    const poids = l.cible > 0 ? l.poids : l.poidsPEA;
    return `<tr data-isin="${esc(l.isin)}" tabindex="0" title="Voir la fiche">
      <td class="etf-cell"><div class="etf"><span class="pastille" style="background:${couleur(l.isin)}"></span><div>${esc(l.court)}<small>${esc(l.ticker)} · ${esc(l.isin)}</small></div></div></td>
      <td class="n" data-l="Parts">${nf(l.parts, 0)}</td>
      <td class="n" data-l="Prix">${eur(l.prix)}</td>
      <td class="n" data-l="Valeur">${eur(l.valeur, 0)}</td>
      <td class="n" data-l="PRU">${l.pru == null ? "—" : nf(l.pru, 4) + " €"}</td>
      <td class="n ${classeSigne(l.pv)}" data-l="Plus-value">${eurS(l.pv)}<small>${pct(l.pvPct, true)}</small></td>
      <td class="poids"><div class="jauge"><i style="width:${Math.min(100, (poids || 0) / echelle * 100)}%;background:${couleur(l.isin)}"></i>${l.cible > 0 ? `<b style="left:${Math.min(100, l.cible / echelle * 100)}%"></b>` : ""}</div>
        <small><span>${pct(poids)}${l.cible > 0 ? "" : " du PEA"}</span><span>${l.cible > 0 ? `cible ${pct(l.cible, false, 0)} (${l.ecart >= 0 ? "+" : "−"}${nf(Math.abs(l.ecart * 100), 1)} pt)` : "plus renforcé"}</span></small></td></tr>`;
  }).join("") || `<tr><td colspan="7" class="vide">Aucune position.</td></tr>`;
  $("posPied").innerHTML = `<tr><td class="etf-cell">Total titres</td><td></td><td></td><td class="n" data-l="Valeur">${eur(r.titres, 0)}</td>
    <td class="n" data-l="Investi">${eur(r.investi, 0)}</td><td class="n ${classeSigne(r.pv)}" data-l="Plus-value">${eurS(r.pv)}<small>${pct(r.pvPct, true)}</small></td><td></td></tr>`;

  const h = VUE.hist.slice(-91);
  $("miniInfo").textContent = h.length ? "3 derniers mois" : "";
  courbe($("gMini"), { dates: h.map(p => p.date), titre: "Valeur du PEA sur 3 mois", hauteur: 170,
    series: [{ nom: "Valeur du PEA", couleur: "var(--e1)", valeurs: h.map(p => p.valeur), aire: true }],
    format: v => eur(v, 0), formatAxe: v => nf(v / 1000, v % 1000 ? 1 : 0) + " k€",
    bulle: i => [["Valeur", eur(h[i].valeur, 0), "var(--e1)"], ["Plus-value", `${eurS(h[i].pv)} (${pct(h[i].pvPct, true)})`]] });
}

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
      <div class="c-sup"><button class="suppr" data-suppr title="Retirer cette ligne" aria-label="Retirer cette ligne">×</button></div>
    </div>`).join("")
    : `<div class="vide">Ajoutez un achat (« + Ajouter un achat ») ou demandez une proposition.</div>`;
  majTotaux();
  infoMontant();
}
const liqDispo = () => Math.max(0, VUE.resume.liquidites);
const virementPrevu = () => (BUDGET > 0 ? Math.max(0, BUDGET - liqDispo()) : null);
function infoMontant() {
  const m = parseFloat($("fMontant").value) || 0, liq = liqDispo();
  $("fMontant").placeholder = liq > 0.005 ? nf(liq, 2) : "";
  $("infoProposer").textContent = !m ? (liq > 0.005 ? `liquidités comprises (vide = ${eur(liq)})` : "liquidités comprises")
    : m <= liq + 0.005 ? `pris sur vos liquidités (${eur(liq)})`
    : `${liq > 0.005 ? `${eur(liq)} de liquidités + ` : ""}virement à faire : ${eur(m - liq)}`;
}
$("fMontant").addEventListener("input", infoMontant);

function majTotaux() {
  const auto = C.verseAuto(OPS, liqDispo(), virementPrevu());
  const verse = VERSE_MANUEL ?? auto;
  if (document.activeElement !== $("fVerse")) $("fVerse").value = OPS.length || VERSE_MANUEL != null ? verse.toFixed(2) : "";
  $("infoVerse").textContent = VERSE_MANUEL != null ? `modifié à la main (calcul auto : ${eur(auto)})`
    : "calcul auto : montants du plan pour les lignes « Plan », virement nécessaire pour les achats ponctuels après usage des liquidités";
  $("btnVerseAuto").hidden = VERSE_MANUEL == null;
  const dispo = verse + liqDispo();
  const investi = OPS.reduce((s, o) => s + (o.parts || 0) * (o.prix || 0), 0);
  const reste = dispo - investi;
  $("tDispo").textContent = eur(dispo); $("tInvesti").textContent = eur(investi);
  $("tReste").textContent = eur(reste); $("tReste").className = reste < -0.005 ? "neg" : "";
  $("tNb").textContent = OPS.filter(o => o.parts > 0).length;
  $("alerteOp").textContent = reste < -0.005 ? `Il manque ${eur(-reste)} : réduisez les parts ou augmentez le montant versé.` : "";
  $("btnValider").disabled = reste < -0.005 || !OPS.some(o => o.parts > 0);
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
  toast(`Proposition pour ${eur(montant)} (reste ${eur(r.reste)}, gardé en liquidités). Poids après : ${achats.map(([i]) => `${nomEtf(i)} ${pct(apres[i])}`).join(", ")}.`);
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
    <div>Investi <b>${eur(investi)}</b> · versé <b>+${eur(verse)}</b> · liquidités ${eur(liqAvant)} → <b class="${liqApres < -0.005 ? "neg" : ""}">${eur(liqApres)}</b></div>
    <div class="texte">Seront mis à jour : parts, PRU, journal, total versé, liquidités${lignes.some(o => o.note === C.NOTE_PLAN) ? " et date de dernière exécution du plan" : ""}.</div>
    <div class="pied"><button class="btn" id="mAnnuler">Annuler</button><button class="btn vert" id="mOk">Enregistrer</button></div>`);
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
    toast(`${lignes.length} achat(s) enregistré(s) ✓  Liquidités : ${eur(VUE.resume.liquidites)}`);
  };
};

// ---------- stratégie ----------
let CIBLES = {};
function strategie() {
  CIBLES = Object.fromEntries(etfs().map(e => [e.isin, Math.round(e.cible * 1000) / 10]));
  dessinerCibles();
  const pl = DON.plan, total = Object.values(pl.montants || {}).reduce((a, b) => a + b, 0);
  $("planInfo").textContent = total ? `${eur(total, 0)}/mois · le ${pl.jour} (lundi si week-end)${pl.regle ? " · réglé le " + dFr(pl.regle) : ""}` : "aucun plan";
  const age = pl.regle ? C.joursEntre(pl.regle, aujourdhui()) : null;
  $("planRappel").hidden = !(total && age != null && age >= 90);
  $("planRappel").textContent = `Répartition calculée il y a ${age} jours : recalculez-la (tous les 3 mois) et reportez-la dans Trade Republic.`;
  $("planLignes").innerHTML = etfs().filter(e => (pl.montants?.[e.isin] || 0) > 0).map(e => {
    const prix = prixActuels()[e.isin];
    return `<div class="plan-ligne"><span class="pastille" style="background:${couleur(e.isin)}"></span>${esc(e.court)}
      <span class="m">${eur(pl.montants[e.isin], 0)}<small>${prix ? `≈ ${Math.floor(pl.montants[e.isin] / prix)} parts/mois` : ""}</small></span></div>`;
  }).join("") || `<div class="vide">Aucun montant. Indiquez votre montant mensuel puis « Recalculer ».</div>`;
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
    return `<tr><td><div class="etf"><span class="pastille" style="background:${couleur(e.isin)}"></span><button class="btn lien" data-fiche="${esc(e.isin)}">${esc(e.court)}</button>${retirable ? `<button class="suppr" data-retirer="${esc(e.isin)}" title="Retirer cette ligne (aucun achat)" aria-label="Retirer ${esc(e.court)}">×</button>` : ""}</div></td>
      <td class="n">${poids == null ? `<span class="info">${pct(total ? valeurs[e.isin] / total : null)} du PEA</span>` : pct(poids)}</td>
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
    : change ? "Après l'enregistrement, recalculez la répartition du plan." : "Écart = poids actuel − cible.";
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
  toast("Cibles enregistrées ✓  Recalculez maintenant la répartition du plan.");
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
  box.innerHTML = `<b>Répartition conseillée pour ${eur(mensuel, 0)}/mois</b>
    ${lignes.filter(l => l.cible > 0 || montants[l.isin] > 0).map(l => `<div class="plan-ligne"><span class="pastille" style="background:${couleur(l.isin)}"></span>${esc(nomEtf(l.isin))}
      <span class="m">${eur(montants[l.isin], 0)}<small>≈ ${parMois[l.isin]} parts/mois · dans ${C.HORIZON_PLAN} mois ${pct(projete[l.isin])} (cible ${pct(l.cible, false, 0)})</small></span></div>`).join("")}
    <div class="pied"><span class="note">Ensuite, reportez ces montants dans votre plan Trade Republic.</span>
      <button class="btn" id="pAnnuler">Annuler</button><button class="btn primaire" id="pOk">Enregistrer ce plan</button></div>`;
  $("pAnnuler").onclick = () => { box.hidden = true; };
  $("pOk").onclick = () => {
    DON.plan = { ...DON.plan, montants: Object.fromEntries(Object.entries(montants).filter(([, v]) => v > 0)), regle: aujourdhui(), maj: D.maintenant() };
    sauver(); box.hidden = true; tout();
    toast("Plan enregistré ✓  Pensez à le modifier dans Trade Republic.");
  };
};

// ---------- liquidités ----------
function ajouterMouvement(m) {
  DON.versements.push({ id: D.nouvelId(), cree: D.maintenant(), ...m });
  DON.versements.sort((a, b) => a.date.localeCompare(b.date));
  sauver(); tout();
}
function modaleVirement() {
  const v = modale(`<h3>Virement reçu sur le PEA</h3>
    <div class="texte">Argent viré sur votre compte PEA Trade Republic. Il s'ajoute au total versé et aux liquidités ;
      « Montant à investir → Proposer » l'utilisera ensuite.</div>
    <div class="champs">
      <label>Date du virement <input type="date" id="mvDate" value="${aujourdhui()}" max="${aujourdhui()}"></label>
      <label>Montant (€) <input type="number" id="mvMontant" min="0" step="0.01" inputmode="decimal"></label>
    </div>
    <div class="pied"><button class="btn" data-annuler>Annuler</button><button class="btn vert" data-ok>Enregistrer</button></div>`);
  v.querySelector("[data-annuler]").onclick = () => v.remove();
  v.querySelector("#mvMontant").focus();
  v.querySelector("[data-ok]").onclick = () => {
    const montant = parseFloat(v.querySelector("#mvMontant").value), date = v.querySelector("#mvDate").value;
    if (!(montant > 0) || !date) return toast("Indiquez la date et un montant positif.", true);
    v.remove();
    ajouterMouvement({ date, montant: Math.round(montant * 100) / 100, note: "Virement" });
    toast(`Virement de ${eur(montant)} enregistré ✓  Liquidités : ${eur(VUE.resume.liquidites)}`);
  };
}
function modaleCorriger() {
  const actuel = VUE.resume.liquidites;
  const v = modale(`<h3>Corriger mes liquidités</h3>
    <div class="texte">Indiquez les espèces affichées sur votre PEA dans Trade Republic. L'écart avec l'application
      (${eur(actuel)}) est enregistré comme une correction : il change les liquidités mais <b>pas</b> le total versé
      (intérêts, arrondis…). Pour un virement, utilisez plutôt « + Virement ».</div>
    <div class="champs">
      <label>Liquidités réelles (€) <input type="number" id="mcMontant" min="0" step="0.01" inputmode="decimal" value="${Math.max(0, actuel).toFixed(2)}"></label>
      <div class="info" id="mcEcart"></div>
    </div>
    <div class="pied"><button class="btn" data-annuler>Annuler</button><button class="btn vert" data-ok>Enregistrer</button></div>`);
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
    toast(`Liquidités corrigées ✓  ${eur(VUE.resume.liquidites)}`);
  };
}
document.querySelectorAll("[data-virement]").forEach(b => b.onclick = modaleVirement);
document.querySelectorAll("[data-corriger]").forEach(b => b.onclick = modaleCorriger);

// ---------- journal ----------
function journal() {
  const filtre = $("jFiltre").value;
  const achats = [...DON.achats].reverse().filter(a => !filtre || a.note === filtre);
  const nPlan = DON.achats.filter(a => a.note === C.NOTE_PLAN).length;
  $("jInfo").textContent = `${DON.achats.length} achats · ${nPlan} plan, ${DON.achats.length - nPlan} ponctuels`;
  $("jCorps").innerHTML = achats.map(a => `<tr data-id="${esc(a.id)}"><td>${dFr(a.date)}</td>
    <td><div class="etf"><span class="pastille" style="background:${couleur(a.isin)}"></span>${esc(nomEtf(a.isin))}</div></td>
    <td><button class="etiquette ${a.note === C.NOTE_PLAN ? "plan" : ""}" data-type title="Changer le type">${esc(a.note || C.NOTE_ACHAT)}</button></td>
    <td class="n">${a.parts}</td><td class="n">${eur(a.prix, 4)}</td><td class="n">${eur(a.parts * a.prix)}</td>
    <td><button class="suppr" data-suppr title="Supprimer cet achat" aria-label="Supprimer cet achat">×</button></td></tr>`).join("")
    || `<tr><td colspan="7" class="vide">Aucun achat.</td></tr>`;
  const vs = [...DON.versements].reverse();
  $("vInfo").textContent = `${vs.length} mouvements · total versé ${eur(VUE.resume.verse)}`;
  $("vCorps").innerHTML = vs.map(v => `<tr data-id="${esc(v.id)}"><td>${dFr(v.date)}</td><td class="info">${esc(v.note || "Versement")}${C.estAjustement(v) ? " (hors total versé)" : ""}</td>
    <td class="n">${eur(v.montant)}</td><td><button class="suppr" data-suppr title="Supprimer ce versement" aria-label="Supprimer ce versement">×</button></td></tr>`).join("")
    || `<tr><td colspan="4" class="vide">Aucun versement.</td></tr>`;
}
$("jFiltre").onchange = journal;
$("jCorps").addEventListener("click", async ev => {
  const tr = ev.target.closest("tr[data-id]"); if (!tr) return;
  const a = DON.achats.find(x => x.id === tr.dataset.id); if (!a) return;
  if (ev.target.closest("[data-type]")) {
    a.note = a.note === C.NOTE_PLAN ? C.NOTE_ACHAT : C.NOTE_PLAN; a.modifie = D.maintenant();
    sauver(); journal();
  } else if (ev.target.closest("[data-suppr]")) {
    if (!await confirmer("Supprimer cet achat ?", `${dFr(a.date)} · ${a.parts} × ${esc(nomEtf(a.isin))} à ${eur(a.prix, 4)} = ${eur(a.parts * a.prix)}.<br>
      Parts, PRU et liquidités seront recalculés. Le versement correspondant n'est pas supprimé (faites-le dans « Versements » si besoin).`, "Supprimer", true)) return;
    DON.achats = DON.achats.filter(x => x.id !== a.id); DON.supprimes.push(a.id);
    sauver(); tout(); toast("Achat supprimé.");
  }
});
$("vCorps").addEventListener("click", async ev => {
  const tr = ev.target.closest("tr[data-id]"); if (!tr || !ev.target.closest("[data-suppr]")) return;
  const v = DON.versements.find(x => x.id === tr.dataset.id); if (!v) return;
  if (!await confirmer("Supprimer ce versement ?", `${dFr(v.date)} · ${eur(v.montant)}. Total versé et liquidités seront recalculés.`, "Supprimer", true)) return;
  DON.versements = DON.versements.filter(x => x.id !== v.id); DON.supprimes.push(v.id);
  sauver(); tout(); toast("Versement supprimé.");
});

// ---------- graphiques ----------
let VUE_GRAPH = "evolution";
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

  // plus-value en % du montant investi : variation sur la période, comme Trade Republic
  const der = h[h.length - 1], prem = h[0];
  $("gPvInfo").textContent = der ? `${pct(der.pvPct, true, 2)} · ${eurS(der.pv)}` : "";
  courbe($("gPv"), { dates, titre: "Plus-value en % du montant investi", zero: true,
    series: [{ nom: "Plus-value", couleur: "var(--e1)", valeurs: h.map(p => p.pvPct), aire: true }],
    format: v => pct(v, true, 2), formatAxe: v => nf(Math.round(v * 100) || 0, 0) + " %",
    bulle: i => [["Plus-value", pct(h[i].pvPct, true, 2), "var(--e1)"], ["en euros", eurS(h[i].pv)], ["Investi", eur(h[i].investi, 0)]] });

  $("gValInfo").textContent = der && prem ? `${eur(der.valeur, 0)} · versé ${eur(der.verse, 0)}` : "";
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
  $("gRepliInfo").textContent = h.length ? `pire repli ${pct(pire.repli, true)} le ${dFr(pire.date)} · actuel ${pct(der.repli, true)}` : "";
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

  // investi par mois
  const debutMois = dates[0]?.slice(0, 7) || "";
  const mois = C.investiParMois(DON.achats).filter(m => m.mois >= debutMois);
  const totalPeriode = mois.reduce((s, m) => s + m.plan + m.ponctuel, 0);
  $("gMoisInfo").textContent = mois.length ? `${eur(totalPeriode, 0)} sur la période · ${eur(totalPeriode / mois.length, 0)}/mois en moyenne` : "";
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  colonnes($("gMois"), { titre: "Investi par mois", categories: mois.map(m => m.mois),
    series: [{ nom: "Plan d'épargne", couleur: "var(--e1)", valeurs: mois.map(m => m.plan) },
             { nom: "Achats ponctuels", couleur: "var(--e2)", valeurs: mois.map(m => m.ponctuel) }],
    format: v => eur(v, 0), formatAxe: k,
    libelleAxe: i => { const [a, mo] = mois[i].mois.split("-"); return +mo === 1 ? a : MOIS[+mo - 1]; },
    titreBulle: i => { const [a, mo] = mois[i].mois.split("-"); return `${MOIS[+mo - 1]} ${a}`; } });

  projectionGraphe();
}

function projectionGraphe() {
  const r = VUE.resume;
  const plan = Object.values(DON.plan.montants || {}).reduce((a, b) => a + b, 0);
  if ($("fProjMensuel").value === "") $("fProjMensuel").value = plan || 500;
  const mensuel = parseFloat($("fProjMensuel").value) || 0;
  const taux = [0.05, 0.07, 0.09];
  const scen = taux.map(t => C.projection(r.valeur, r.verse, mensuel, t));
  const t0 = aujourdhui();
  const [a0, m0] = t0.split("-").map(Number);
  const dates = scen[0].map(p => { const m = m0 - 1 + p.mois; return `${a0 + Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, "0")}-01`; });
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const moisFr = d => `${MOIS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
  const reste = (DON.reglages.plafond || 150000) - r.verse;
  const nPlafond = mensuel > 0 ? Math.ceil(reste / mensuel) : null;
  const dPlafond = nPlafond == null ? null : (() => { const m = m0 - 1 + nPlafond; return `${a0 + Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, "0")}-01`; })();
  $("gProjInfo").textContent = nPlafond == null ? "" : `plafond de versements (${eur(DON.reglages.plafond || 150000, 0)}) atteint vers ${moisFr(dPlafond)} à ce rythme`;
  const fin = scen.map(s => s[s.length - 1]);
  $("gProjChiffres").innerHTML = taux.map((t, i) => `<div><span>Dans 10 ans à ${nf(t * 100, 0)} %/an</span><b>${eur(fin[i].valeur, 0)}</b><small>dont ${eur(fin[i].verse, 0)} versés</small></div>`).join("");
  const k = v => Math.abs(v) >= 1000 ? nf(v / 1000, 0) + " k€" : nf(v, 0) + " €";
  const teinte = p => `color-mix(in srgb, var(--e1) ${p}%, var(--carte))`;
  courbe($("gProj"), { dates, titre: "Projection à 10 ans", pasMois: 12, titreBulle: moisFr,
    series: [{ nom: "à 9 %/an", couleur: teinte(100), valeurs: scen[2].map(p => p.valeur) },
             { nom: "à 7 %/an", couleur: teinte(70), valeurs: scen[1].map(p => p.valeur) },
             { nom: "à 5 %/an", couleur: teinte(45), valeurs: scen[0].map(p => p.valeur) },
             { nom: "Total versé", couleur: "var(--verse)", valeurs: scen[0].map(p => p.verse), pointille: true }],
    format: v => eur(v, 0), formatAxe: k });
}
$("fProjMensuel").addEventListener("input", () => { clearTimeout(window.__proj); window.__proj = setTimeout(projectionGraphe, 200); });
document.querySelectorAll("[data-periode]").forEach(b => b.onclick = () => {
  PERIODE = b.dataset.periode === "max" || b.dataset.periode === "ytd" ? b.dataset.periode : +b.dataset.periode;
  document.querySelectorAll("[data-periode]").forEach(x => x.classList.toggle("actif", x === b));
  graphiques();
});

// ---------- sauvegarde ----------
function sauvegarde() {
  const exp = localStorage.getItem(CLE_EXPORT);
  $("infoSauvegarde").textContent = `${DON.achats.length} achats, ${DON.versements.length} versements dans cet appareil. ${exp ? `Dernier export : ${dFr(exp.slice(0, 10))}.` : "Jamais exporté depuis cet appareil."}`;
  $("fOuverture").value = DON.reglages.ouverture || "";
  if (DON.reglages.ouverture) {
    const [a, m, j] = DON.reglages.ouverture.split("-");
    $("infoOuverture").textContent = `5 ans le ${j}/${m}/${+a + 5} (retraits possibles sans clôturer le PEA).`;
  }
  const nb = etfs().reduce((s, e) => s + Object.keys(COURS.closes[e.isin] || {}).length, 0);
  $("infoCours").textContent = `${nb} clôtures en mémoire · ${libelleCours()}${COURS.maj ? ` · téléchargées le ${new Date(COURS.maj).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : ""}.`;
  $("infoDivisions").innerHTML = (DON.divisions || []).map(d => `${esc(nomEtf(d.isin))} : 1 part → ${d.ratio} le ${dFr(d.date)} (les achats antérieurs sont convertis automatiquement)`).join("<br>") || "Aucune.";
  $("fCoursEtf").innerHTML = etfs().map(e => `<option value="${e.isin}">${esc(e.court)}</option>`).join("");
  if (!$("fCoursDate").value) $("fCoursDate").value = aujourdhui();
  navigator.storage?.persisted?.().then(p => {
    $("infoApp").textContent = `Version ${VERSION} · stockage ${p ? "persistant (le navigateur ne l'effacera pas)" : "non garanti : installez l'application pour le rendre persistant"}.`;
  }).catch(() => { $("infoApp").textContent = `Version ${VERSION}.`; });
}
function exporter() {
  const t = D.maintenant();
  D.telecharger(`investir-pea_${aujourdhui()}.json`, D.exportJSON(DON), "application/json");
  localStorage.setItem(CLE_EXPORT, t);
  enTete(); sauvegarde();
  toast("Sauvegarde exportée ✓");
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
  history.pushState({ fiche: isin }, "", "#fiche");
  ouvrirOnglet("fiche");
  dessinerFiche();
}
$("btnFicheRetour").onclick = () => (history.state?.fiche ? history.back() : ouvrirOnglet(ONGLET));
$("posCorps").addEventListener("click", ev => { const tr = ev.target.closest("tr[data-isin]"); if (tr) ouvrirFiche(tr.dataset.isin); });
$("posCorps").addEventListener("keydown", ev => { const tr = ev.target.closest("tr[data-isin]"); if (tr && ev.key === "Enter") ouvrirFiche(tr.dataset.isin); });

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
  const premier = achats[0]?.date;
  const varJour = st?.veille ? st.prix / st.veille - 1 : null;
  const perfAchat = premier && st ? (() => { const c = C.serie(COURS.closes[e.isin]).filter(([d]) => d <= premier).pop(); return c ? st.prix / c[1] - 1 : null; })() : null;
  const chiffre = (lib, val, cls = "") => `<div><span>${lib}</span><b class="${cls}">${val}</b></div>`;
  const perf = v => `<span class="${classeSigne(v)}">${pct(v, true)}</span>`;
  const coutAnnuel = f.frais != null && l.valeur ? l.valeur * f.frais / 100 : null;
  const dl = [["Type", e.type || "ETF"], ["Émetteur", f.emetteur], ["Indice suivi", f.indice], ["Frais annuels", f.frais != null ? `${nf(f.frais, 2)} %${coutAnnuel != null ? ` · ${eur(coutAnnuel, 0)}/an pour ma ligne` : ""}` : null],
    ["Encours", f.encours], ["Réplication", f.replication], ["Création", f.creation ? dFr(f.creation) : null], ["Domicile", f.domicile],
    ["Dividendes", f.dividendes], ["Éligible PEA", f.pea == null ? null : f.pea ? "Oui" : "Non"], ["Place de cotation", `Euronext ${PLACES[e.place || "XPAR"]}`]]
    .filter(([, v]) => v != null && v !== "");
  $("ficheContenu").innerHTML = `
    <section class="carte">
      <div class="fiche-tete"><span class="pastille" style="background:${couleur(e.isin)}"></span>
        <div><h2>${esc(e.court)}</h2><div class="sous">${esc(e.nom || "")}<br>${esc(e.isin)} · ${esc(e.ticker || "")}</div></div>
        <div class="prix"><b>${eur(st?.prix, st?.prix < 10 ? 4 : 2)}</b><small>${st ? `${perf(varJour)} · ${provisoire(st.date) ? "provisoire" : `clôture du ${dFr(st.date)}`}` : "aucun cours"}</small></div>
      </div>
      <div class="periodes" role="group" aria-label="Période du graphique">
        ${[[30, "1M"], [182, "6M"], [365, "1A"], ["max", "Max"]].map(([v, t]) => `<button data-pfiche="${v}" class="${String(PERIODE_FICHE) === String(v) ? "actif" : ""}">${t}</button>`).join("")}
      </div>
      <div id="fGraphe"></div>
      <div class="grille-chiffres">
        ${chiffre("1 mois", perf(st?.perf.m1))}${chiffre("3 mois", perf(st?.perf.m3))}${chiffre("6 mois", perf(st?.perf.m6))}
        ${chiffre("Depuis le 1er janv.", perf(st?.perf.ytd))}${chiffre("1 an", perf(st?.perf.a1))}${chiffre("Depuis mon 1er achat", perf(perfAchat))}
      </div>
    </section>
    <div class="grille">
      <section class="carte">
        <h2>Ma ligne</h2>
        <div class="grille-chiffres">
          ${chiffre("Parts", nf(l.parts || 0, 0))}${chiffre("Valeur", eur(l.valeur, 0))}${chiffre("PRU", l.pru == null ? "—" : nf(l.pru, 4) + " €")}
          ${chiffre("Plus-value", `${eurS(l.pv)} (${pct(l.pvPct, true)})`, classeSigne(l.pv))}${chiffre("Investi", eur(l.cout, 0))}
          ${chiffre("Poids / cible", e.cible > 0 ? `${pct(l.poids)} / ${pct(e.cible, false, 0)}` : `${pct(l.poidsPEA)} du PEA`)}
        </div>
        <details><summary>${achats.length} achat${achats.length > 1 ? "s" : ""}${premier ? ` depuis le ${dFr(premier)}` : ""}</summary>
          <table class="journal"><tbody>${[...achats].reverse().map(a => `<tr><td>${dFr(a.date)}</td><td class="n">${a.parts}</td><td class="n">${eur(a.prix, 4)}</td><td class="n">${eur(a.parts * a.prix)}</td></tr>`).join("")}</tbody></table>
        </details>
        <h3>Statistiques</h3>
        <div class="grille-chiffres">
          ${chiffre("Volatilité 1 an", st?.volatilite == null ? "—" : pct(st.volatilite))}${chiffre("Plus haut 52 sem.", eur(st?.haut52))}${chiffre("Plus bas 52 sem.", eur(st?.bas52))}
          ${chiffre(`Pire baisse depuis ${st ? dCourt(st.debut) + "/" + st.debut.slice(2, 4) : "—"}`, st?.pireBaisse.date ? `${pct(st.pireBaisse.valeur)} (${dFr(st.pireBaisse.date)})` : "—")}
        </div>
      </section>
      <section class="carte">
        <h2>Identité <span class="aide">${f.au ? `données au ${dFr(f.au)}` : "fiche à compléter"}</span></h2>
        <dl class="identite">${dl.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        ${f.note ? `<div class="note-graphe">${esc(f.note)}</div>` : ""}
        <div class="pied">${f.source ? `<a class="btn lien note" href="${esc(f.source)}" target="_blank" rel="noopener">Source</a>` : ""}<button class="btn" id="btnModifierFiche">Modifier la fiche</button></div>
      </section>
    </div>
    ${f.top?.length || f.pays?.length || f.secteurs?.length ? `<div class="grille">
      ${f.top?.length ? `<section class="carte"><h2>10 premières positions <span class="aide">${nf(f.top.reduce((t, x) => t + x[1], 0), 1)} % du fonds</span></h2>${liste(f.top)}</section>` : ""}
      ${f.pays?.length ? `<section class="carte"><h2>Pays</h2>${liste(f.pays)}</section>` : ""}
      ${f.secteurs?.length ? `<section class="carte"><h2>Secteurs</h2>${liste(f.secteurs)}</section>` : ""}
    </div>` : ""}`;
  // graphique du cours avec mon PRU
  const s = C.serie(COURS.closes[e.isin]);
  const fin = s.length ? s[s.length - 1][0] : aujourdhui();
  const vue = PERIODE_FICHE === "max" ? s : s.filter(([d]) => d > C.ajouterJours(fin, -PERIODE_FICHE));
  const parDate = {};
  for (const a of achats) parDate[a.date] = (parDate[a.date] || 0) + a.parts;
  courbe($("fGraphe"), { dates: vue.map(x => x[0]), titre: `Cours de ${e.court}`, hauteur: 220,
    series: [{ nom: "Cours", couleur: couleur(e.isin), valeurs: vue.map(x => x[1]), aire: true },
             ...(l.pru ? [{ nom: "Mon PRU", couleur: "var(--verse)", valeurs: vue.map(() => l.pru), pointille: true, epaisseur: 1.5 }] : [])],
    format: v => eur(v, v < 10 ? 4 : 2), formatAxe: v => nf(v, v < 10 ? 2 : 0),
    bulle: i => [["Cours", eur(vue[i][1], vue[i][1] < 10 ? 4 : 2), couleur(e.isin)], ...(l.pru ? [["Mon PRU", nf(l.pru, 4) + " €", "var(--verse)"]] : []),
                 ...(parDate[vue[i][0]] ? [["Mon achat", `${parDate[vue[i][0]]} part(s)`]] : [])] });
  document.querySelectorAll("[data-pfiche]").forEach(b => b.onclick = () => { PERIODE_FICHE = b.dataset.pfiche === "max" ? "max" : +b.dataset.pfiche; dessinerFiche(); });
  $("btnModifierFiche").onclick = () => modifierFiche(e.isin);
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
    <div class="texte">Recopiez la fiche mensuelle de l'émetteur (tous les 6 mois environ). Pour les listes : une ligne par élément, « Nom ; pourcentage ».</div>
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
      <button class="btn" data-annuler>Annuler</button><button class="btn vert" data-ok>Enregistrer</button></div>`);
  const val = id => v.querySelector("#" + id).value.trim();
  v.querySelector("[data-annuler]").onclick = () => v.remove();
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
  const v = modale(`<h3>Ajouter un ETF ou une action</h3>
    <div class="texte">Recherche sur Euronext par ISIN, nom ou mnémonique. La ligne est ajoutée avec une cible à 0 % : réglez-la ensuite.
      <b>Vérifiez vous-même l'éligibilité au PEA</b> (l'application ne peut pas la contrôler).</div>
    <div class="outils"><input id="mlRecherche" placeholder="ex. FR0011869353 ou Amundi MSCI World" style="flex:1;min-width:0">
      <button class="btn primaire" data-chercher>Rechercher</button></div>
    <div class="resultats" id="mlResultats"></div>
    <div class="pied"><button class="btn" data-annuler>Fermer</button></div>`);
  const champ = v.querySelector("#mlRecherche"), zone = v.querySelector("#mlResultats");
  let resultats = [];
  v.querySelector("[data-annuler]").onclick = () => v.remove();
  const chercher = async () => {
    const q = champ.value.trim();
    if (q.length < 2) return;
    zone.innerHTML = `<div class="info">Recherche…</div>`;
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
    zone.innerHTML = `<div class="info">Vérification des cours…</div>`;
    const depuis = C.ajouterJours([DON.reglages.ouverture, DON.achats[0]?.date].filter(Boolean).sort()[0] || C.ajouterJours(aujourdhui(), -400), -7);
    const erreurs = await actualiserCours(COURS, [{ isin: r.isin, place: r.place }], depuis);
    if (erreurs.length || !Object.keys(COURS.closes[r.isin] || {}).length) {
      zone.innerHTML = `<div class="info neg">Impossible de récupérer les cours de ce titre sur Euronext ${esc(PLACES[r.place])}. Ligne non ajoutée.</div>`;
      return;
    }
    D.enregistrerCours(COURS);
    DON.etf = { maj: D.maintenant(), liste: [...etfs(), { isin: r.isin, court: court.trim() || r.nom, nom: r.nom, ticker: r.ticker, place: r.place, type: r.type, cible: 0 }] };
    sauver(); v.remove(); tout();
    toast(`${court.trim() || r.nom} ajouté (cible 0 %). Complétez sa fiche depuis l'Accueil si besoin.`);
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
  $("aFrais").textContent = fr.taux == null ? "—" : nf(fr.taux, 2) + " %/an";
  $("aFraisS").textContent = fr.taux == null ? "fiches à compléter" : `soit ≈ ${eur(fr.coutAnnuel, 0)} par an${fr.couverture < total - 1 ? " (lignes renseignées)" : ""}`;
  const pays = C.allocation(lignes, fiches, "pays"), secteurs = C.allocation(lignes, fiches, "secteurs");
  const premier = l => l.find(([n]) => n !== C.AUTRES && n !== C.NON_RENSEIGNE);
  const [p1, s1] = [premier(pays), premier(secteurs)];
  $("aPays").textContent = p1 ? p1[0] : "—"; $("aPaysS").textContent = p1 ? `${pct(p1[1])} du portefeuille` : "";
  $("aSecteur").textContent = s1 ? s1[0] : "—"; $("aSecteurS").textContent = s1 ? `${pct(s1[1])} du portefeuille` : "";
  const items = l => l.map(([nom, v]) => ({ nom, valeur: v, texte: pct(v), couleur: nom === C.AUTRES || nom === C.NON_RENSEIGNE ? "var(--verse)" : "var(--e1)" }));
  const sp = { pastilles: false };
  barres($("aGPays"), items(pays), sp);
  barres($("aGSecteurs"), items(secteurs), sp);
  barres($("aGTop"), items(C.positionsCumulees(lignes, fiches)), sp);
  $("aGEmetteurs").innerHTML = "<h3>Émetteurs</h3>"; const d1 = document.createElement("div"); barres(d1, items(C.repartitionPar(lignes, fiches, "emetteur")), sp); $("aGEmetteurs").appendChild(d1);
  $("aGReplication").innerHTML = "<h3>Réplication</h3>"; const d2 = document.createElement("div"); barres(d2, items(C.repartitionPar(lignes, fiches, "replication")), sp); $("aGReplication").appendChild(d2);
  const dates = Object.values(fiches).map(f => f.au).filter(Boolean).sort();
  const approx = etfs().filter(e => /approximation/i.test(fiches[e.isin]?.note || "")).map(e => e.court);
  $("aNote").textContent = `Calculé à partir des fiches des ETF${dates.length ? ` (données du ${dFr(dates[0])} au ${dFr(dates[dates.length - 1])})` : ""}, pondérées par la valeur actuelle de chaque ligne. « Autres » = pays ou secteurs non détaillés dans les fiches.`
    + (approx.length ? ` ${approx.join(", ")} : composition approchée (voir sa fiche).` : "");
}

// ---------- cours ----------
async function chargerCours(manuel = false) {
  if (!navigator.onLine) { if (manuel) toast("Pas de connexion : cours en mémoire utilisés.", true); return; }
  const depuis = [DON.reglages.ouverture, DON.achats[0]?.date].filter(Boolean).sort()[0] || C.ajouterJours(aujourdhui(), -400);
  const erreurs = await actualiserCours(COURS, titresCours(), C.ajouterJours(depuis, -7));
  D.enregistrerCours(COURS);
  tout();
  if (erreurs.length) toast(`Cours non mis à jour pour ${erreurs.length} ETF (Euronext injoignable) : derniers cours connus utilisés.`, true);
  else if (manuel) toast(`Cours actualisés ✓  ${libelleCours()}`);
}
$("btnActualiser").onclick = () => occupe($("btnActualiser"), () => chargerCours(true));

// ---------- thème : automatique (comme le téléphone / PC) → clair → sombre ----------
const CLE_THEME = "investir-pea:theme";
const THEMES = {
  auto: { nom: "automatique", svg: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>' },
  light: { nom: "clair", svg: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' },
  dark: { nom: "sombre", svg: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>' },
};
function appliquerTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else { delete document.documentElement.dataset.theme; t = "auto"; }
  try { localStorage.setItem(CLE_THEME, t); } catch { /* */ }
  $("btnTheme").innerHTML = `<svg viewBox="0 0 24 24">${THEMES[t].svg}</svg>`;
  $("btnTheme").title = `Thème ${THEMES[t].nom} (toucher pour changer)`;
  const sombre = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').content = sombre ? "#0f141a" : "#164278";
  return t;
}
let THEME = (() => { try { return localStorage.getItem(CLE_THEME) || "auto"; } catch { return "auto"; } })();
THEME = appliquerTheme(THEME);
$("btnTheme").onclick = () => {
  THEME = appliquerTheme({ auto: "light", light: "dark", dark: "auto" }[THEME]);
  toast(`Thème ${THEMES[THEME].nom}`);
};

// ---------- onglets ----------
let ONGLET = "accueil";
function ouvrirOnglet(nom) {
  if (nom !== "fiche") { ONGLET = nom; FICHE_ISIN = null; }
  document.querySelectorAll(".onglets button").forEach(x => x.classList.toggle("actif", x.dataset.onglet === (nom === "fiche" ? ONGLET : nom)));
  document.querySelectorAll("[data-panneau]").forEach(p => { p.hidden = p.dataset.panneau !== nom; });
  if (nom !== "fiche") try { sessionStorage.setItem("onglet", nom); } catch { /* */ }
  if (nom === "graphiques") graphiques();
  if (nom === "accueil") accueil();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".onglets button").forEach(b => b.onclick = () => {
  if (history.state?.fiche) history.back();     // ferme la fiche sans laisser d'entrée dans l'historique
  ouvrirOnglet(b.dataset.onglet);
});
window.addEventListener("popstate", ev => {
  if (ev.state?.fiche) { FICHE_ISIN = ev.state.fiche; ouvrirOnglet("fiche"); dessinerFiche(); }
  else if (!panneau("fiche").hidden) ouvrirOnglet(ONGLET);
});
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
  try {
    const b = JSON.parse(localStorage.getItem(CLE_BROUILLON) || "null");
    if (b?.ops?.length) { OPS = b.ops; VERSE_MANUEL = b.verse ?? null; BUDGET = b.budget || 0; }
  } catch { /* brouillon illisible */ }
  tout();
  let onglet = "accueil";
  try { onglet = sessionStorage.getItem("onglet") || "accueil"; } catch { /* */ }
  ouvrirOnglet(onglet);
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
