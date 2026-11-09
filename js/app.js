// Interface « Investir PEA » : état, rendu des écrans, actions.
import * as C from "./calculs.js";
import * as D from "./donnees.js";
import { actualiser as actualiserCours, provisoire, jourParis } from "./cours.js";
import { courbe, barres } from "./graphiques.js";

export const VERSION = "1.0.0";
const COULEURS = ["var(--e1)", "var(--e2)", "var(--e3)", "var(--e4)", "var(--e5)"];
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
let VERSE_MANUEL = null;              // montant versé imposé (null = calcul auto)
let VERSE_ORIGINE = "";
let PERIODE = "max";
let VUE = { lignes: [], resume: null, hist: [] };

const etfs = () => DON.etf.liste;
const couleur = isin => COULEURS[Math.max(0, etfs().findIndex(e => e.isin === isin)) % COULEURS.length];
const nomEtf = isin => etfs().find(e => e.isin === isin)?.court || isin;
const prixActuels = () => Object.fromEntries(etfs().map(e => [e.isin, C.dernierCours(COURS.closes[e.isin])?.prix ?? null]));

function sauver() { DON.modifie = D.maintenant(); D.enregistrer(DON); }
function sauverBrouillon() {
  try { localStorage.setItem(CLE_BROUILLON, JSON.stringify({ ops: OPS, verse: VERSE_MANUEL })); } catch { /* plein */ }
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

  const echelle = Math.max(0.6, ...VUE.lignes.map(l => Math.max(l.poids || 0, l.cible)));
  $("posCorps").innerHTML = VUE.lignes.map(l => {
    const poids = l.cible > 0 ? l.poids : l.poidsPEA;
    return `<tr>
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
              parts: o.parts || 0, prix: o.prix ?? null, libelle: o.libelle || "", note: o.note || C.NOTE_ACHAT, verse: o.verse };
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
    : `<div class="vide">Préremplissez votre plan, demandez une proposition ou ajoutez un achat.</div>`;
  majTotaux();
  const pl = DON.plan, total = Object.values(pl.montants || {}).reduce((a, b) => a + b, 0);
  const debut = C.debutPlan(pl);
  $("infoPlan").textContent = total ? `${eur(total, 0)}/mois le ${pl.jour} · exécutions après le ${dFr(debut)}` : "aucun plan défini (onglet Stratégie)";
  $("btnPlan").disabled = !total;
  $("infoProposer").textContent = VUE.resume.liquidites > 0.005 ? `+ ${eur(VUE.resume.liquidites)} de liquidités incluses` : "";
}

function majTotaux() {
  const auto = C.verseAuto(OPS);
  const verse = VERSE_MANUEL ?? auto;
  if (document.activeElement !== $("fVerse")) $("fVerse").value = OPS.length || VERSE_MANUEL != null ? verse.toFixed(2) : "";
  $("infoVerse").textContent = VERSE_MANUEL != null ? `${VERSE_ORIGINE || "modifié à la main"} (calcul auto : ${eur(auto)})` : "prérempli : montants du plan + achats ponctuels";
  $("btnVerseAuto").hidden = VERSE_MANUEL == null;
  const dispo = verse + Math.max(0, VUE.resume.liquidites);
  const investi = OPS.reduce((s, o) => s + (o.parts || 0) * (o.prix || 0), 0);
  const reste = dispo - investi;
  $("tDispo").textContent = eur(dispo); $("tInvesti").textContent = eur(investi);
  $("tReste").textContent = eur(reste); $("tReste").className = reste < -0.005 ? "neg" : "";
  $("tNb").textContent = OPS.filter(o => o.parts > 0).length;
  $("alerteOp").textContent = reste < -0.005 ? "Vous investissez plus que le versé + liquidités : vérifiez le montant versé." : "";
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
$("btnVider").onclick = () => { OPS = []; VERSE_MANUEL = null; dessinerOps(); };
$("fVerse").addEventListener("input", () => { VERSE_MANUEL = parseFloat($("fVerse").value) || 0; VERSE_ORIGINE = ""; majTotaux(); });
$("btnVerseAuto").onclick = () => { VERSE_MANUEL = null; majTotaux(); };

$("btnPlan").onclick = () => {
  const r = C.preremplirPlan(DON.plan, COURS.closes, aujourdhui());
  if (!r.lignes.length) return toast(`Aucune exécution du plan depuis le ${dFr(r.debut)} (prochaine : le ${dFr(prochaineExecution())}).`);
  OPS = OPS.filter(o => o.note !== C.NOTE_PLAN);
  r.lignes.forEach(l => ajouterLigne({ ...l, libelle: l.coursDu ? `estim. clôt. ${dCourt(l.coursDu)}` : "cours introuvable" }));
  OPS.sort((a, b) => a.date.localeCompare(b.date));
  VERSE_MANUEL = null;
  dessinerOps();
  toast(`${r.executions.length} exécution(s) du plan ajoutée(s) : comparez avec Trade Republic et corrigez si besoin.`);
};
function prochaineExecution() {
  const t = aujourdhui(); const [a, m] = t.split("-").map(Number);
  const e = C.executionPlan(DON.plan.jour, a, m);
  return e > t ? e : C.executionPlan(DON.plan.jour, m === 12 ? a + 1 : a, m === 12 ? 1 : m + 1);
}

$("btnProposer").onclick = () => {
  const montant = parseFloat($("fMontant").value) || 0;
  const liq = Math.max(0, VUE.resume.liquidites);
  if (montant + liq <= 0) return toast("Indiquez le montant à investir.", true);
  const lignes = VUE.lignes.filter(l => l.prix).map(l => ({ isin: l.isin, parts: l.parts, prix: l.prix, cible: l.cible }));
  const r = C.repartir(lignes, montant + liq);
  const achats = Object.entries(r.achats).filter(([, n]) => n > 0);
  if (!achats.length) return toast("Montant trop faible pour acheter une part des lignes en retard.");
  const t = aujourdhui();
  achats.forEach(([isin, n]) => ajouterLigne({ isin, parts: n, date: t, note: C.NOTE_ACHAT, ...prixDuJour(isin, t) }));
  if (montant !== C.verseAuto(OPS) && OPS.every(o => o.note !== C.NOTE_PLAN)) { VERSE_MANUEL = montant; VERSE_ORIGINE = "= montant à investir"; }
  dessinerOps();
  const apres = C.poidsApres(lignes, r.achats);
  toast(`Proposition ajoutée (reste ${eur(r.reste)}). Poids après : ${achats.map(([i]) => `${nomEtf(i)} ${pct(apres[i])}`).join(", ")}. Passez vos ordres puis ajustez parts et prix réels.`);
};

$("btnValider").onclick = () => {
  const lignes = OPS.filter(o => o.parts > 0);
  if (!lignes.length) return toast("Ajoutez au moins un achat avec des parts.", true);
  if (lignes.some(o => !(o.prix > 0))) return toast("Il manque un prix.", true);
  if (lignes.some(o => o.date > aujourdhui())) return toast("Une date n'est pas encore arrivée.", true);
  const verse = VERSE_MANUEL ?? C.verseAuto(OPS);
  const investi = lignes.reduce((s, o) => s + o.parts * o.prix, 0);
  const liqAvant = VUE.resume.liquidites;
  const liqApres = liqAvant + verse - investi;
  const v = modale(`<h3>Enregistrer ${lignes.length} achat${lignes.length > 1 ? "s" : ""} ?</h3>
    <ul>${[...lignes].sort((a, b) => a.date.localeCompare(b.date)).map(o => `<li>${dFr(o.date)} · ${o.parts} × ${esc(nomEtf(o.isin))} à ${eur(o.prix, 4)} = <b>${eur(o.parts * o.prix)}</b> <span class="etiquette ${o.note === C.NOTE_PLAN ? "plan" : ""}">${o.note === C.NOTE_PLAN ? "Plan" : "Ponctuel"}</span></li>`).join("")}</ul>
    <div>Investi <b>${eur(investi)}</b> · versé <b>+${eur(verse)}</b> · liquidités ${eur(liqAvant)} → <b class="${liqApres < -0.005 ? "neg" : ""}">${eur(liqApres)}</b></div>
    ${liqApres < -0.005 ? `<div class="rappel">Les liquidités deviendraient négatives : le montant versé est sans doute trop faible.</div>` : ""}
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
    v.remove(); OPS = []; VERSE_MANUEL = null; $("fMontant").value = "";
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
    return `<tr><td><div class="etf"><span class="pastille" style="background:${couleur(e.isin)}"></span>${esc(e.court)}</div></td>
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
  $("vInfo").textContent = `${vs.length} versements · total ${eur(VUE.resume.verse)}`;
  $("vCorps").innerHTML = vs.map(v => `<tr data-id="${esc(v.id)}"><td>${dFr(v.date)}</td><td class="info">${esc(v.note || "Versement")}</td>
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
function graphiques() {
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
    format: v => pct(v, true, 2), formatAxe: v => nf(v * 100, 0) + " %",
    bulle: i => [["Plus-value", pct(h[i].pvPct, true, 2), "var(--e1)"], ["en euros", eurS(h[i].pv)], ["Investi", eur(h[i].investi, 0)]] });

  $("gValInfo").textContent = der && prem ? `${eur(der.valeur, 0)} · versé ${eur(der.verse, 0)}` : "";
  courbe($("gVal"), { dates, titre: "Valeur du PEA et total versé",
    series: [{ nom: "Valeur du PEA", couleur: "var(--e1)", valeurs: h.map(p => p.valeur) },
             { nom: "Total versé", couleur: "var(--verse)", valeurs: h.map(p => p.verse), pointille: true }],
    format: v => eur(v, 0), formatAxe: k,
    bulle: i => [["Valeur du PEA", eur(h[i].valeur, 0), "var(--e1)"], ["Total versé", eur(h[i].verse, 0), "var(--verse)"], ["Écart", eurS(h[i].valeur - h[i].verse)]] });

  barres($("gEcart"), VUE.lignes.filter(l => l.cible > 0).map(l => ({
    nom: l.court, couleur: couleur(l.isin), valeur: l.ecart * 100,
    texte: (l.ecart >= 0 ? "+" : "−") + nf(Math.abs(l.ecart * 100), 1) + " pt", detail: `${pct(l.poids)} / ${pct(l.cible, false, 0)}` })),
    { note: "À droite : en avance sur la cible. À gauche : en retard, renforcé en priorité." });
  barres($("gPvEtf"), VUE.lignes.map(l => ({ nom: l.court, couleur: couleur(l.isin), valeur: l.pv || 0, texte: eurS(l.pv), detail: pct(l.pvPct, true) })));
}
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

// ---------- cours ----------
async function chargerCours(manuel = false) {
  if (!navigator.onLine) { if (manuel) toast("Pas de connexion : cours en mémoire utilisés.", true); return; }
  const depuis = [DON.reglages.ouverture, DON.achats[0]?.date].filter(Boolean).sort()[0] || C.ajouterJours(aujourdhui(), -400);
  const erreurs = await actualiserCours(COURS, etfs().map(e => e.isin), C.ajouterJours(depuis, -7));
  D.enregistrerCours(COURS);
  tout();
  if (erreurs.length) toast(`Cours non mis à jour pour ${erreurs.length} ETF (Euronext injoignable) : derniers cours connus utilisés.`, true);
  else if (manuel) toast(`Cours actualisés ✓  ${libelleCours()}`);
}
$("btnActualiser").onclick = () => occupe($("btnActualiser"), () => chargerCours(true));

// ---------- onglets ----------
function ouvrirOnglet(nom) {
  document.querySelectorAll(".onglets button").forEach(x => x.classList.toggle("actif", x.dataset.onglet === nom));
  document.querySelectorAll("[data-panneau]").forEach(p => { p.hidden = p.dataset.panneau !== nom; });
  try { sessionStorage.setItem("onglet", nom); } catch { /* */ }
  if (nom === "graphiques") graphiques();
  if (nom === "accueil") accueil();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".onglets button").forEach(b => b.onclick = () => ouvrirOnglet(b.dataset.onglet));
let attente;
window.addEventListener("resize", () => {
  if (!VUE.resume) return;
  clearTimeout(attente);
  attente = setTimeout(() => { if (!panneau("graphiques").hidden) graphiques(); if (!panneau("accueil").hidden) accueil(); }, 150);
});

// ---------- démarrage ----------
function demarrer() {
  $("ecranVide").hidden = true;
  try {
    const b = JSON.parse(localStorage.getItem(CLE_BROUILLON) || "null");
    if (b?.ops?.length) { OPS = b.ops; VERSE_MANUEL = b.verse ?? null; }
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
