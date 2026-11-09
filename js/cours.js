// Cours de clôture Euronext Paris (EUR), téléchargés directement depuis live.euronext.com.
// Le service autorise les appels depuis un navigateur (CORS) et renvoie un historique ajusté des divisions.
import { ajouterJours, isoLocal, serie } from "./calculs.js";

const BASE = "https://live.euronext.com/en/ajax/AwlHistoricalPrice/getFullDownloadAjax/";
const DELAI = 20000;

function url(isin, debut, fin) {
  const p = new URLSearchParams({ format: "csv", decimal_separator: ".", date_form: "d/m/Y", op: "",
                                  adjusted: "Y", base100: "", startdate: debut, enddate: fin });
  return `${BASE}${isin}-XPAR?${p}`;
}

/** CSV Euronext → {date ISO: clôture} */
export function lireCSV(texte) {
  const out = {};
  const lignes = texte.replace(/^﻿/, "").split(/\r?\n/);
  const i = lignes.findIndex(l => l.startsWith("Date;"));
  if (i < 0) throw new Error("réponse Euronext inattendue");
  const entete = lignes[i].split(";").map(s => s.replace(/"/g, ""));
  const iClose = entete.indexOf("Close"), iLast = entete.indexOf("Last");
  for (const l of lignes.slice(i + 1)) {
    const c = l.split(";");
    const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(c[0]);
    if (!m) continue;
    const v = parseFloat(c[iClose]) || parseFloat(c[iLast]);
    if (v > 0) out[`${m[3]}-${m[2]}-${m[1]}`] = v;
  }
  return out;
}

async function telecharger(isin, debut, fin) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DELAI);
  try {
    const r = await fetch(url(isin, debut, fin), { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`Euronext a répondu ${r.status}`);
    return lireCSV(await r.text());
  } finally { clearTimeout(t); }
}

/** Heure de Paris « HH:MM » */
export function heureParis(d = new Date()) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
export function jourParis(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** Le cours du jour est provisoire tant que l'enchère de clôture (17h30-17h35) n'est pas passée. */
export const provisoire = date => date === jourParis() && heureParis() < "17:40";

/** Met à jour le cache des clôtures. Télécharge depuis la dernière date connue (moins une marge),
 *  et tout l'historique si une division est apparue (cours anciens modifiés) ou si le cache est vide. */
export async function actualiser(cache, isins, depuis) {
  const fin = isoLocal();
  const erreurs = [];
  await Promise.all(isins.map(async isin => {
    const connus = cache.closes[isin] || {};
    const s = serie(connus);
    const debut = s.length && s[0][0] <= depuis ? ajouterJours(s[s.length - 1][0], -10) : depuis;
    try {
      let neufs = await telecharger(isin, debut, fin);
      const change = Object.entries(neufs).some(([d, v]) => connus[d] && Math.abs(v / connus[d] - 1) > 0.2);
      if (change) neufs = await telecharger(isin, depuis, fin);
      cache.closes[isin] = change ? neufs : { ...connus, ...neufs };
    } catch (e) {
      erreurs.push(`${isin} : ${e.name === "AbortError" ? "délai dépassé" : e.message}`);
    }
  }));
  if (erreurs.length < isins.length) cache.maj = new Date().toISOString();
  return erreurs;
}
