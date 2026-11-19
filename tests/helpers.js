// Outils communs aux tests : lancer le vrai serveur sur un port de test, avec un répertoire racine
// et un profil temporaires — rien de votre installation n'est touché.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const APP_DIR = path.join(__dirname, '..');

function tmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), `scubapilot-test-${prefix}-`)); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Délai dépassé : ${what || 'condition'}${last ? ' (' + last.message + ')' : ''}`);
}

/**
 * Démarre server.js. options : { port, root (défini d'office comme racine si fourni), env }
 * Renvoie { url, port, root, localDir, api(method, path, body, headers), raw(method, path, opts), stop() }.
 */
async function startServer(options) {
  const port = options.port;
  const localDir = tmpDir('local');
  const root = options.root === undefined ? tmpDir('root') : options.root;
  if (root) fs.writeFileSync(path.join(localDir, 'local.json'), JSON.stringify({ rootDir: root }));
  let output = '';
  const child = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR, env: { ...process.env, SCUBAPILOT_PORT: String(port), SCUBAPILOT_LOCAL_DIR: localDir, ...(options.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  const url = `http://127.0.0.1:${port}`;
  // Comme l'interface, les tests envoient l'en-tête X-ScubaPilot (exigé pour toute modification).
  const raw = (method, p, opts) => fetch(url + p, { method, ...(opts || {}), headers: { 'X-ScubaPilot': '1', ...((opts && opts.headers) || {}) } });
  const api = async (method, p, body, headers) => {
    const res = await fetch(url + p, {
      method, headers: { 'X-ScubaPilot': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, data };
  };
  let exited = false;
  child.on('exit', () => { exited = true; });
  try {
    await waitFor(async () => { if (exited) throw new Error('le serveur s\'est arrêté :\n' + output); return (await fetch(url + '/api/app-info')).ok; }, 15000, 'démarrage du serveur');
  } catch (e) { child.kill(); throw new Error(e.message + '\n' + output); }
  const stop = async () => {
    if (!exited) { child.kill(); await waitFor(() => exited, 5000, 'arrêt du serveur').catch(() => {}); }
    rmrf(localDir); if (root && options.root === undefined) rmrf(root);
  };
  return { url, port, root, localDir, api, raw, stop, output: () => output };
}

// Jeu de données minimal : un centre + un cours OWD avec deux étudiants.
async function seedCourse(srv, date) {
  await srv.api('PUT', '/api/centers', [{ id: 'c1', name: 'Centre Test', email: 'centre@exemple.ca' }]);
  const c = await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: date || '2030-06-15', timeStart: '09:00', timeEnd: '12:00' } });
  if (c.status !== 200) throw new Error('création du cours : ' + JSON.stringify(c.data));
  const a = await srv.api('POST', `/api/courses/${c.data.id}/students`, { firstName: 'Zoé', lastName: 'Lévesque', email: 'zoe@exemple.ca', status: 'both' });
  const b = await srv.api('POST', `/api/courses/${c.data.id}/students`, { firstName: 'Marc', lastName: 'Roy', status: 'cours' });
  return { id: c.data.id, zoe: a.data.folder, marc: b.data.folder };
}

// ---- Lecteur ZIP minimal (ZIP et ZIP64), pour vérifier les archives produites sans outil externe ----
const { crc32 } = require('../zipwriter');
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('fin de zip introuvable');
  let count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  let zip64 = false;
  const loc = eocd - 20;
  if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
    const z = Number(buf.readBigUInt64LE(loc + 8));
    if (buf.readUInt32LE(z) !== 0x06064b50) throw new Error('enregistrement ZIP64 invalide');
    count = Number(buf.readBigUInt64LE(z + 32)); cdSize = Number(buf.readBigUInt64LE(z + 40)); cdOff = Number(buf.readBigUInt64LE(z + 48));
    zip64 = true;
  }
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('entrée centrale invalide à ' + p);
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    let offset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    let x = p + 46 + nameLen; const xEnd = x + extraLen; let entry64 = false;
    while (x + 4 <= xEnd) {
      const id = buf.readUInt16LE(x), len = buf.readUInt16LE(x + 2); let q = x + 4;
      if (id === 0x0001) {
        entry64 = true;
        if (usize === 0xFFFFFFFF) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xFFFFFFFF) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xFFFFFFFF) { offset = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + len;
    }
    // données : après l'en-tête local
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error('en-tête local invalide pour ' + name);
    const ln = buf.readUInt16LE(offset + 26), le = buf.readUInt16LE(offset + 28);
    const data = buf.slice(offset + 30 + ln + le, offset + 30 + ln + le + csize);
    const content = name.endsWith('/') ? Buffer.alloc(0) : (method === 8 ? zlib.inflateRawSync(data) : data);
    if (content.length !== usize) throw new Error('taille incorrecte pour ' + name);
    if (crc32(content, 0) !== crc) throw new Error('CRC incorrect pour ' + name);
    entries.push({ name, method, utf8: !!(flags & 0x0800), zip64: entry64, content });
    p = xEnd + commentLen;
  }
  return { entries, zip64, names: entries.map(e => e.name), get: n => (entries.find(e => e.name === n) || {}).content };
}

module.exports = { APP_DIR, tmpDir, rmrf, waitFor, startServer, seedCourse, readZip };
