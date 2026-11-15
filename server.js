const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const app = express();
// Port 4531, sauf pour les tests automatiques (variable SCUBAPILOT_PORT) qui tournent à côté sans gêner l'application.
const PORT = Number(process.env.SCUBAPILOT_PORT) || 4531;
// L'application n'est destinée qu'à cet ordinateur. On refuse toute requête qui ne vise pas
// localhost (protection contre un site web malveillant qui ferait pointer son nom de domaine
// vers 127.0.0.1) ; voir aussi app.listen() en bas, qui n'écoute que sur 127.0.0.1.
const HOST = process.env.SCUBAPILOT_HOST || '127.0.0.1';
const LOCAL_ONLY = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
app.use((req, res, next) => {
  if (!LOCAL_ONLY) return next();
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return next();
  res.status(403).json({ error: 'FORBIDDEN_HOST' });
});
// Limite relevée : les documents glissés-déposés sont envoyés en base64 dans le corps JSON.
app.use(express.json({ limit: '25mb' }));
// no-cache : le navigateur revalide à chaque chargement, pour qu'une mise à jour de l'application
// (public/app.js) soit visible tout de suite sans devoir vider le cache.
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

// ---------------------------------------------------------------------------------------------
// Où vivent les données ?
//  - Les COURS            : dans le répertoire racine choisi par l'utilisateur (souvent sous OneDrive).
//  - Les RÉGLAGES partagés : dans <racine>/_ScubaPilot/ (centres, tarifs, modèles d'email, types de
//    cours, sites, étampe, coordonnées de l'instructeur). Ils suivent donc les cours : synchronisés,
//    sauvegardés avec eux, et jamais écrasés par une mise à jour de l'application.
//  - Le CHEMIN de la racine : propre à cet ordinateur, dans le profil de l'utilisateur
//    (%APPDATA%\ScubaPilot\local.json), hors du dossier de l'application. Remplacer le dossier
//    de l'application lors d'une mise à jour ne fait donc plus rien perdre.
//  - data/ (dans l'application) : valeurs par défaut livrées avec l'application + anciens réglages
//    d'avant la version 1.8, recopiés une seule fois vers <racine>/_ScubaPilot/.
// ---------------------------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_DIRNAME = '_ScubaPilot';
const TRASH_DIRNAME = '_Corbeille';
const CONFIG_FILES = ['settings.json', 'course_types.json', 'sites.json', 'student_fields.json',
  'email_templates.json', 'buddies.json', 'centers.json', 'billing.json', 'stamp.json'];
const LOCAL_DIR = process.env.SCUBAPILOT_LOCAL_DIR ||
  (process.env.APPDATA ? path.join(process.env.APPDATA, 'ScubaPilot') : path.join(os.homedir(), '.scubapilot'));
