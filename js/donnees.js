// Stockage local (dans l'appareil), fusion de sauvegardes et export JSON / CSV.
import { NOTE_PLAN } from "./calculs.js";

const CLE = "investir-pea:donnees";
const CLE_COURS = "investir-pea:cours";
export const FORMAT = "investir-pea";

export const maintenant = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
export const nouvelId = () => (crypto.randomUUID ? crypto.randomUUID()
  : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2));

const lire = cle => { try { return JSON.parse(localStorage.getItem(cle)); } catch { return null; } };
const ecrire = (cle, v) => localStorage.setItem(cle, JSON.stringify(v));

export function vide() {
  // daté dans le passé : un import ou une fusion l'emporte toujours sur ces réglages par défaut
  const t = "2000-01-01T00:00:00Z";
  return {
    format: FORMAT, version: 1,
    reglages: { ouverture: null, plafond: 150000, maj: t },
    etf: { maj: t, liste: [
      { isin: "FR0011550185", court: "S&P 500", nom: "BNP Paribas Easy S&P 500 EUR C", ticker: "ESE", cible: 0.2 },
      { isin: "LU1829219390", court: "Euro Stoxx Banks", nom: "Amundi Euro Stoxx Banks Acc", ticker: "BNKE", cible: 0.2 },
      { isin: "FR0013412012", court: "MSCI Emerging Asia", nom: "Amundi PEA Asie Émergente (MSCI EM Asia) Screened", ticker: "PAASI", cible: 0.2 },
      { isin: "FR0011550193", court: "Stoxx Europe 600", nom: "BNP Paribas Easy Stoxx Europe 600 EUR C", ticker: "ETZ", cible: 0.2 },
      { isin: "LU1834987973", court: "Stoxx 600 Insurance", nom: "Amundi STOXX Europe 600 Insurance Acc", ticker: "INS", cible: 0.2 },
    ] },
    plan: { maj: t, montants: {}, jour: 2, regle: null, dernier: null },
    divisions: [{ isin: "LU1829219390", date: "2026-10-26", ratio: 80 }],
    achats: [], versements: [], supprimes: [],
  };
}

export const charger = () => lire(CLE);
export const enregistrer = d => ecrire(CLE, d);
export const chargerCours = () => lire(CLE_COURS) || { closes: {}, maj: null };
export const enregistrerCours = c => ecrire(CLE_COURS, c);

/** Demande au navigateur de ne pas effacer les données (stockage persistant). */
export async function demanderPersistance() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}

export function valider(d) {
  if (!d || d.format !== FORMAT) throw new Error("Ce fichier n'est pas une sauvegarde « Investir PEA ».");
  for (const k of ["etf", "plan", "reglages"]) if (!d[k]) throw new Error(`Sauvegarde incomplète (${k} manquant).`);
  for (const k of ["achats", "versements"]) if (!Array.isArray(d[k])) throw new Error(`Sauvegarde incomplète (${k} manquant).`);
  for (const a of d.achats) {
    if (!a.id || !/^\d{4}-\d\d-\d\d$/.test(a.date) || !(a.parts > 0) || !(a.prix > 0)) throw new Error("Achat invalide dans la sauvegarde.");
  }
  return d;
}

/** Fusion de deux sauvegardes (téléphone ↔ PC) :
 *  - achats et versements : union par identifiant, les suppressions de l'un comme de l'autre s'appliquent ;
 *  - cibles, plan, réglages : la version modifiée le plus récemment l'emporte. */
export function fusionner(local, autre) {
  valider(autre);
  const supprimes = [...new Set([...(local.supprimes || []), ...(autre.supprimes || [])])];
  const out = new Set(supprimes);
  const union = (x, y) => {
    const m = new Map();
    for (const e of [...x, ...y]) {
      const deja = m.get(e.id);
      if (!deja || (e.modifie || e.cree || "") > (deja.modifie || deja.cree || "")) m.set(e.id, e);
    }
    return [...m.values()].filter(e => !out.has(e.id)).sort((a, b) => a.date.localeCompare(b.date));
  };
  const recent = (a, b) => ((b?.maj || "") > (a?.maj || "") ? b : a);
  const divisions = new Map();
  for (const d of [...(local.divisions || []), ...(autre.divisions || [])]) divisions.set(d.isin + d.date, d);
  const avant = { achats: local.achats.length, versements: local.versements.length };
  const fusion = {
    format: FORMAT, version: 1,
    reglages: recent(local.reglages, autre.reglages),
    etf: recent(local.etf, autre.etf),
    plan: recent(local.plan, autre.plan),
    divisions: [...divisions.values()],
    achats: union(local.achats, autre.achats),
    versements: union(local.versements, autre.versements),
    supprimes,
  };
  // la dernière exécution du plan enregistrée est la plus récente des deux appareils
  const derniers = [local.plan?.dernier, autre.plan?.dernier].filter(Boolean).sort();
  if (derniers.length) fusion.plan = { ...fusion.plan, dernier: derniers.pop() };
  return { donnees: fusion, ajouts: { achats: fusion.achats.length - avant.achats, versements: fusion.versements.length - avant.versements } };
}

export function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nom });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportJSON(d) {
  return JSON.stringify({ ...d, exporte: maintenant() }, null, 1);
}

/** Journal au format CSV (séparateur « ; », virgule décimale : s'ouvre directement dans Excel). */
export function exportCSV(d) {
  const noms = Object.fromEntries(d.etf.liste.map(e => [e.isin, e.court]));
  const num = v => String(v).replace(".", ",");
  const lignes = [["Date", "ETF", "ISIN", "Parts", "Prix (€)", "Montant (€)", "Type"].join(";")];
  for (const a of [...d.achats].sort((x, y) => x.date.localeCompare(y.date))) {
    lignes.push([a.date, noms[a.isin] || a.isin, a.isin, a.parts, num(a.prix), num((a.parts * a.prix).toFixed(2)),
                 a.note || ""].join(";"));
  }
  lignes.push("", ["Versements", "", "", "", "", "Montant (€)", ""].join(";"));
  for (const v of [...d.versements].sort((x, y) => x.date.localeCompare(y.date))) {
    lignes.push([v.date, "", "", "", "", num(v.montant.toFixed(2)), (v.note || "Versement") + (v.type === "ajustement" ? " (hors total versé)" : "")].join(";"));
  }
  return "﻿" + lignes.join("\r\n");
}

export const estPlan = a => a.note === NOTE_PLAN;
