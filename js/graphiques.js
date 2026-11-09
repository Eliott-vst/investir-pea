// Graphiques SVG faits main (aucune bibliothèque) : courbes avec réticule + info-bulle, barres horizontales.

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const dCourt = iso => { const [a, m, j] = iso.split("-"); return `${+j} ${MOIS[+m - 1]} ${a}`; };

function graduations(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const brut = (max - min) / n, p = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map(k => k * p).find(k => k >= brut);
  const out = [];
  for (let v = Math.floor(min / pas) * pas; v <= max + pas * 0.001; v += pas) out.push(+v.toFixed(10));
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + pas);
  return out;
}

/** Courbe(s) temporelle(s).
 *  opts : { dates: [iso], series: [{nom, couleur, valeurs, pointille}], format: v => texte, formatAxe, zero: bool,
 *           bulle: i => [[libellé, texte, couleur?]] (optionnel) } */
export function courbe(conteneur, opts) {
  conteneur.classList.add("graphe");
  conteneur.innerHTML = "";
  const { dates, series } = opts;
  if (dates.length < 2) { conteneur.innerHTML = `<div class="vide">Pas encore assez de données.</div>`; return; }
  if (series.length > 1) {
    const leg = document.createElement("div"); leg.className = "legende";
    leg.innerHTML = series.map(s => `<span><i class="${s.pointille ? "pointille" : ""}" style="--c:${s.couleur}"></i>${s.nom}</span>`).join("");
    conteneur.appendChild(leg);
  }
  const zone = document.createElement("div"); zone.className = "graphe-zone"; conteneur.appendChild(zone);
  const bulle = document.createElement("div"); bulle.className = "bulle"; bulle.hidden = true; zone.appendChild(bulle);

  const L = Math.max(280, zone.clientWidth || conteneur.clientWidth || 600);
  const H = opts.hauteur || (L < 500 ? 210 : 260);
  const m = { h: 10, b: 24, g: 8, d: 8 };
  const toutes = series.flatMap(s => s.valeurs).filter(v => v != null && isFinite(v));
  let min = Math.min(...toutes), max = Math.max(...toutes);
  if (opts.zero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  const ticks = graduations(min, max);
  min = ticks[0]; max = ticks[ticks.length - 1];
  const fa = opts.formatAxe || opts.format;
  // largeur de l'axe Y d'après le libellé le plus long
  m.g = 10 + Math.max(...ticks.map(t => fa(t).length)) * 6.6;
  const x = i => m.g + (i / (dates.length - 1)) * (L - m.g - m.d);
  const y = v => m.h + (1 - (v - min) / (max - min)) * (H - m.h - m.b);

  const svg = el("svg", { viewBox: `0 0 ${L} ${H}`, width: L, height: H, role: "img", "aria-label": opts.titre || "graphique" });
  for (const t of ticks) {
    svg.appendChild(el("line", { x1: m.g, x2: L - m.d, y1: y(t), y2: y(t), class: t === 0 && opts.zero ? "axe-zero" : "grille" }));
    const tx = el("text", { x: m.g - 6, y: y(t) + 4, "text-anchor": "end", class: "axe" }); tx.textContent = fa(t); svg.appendChild(tx);
  }
  // repères de temps : un libellé par mois (ou par trimestre / année si la période est longue)
  const jours = dates.length, moisVus = new Set();
  const pasMois = jours > 400 ? 6 : jours > 200 ? 3 : jours > 70 ? 1 : 0;
  let dernierX = -1e9;
  if (pasMois) dates.forEach((d, i) => {
    const cle = d.slice(0, 7);
    if (moisVus.has(cle)) return; moisVus.add(cle);
    const mo = +d.slice(5, 7) - 1;
    if (i === 0 || mo % pasMois || x(i) - dernierX < 52) return;
    dernierX = x(i);
    const tx = el("text", { x: x(i), y: H - 6, "text-anchor": "middle", class: "axe" });
    tx.textContent = mo === 0 ? d.slice(0, 4) : MOIS[mo];
    svg.appendChild(tx);
  });
  if (!pasMois) {   // période courte : quelques dates
    const n = 4;
    for (let k = 0; k <= n; k++) {
      const i = Math.round(k * (jours - 1) / n), d = dates[i];
      const tx = el("text", { x: x(i), y: H - 6, "text-anchor": k === 0 ? "start" : k === n ? "end" : "middle", class: "axe" });
      tx.textContent = `${+d.slice(8)} ${MOIS[+d.slice(5, 7) - 1]}`; svg.appendChild(tx);
    }
  }
  for (const s of series) {
    let dpath = "", leve = true;
    s.valeurs.forEach((v, i) => {
      if (v == null || !isFinite(v)) { leve = true; return; }
      dpath += `${leve ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; leve = false;
    });
    if (s.aire) {
      const base = y(Math.max(min, 0));
      svg.appendChild(el("path", { d: `${dpath}L${x(dates.length - 1)},${base}L${x(0)},${base}Z`, fill: s.couleur, opacity: 0.1 }));
    }
    svg.appendChild(el("path", { d: dpath, fill: "none", stroke: s.couleur, "stroke-width": 2, "stroke-linejoin": "round",
                                 "stroke-linecap": "round", ...(s.pointille ? { "stroke-dasharray": "5 4" } : {}) }));
  }
  // réticule
  const reticule = el("line", { y1: m.h, y2: H - m.b, class: "reticule", visibility: "hidden" });
  svg.appendChild(reticule);
  const points = series.map(s => { const c = el("circle", { r: 4.5, fill: s.couleur, class: "point", visibility: "hidden" }); svg.appendChild(c); return c; });
  const capte = el("rect", { x: m.g, y: 0, width: L - m.g - m.d, height: H, fill: "transparent" });
  svg.appendChild(capte);
  zone.appendChild(svg);

  const montrer = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (L / r.width);
    const i = Math.max(0, Math.min(dates.length - 1, Math.round((px - m.g) / (L - m.g - m.d) * (dates.length - 1))));
    reticule.setAttribute("x1", x(i)); reticule.setAttribute("x2", x(i)); reticule.setAttribute("visibility", "visible");
    series.forEach((s, k) => {
      const v = s.valeurs[i];
      points[k].setAttribute("visibility", v == null ? "hidden" : "visible");
      if (v != null) { points[k].setAttribute("cx", x(i)); points[k].setAttribute("cy", y(v)); }
    });
    const lignes = opts.bulle ? opts.bulle(i) : series.map(s => [s.nom, opts.format(s.valeurs[i]), s.couleur]);
    bulle.innerHTML = `<b>${dCourt(dates[i])}</b>` + lignes.map(([l, t, c]) =>
      `<div>${c ? `<i style="--c:${c}"></i>` : ""}<span>${l}</span><b>${t}</b></div>`).join("");
    bulle.hidden = false;
    const bx = x(i) * (r.width / L), bw = bulle.offsetWidth;
    bulle.style.left = Math.max(0, Math.min(r.width - bw, bx + (bx > r.width / 2 ? -bw - 12 : 12))) + "px";
  };
  const cacher = () => { reticule.setAttribute("visibility", "hidden"); points.forEach(p => p.setAttribute("visibility", "hidden")); bulle.hidden = true; };
  capte.addEventListener("pointermove", montrer);
  capte.addEventListener("pointerdown", montrer);
  capte.addEventListener("pointerleave", cacher);
}

/** Barres horizontales autour de zéro. items : [{nom, couleur, valeur, texte, detail}] */
export function barres(conteneur, items, opts = {}) {
  const maxAbs = Math.max(...items.map(i => Math.abs(i.valeur || 0)), 1e-9);
  const aNeg = items.some(i => i.valeur < 0), aPos = items.some(i => i.valeur > 0);
  const zero = aNeg && aPos ? 50 : aNeg ? 100 : 0;
  const echelle = aNeg && aPos ? 50 : 100;
  conteneur.innerHTML = `<div class="barres">${items.map(i => {
    const w = Math.abs(i.valeur || 0) / maxAbs * echelle;
    const gauche = i.valeur < 0 ? zero - w : zero;
    return `<div class="barre-ligne" title="${i.nom} : ${i.texte}${i.detail ? " · " + i.detail : ""}">
      <span class="barre-nom"><i class="pastille" style="background:${i.couleur}"></i>${i.nom}</span>
      <span class="barre-piste">${aNeg && aPos ? `<b class="barre-zero" style="left:${zero}%"></b>` : ""}
        <i class="barre-val" style="left:${gauche}%;width:${Math.max(w, 0.5)}%;background:${i.couleur}"></i></span>
      <span class="barre-txt n">${i.texte}${i.detail ? `<small>${i.detail}</small>` : ""}</span></div>`;
  }).join("")}</div>${opts.note ? `<div class="note-graphe">${opts.note}</div>` : ""}`;
}
