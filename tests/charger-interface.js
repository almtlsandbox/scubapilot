// Charge public/app.js (le code de l'interface, écrit pour un navigateur) dans un bac à sable Node,
// avec un faux navigateur minimal, pour en tester les fonctions de calcul sans navigateur.
// C'est le fichier réellement livré qui est exécuté : aucune copie des fonctions.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadInterface(todayIso) {
  // Objet « attrape-tout » : toute propriété, tout appel renvoie le même objet. Suffit pour que le
  // code d'affichage s'exécute sans erreur ; seules les fonctions de calcul nous intéressent.
  const stub = new Proxy(function () {}, {
    get(target, key) {
      if (key === Symbol.toPrimitive) return () => '';
      if (key === Symbol.iterator) return function* () {};
      if (key === 'then') return undefined;          // pas une promesse
      if (key === 'length') return 0;
      if (key === 'classList' || key === 'style' || key === 'dataset') return stub;
      return stub;
    },
    apply() { return stub; }, construct() { return stub; }, set() { return true; }, has() { return true; }
  });
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob, TextEncoder, TextDecoder, Intl, Date, Math, JSON, Promise,
    document: stub, navigator: stub, localStorage: stub, sessionStorage: stub, XMLHttpRequest: stub, FileReader: stub,
    location: { hash: '#/dashboard', origin: 'http://localhost:4531', reload() {} },
    fetch: async () => ({ ok: false, status: 503, json: async () => ({ error: 'TEST' }) }),
    addEventListener() {}, removeEventListener() {}, open: () => stub, scrollTo() {}, alert() {}, confirm: () => true
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'app.js' });
  const run = src => vm.runInContext(src, ctx);
  // « Aujourd'hui » figé, pour des tests de dates reproductibles.
  if (todayIso) run(`todayISO = function () { return ${JSON.stringify(todayIso)}; };`);
  // Réglages de référence (centres, sites, taxes...) utilisés par les fonctions de calcul.
  const setState = patch => run(`Object.assign(state, ${JSON.stringify(patch)}); if (state.billing) state.billing = normBilling(state.billing);`);
  // Les valeurs créées dans le bac à sable n'ont pas les mêmes prototypes que celles de Node :
  // on les convertit en JSON pour pouvoir les comparer simplement.
  const call = (name, ...args) => JSON.parse(run(`JSON.stringify(${name}(...${JSON.stringify(args)}) ?? null)`));
  return { run, call, setState };
}

module.exports = { loadInterface };
