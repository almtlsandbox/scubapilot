// Lanceur de ScubaPilot.
//
//   node launcher.js                 démarre ScubaPilot en arrière-plan (sans fenêtre) s'il ne tourne pas déjà
//   node launcher.js --open          idem, puis ouvre la page dans le navigateur
//   node launcher.js --stop          arrête ScubaPilot
//   node launcher.js --install-startup   démarrage automatique à l'ouverture de session Windows
//   node launcher.js --remove-startup    retire le démarrage automatique
//
// Règles :
//  - Une seule copie à la fois. Si CETTE copie (même dossier, même version) tourne déjà, on ne fait rien.
//  - Si une AUTRE copie tourne (autre dossier, ou ancienne version restée en mémoire après une mise à
//    jour), elle est arrêtée et remplacée : c'est toujours la copie que vous lancez qui tourne.
//  - Si le port est pris par un autre programme, on le dit clairement au lieu d'échouer en silence.
//  - Le journal app.log est archivé (app.log.1) quand il dépasse 1 Mo.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile, execFileSync } = require('child_process');

const PORT = 4531;
const HOST = '127.0.0.1';
const URL_APP = `http://localhost:${PORT}`;
const APP_DIR = __dirname;
const LOG_FILE = path.join(APP_DIR, 'app.log');
const MAX_LOG_BYTES = 1024 * 1024;
const IS_WIN = process.platform === 'win32';
let VERSION = '';
try { VERSION = require('./package.json').version; } catch (e) {}

