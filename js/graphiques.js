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
  const enLegende = series.filter(s => s.legende !== false);
  if (enLegende.length > 1 || opts.legende) {
    const leg = document.createElement("div"); leg.className = "legende";
    leg.innerHTML = enLegende.map(s => `<span><i class="${s.pointille ? "pointille" : ""}" style="--c:${s.couleur}"></i>${s.nom}</span>`).join("")
      + (opts.legende || "");
    conteneur.appendChild(leg);
  }
  const zone = document.createElement("div"); zone.className = "graphe-zone"; conteneur.appendChild(zone);
  const bulle = document.createElement("div"); bulle.className = "bulle"; bulle.hidden = true; zone.appendChild(bulle);

  const L = Math.max(260, zone.clientWidth || conteneur.clientWidth || 600);
  const H = opts.hauteur || (L < 500 ? 210 : 260);
  // « épuré » : ni axes ni grille (courbe de l'Accueil, façon application bancaire)
  const epure = !!opts.epure;
  const m = epure ? { h: 8, b: 8, g: 4, d: 4 } : { h: 10, b: 24, g: 8, d: 8 };
  const toutes = series.flatMap(s => s.valeurs).filter(v => v != null && isFinite(v));
  let min = Math.min(...toutes), max = Math.max(...toutes);
  if (opts.zero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  const ticks = epure ? [] : graduations(min, max);
  if (epure) { const marge = (max - min || Math.abs(max) || 1) * 0.08; min -= marge; max += marge; }
  else { min = ticks[0]; max = ticks[ticks.length - 1]; }
  const fa = opts.formatAxe || opts.format;
  // largeur de l'axe Y d'après le libellé le plus long
  if (!epure) m.g = 10 + Math.max(...ticks.map(t => fa(t).length)) * 6.8;
  const x = i => m.g + (i / (dates.length - 1)) * (L - m.g - m.d);
  const y = v => m.h + (1 - (v - min) / (max - min)) * (H - m.h - m.b);

  const svg = el("svg", { viewBox: `0 0 ${L} ${H}`, width: L, height: H, role: "img", "aria-label": opts.titre || "graphique" });
  for (const t of ticks) {
    svg.appendChild(el("line", { x1: m.g, x2: L - m.d, y1: y(t), y2: y(t), class: t === 0 && opts.zero ? "axe-zero" : "grille" }));
    const tx = el("text", { x: m.g - 6, y: y(t) + 4, "text-anchor": "end", class: "axe" }); tx.textContent = fa(t); svg.appendChild(tx);
  }
  // repères de temps : un libellé par mois (ou par trimestre / année si la période est longue)
  const jours = dates.length, moisVus = new Set();
  const pasMois = opts.pasMois ?? (jours > 400 ? 6 : jours > 200 ? 3 : jours > 70 ? 1 : 0);
  let dernierX = -1e9;
  if (pasMois && !epure) dates.forEach((d, i) => {
    const cle = d.slice(0, 7);
    if (moisVus.has(cle)) return; moisVus.add(cle);
    const mo = +d.slice(5, 7) - 1;
    if (i === 0 || mo % pasMois || x(i) - dernierX < 52) return;
    dernierX = x(i);
    const tx = el("text", { x: x(i), y: H - 6, "text-anchor": "middle", class: "axe" });
    tx.textContent = mo === 0 ? d.slice(0, 4) : MOIS[mo];
    svg.appendChild(tx);
  });
  if (!pasMois && !epure) {   // période courte : quelques dates
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
    if (s.signe) {
      // gain en vert au-dessus de zéro, perte en rouge en dessous, remplissage en dégradé vers la ligne zéro
      const id = "g" + Math.random().toString(36).slice(2, 8), y0 = y(Math.min(Math.max(0, min), max));
      const defs = el("defs");
      defs.innerHTML = `<clipPath id="${id}h"><rect x="0" y="0" width="${L}" height="${y0}"/></clipPath>
        <clipPath id="${id}b"><rect x="0" y="${y0}" width="${L}" height="${H}"/></clipPath>
        <linearGradient id="${id}gh" x1="0" y1="${m.h}" x2="0" y2="${y0}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="var(--vert)" stop-opacity=".35"/><stop offset="1" stop-color="var(--vert)" stop-opacity="0"/></linearGradient>
        <linearGradient id="${id}gb" x1="0" y1="${H - m.b}" x2="0" y2="${y0}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="var(--rouge)" stop-opacity=".35"/><stop offset="1" stop-color="var(--rouge)" stop-opacity="0"/></linearGradient>`;
      svg.appendChild(defs);
      const aire = `${dpath}L${x(dates.length - 1)},${y0}L${x(0)},${y0}Z`;
      for (const [cote, coul] of [["h", "var(--vert)"], ["b", "var(--rouge)"]]) {
        const g = el("g", { "clip-path": `url(#${id}${cote})` });
        g.appendChild(el("path", { d: aire, fill: `url(#${id}g${cote})` }));
        g.appendChild(el("path", { d: dpath, fill: "none", stroke: coul, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        svg.appendChild(g);
      }
      continue;
    }
    if (s.aire) {
      // remplissage en dégradé, du trait vers le bas du graphique
      const base = epure ? H : y(Math.max(min, 0)), id = "a" + Math.random().toString(36).slice(2, 8);
      const defs = el("defs");
      defs.innerHTML = `<linearGradient id="${id}" x1="0" y1="${m.h}" x2="0" y2="${base}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${s.couleur}" stop-opacity=".22"/><stop offset="1" stop-color="${s.couleur}" stop-opacity="0"/></linearGradient>`;
      svg.appendChild(defs);
      svg.appendChild(el("path", { d: `${dpath}L${x(dates.length - 1)},${base}L${x(0)},${base}Z`, fill: `url(#${id})` }));
    }
    svg.appendChild(el("path", { d: dpath, fill: "none", stroke: s.couleur, "stroke-width": s.epaisseur || 2, "stroke-linejoin": "round",
                                 ...(s.opacite ? { opacity: s.opacite } : {}),
                                 "stroke-linecap": "round", ...(s.pointille ? { "stroke-dasharray": "5 4" } : {}) }));
  }
  // réticule
  const reticule = el("line", { y1: m.h, y2: H - m.b, class: "reticule", visibility: "hidden" });
  svg.appendChild(reticule);
  const points = series.map(s => { const c = el("circle", { r: s.legende === false ? 0 : 4.5, fill: s.couleur, class: "point", visibility: "hidden" }); svg.appendChild(c); return c; });
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
    const lignes = opts.bulle ? opts.bulle(i) : enLegende.map(s => [s.nom, opts.format(s.valeurs[i]), s.couleur]);
    bulle.innerHTML = `<b>${(opts.titreBulle || dCourt)(dates[i])}</b>` + lignes.map(([l, t, c]) =>
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

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Barres horizontales autour de zéro. items : [{nom, couleur, valeur, texte, detail, sous}]
 *  detail : petit texte sous la valeur ; sous : ligne explicative sous la barre (toute la largeur). */
export function barres(conteneur, items, opts = {}) {
  const maxAbs = Math.max(...items.map(i => Math.abs(i.valeur || 0)), 1e-9);
  const aNeg = items.some(i => i.valeur < 0), aPos = items.some(i => i.valeur > 0);
  const zero = aNeg && aPos ? 50 : aNeg ? 100 : 0;
  const echelle = aNeg && aPos ? 50 : 100;
  conteneur.innerHTML = `<div class="barres">${items.map(i => {
    const w = Math.abs(i.valeur || 0) / maxAbs * echelle;
    const gauche = i.valeur < 0 ? zero - w : zero;
    return `<div class="barre-ligne" title="${esc(i.nom)} : ${esc(i.texte)}${i.detail ? " · " + esc(i.detail) : ""}">
      <span class="barre-nom">${opts.pastilles === false ? "" : `<i class="pastille" style="background:${i.couleur}"></i>`}${esc(i.nom)}</span>
      <span class="barre-piste">${aNeg && aPos ? `<b class="barre-zero" style="left:${zero}%"></b>` : ""}
        <i class="barre-val" style="left:${gauche}%;width:${Math.max(w, 0.5)}%;background:${i.couleur}"></i></span>
      <span class="barre-txt n">${esc(i.texte)}${i.detail ? `<small>${esc(i.detail)}</small>` : ""}</span>
      ${i.sous ? `<span class="barre-sous">${esc(i.sous)}</span>` : ""}</div>`;
  }).join("")}</div>${opts.note ? `<div class="note-graphe">${esc(opts.note)}</div>` : ""}`;
}

