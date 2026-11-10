// Fiches d'identité et composition des ETF (données statiques, à mettre à jour tous les 6 mois environ
// depuis les fiches mensuelles des émetteurs : onglet Accueil → toucher un ETF → « Modifier la fiche »).
// Source initiale : justETF, données au 24-30/09/2026.
// Pour un ETF synthétique, la composition est celle de l'indice suivi : c'est l'exposition réelle.

export const FICHES = {
  FR0011550185: {
    au: "2026-09-30", emetteur: "BNP Paribas Easy", indice: "S&P 500", frais: 0.14, encours: "3 693 M€",
    replication: "Synthétique (swap)", creation: "2013-09-16", domicile: "France", dividendes: "Capitalisation", pea: true,
    top: [["NVIDIA", 8.33], ["Apple", 7.32], ["Microsoft", 5.74], ["Amazon", 3.69], ["Alphabet A", 3.04], ["Broadcom", 2.52],
          ["Alphabet C", 2.44], ["Meta Platforms", 2.41], ["Micron Technology", 1.81], ["Tesla", 1.51]],
    pays: [["États-Unis", 96.97], ["Irlande", 1.23], ["Autres", 1.8]],
    secteurs: [["Technologie", 47.37], ["Finance", 12.6], ["Santé", 9.02], ["Consommation non cyclique", 8.56], ["Autres", 22.45]],
    note: "Composition de l'indice S&P 500 (ETF synthétique). 505 titres.",
    source: "https://www.justetf.com/fr/etf-profile.html?isin=FR0011550185",
  },
  LU1829219390: {
    au: "2026-09-24", emetteur: "Amundi", indice: "EURO STOXX Banks", frais: 0.3, encours: "5 934 M€",
    replication: "Physique (complète)", creation: "2013-12-12", domicile: "Luxembourg", dividendes: "Capitalisation", pea: true,
    top: [["Banco Santander", 14.15], ["BBVA", 10.44], ["UniCredit", 9.32], ["Intesa Sanpaolo", 7.87], ["BNP Paribas", 7.68],
          ["ING Groep", 6.81], ["Nordea Bank", 4.55], ["Deutsche Bank", 4.44], ["Société Générale", 3.94], ["CaixaBank", 3.45]],
    pays: [["Espagne", 30.46], ["Italie", 23.22], ["France", 13.12], ["Pays-Bas", 8.9], ["Autres", 24.3]],
    secteurs: [["Finance", 100]],
    note: "",
    source: "https://www.justetf.com/fr/etf-profile.html?isin=LU1829219390",
  },
  FR0013412012: {
    au: "2026-09-30", emetteur: "Amundi", indice: "MSCI EM Asia Screened Select ex Thermal Coal", frais: 0.3, encours: "666 M€",
    replication: "Synthétique (swap)", creation: "2019-04-25", domicile: "France", dividendes: "Capitalisation", pea: true,
    top: [["TSMC", 18.78], ["Samsung Electronics", 10.21], ["SK hynix", 7.09], ["Tencent", 3.3], ["Alibaba", 2.22],
          ["MediaTek", 2.17], ["Delta Electronics", 1.15], ["China Construction Bank", 1.02], ["Hon Hai Precision", 0.94]],
    pays: [["Taïwan", 34.78], ["Corée du Sud", 25.72], ["Chine", 21.28], ["Inde", 12.76], ["Autres", 5.46]],
    secteurs: [["Technologie", 56.04], ["Finance", 16.21], ["Industrie", 5.91], ["Consommation non cyclique", 4.87], ["Autres", 16.97]],
    note: "Approximation : composition de l'indice MSCI EM Asia standard (la version « Screened » n'est pas publiée en accès libre). À remplacer par la fiche mensuelle Amundi.",
    source: "https://www.justetf.com/fr/etf-profile.html?isin=LU1681044480",
  },
  FR0011550193: {
    au: "2026-09-29", emetteur: "BNP Paribas Easy", indice: "STOXX Europe 600", frais: 0.19, encours: "1 122 M€",
    replication: "Synthétique (swap)", creation: "2013-09-16", domicile: "France", dividendes: "Capitalisation", pea: true,
    top: [["ASML", 4.49], ["HSBC", 2.29], ["Roche", 1.99], ["Novartis", 1.83], ["Shell", 1.78], ["AstraZeneca", 1.7],
          ["Nestlé", 1.58], ["Siemens", 1.54], ["Banco Santander", 1.42], ["SAP", 1.4]],
    pays: [["Royaume-Uni", 21.96], ["Suisse", 14.38], ["France", 13.63], ["Allemagne", 12.88], ["Autres", 37.15]],
    secteurs: [["Finance", 27.26], ["Industrie", 16.71], ["Santé", 11.53], ["Technologie", 9.81], ["Autres", 34.69]],
    note: "Composition de l'indice STOXX Europe 600 (ETF synthétique).",
    source: "https://www.justetf.com/fr/etf-profile.html?isin=FR0011550193",
  },
  LU1834987973: {
    au: "2026-09-30", emetteur: "Amundi", indice: "STOXX Europe 600 Insurance", frais: 0.3, encours: "119 M€",
    replication: "Synthétique (swap)", creation: "2006-08-18", domicile: "Luxembourg", dividendes: "Capitalisation", pea: true,
    top: [["Allianz", 20.53], ["Zurich Insurance", 11.73], ["AXA", 9.73], ["Munich Re", 8.27], ["Generali", 5.97],
          ["Swiss Re", 5.27], ["Prudential", 3.53], ["Swiss Life", 3.43], ["Aviva", 3.13], ["Sampo", 2.82]],
    pays: [["Allemagne", 31.69], ["Suisse", 22.61], ["France", 10.4], ["Royaume-Uni", 7.96], ["Autres", 27.34]],
    secteurs: [["Finance", 98.01], ["Autres", 1.99]],
    note: "Composition de l'indice STOXX Europe 600 Insurance (ETF synthétique). 28 titres.",
    source: "https://www.justetf.com/fr/etf-profile.html?isin=LU1834987973",
  },
};
