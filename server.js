const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');

const app = express();
// Limite relevée : les documents glissés-déposés sont envoyés en base64 dans le corps JSON.
app.use(express.json({ limit: '25mb' }));
// no-cache : le navigateur revalide à chaque chargement, pour qu'une mise à jour de l'application
// (public/app.js) soit visible tout de suite sans devoir vider le cache.
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const TYPES_FILE = path.join(DATA_DIR, 'course_types.json');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const STUDENT_FIELDS_FILE = path.join(DATA_DIR, 'student_fields.json');
const EMAIL_TEMPLATES_FILE = path.join(DATA_DIR, 'email_templates.json');
const BUDDIES_FILE = path.join(DATA_DIR, 'buddies.json');
const CENTERS_FILE = path.join(DATA_DIR, 'centers.json');
const BILLING_FILE = path.join(DATA_DIR, 'billing.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function getRoot() {
  const s = readJSON(SETTINGS_FILE, {});
  if (!s.rootDir) { const err = new Error('ROOT_NOT_SET'); throw err; }
  return s.rootDir;
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
if (!fs.existsSync(EMAIL_TEMPLATES_FILE)) {
  const oldSettings = readJSON(SETTINGS_FILE, {});
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
  writeJSON(EMAIL_TEMPLATES_FILE, migrated);
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

// ---------- Settings ----------
app.get('/api/settings', (req, res) => res.json(readJSON(SETTINGS_FILE, {})));
app.put('/api/settings', (req, res) => { writeJSON(SETTINGS_FILE, req.body); res.json({ ok: true }); });
app.post('/api/settings/check-dir', (req, res) => {
  const dir = req.body.dir || '';
  res.json({ exists: dir ? fs.existsSync(dir) : false });
});
app.post('/api/settings/create-dir', (req, res) => {
  try { fs.mkdirSync(req.body.dir, { recursive: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Course types (modèles de cours) ----------
app.get('/api/course-types', (req, res) => res.json(readJSON(TYPES_FILE, [])));
app.put('/api/course-types', (req, res) => { writeJSON(TYPES_FILE, req.body); res.json({ ok: true }); });

// ---------- Sites ----------
app.get('/api/sites', (req, res) => res.json(readJSON(SITES_FILE, [])));
app.put('/api/sites', (req, res) => { writeJSON(SITES_FILE, req.body); res.json({ ok: true }); });

// ---------- Champs du profil étudiant (modèle personnalisable) ----------
app.get('/api/student-fields', (req, res) => res.json(readJSON(STUDENT_FIELDS_FILE, [])));
app.put('/api/student-fields', (req, res) => { writeJSON(STUDENT_FIELDS_FILE, req.body); res.json({ ok: true }); });

// ---------- Bibliothèque de modèles d'email ----------
app.get('/api/email-templates', (req, res) => res.json(readJSON(EMAIL_TEMPLATES_FILE, [])));
app.put('/api/email-templates', (req, res) => { writeJSON(EMAIL_TEMPLATES_FILE, req.body); res.json({ ok: true }); });

// ---------- Liste globale de coéquipiers (Divemaster, autres instructeurs...) ----------
app.get('/api/buddies', (req, res) => res.json(readJSON(BUDDIES_FILE, [])));
app.put('/api/buddies', (req, res) => { writeJSON(BUDDIES_FILE, req.body); res.json({ ok: true }); });

// ---------- Centres partenaires (qui mandatent l'instructeur) ----------
app.get('/api/centers', (req, res) => res.json(readJSON(CENTERS_FILE, [])));
app.put('/api/centers', (req, res) => { writeJSON(CENTERS_FILE, req.body); res.json({ ok: true }); });

// ---------- Modèle de facturation (prix de base + offset par étudiant additionnel) ----------
app.get('/api/billing', (req, res) => res.json(readJSON(BILLING_FILE, { currency: 'CAD', default: { basePrice: 0, minStudents: 1, extraStudentPrice: 0 }, byType: {} })));
app.put('/api/billing', (req, res) => { writeJSON(BILLING_FILE, req.body); res.json({ ok: true }); });

// ---------- Étampe (image pour les factures, stockée en data URL) ----------
const STAMP_FILE = path.join(DATA_DIR, 'stamp.json');
app.get('/api/stamp', (req, res) => res.json(readJSON(STAMP_FILE, { dataUrl: '' })));
app.put('/api/stamp', (req, res) => {
  const d = req.body && typeof req.body.dataUrl === 'string' ? req.body.dataUrl : '';
  if (d && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(d)) return res.status(400).json({ error: 'INVALID_IMAGE' });
  writeJSON(STAMP_FILE, { dataUrl: d }); res.json({ ok: true });
});

// ---------- Stats d'un cours ----------
function computeCourseStats(root, courseId, course) {
  const cFolder = path.join(root, courseId);
  const types = readJSON(TYPES_FILE, []);
  const type = types.find(t => t.code === course.typeCode) || {};
  let totalPre = 0, donePre = 0, totalPost = 0, donePost = 0;
  const students = [];
  for (const sName of (course.students || [])) {
    const sData = readJSON(path.join(cFolder, sName, 'student.json'), null);
    if (!sData) continue;
    const preC = countDocGroup(sData.preDocs, type.preDocs);
    const postC = countDocGroup(sData.postDocs, type.postDocs);
    totalPre += preC.total; donePre += preC.done;
    totalPost += postC.total; donePost += postC.done;
    students.push({
      folder: sName, firstName: sData.firstName, lastName: sData.lastName,
      prePercent: preC.total ? Math.round(100 * preC.done / preC.total) : 100,
      postPercent: postC.total ? Math.round(100 * postC.done / postC.total) : 100
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
    students
  };
}

// ---------- Courses ----------
app.get('/api/courses', (req, res) => {
  try {
    const root = getRoot();
    if (!fs.existsSync(root)) return res.json([]);
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
    const courses = [];
    for (const d of dirs) {
      const cJsonPath = path.join(root, d.name, 'course.json');
      if (!fs.existsSync(cJsonPath)) continue;
      const course = readJSON(cJsonPath, null);
      if (!course) continue;
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
    if (e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/courses/:id', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    const cJsonPath = path.join(cFolder, 'course.json');
    if (!fs.existsSync(cJsonPath)) return res.status(404).json({ error: 'NOT_FOUND' });
    const course = readJSON(cJsonPath, {});
    const students = (course.students || []).map(sName => {
      const sData = readJSON(path.join(cFolder, sName, 'student.json'), {});
      let files = [];
      try { files = fs.readdirSync(path.join(cFolder, sName)).filter(f => f !== 'student.json'); } catch (e) {}
      return { folder: sName, ...sData, files };
    });
    const sessions = getSessions(course).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    // Fichiers déposés directement dans le dossier du cours (documents généraux), en excluant
    // course.json et les sous-dossiers étudiants.
    let files = [];
    try {
      files = fs.readdirSync(cFolder, { withFileTypes: true })
        .filter(d => d.isFile() && d.name !== 'course.json')
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
    if (e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/courses', (req, res) => {
  try {
    const root = getRoot();
    const { typeCode, notes, session, emailTemplateId, centerId, instructorIds } = req.body;
    if (!typeCode || !session || !session.date) return res.status(400).json({ error: 'MISSING_FIELDS' });
    if (!centerId) return res.status(400).json({ error: 'CENTER_REQUIRED' });
    const id = `${typeCode}_${fmtDateId(session.date)}`;
    const cFolder = path.join(root, id);
    if (fs.existsSync(cFolder)) return res.status(400).json({ error: 'COURSE_EXISTS' });
    fs.mkdirSync(cFolder, { recursive: true });
    ensurePhotoDir(cFolder); // dossier "Photo" créé systématiquement pour chaque nouveau cours
    const types = readJSON(TYPES_FILE, []);
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
      emailTemplateId: emailTemplateId || ''
    };
    writeJSON(path.join(cFolder, 'course.json'), course);
    res.json({ id, ...course });
  } catch (e) {
    if (e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/courses/:id', (req, res) => {
  try {
    const root = getRoot();
    const p = path.join(root, req.params.id, 'course.json');
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'NOT_FOUND' });
    const updated = { ...readJSON(p, {}), ...req.body };
    writeJSON(p, updated);
    res.json({ id: req.params.id, ...updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/courses/:id', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    if (fs.existsSync(cFolder)) fs.rmSync(cFolder, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Students within a course ----------
app.post('/api/courses/:id/students', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    const cJsonPath = path.join(cFolder, 'course.json');
    if (!fs.existsSync(cJsonPath)) return res.status(404).json({ error: 'NOT_FOUND' });
    const course = readJSON(cJsonPath, {});
    const types = readJSON(TYPES_FILE, []);
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
    if (e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
    res.status(500).json({ error: e.message });
  }
});

// Import de plusieurs étudiants d'un coup (ex: à partir d'un roster PDF converti en JSON par Claude)
app.post('/api/courses/:id/students/bulk', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    const cJsonPath = path.join(cFolder, 'course.json');
    if (!fs.existsSync(cJsonPath)) return res.status(404).json({ error: 'NOT_FOUND' });
    const course = readJSON(cJsonPath, {});
    const types = readJSON(TYPES_FILE, []);
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
    if (e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/courses/:id/students/:folder', (req, res) => {
  try {
    const root = getRoot();
    const p = path.join(root, req.params.id, req.params.folder, 'student.json');
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'NOT_FOUND' });
    const updated = { ...readJSON(p, {}), ...req.body };
    writeJSON(p, updated);
    res.json({ folder: req.params.folder, ...updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/courses/:id/students/:folder', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    const sFolder = path.join(cFolder, req.params.folder);
    if (fs.existsSync(sFolder)) fs.rmSync(sFolder, { recursive: true, force: true });
    const cJsonPath = path.join(cFolder, 'course.json');
    const course = readJSON(cJsonPath, {});
    course.students = (course.students || []).filter(s => s !== req.params.folder);
    writeJSON(cJsonPath, course);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Global students (recherche pour copier les infos) ----------
app.get('/api/global-students', (req, res) => {
  try {
    const root = getRoot();
    if (!fs.existsSync(root)) return res.json([]);
    const q = (req.query.q || '').toLowerCase();
    const results = [];
    const courseDirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
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
    if (e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
    res.status(500).json({ error: e.message });
  }
});

// Évite d'écraser un fichier existant : ajoute " (2)", " (3)"... avant l'extension si besoin.
function uniqueFileName(folder, name) {
  const clean = sanitize(name) || 'document';
  const ext = path.extname(clean);
  const base = clean.slice(0, clean.length - ext.length);
  let candidate = clean, n = 2;
  while (fs.existsSync(path.join(folder, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n++;
  }
  return candidate;
}

// ---------- Glisser-déposer : copie un document dans le dossier du cours (documents généraux) ----------
app.post('/api/courses/:id/upload', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    if (!fs.existsSync(path.join(cFolder, 'course.json'))) return res.status(404).json({ error: 'NOT_FOUND' });
    const { filename, dataBase64 } = req.body || {};
    if (!filename || !dataBase64) return res.status(400).json({ error: 'MISSING_FIELDS' });
    const finalName = uniqueFileName(cFolder, filename);
    fs.writeFileSync(path.join(cFolder, finalName), Buffer.from(dataBase64, 'base64'));
    res.json({ ok: true, filename: finalName });
  } catch (e) {
    if (e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
    res.status(500).json({ error: e.message });
  }
});

// ---------- Glisser-déposer : copie une photo dans le sous-dossier "Photo" du cours ----------
app.post('/api/courses/:id/photos/upload', (req, res) => {
  try {
    const root = getRoot();
    const cFolder = path.join(root, req.params.id);
    if (!fs.existsSync(path.join(cFolder, 'course.json'))) return res.status(404).json({ error: 'NOT_FOUND' });
    const photoDir = ensurePhotoDir(cFolder);
    const { filename, dataBase64 } = req.body || {};
    if (!filename || !dataBase64) return res.status(400).json({ error: 'MISSING_FIELDS' });
    const finalName = uniqueFileName(photoDir, filename);
    fs.writeFileSync(path.join(photoDir, finalName), Buffer.from(dataBase64, 'base64'));
    res.json({ ok: true, filename: finalName });
  } catch (e) {
    if (e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
    res.status(500).json({ error: e.message });
  }
});

// ---------- Glisser-déposer : copie un document dans le dossier d'un étudiant ----------
app.post('/api/courses/:id/students/:folder/upload', (req, res) => {
  try {
    const root = getRoot();
    const sFolder = path.join(root, req.params.id, req.params.folder);
    if (!fs.existsSync(path.join(sFolder, 'student.json'))) return res.status(404).json({ error: 'NOT_FOUND' });
    const { filename, dataBase64 } = req.body || {};
    if (!filename || !dataBase64) return res.status(400).json({ error: 'MISSING_FIELDS' });
    const finalName = uniqueFileName(sFolder, filename);
    fs.writeFileSync(path.join(sFolder, finalName), Buffer.from(dataBase64, 'base64'));
    res.json({ ok: true, filename: finalName });
  } catch (e) {
    if (e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
    res.status(500).json({ error: e.message });
  }
});

// ---------- Ouvrir dans l'Explorateur Windows ----------
app.post('/api/open-explorer', (req, res) => {
  try {
    const root = getRoot();
    let target = path.join(root, req.body.courseId || '');
    if (req.body.studentFolder) target = path.join(target, req.body.studentFolder);
    if (req.body.sub) target = path.join(target, req.body.sub);
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'PATH_NOT_FOUND', target });
    exec(`start "" "${target}"`, { shell: 'cmd.exe' }, () => {});
    res.json({ ok: true, target });
  } catch (e) {
    if (e.message === 'ROOT_NOT_SET') return res.status(400).json({ error: 'ROOT_NOT_SET' });
    res.status(500).json({ error: e.message });
  }
});

// ---------- Sauvegarde (backup) du répertoire racine en .zip ----------
// Utilise Compress-Archive (PowerShell, inclus dans Windows) plutôt qu'une dépendance npm,
// pour éviter d'avoir besoin d'accès internet lors de l'installation. Le zip est créé dans un
// dossier temporaire puis envoyé en téléchargement au navigateur, qui laisse l'instructeur
// choisir où l'enregistrer (clé USB, cloud, autre disque...).
function backupFileName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `PLONGEE_BACKUP_${stamp}.zip`;
}
app.post('/api/backup', (req, res) => {
  let root;
  try { root = getRoot(); }
  catch (e) { return res.status(400).json({ error: e.message === 'ROOT_NOT_SET' ? 'ROOT_NOT_SET' : e.message }); }
  if (!fs.existsSync(root)) return res.status(400).json({ error: 'ROOT_NOT_FOUND' });
  let hasContent = false;
  try { hasContent = fs.readdirSync(root).length > 0; } catch (e) {}
  if (!hasContent) return res.status(400).json({ error: 'ROOT_EMPTY' });

  const filename = backupFileName();
  const zipPath = path.join(os.tmpdir(), filename);
  try { fs.unlinkSync(zipPath); } catch (e) {}

  const escapeForPs = s => s.replace(/'/g, "''");
  const psCommand = `Compress-Archive -Path '${escapeForPs(root)}\\*' -DestinationPath '${escapeForPs(zipPath)}' -Force -CompressionLevel Optimal`;

  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand],
    { maxBuffer: 1024 * 1024 * 20, timeout: 10 * 60 * 1000 },
    (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({ error: 'BACKUP_FAILED', details: (stderr || err.message || '').toString().slice(0, 2000) });
      }
      res.download(zipPath, filename, (downloadErr) => {
        fs.unlink(zipPath, () => {});
        if (downloadErr && !res.headersSent) {
          res.status(500).json({ error: 'DOWNLOAD_FAILED', details: downloadErr.message });
        }
      });
    });
});

app.get('/api/utils/format-date', (req, res) => res.json({ human: fmtDateHuman(req.query.d) }));

const PORT = 4531;
app.listen(PORT, () => {
  console.log('=================================================');
  console.log('  ScubaPilot');
  console.log(`  Ouvrez votre navigateur sur : http://localhost:${PORT}`);
  console.log('=================================================');
});