const LOCAL_FILE = path.join(LOCAL_DIR, 'local.json');
const LEGACY_SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function parseJSONText(txt) {
  // Un fichier retouché dans le Bloc-notes peut commencer par un BOM : on l'ignore.
  return JSON.parse(txt.charCodeAt(0) === 0xFEFF ? txt.slice(1) : txt);
}
// Lecture tolérante : renvoie `fallback` si le fichier est absent OU illisible. À réserver aux
// lectures purement informatives (statistiques, recherche) qui ne sont jamais réécrites ensuite.
function readJSON(file, fallback) {
  try { return parseJSONText(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
// Lecture stricte : `fallback` seulement si le fichier n'existe pas. S'il existe mais est illisible
// (écriture interrompue, conflit de synchronisation OneDrive, fichier vide...), on lève CORRUPT_FILE
// au lieu de faire comme s'il était vide — sinon la prochaine sauvegarde écraserait les données.
function readJSONStrict(file, fallback) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw corruptError(file); }
  try { return parseJSONText(txt); } catch (e) { throw corruptError(file); }
}
function corruptError(file) { const err = new Error('CORRUPT_FILE'); err.file = file; return err; }
function isCorrupt(file) {
  try { readJSONStrict(file, null); return false; } catch (e) { return true; }
}
// Écriture atomique : on écrit dans un fichier temporaire voisin puis on le renomme par-dessus
// l'original. Une coupure en cours d'écriture laisse donc l'ancien fichier intact, jamais un
// fichier à moitié écrit. Sous OneDrive le renommage peut échouer un instant (fichier verrouillé
// par la synchronisation) : on réessaie, puis on retombe sur une écriture directe.
function sleepMs(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {} }
function writeJSON(file, data) {
  const txt = JSON.stringify(data, null, 2);
  if (txt === undefined) throw new Error('INVALID_DATA');
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, txt, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tmp, file); return; }
      catch (e) {
        if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
        sleepMs(60 * (attempt + 1));
      }
    }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) {}
    fs.writeFileSync(file, txt, 'utf8');
  }
}
// Chemin de la racine pour cet ordinateur (ou '' s'il n'est pas encore choisi).
function getRootOrEmpty() {
  const local = readJSON(LOCAL_FILE, null);
  if (local && typeof local.rootDir === 'string') return local.rootDir;
  // Avant la version 1.8, le chemin était dans data/settings.json : on le reprend une fois.
  const legacy = readJSON(LEGACY_SETTINGS_FILE, {});
  const rootDir = (legacy && typeof legacy.rootDir === 'string') ? legacy.rootDir : '';
  if (rootDir) setLocalRoot(rootDir);
  return rootDir;
}
function setLocalRoot(rootDir) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  writeJSON(LOCAL_FILE, { rootDir: rootDir || '' });
}
function getRoot() {
  const root = getRootOrEmpty();
  if (!root) throw new Error('ROOT_NOT_SET');
  if (!fs.existsSync(root)) { const err = new Error('ROOT_NOT_FOUND'); err.rootDir = root; throw err; }
  return root;
}
function stripRoot(settings) {
  const { rootDir, ...rest } = (settings && typeof settings === 'object' && !Array.isArray(settings)) ? settings : {};
  return rest;
}
// Prépare <racine>/_ScubaPilot/ : crée le dossier et y recopie, UNE SEULE FOIS par fichier, les
// réglages qui n'y sont pas encore (depuis `seedDir` : l'ancien dossier data/, ou les réglages de
// la racine précédente quand on change de racine). Un fichier déjà présent n'est jamais écrasé.
const preparedConfigDirs = new Set();
function ensureConfigDir(root, seedDir) {
  const dir = path.join(root, CONFIG_DIRNAME);
  if (preparedConfigDirs.has(dir) && fs.existsSync(dir)) return dir;
  fs.mkdirSync(dir, { recursive: true });
  const from = seedDir || DATA_DIR;
  for (const f of CONFIG_FILES) {
    const dest = path.join(dir, f), src = path.join(from, f);
    if (fs.existsSync(dest) || !fs.existsSync(src) || path.resolve(src) === path.resolve(dest)) continue;
    if (f === 'settings.json') { try { writeJSON(dest, stripRoot(readJSONStrict(src, {}))); } catch (e) { fs.copyFileSync(src, dest); } }
    else fs.copyFileSync(src, dest);
  }
  migrateEmailTemplates(dir);
  const readme = path.join(dir, 'LISEZ-MOI.txt');
  if (!fs.existsSync(readme)) {
    try {
      fs.writeFileSync(readme,
        'Réglages de ScubaPilot (centres, tarifs, modèles d\'email, types de cours, sites, étampe, coordonnées).\r\n' +
        'Ce dossier est géré par l\'application : ne le supprimez pas et ne le renommez pas.\r\n' +
        'Il est inclus dans la sauvegarde .zip. Pour restaurer des réglages, remplacez les fichiers .json\r\n' +
        'de ce dossier pendant que ScubaPilot est fermé (ou utilisez Paramètres > Emplacements > Importer).\r\n', 'utf8');
    } catch (e) {}
  }
  preparedConfigDirs.add(dir);
  return dir;
}
// Dossier des réglages en vigueur : <racine>/_ScubaPilot/, ou data/ tant qu'aucune racine n'est choisie.
function configDir() {
  const root = getRootOrEmpty();
  if (!root) return DATA_DIR;
  if (!fs.existsSync(root)) { const err = new Error('ROOT_NOT_FOUND'); err.rootDir = root; throw err; }
  return ensureConfigDir(root);
}
function cfg(name) { return path.join(configDir(), name); }
// Un nom de dossier reçu dans une URL (cours, étudiant) doit être un simple nom : jamais de
// séparateur ni de « .. », sinon une requête pourrait lire, écrire ou SUPPRIMER hors du répertoire racine.
function isSafeSegment(name) {
  if (typeof name !== 'string' || !name.length || name.length > 200) return false;
  if (/[\\/\0]/.test(name)) return false;        // aucun séparateur de chemin
  if (/^[.\s]*$/.test(name)) return false;        // ni vide, ni « . », ni « .. », ni espaces seuls
  return true;
}
function invalidPath() { return new Error('INVALID_PATH'); }
// Dossiers de la racine réservés à l'application : jamais traités comme des cours.
function isReservedDir(name) { return name === CONFIG_DIRNAME || name === TRASH_DIRNAME; }
// Vérification finale : le chemin résolu doit rester à l'intérieur du répertoire racine.
function insideRoot(root, target) {
  const r = path.resolve(root), t = path.resolve(target);
  return t !== r && t.startsWith(r + path.sep);
}
// Réponse d'erreur commune à toutes les routes.
function fail(res, e) {
  if (e && e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
  if (e && e.message === 'ROOT_NOT_FOUND') return res.status(400).json({ error: 'ROOT_NOT_FOUND', rootDir: e.rootDir || '' });
  if (e && e.message === 'INVALID_PATH') return res.status(400).json({ error: 'INVALID_PATH' });
  if (e && e.message === 'CORRUPT_FILE') return res.status(500).json({ error: 'CORRUPT_FILE', file: e.file || '' });
  res.status(500).json({ error: (e && e.message) || 'ERROR' });
}
function sanitize(str) {
  return String(str || '').replace(/[\\/:*?"<>|]/g, '').trim();
}

// Chaque cours a systématiquement un sous-dossier "Photo" (photos du cours, indépendantes des
// documents administratifs). On s'assure qu'il existe à chaque fois qu'on en a besoin, pour que
// les cours créés avant l'ajout de cette fonctionnalité en bénéficient aussi sans migration.
const PHOTO_DIRNAME = 'Photo';
function ensurePhotoDir(cFolder) {
  const p = path.join(cFolder, PHOTO_DIRNAME);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// Migration ponctuelle : l'ancienne version stockait 2 modèles fixes (convocation/rappel) dans
// settings.json. On les convertit en bibliothèque de modèles (email_templates.json) la première
// fois que le fichier n'existe pas encore, pour ne pas perdre les modèles déjà personnalisés.
function migrateEmailTemplates(dir) {
  const file = path.join(dir, 'email_templates.json');
  if (fs.existsSync(file)) return;
  const oldSettings = readJSON(path.join(dir, 'settings.json'), {});
  const migrated = [];
  if (oldSettings.emailTemplates && oldSettings.emailTemplates.convocation) {
    migrated.push({ id: 'convocation-standard', name: 'Convocation - standard', ...oldSettings.emailTemplates.convocation });
  }
  if (oldSettings.emailTemplates && oldSettings.emailTemplates.reminder) {
    migrated.push({ id: 'rappel-standard', name: 'Rappel - standard', ...oldSettings.emailTemplates.reminder });
  }
  if (!migrated.length) {
    migrated.push(
      { id: 'convocation-standard', name: 'Convocation - standard', subject: 'Convocation - {type_cours}', body: "Bonjour {prenom},\n\nJe vous confirme votre inscription au cours \"{type_cours}\".\n\nSéance(s) prévue(s) :\n{liste_dates_lieux}\n\nMerci de vous présenter avec les documents suivants :\n{liste_docs_pre}\n\nÀ bientôt,\n{instructeur}" },
      { id: 'rappel-standard', name: 'Rappel - standard', subject: 'Rappel - {type_cours}', body: "Bonjour {prenom},\n\nPetit rappel concernant votre cours \"{type_cours}\".\n\nSéance(s) prévue(s) :\n{liste_dates_lieux}\n\nIl me manque encore les documents suivants :\n{liste_docs_manquants}\n\nMerci de me les transmettre avant le début du cours.\n\nÀ bientôt,\n{instructeur}" }
    );
  }
  writeJSON(file, migrated);
}

// Un document a l'un de ces 3 statuts (défini dans le modèle de cours) :
//  - "required"    : toujours nécessaire, compte toujours dans le score.
//  - "optional"    : jamais compté dans le score (purement informatif).
//  - "conditional" : nécessaire seulement pour certains étudiants (ex: certificat médical
//                     selon le questionnaire, autorisation parentale selon l'âge) — chaque
//                     étudiant a alors un interrupteur "Nécessaire ?" ; le document ne compte
//                     dans le score QUE si cet interrupteur est activé pour cet étudiant.
// Rétro-compatibilité : si "requirement" est absent, on retombe sur l'ancien "required":true/false.
function docRequirement(docDef) {
  if (docDef && docDef.requirement) return docDef.requirement;
  return (docDef && docDef.required === false) ? 'optional' : 'required';
}
function countDocGroup(entries, docDefs) {
  // On parcourt la liste des documents définis par le type de cours (la source de vérité),
  // et non les clés déjà enregistrées dans "entries" : une fiche étudiant créée avant l'ajout
  // d'un document au type de cours n'a pas encore d'entrée pour ce document, et il doit quand
  // même compter comme "requis, non coché" — sinon il devient invisible au score (et un groupe
  // entièrement sans entrées affichait à tort 100%).
  const map = entries || {};
  let total = 0, done = 0;
  (docDefs || []).forEach(def => {
    const req = docRequirement(def);
    if (req === 'optional') return;
    const entry = map[def.id];
    if (req === 'conditional' && !(entry && entry.needed)) return;
    total++;
    if (entry && entry.collected) done++;
  });
  return { total, done };
}

const MONTHS_FR = ['JAN','FEV','MAR','AVR','MAI','JUN','JUL','AOU','SEP','OCT','NOV','DEC'];
function fmtDateId(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}${MONTHS_FR[d.getMonth()]}${d.getFullYear()}`;
}
function fmtDateHuman(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Retourne les séances d'un cours ; migre automatiquement les anciens cours
// (créés avant l'ajout des séances multiples) qui n'avaient qu'un startDate/endDate/siteId.
// Normalise une séance : l'ancien champ unique "time" (heure de début seulement) devient
// "timeStart", avec "timeEnd" vide si absent — ce qui permet d'afficher une durée (utile pour
// la facturation) sans perdre les séances déjà enregistrées avec l'ancien format.
function normalizeSession(sess) {
  if (sess.timeStart !== undefined) return sess;
  const { time, ...rest } = sess;
  return { ...rest, timeStart: time || '', timeEnd: '' };
}
function getSessions(course) {
  if (Array.isArray(course.sessions)) return course.sessions.map(normalizeSession);
  const sessions = [];
  if (course.startDate) sessions.push({ date: course.startDate, timeStart: '', timeEnd: '', siteId: course.siteId || '', notes: '' });
  if (course.endDate && course.endDate !== course.startDate) sessions.push({ date: course.endDate, timeStart: '', timeEnd: '', siteId: course.siteId || '', notes: '' });
  return sessions;
}

// Tout identifiant de cours / dossier d'étudiant présent dans une URL est validé ici, une fois pour toutes.
app.param('id', (req, res, next, value) => (isSafeSegment(value) && !isReservedDir(value)) ? next() : res.status(400).json({ error: 'INVALID_PATH' }));
app.param('folder', (req, res, next, value) => isSafeSegment(value) ? next() : res.status(400).json({ error: 'INVALID_PATH' }));
app.param('tid', (req, res, next, value) => isSafeSegment(value) ? next() : res.status(400).json({ error: 'INVALID_PATH' }));

// ---------- Corbeille ----------
// Supprimer un cours ou un étudiant le DÉPLACE dans <racine>/_Corbeille/<horodatage>/ au lieu de
// l'effacer. Chaque entrée contient info.json (ce que c'était, d'où ça vient, quand) et le dossier
// d'origine, intact. On peut restaurer, supprimer définitivement, ou vider la corbeille.
function moveDir(src, dest) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(src, dest); return; }
    catch (e) {
      if (['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code) && attempt < 4) { sleepMs(120 * (attempt + 1)); continue; }
      if (!['EPERM', 'EBUSY', 'EACCES', 'EXDEV'].includes(e.code)) throw e;
      break; // dernier recours ci-dessous : copier puis effacer la source
    }
  }
  try { fs.cpSync(src, dest, { recursive: true, errorOnExist: true, force: false }); }
  catch (e) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch (e2) {} throw e; } // copie incomplète : on la retire, la source est intacte
  fs.rmSync(src, { recursive: true, force: true });
}
function trashStamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}
function moveToTrash(root, srcPath, info) {
  const entry = path.join(root, TRASH_DIRNAME, trashStamp());
  fs.mkdirSync(entry, { recursive: true });
  const name = path.basename(srcPath);
  // info.json est écrit AVANT le déplacement : une entrée de corbeille est toujours identifiable.
  writeJSON(path.join(entry, 'info.json'), { ...info, name, deletedAt: new Date().toISOString() });
  try { moveDir(srcPath, path.join(entry, name)); }
  catch (e) {
    if (!fs.existsSync(path.join(entry, name))) { try { fs.rmSync(entry, { recursive: true, force: true }); } catch (e2) {} }
    throw e;
  }
  return path.basename(entry);
}
function listTrash(root) {
  const dir = path.join(root, TRASH_DIRNAME);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch (e) { return []; }
  return entries.map(d => {
    const info = readJSON(path.join(dir, d.name, 'info.json'), null) || {};
    const present = !!info.name && fs.existsSync(path.join(dir, d.name, info.name));
    return { tid: d.name, kind: info.kind || 'unknown', name: info.name || d.name, courseId: info.courseId || '',
      studentFolder: info.studentFolder || '', deletedAt: info.deletedAt || '', restorable: present && (info.kind === 'course' || info.kind === 'student') };
  }).sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
}
app.get('/api/trash', (req, res) => { try { res.json(listTrash(getRoot())); } catch (e) { fail(res, e); } });
app.post('/api/trash/:tid/restore', (req, res) => {
  try {
    const root = getRoot();
    const entry = path.join(root, TRASH_DIRNAME, req.params.tid);
    if (!insideRoot(path.join(root, TRASH_DIRNAME), entry) || !fs.existsSync(entry)) return res.status(404).json({ error: 'NOT_FOUND' });
    const info = readJSONStrict(path.join(entry, 'info.json'), null);
    if (!info || !isSafeSegment(info.name) || !fs.existsSync(path.join(entry, info.name))) return res.status(400).json({ error: 'TRASH_ENTRY_INVALID' });
    const src = path.join(entry, info.name);
    if (info.kind === 'course') {
      const dest = path.join(root, info.name);
      if (isReservedDir(info.name) || !insideRoot(root, dest)) throw invalidPath();
      if (fs.existsSync(dest)) return res.status(409).json({ error: 'COURSE_EXISTS', id: info.name });
      moveDir(src, dest);
    } else if (info.kind === 'student') {
      if (!isSafeSegment(info.courseId) || isReservedDir(info.courseId)) throw invalidPath();
      const cFolder = path.join(root, info.courseId);
      const cJsonPath = path.join(cFolder, 'course.json');
      if (!fs.existsSync(cJsonPath)) return res.status(409).json({ error: 'COURSE_NOT_FOUND', id: info.courseId });
      const course = readJSONStrict(cJsonPath, {});
      const dest = path.join(cFolder, info.name);
      if (fs.existsSync(dest)) return res.status(409).json({ error: 'STUDENT_EXISTS' });
      moveDir(src, dest);
      course.students = course.students || [];
      if (!course.students.includes(info.name)) { course.students.push(info.name); writeJSON(cJsonPath, course); }
    } else return res.status(400).json({ error: 'TRASH_ENTRY_INVALID' });
    fs.rmSync(entry, { recursive: true, force: true });
    res.json({ ok: true, kind: info.kind, courseId: info.kind === 'course' ? info.name : info.courseId });
  } catch (e) { fail(res, e); }
});
app.delete('/api/trash/:tid', (req, res) => {
  try {
    const root = getRoot();
    const tdir = path.join(root, TRASH_DIRNAME), entry = path.join(tdir, req.params.tid);
    if (!insideRoot(tdir, entry)) throw invalidPath();
    if (fs.existsSync(entry)) fs.rmSync(entry, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});
app.delete('/api/trash', (req, res) => {
  try {
    const root = getRoot();
    const tdir = path.join(root, TRASH_DIRNAME);
    let n = 0;
    for (const item of listTrash(root)) { fs.rmSync(path.join(tdir, item.tid), { recursive: true, force: true }); n++; }
    res.json({ ok: true, removed: n });
  } catch (e) { fail(res, e); }
});

// ---------- Emplacements & import d'anciens réglages ----------
app.get('/api/app-info', (req, res) => {
  const rootDir = getRootOrEmpty();
  let version = '';
  try { version = require('./package.json').version; } catch (e) {}
  res.json({
    version, installDir: __dirname, rootDir, localFile: LOCAL_FILE,
    configDir: rootDir ? path.join(rootDir, CONFIG_DIRNAME) : DATA_DIR,
    trashDir: rootDir ? path.join(rootDir, TRASH_DIRNAME) : '',
    logFile: path.join(__dirname, 'app.log'), pid: process.pid, app: 'ScubaPilot',
    rootMissing: !!rootDir && !fs.existsSync(rootDir)
  });
});
// Arrêt propre, demandé par le lanceur (launcher.js) quand une autre copie doit prendre la place.
// L'en-tête exigé ne peut pas être envoyé par une page web d'un autre site : seul un programme local le peut.
app.post('/api/shutdown', (req, res) => {
  if (req.headers['x-scubapilot-launcher'] !== '1') return res.status(403).json({ error: 'FORBIDDEN' });
  res.json({ ok: true });
  console.log(`[${new Date().toISOString()}] Arrêt demandé par le lanceur.`);
  setTimeout(() => process.exit(0), 150);
});

// Importe les réglages d'une ancienne installation (son dossier « data », ou le dossier de
// l'application lui-même, ou un dossier de réglages tiré d'une sauvegarde). Les réglages actuels
// sont d'abord mis de côté dans _ScubaPilot/_avant-import-<date>/ : l'import est réversible.
app.post('/api/config/import', (req, res) => {
  try {
    getRoot();
    const target = configDir();
    let src = String((req.body && req.body.dir) || '').trim().replace(/^"|"$/g, '');
    if (!src || !fs.existsSync(src) || !fs.statSync(src).isDirectory()) return res.status(400).json({ error: 'IMPORT_DIR_NOT_FOUND' });
    const has = d => CONFIG_FILES.some(f => fs.existsSync(path.join(d, f)));
    if (!has(src)) {
      const sub = [path.join(src, 'data'), path.join(src, CONFIG_DIRNAME), path.join(src, '_ScubaPilot-parametres')].find(d => fs.existsSync(d) && has(d));
      if (!sub) return res.status(400).json({ error: 'IMPORT_NOTHING_FOUND' });
      src = sub;
    }
    if (path.resolve(src) === path.resolve(target)) return res.status(400).json({ error: 'IMPORT_SAME_DIR' });
    const found = CONFIG_FILES.filter(f => fs.existsSync(path.join(src, f)));
    // Tout vérifier AVANT de toucher à quoi que ce soit.
    const parsed = {};
    for (const f of found) parsed[f] = readJSONStrict(path.join(src, f), null);
    const keep = path.join(target, `_avant-import-${trashStamp()}`);
    fs.mkdirSync(keep, { recursive: true });
    for (const f of CONFIG_FILES) if (fs.existsSync(path.join(target, f))) fs.copyFileSync(path.join(target, f), path.join(keep, f));
    for (const f of found) writeJSON(path.join(target, f), f === 'settings.json' ? stripRoot(parsed[f]) : parsed[f]);
    res.json({ ok: true, imported: found, from: src, previousSavedIn: keep });
  } catch (e) { fail(res, e); }
});

// ---------- Settings ----------
// Les réglages renvoyés au navigateur = réglages partagés (dans la racine) + chemin de la racine (local).
app.get('/api/settings', (req, res) => {
  try {
    const rootDir = getRootOrEmpty();
    if (rootDir && !fs.existsSync(rootDir)) return res.json({ rootDir, rootMissing: true });
    res.json({ ...stripRoot(readJSONStrict(cfg('settings.json'), {})), rootDir });
  } catch (e) { fail(res, e); }
});
app.put('/api/settings', (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'INVALID_DATA' });
    const { rootMissing, ...body } = req.body;
    const prevRoot = getRootOrEmpty();
    // Sans champ rootDir dans la requête, la racine reste celle en vigueur (on ne la « vide » jamais par accident).
    const newRoot = typeof body.rootDir === 'string' ? body.rootDir.trim() : prevRoot;
    const norm = d => d ? path.resolve(d) : '';
    const rootChanged = norm(newRoot) !== norm(prevRoot);
    if (!rootChanged) { writeJSON(cfg('settings.json'), stripRoot(body)); return res.json({ ok: true }); }

    // Changement (ou premier choix) de la racine.
    if (newRoot && !fs.existsSync(newRoot)) return res.status(400).json({ error: 'ROOT_NOT_FOUND', rootDir: newRoot });
    let prevCfg = DATA_DIR;
    if (prevRoot && fs.existsSync(path.join(prevRoot, CONFIG_DIRNAME))) prevCfg = path.join(prevRoot, CONFIG_DIRNAME);
    setLocalRoot(newRoot);
    if (!newRoot) return res.json({ ok: true });
    // Si la nouvelle racine a déjà ses propres réglages (ex. : nouvel ordinateur pointant vers le
    // même dossier OneDrive), on les ADOPTE tels quels : surtout ne pas les écraser avec ceux du navigateur.
    const adopted = fs.existsSync(path.join(newRoot, CONFIG_DIRNAME, 'settings.json'));
    ensureConfigDir(newRoot, prevCfg);
    if (!adopted) writeJSON(cfg('settings.json'), { ...stripRoot(readJSON(cfg('settings.json'), {})), ...stripRoot(body) });
    res.json({ ok: true, adopted });
  } catch (e) { fail(res, e); }
});
app.post('/api/settings/check-dir', (req, res) => {
  const dir = req.body.dir || '';
  res.json({ exists: dir ? fs.existsSync(dir) : false });
});
app.post('/api/settings/create-dir', (req, res) => {
  try { fs.mkdirSync(req.body.dir, { recursive: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Course types (modèles de cours) ----------
app.get('/api/course-types', (req, res) => { try { res.json(readJSONStrict(cfg('course_types.json'), [])); } catch (e) { fail(res, e); } });
app.put('/api/course-types', (req, res) => { try { if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'INVALID_DATA' }); writeJSON(cfg('course_types.json'), req.body); res.json({ ok: true }); } catch (e) { fail(res, e); } });

// ---------- Sites ----------
app.get('/api/sites', (req, res) => { try { res.json(readJSONStrict(cfg('sites.json'), [])); } catch (e) { fail(res, e); } });
app.put('/api/sites', (req, res) => { try { if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'INVALID_DATA' }); writeJSON(cfg('sites.json'), req.body); res.json({ ok: true }); } catch (e) { fail(res, e); } });

// ---------- Champs du profil étudiant (modèle personnalisable) ----------
app.get('/api/student-fields', (req, res) => { try { res.json(readJSONStrict(cfg('student_fields.json'), [])); } catch (e) { fail(res, e); } });
app.put('/api/student-fields', (req, res) => { try { if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'INVALID_DATA' }); writeJSON(cfg('student_fields.json'), req.body); res.json({ ok: true }); } catch (e) { fail(res, e); } });

// ---------- Bibliothèque de modèles d'email ----------
app.get('/api/email-templates', (req, res) => { try { res.json(readJSONStrict(cfg('email_templates.json'), [])); } catch (e) { fail(res, e); } });
app.put('/api/email-templates', (req, res) => { try { if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'INVALID_DATA' }); writeJSON(cfg('email_templates.json'), req.body); res.json({ ok: true }); } catch (e) { fail(res, e); } });

// ---------- Liste globale de coéquipiers (Divemaster, autres instructeurs...) ----------
app.get('/api/buddies', (req, res) => { try { res.json(readJSONStrict(cfg('buddies.json'), [])); } catch (e) { fail(res, e); } });
app.put('/api/buddies', (req, res) => { try { if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'INVALID_DATA' }); writeJSON(cfg('buddies.json'), req.body); res.json({ ok: true }); } catch (e) { fail(res, e); } });

// ---------- Centres partenaires (qui mandatent l'instructeur) ----------
app.get('/api/centers', (req, res) => { try { res.json(readJSONStrict(cfg('centers.json'), [])); } catch (e) { fail(res, e); } });
app.put('/api/centers', (req, res) => { try { if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'INVALID_DATA' }); writeJSON(cfg('centers.json'), req.body); res.json({ ok: true }); } catch (e) { fail(res, e); } });

// ---------- Modèle de facturation (prix de base + offset par étudiant additionnel) ----------
app.get('/api/billing', (req, res) => { try { res.json(readJSONStrict(cfg('billing.json'), { currency: 'CAD', default: { basePrice: 0, minStudents: 1, extraStudentPrice: 0 }, byType: {} })); } catch (e) { fail(res, e); } });
app.put('/api/billing', (req, res) => { try { if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'INVALID_DATA' }); writeJSON(cfg('billing.json'), req.body); res.json({ ok: true }); } catch (e) { fail(res, e); } });

// ---------- Étampe (image pour les factures, stockée en data URL) ----------
app.get('/api/stamp', (req, res) => { try { res.json(readJSON(cfg('stamp.json'), { dataUrl: '' })); } catch (e) { fail(res, e); } });
app.put('/api/stamp', (req, res) => {
  const d = req.body && typeof req.body.dataUrl === 'string' ? req.body.dataUrl : '';
  if (d && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(d)) return res.status(400).json({ error: 'INVALID_IMAGE' });
  writeJSON(cfg('stamp.json'), { dataUrl: d }); res.json({ ok: true });
});

// ---------- Stats d'un cours ----------
function computeCourseStats(root, courseId, course) {
  const cFolder = path.join(root, courseId);
  const types = readJSON(cfg('course_types.json'), []);
  const type = types.find(t => t.code === course.typeCode) || {};
  let totalPre = 0, donePre = 0, totalPost = 0, donePost = 0, corruptedStudents = 0;
  const students = [];
  for (const sName of (course.students || [])) {
    const sData = readJSON(path.join(cFolder, sName, 'student.json'), null);
    if (!sData) { if (fs.existsSync(path.join(cFolder, sName, 'student.json'))) corruptedStudents++; continue; }
    const preC = countDocGroup(sData.preDocs, type.preDocs);
    const postC = countDocGroup(sData.postDocs, type.postDocs);
    totalPre += preC.total; donePre += preC.done;
    totalPost += postC.total; donePost += postC.done;
    const mailLog = Array.isArray(sData.mailLog) ? sData.mailLog : [];
    students.push({
      folder: sName, firstName: sData.firstName, lastName: sData.lastName,
      prePercent: preC.total ? Math.round(100 * preC.done / preC.total) : 100,
      postPercent: postC.total ? Math.round(100 * postC.done / postC.total) : 100,
      // Détails utilisés par la liste « À faire » du tableau de bord
      preMissing: preC.total - preC.done, postMissing: postC.total - postC.done,
      courseOnly: sData.status === 'cours',
      certificationConfirmed: !!sData.certificationConfirmed, fileTransferred: !!sData.fileTransferred,
      hasEmail: !!sData.email, lastMail: mailLog.length ? mailLog[mailLog.length - 1] : null
    });
  }
  // Documents généraux du cours (non liés à un étudiant en particulier)
  const gPreC = countDocGroup(course.generalPreDocs, type.generalPreDocs);
  const gPostC = countDocGroup(course.generalPostDocs, type.generalPostDocs);
  totalPre += gPreC.total; donePre += gPreC.done;
  totalPost += gPostC.total; donePost += gPostC.done;
  return {
    prePercent: totalPre ? Math.round(100 * donePre / totalPre) : 100,
    postPercent: totalPost ? Math.round(100 * donePost / totalPost) : 100,
    studentCount: students.length,
    corruptedStudents,
    generalPreMissing: gPreC.total - gPreC.done, generalPostMissing: gPostC.total - gPostC.done,
    students
  };
}

// ---------- Courses ----------
app.get('/api/courses', (req, res) => {
  try {
    const root = getRoot();
    if (!fs.existsSync(root)) return res.json([]);
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !isReservedDir(d.name));
    const courses = [];
    for (const d of dirs) {
      const cJsonPath = path.join(root, d.name, 'course.json');
      if (!fs.existsSync(cJsonPath)) continue;
      const course = readJSON(cJsonPath, null);
      if (!course || typeof course !== 'object' || Array.isArray(course)) {
        // Fichier illisible : on montre quand même le cours (avec une alerte) au lieu de le faire disparaître.
        courses.push({ id: d.name, corrupted: true, typeCode: '', centerId: '', students: [], sessions: [],
          generalPreDocs: {}, generalPostDocs: {}, stats: { prePercent: 0, postPercent: 0, studentCount: 0, students: [] } });
        continue;
      }
      const sessions = getSessions(course).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      courses.push({
        id: d.name, ...course, sessions,
        generalPreDocs: course.generalPreDocs || {}, generalPostDocs: course.generalPostDocs || {},
        stats: computeCourseStats(root, d.name, course)
      });
    }
    courses.sort((a, b) => ((a.sessions[0] && a.sessions[0].date) || '').localeCompare((b.sessions[0] && b.sessions[0].date) || ''));
    res.json(courses);
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/courses/:id', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    const cJsonPath = path.join(cFolder, 'course.json');
    if (!fs.existsSync(cJsonPath)) return res.status(404).json({ error: 'NOT_FOUND' });
    const course = readJSONStrict(cJsonPath, {});
    const students = (course.students || []).map(sName => {
      const sFile = path.join(cFolder, sName, 'student.json');
      let sData;
      try { sData = readJSONStrict(sFile, {}); }
      catch (e) {
        // Fiche illisible : on l'affiche avec une alerte (nom déduit du dossier) ; toute modification sera refusée.
        const parts = sName.split(' ');
        sData = { corrupted: true, firstName: parts[0] || sName, lastName: parts.slice(1).join(' '), preDocs: {}, postDocs: {} };
      }
      let files = [];
      try { files = fs.readdirSync(path.join(cFolder, sName)).filter(f => f !== 'student.json' && !f.endsWith('.tmp')); } catch (e) {}
      return { folder: sName, ...sData, files };
    });
    const sessions = getSessions(course).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    // Fichiers déposés directement dans le dossier du cours (documents généraux), en excluant
    // course.json et les sous-dossiers étudiants.
    let files = [];
    try {
      files = fs.readdirSync(cFolder, { withFileTypes: true })
        .filter(d => d.isFile() && d.name !== 'course.json' && !d.name.endsWith('.tmp'))
        .map(d => d.name);
    } catch (e) {}
    let photos = [];
    try {
      const photoDir = ensurePhotoDir(cFolder);
      photos = fs.readdirSync(photoDir, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name);
    } catch (e) {}
    res.json({
      id: req.params.id, ...course, sessions, students, files, photos,
      generalPreDocs: course.generalPreDocs || {}, generalPostDocs: course.generalPostDocs || {},
      folderPath: cFolder
    });
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/courses', (req, res) => {
  try {
    const root = getRoot();
    const { typeCode, notes, session, emailTemplateId, centerId, instructorIds, billable } = req.body;
    if (!typeCode || !session || !session.date) return res.status(400).json({ error: 'MISSING_FIELDS' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date) || isNaN(new Date(session.date + 'T00:00:00'))) return res.status(400).json({ error: 'INVALID_DATE' });
    if (!centerId) return res.status(400).json({ error: 'CENTER_REQUIRED' });
    const id = `${typeCode}_${fmtDateId(session.date)}`;
    const cFolder = path.join(root, id);
    if (fs.existsSync(cFolder)) return res.status(400).json({ error: 'COURSE_EXISTS' });
    fs.mkdirSync(cFolder, { recursive: true });
    ensurePhotoDir(cFolder); // dossier "Photo" créé systématiquement pour chaque nouveau cours
    const types = readJSON(cfg('course_types.json'), []);
    const type = types.find(t => t.code === typeCode) || {};
    const generalPreDocs = {}; (type.generalPreDocs || []).forEach(d => generalPreDocs[d.id] = { collected: false, date: null, needed: docRequirement(d) === 'required' });
    const generalPostDocs = {}; (type.generalPostDocs || []).forEach(d => generalPostDocs[d.id] = { collected: false, date: null, needed: docRequirement(d) === 'required' });
    const course = {
      typeCode, notes: notes || '', students: [], centerId,
      // Sous-ensemble de la liste globale de coéquipiers (data/buddies.json) rattaché à ce cours ;
      // sert à limiter le choix de l'instructeur certificateur d'un étudiant (voir countDocGroup/
      // certifyingInstructorId côté client). Pas de liste séparée d'instructeurs : un coéquipier
      // qui est instructeur est simplement un coéquipier de plus dans cette même liste.
      instructorIds: Array.isArray(instructorIds) ? instructorIds : [],
      sessions: [{ date: session.date, timeStart: session.timeStart || '', timeEnd: session.timeEnd || '', siteId: session.siteId || '', notes: session.notes || '' }],
      generalPreDocs, generalPostDocs,
      emailTemplateId: emailTemplateId || '',
      billable: billable !== false // facturé par défaut ; false = sort du suivi des factures
    };
    writeJSON(path.join(cFolder, 'course.json'), course);
    res.json({ id, ...course });
  } catch (e) {
    fail(res, e);
  }
});

app.put('/api/courses/:id', (req, res) => {
  try {
    const root = getRoot();
    const p = path.join(root, req.params.id, 'course.json');
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'INVALID_DATA' });
    const updated = { ...readJSONStrict(p, {}), ...req.body };
    writeJSON(p, updated);
    res.json({ id: req.params.id, ...updated });
  } catch (e) { fail(res, e); }
});

app.delete('/api/courses/:id', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    if (!insideRoot(root, cFolder)) throw invalidPath();
    // On ne supprime qu'un vrai dossier de cours (qui contient course.json), jamais un dossier quelconque.
    if (fs.existsSync(cFolder)) {
      if (!fs.existsSync(path.join(cFolder, 'course.json'))) return res.status(400).json({ error: 'NOT_A_COURSE' });
      const tid = moveToTrash(root, cFolder, { kind: 'course', courseId: req.params.id });
      return res.json({ ok: true, trashed: tid });
    }
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ---------- Students within a course ----------
app.post('/api/courses/:id/students', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    const cJsonPath = path.join(cFolder, 'course.json');
    if (!fs.existsSync(cJsonPath)) return res.status(404).json({ error: 'NOT_FOUND' });
    const course = readJSONStrict(cJsonPath, {});
    const types = readJSON(cfg('course_types.json'), []);
    const type = types.find(t => t.code === course.typeCode) || { preDocs: [], postDocs: [] };
    const b = req.body || {};
    if (!b.firstName || !b.lastName) return res.status(400).json({ error: 'MISSING_FIELDS' });
    const folderName = sanitize(`${b.firstName} ${(b.lastName || '').toUpperCase()}`);
    const sFolder = path.join(cFolder, folderName);
    if (fs.existsSync(sFolder)) return res.status(400).json({ error: 'STUDENT_EXISTS' });
    fs.mkdirSync(sFolder, { recursive: true });
    const preDocs = {}; (type.preDocs || []).forEach(d => preDocs[d.id] = { collected: false, date: null, needed: docRequirement(d) === 'required' });
    const postDocs = {}; (type.postDocs || []).forEach(d => postDocs[d.id] = { collected: false, date: null, needed: docRequirement(d) === 'required' });
    // Les champs d'identité (prénom, nom, adresse, téléphones, etc.) sont libres : ils suivent
    // le schéma éditable dans data/student_fields.json, pas une liste figée côté serveur.
    const student = { ...b, preDocs, postDocs };
    writeJSON(path.join(sFolder, 'student.json'), student);
    course.students = course.students || [];
    course.students.push(folderName);
    writeJSON(cJsonPath, course);
    res.json({ folder: folderName, ...student });
  } catch (e) {
    fail(res, e);
  }
});

// Import de plusieurs étudiants d'un coup (ex: à partir d'un roster PDF converti en JSON par Claude)
app.post('/api/courses/:id/students/bulk', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    const cJsonPath = path.join(cFolder, 'course.json');
    if (!fs.existsSync(cJsonPath)) return res.status(404).json({ error: 'NOT_FOUND' });
    const course = readJSONStrict(cJsonPath, {});
    const types = readJSON(cfg('course_types.json'), []);
    const type = types.find(t => t.code === course.typeCode) || { preDocs: [], postDocs: [] };
    const list = Array.isArray(req.body.students) ? req.body.students : [];
    const created = [], skipped = [];
    course.students = course.students || [];
    for (const b of list) {
      if (!b || !b.firstName || !b.lastName) { skipped.push({ name: (b && (b.firstName || b.lastName)) || '(inconnu)', reason: 'Prénom/nom manquant' }); continue; }
      const folderName = sanitize(`${b.firstName} ${(b.lastName || '').toUpperCase()}`);
      const sFolder = path.join(cFolder, folderName);
      if (fs.existsSync(sFolder)) { skipped.push({ name: folderName, reason: 'Existe déjà dans ce cours' }); continue; }
      fs.mkdirSync(sFolder, { recursive: true });
      const preDocs = {}; (type.preDocs || []).forEach(d => preDocs[d.id] = { collected: false, date: null, needed: docRequirement(d) === 'required' });
      const postDocs = {}; (type.postDocs || []).forEach(d => postDocs[d.id] = { collected: false, date: null, needed: docRequirement(d) === 'required' });
      const student = { ...b, preDocs, postDocs };
      writeJSON(path.join(sFolder, 'student.json'), student);
      course.students.push(folderName);
      created.push(folderName);
    }
    writeJSON(cJsonPath, course);
    res.json({ created, skipped });
  } catch (e) {
    fail(res, e);
  }
});

app.put('/api/courses/:id/students/:folder', (req, res) => {
  try {
    const root = getRoot();
    const p = path.join(root, req.params.id, req.params.folder, 'student.json');
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'INVALID_DATA' });
    const { corrupted, files, folder, ...patch } = req.body; // champs calculés par le serveur : jamais enregistrés
    const updated = { ...readJSONStrict(p, {}), ...patch };
    writeJSON(p, updated);
    res.json({ folder: req.params.folder, ...updated });
  } catch (e) { fail(res, e); }
});

app.delete('/api/courses/:id/students/:folder', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    const sFolder = path.join(cFolder, req.params.folder);
    if (!insideRoot(root, cFolder) || !insideRoot(cFolder, sFolder)) throw invalidPath();
    const cJsonPath = path.join(cFolder, 'course.json');
    if (!fs.existsSync(cJsonPath)) return res.status(404).json({ error: 'NOT_FOUND' });
    // On lit course.json AVANT de supprimer : s'il est illisible, on ne touche à rien.
    const course = readJSONStrict(cJsonPath, {});
    if (fs.existsSync(sFolder)) {
      // Seul un dossier inscrit au cours (ou contenant une fiche) peut être supprimé — pas « Photo », par exemple.
      const known = (course.students || []).includes(req.params.folder) || fs.existsSync(path.join(sFolder, 'student.json'));
      if (!known) return res.status(400).json({ error: 'NOT_A_STUDENT' });
      moveToTrash(root, sFolder, { kind: 'student', courseId: req.params.id, studentFolder: req.params.folder });
    }
    course.students = (course.students || []).filter(s => s !== req.params.folder);
    writeJSON(cJsonPath, course);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ---------- Global students (recherche pour copier les infos) ----------
app.get('/api/global-students', (req, res) => {
  try {
    const root = getRoot();
    if (!fs.existsSync(root)) return res.json([]);
    const q = (req.query.q || '').toLowerCase();
    const results = [];
    const courseDirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !isReservedDir(d.name));
    for (const cd of courseDirs) {
      const cPath = path.join(root, cd.name);
      let studentDirs = [];
      try { studentDirs = fs.readdirSync(cPath, { withFileTypes: true }).filter(d => d.isDirectory()); }
      catch (e) { continue; }
      for (const sd of studentDirs) {
        const sData = readJSON(path.join(cPath, sd.name, 'student.json'), null);
        if (!sData) continue;
        const full = `${sData.firstName || ''} ${sData.lastName || ''}`.toLowerCase();
        if (!q || full.includes(q)) {
          const { preDocs, postDocs, ...rest } = sData;
          results.push({ courseId: cd.name, folder: sd.name, ...rest });
        }
      }
    }
    res.json(results);
  } catch (e) {
    fail(res, e);
  }
});

// Évite d'écraser un fichier existant : ajoute " (2)", " (3)"... avant l'extension si besoin.
function uniqueFileName(folder, name) {
  // On ne garde que le nom du fichier (sans chemin éventuel), nettoyé, sans points en tête.
  const clean = sanitize(String(name || '').split(/[\\/]/).pop()).replace(/^\.+/, '') || 'document';
  const ext = path.extname(clean);
  const base = clean.slice(0, clean.length - ext.length);
  let candidate = clean, n = 2;
  while (fs.existsSync(path.join(folder, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n++;
  }
  return candidate;
}

// ---------- Glisser-déposer : réception d'un fichier ----------
// Le navigateur envoie le fichier brut (application/octet-stream), avec son nom dans ?filename=.
// Il est écrit en flux dans un fichier temporaire voisin, puis renommé : aucune limite de taille
// liée à la mémoire, et jamais de fichier à moitié copié sous son nom définitif.
// (L'ancien format, JSON + base64, reste accepté.)
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024; // 8 Go : garde-fou, pas une limite technique
function receiveUpload(req, res, folder) {
  const legacy = req.body && typeof req.body === 'object' && req.body.dataBase64;
  const filename = legacy ? req.body.filename : req.query.filename;
  if (!filename) return res.status(400).json({ error: 'MISSING_FIELDS' });
  if (legacy) {
    const finalName = uniqueFileName(folder, filename);
    fs.writeFileSync(path.join(folder, finalName), Buffer.from(req.body.dataBase64, 'base64'));
    return res.json({ ok: true, filename: finalName });
  }
  if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'FILE_TOO_LARGE' });
  const tmp = path.join(folder, `envoi-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.tmp`);
  const out = fs.createWriteStream(tmp);
  let received = 0, finished = false;
  const abort = (status, error) => {
    if (finished) return; finished = true;
    req.unpipe(out); out.destroy();
    fs.unlink(tmp, () => {});
    if (!res.headersSent) res.status(status).json({ error });
  };
  req.on('data', chunk => { received += chunk.length; if (received > MAX_UPLOAD_BYTES) abort(413, 'FILE_TOO_LARGE'); });
  req.on('aborted', () => abort(400, 'UPLOAD_ABORTED'));   // envoi interrompu (onglet fermé, réseau)
  req.on('error', () => abort(400, 'UPLOAD_ABORTED'));
  out.on('error', e => abort(500, e.code === 'ENOSPC' ? 'DISK_FULL' : (e.code || 'WRITE_ERROR')));
  out.on('finish', () => {
    if (finished) return; finished = true;
    try {
      const finalName = uniqueFileName(folder, filename);
      fs.renameSync(tmp, path.join(folder, finalName));
      res.json({ ok: true, filename: finalName, size: received });
    } catch (e) { fs.unlink(tmp, () => {}); res.status(500).json({ error: e.code || e.message }); }
  });
  req.pipe(out);
}
// Documents généraux du cours
app.post('/api/courses/:id/upload', (req, res) => {
  try {
    const cFolder = path.join(getRoot(), req.params.id);
    if (!fs.existsSync(path.join(cFolder, 'course.json'))) return res.status(404).json({ error: 'NOT_FOUND' });
    receiveUpload(req, res, cFolder);
  } catch (e) { fail(res, e); }
});
// Photos du cours (sous-dossier « Photo »)
app.post('/api/courses/:id/photos/upload', (req, res) => {
  try {
    const cFolder = path.join(getRoot(), req.params.id);
    if (!fs.existsSync(path.join(cFolder, 'course.json'))) return res.status(404).json({ error: 'NOT_FOUND' });
    receiveUpload(req, res, ensurePhotoDir(cFolder));
  } catch (e) { fail(res, e); }
});
// Documents d'un étudiant
app.post('/api/courses/:id/students/:folder/upload', (req, res) => {
  try {
    const sFolder = path.join(getRoot(), req.params.id, req.params.folder);
    if (!fs.existsSync(path.join(sFolder, 'student.json'))) return res.status(404).json({ error: 'NOT_FOUND' });
    receiveUpload(req, res, sFolder);
  } catch (e) { fail(res, e); }
});

// ---------- Ouvrir dans l'Explorateur Windows ----------
app.post('/api/open-explorer', (req, res) => {
  try {
    const root = getRoot();
    const b = req.body || {};
    let target = root;
    for (const seg of [b.courseId, b.studentFolder, b.sub]) {
      if (seg === undefined || seg === null || seg === '') continue;
      if (!isSafeSegment(seg)) throw invalidPath();
      target = path.join(target, seg);
    }
    if (path.resolve(target) !== path.resolve(root) && !insideRoot(root, target)) throw invalidPath();
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'PATH_NOT_FOUND', target });
    // execFile (sans interpréteur de commandes) : le nom du dossier ne peut pas être interprété comme une commande.
    execFile('explorer.exe', [path.resolve(target)], () => {});
    res.json({ ok: true, target });
  } catch (e) {
    fail(res, e);
  }
});

// ---------- Sauvegarde (backup) du répertoire racine en .zip ----------
// Le zip est créé dans un dossier temporaire (voir plus bas), puis téléchargé par le navigateur,
// qui laisse l'instructeur choisir où l'enregistrer (clé USB, cloud, autre disque...).
function backupFileName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `PLONGEE_BACKUP_${stamp}.zip`;
}
// La sauvegarde est créée en tâche de fond par zipwriter.js (Node pur : pas de PowerShell, pas de
// limite de 2 Go). Le navigateur suit l'avancement, puis télécharge le zip directement sur le disque
// (GET), sans le charger en mémoire.
const { createZip } = require('./zipwriter');
let backupJob = null; // { id, state: 'running'|'done'|'error', filename, zipPath, progress, result, error }
function cleanupBackup(job) { if (job && job.zipPath) { try { fs.unlinkSync(job.zipPath); } catch (e) {} } }
function publicBackupJob(job) {
  if (!job) return { state: 'none' };
  const p = job.progress || {};
  return { id: job.id, state: job.state, filename: job.filename, error: job.error || '',
    filesDone: p.filesDone || 0, filesTotal: p.filesTotal || 0, bytesDone: p.bytesDone || 0, bytesTotal: p.bytesTotal || 0,
    zipBytes: job.result ? job.result.zipBytes : 0, skipped: job.result ? job.result.skipped : [] };
}
app.post('/api/backup', (req, res) => {
  let root;
  try { root = getRoot(); }
  catch (e) { return fail(res, e); }
  if (backupJob && backupJob.state === 'running') return res.json(publicBackupJob(backupJob));
  let hasContent = false;
  try { hasContent = fs.readdirSync(root).length > 0; } catch (e) {}
  if (!hasContent) return res.status(400).json({ error: 'ROOT_EMPTY' });

  cleanupBackup(backupJob); // zip d'une sauvegarde précédente jamais téléchargée
  try { configDir(); } catch (e) {}
  const filename = backupFileName();
  const job = backupJob = { id: trashStamp(), state: 'running', filename, progress: {},
    zipPath: path.join(os.tmpdir(), `scubapilot-${process.pid}-${Date.now()}.zip`) };
  createZip(job.zipPath, root, {
    skip: (abs, d) => d.isFile() && d.name.endsWith('.tmp'),
    onProgress: p => { job.progress = { ...p }; }
  }).then(result => { job.result = result; job.state = 'done'; },
          err => { job.error = (err && (err.code || err.message)) || 'ERREUR'; job.state = 'error'; cleanupBackup(job); });
  res.json(publicBackupJob(job));
});
app.get('/api/backup/status', (req, res) => res.json(publicBackupJob(backupJob)));
app.get('/api/backup/download/:tid', (req, res) => {
  const job = backupJob;
  if (!job || job.id !== req.params.tid || job.state !== 'done' || !fs.existsSync(job.zipPath)) return res.status(404).json({ error: 'NOT_FOUND' });
  res.download(job.zipPath, job.filename, () => {
    // Le zip temporaire est retiré une fois envoyé (ou si l'envoi a échoué : il suffira de relancer).
    cleanupBackup(job);
    if (backupJob === job) backupJob = null;
  });
});

app.get('/api/utils/format-date', (req, res) => res.json({ human: fmtDateHuman(req.query.d) }));

let APP_VERSION = '';
try { APP_VERSION = require('./package.json').version; } catch (e) {}
// Une erreur imprévue dans une requête ne doit pas arrêter le programme (il tourne en arrière-plan,
// sans fenêtre : personne ne le verrait s'arrêter). On la note dans le journal et on continue.
process.on('uncaughtException', e => console.error(`[${new Date().toISOString()}] Erreur imprévue :`, e && e.stack || e));
process.on('unhandledRejection', e => console.error(`[${new Date().toISOString()}] Erreur imprévue (promesse) :`, e && e.stack || e));

// Au démarrage : reprise du chemin de la racine et migration des réglages vers <racine>/_ScubaPilot/.
try { configDir(); } catch (e) { /* racine absente ou pas encore choisie : l'interface le signalera */ }

const server = app.listen(PORT, HOST, () => {
  console.log('=================================================');
  console.log(`  ScubaPilot ${APP_VERSION} — démarré le ${new Date().toLocaleString('fr-CA')}`);
  console.log(`  Ouvrez votre navigateur sur : http://localhost:${PORT}`);
  console.log(`  Application : ${__dirname}`);
  console.log(`  Racine      : ${getRootOrEmpty() || '(à choisir)'}`);
  if (!LOCAL_ONLY) console.log(`  ATTENTION : accessible depuis le réseau (${HOST}), sans mot de passe.`);
  console.log('=================================================');
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`[${new Date().toISOString()}] Le port ${PORT} est déjà utilisé : une autre copie de ScubaPilot tourne déjà. Lancez "Arreter.bat" puis redémarrez.`);
  else console.error(e);
  process.exit(1);
});