const args = new Set(process.argv.slice(2));
const say = msg => console.log(msg);
// Un échec est aussi noté dans le journal : au démarrage automatique, personne ne voit la fenêtre.
const sayError = msg => { say(msg); try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] Lanceur : ${msg}\n`); } catch (e) {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const samePath = (a, b) => {
  const n = p => { const r = path.resolve(String(p || '')); return IS_WIN ? r.toLowerCase() : r; };
  return n(a) === n(b);
};

function request(method, urlPath, headers) {
  return new Promise(resolve => {
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method, headers: { Host: `localhost:${PORT}`, ...(headers || {}) }, timeout: 2000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (body.length < 200000) body += c; });
      res.on('end', () => resolve({ ok: true, status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, code: 'TIMEOUT' }); });
    req.on('error', e => resolve({ ok: false, code: e.code || 'ERROR' }));
    req.end();
  });
}

// Qui occupe le port ? -> { state: 'free' | 'this' | 'other-scubapilot' | 'foreign', info }
async function probe() {
  const r = await request('GET', '/api/app-info');
  if (!r.ok) return { state: r.code === 'ECONNREFUSED' ? 'free' : 'foreign', detail: r.code };
  if (r.status === 200) {
    try {
      const info = JSON.parse(r.body);
      if (info && info.installDir) {
        const same = samePath(info.installDir, APP_DIR) && String(info.version || '') === String(VERSION);
        return { state: same ? 'this' : 'other-scubapilot', info };
      }
    } catch (e) {}
  }
  // Versions d'avant la 1.8 : pas de /api/app-info. On reconnaît ScubaPilot à sa page d'accueil.
  const home = await request('GET', '/');
  if (home.ok && /ScubaPilot/i.test(home.body)) return { state: 'other-scubapilot', info: { version: '(ancienne)', installDir: '' } };
  return { state: 'foreign', detail: 'HTTP ' + r.status };
}

function pidsOnPort() {
  try {
    if (IS_WIN) {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
        if (m && Number(m[1]) === PORT && Number(m[2]) > 0) pids.add(Number(m[2]));
      }
      return [...pids];
    }
    const out = execFileSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch (e) { return []; }
}
async function waitUntil(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(250); }
  return false;
}
const isFree = async () => (await probe()).state === 'free';

// Arrête la copie de ScubaPilot en cours : d'abord poliment (versions 1.9+), sinon en arrêtant son processus.
async function stopRunning() {
  await request('POST', '/api/shutdown', { 'X-ScubaPilot-Launcher': '1', 'Content-Length': '0' });
  if (await waitUntil(isFree, 3000)) return true;
  for (const pid of pidsOnPort()) {
    if (pid === process.pid) continue;
    try {
      if (IS_WIN) execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
      else process.kill(pid, 'SIGTERM');
    } catch (e) {}
  }
  return waitUntil(isFree, 5000);
}

function rotateLog() {
  try {
    if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      try { fs.unlinkSync(LOG_FILE + '.1'); } catch (e) {}
      fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    }
  } catch (e) {}
}

function startServer() {
  rotateLog();
  const log = fs.openSync(LOG_FILE, 'a');
  // detached + windowsHide : le serveur vit sans fenêtre et continue après la fermeture de ce lanceur.
  const child = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR, detached: true, windowsHide: true, stdio: ['ignore', log, log]
  });
  child.unref();
  fs.closeSync(log);
}

function openBrowser() {
  try {
    if (IS_WIN) execFile('cmd', ['/c', 'start', '', URL_APP], { windowsHide: true }, () => {});
    else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [URL_APP], () => {});
  } catch (e) {}
}

// ---- Démarrage automatique (Windows) ----
// Un simple fichier « ScubaPilot.cmd » est écrit dans le dossier « Démarrage » de Windows. Il lance
// ce lanceur en fenêtre réduite à l'ouverture de session.
// Volontairement SANS PowerShell, sans registre et sans VBScript : la version 1.9 appelait PowerShell
// avec une commande encodée, ce que les antivirus (Norton, entre autres) bloquent par principe.
const STARTUP_FILE = 'ScubaPilot.cmd';
function startupDir() {
  if (process.env.SCUBAPILOT_STARTUP_DIR) return process.env.SCUBAPILOT_STARTUP_DIR; // pour les tests
  if (!IS_WIN || !process.env.APPDATA) return '';
  return path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}
// Un raccourci .lnk contient le chemin de sa cible en clair (ASCII et/ou UTF-16) : on peut donc
// reconnaître les anciens raccourcis de ScubaPilot sans passer par un outil Windows.
function lnkMentions(file, words) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return false; }
  const hay8 = buf.toString('latin1').toLowerCase(), hay16 = buf.toString('utf16le').toLowerCase();
  return words.some(w => hay8.includes(w.toLowerCase()) || hay16.includes(w.toLowerCase()));
}
function startupShortcut(install) {
  const dir = startupDir();
  if (!dir) { say("Le démarrage automatique n'est géré que sous Windows."); return 1; }
  try {
    if (!fs.existsSync(dir)) { say(`Dossier « Démarrage » introuvable : ${dir}`); return 1; }
    // 1) Retirer les anciens lancements de ScubaPilot (dont les raccourcis vers Demarrage-automatique.vbs,
    //    même s'ils pointent vers un autre dossier : c'est ce qui relançait une vieille version).
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const lower = name.toLowerCase();
      const ours = lower === STARTUP_FILE.toLowerCase() || lower === 'scubapilot.lnk' || lower === 'demarrage-automatique.vbs' ||
        (lower.endsWith('.lnk') && lnkMentions(full, ['Demarrage-automatique.vbs', 'scubapilot\\launcher.js', 'scubapilot/launcher.js']));
      if (!ours) continue;
      try { fs.unlinkSync(full); if (lower !== STARTUP_FILE.toLowerCase()) say(`  Ancien lancement retiré : ${name}`); }
      catch (e) { say(`  Impossible de retirer ${name} : ${e.code || e.message}`); }
    }
    if (!install) { say('Démarrage automatique retiré.'); return 0; }
    // 2) Écrire le nouveau fichier de lancement.
    const q = s => '"' + String(s).replace(/%/g, '%%') + '"';
    const content = [
      '@echo off',
      'rem Demarrage automatique de ScubaPilot.',
      'rem Cree par "Installer le demarrage automatique.bat" ; retire par "Retirer le demarrage automatique.bat".',
      'chcp 65001 >nul',
      `start "ScubaPilot" /min ${q(process.execPath)} ${q(path.join(APP_DIR, 'launcher.js'))}`,
      ''
    ].join('\r\n');
    fs.writeFileSync(path.join(dir, STARTUP_FILE), content, 'utf8');
    say(`  Fichier créé : ${path.join(dir, STARTUP_FILE)}`);
    say('Démarrage automatique installé : ScubaPilot se lancera à chaque ouverture de session Windows.');
    say("(Si vous déplacez le dossier de l'application, relancez cette installation.)");
    return 0;
  } catch (e) {
    say('Impossible de modifier le démarrage automatique : ' + (e.code || e.message));
    return 1;
  }
}

async function main() {
  if (args.has('--install-startup')) return startupShortcut(true);
  if (args.has('--remove-startup')) return startupShortcut(false);

  let p = await probe();
  if (args.has('--stop')) {
    if (p.state === 'free') { say("ScubaPilot n'était pas en marche."); return 0; }
    if (p.state === 'foreign') { say(`Le port ${PORT} est utilisé par un autre programme : rien n'a été arrêté.`); return 1; }
    const ok = await stopRunning();
    say(ok ? 'ScubaPilot est arrêté.' : "ScubaPilot n'a pas pu être arrêté.");
    return ok ? 0 : 1;
  }

  if (p.state === 'this') {
    say(`ScubaPilot ${VERSION} est déjà en marche.`);
  } else {
    if (p.state === 'foreign') {
      sayError(`Impossible de démarrer : le port ${PORT} est utilisé par un autre programme (${p.detail || '?'}).`);
      say('Fermez ce programme, ou redémarrez l\'ordinateur, puis relancez ScubaPilot.');
      return 1;
    }
    if (p.state === 'other-scubapilot') {
      const where = p.info && p.info.installDir ? ` (dossier : ${p.info.installDir})` : '';
      say(`Une autre copie de ScubaPilot était en marche — version ${p.info && p.info.version || '?'}${where}.`);
      say('Elle est arrêtée et remplacée par celle-ci.');
      if (!(await stopRunning())) { sayError("Impossible d'arrêter l'ancienne copie. Lancez « Arreter.bat », puis réessayez."); return 1; }
    }
    try { require.resolve('express'); }
    catch (e) {
      sayError('Les composants de ScubaPilot ne sont pas installés dans ce dossier (dossier node_modules absent).');
      say('Lancez « Lancer ScubaPilot.bat », qui les installe automatiquement, ou tapez « npm install » dans ce dossier.');
      return 1;
    }
    startServer();
    const up = await waitUntil(async () => (await probe()).state === 'this', 15000);
    if (!up) { sayError(`ScubaPilot n'a pas démarré. Consultez le journal : ${LOG_FILE}`); return 1; }
    say(`ScubaPilot ${VERSION} est démarré.`);
  }
  say(`Adresse : ${URL_APP}`);
  if (args.has('--open')) openBrowser();
  return 0;
}

main().then(code => { process.exitCode = code; }, e => { console.error(e); process.exitCode = 1; });
