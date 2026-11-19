// Dépôt de fichiers, corbeille, sauvegarde.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startServer, seedCourse, waitFor, readZip, rmrf } = require('./helpers');

test('dépôt de fichiers', async (t) => {
  const srv = await startServer({ port: 45413 });
  t.after(() => srv.stop());
  const c = await seedCourse(srv);
  const up = (url, name, body) => srv.raw('POST', `${url}?filename=${encodeURIComponent(name)}`, { headers: { 'Content-Type': 'application/octet-stream' }, body });

  await t.test('un gros fichier binaire arrive intact (8 Mo)', async () => {
    const data = crypto.randomBytes(8 * 1024 * 1024);
    const r = await up(`/api/courses/${c.id}/photos/upload`, 'plongée vidéo.mp4', data);
    const j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.filename, 'plongée vidéo.mp4'); assert.equal(j.size, data.length);
    assert.ok(fs.readFileSync(path.join(srv.root, c.id, 'Photo', 'plongée vidéo.mp4')).equals(data));
  });
  await t.test('même nom une seconde fois : un nouveau nom, rien d\'écrasé', async () => {
    const j = await (await up(`/api/courses/${c.id}/photos/upload`, 'plongée vidéo.mp4', 'autre')).json();
    assert.notEqual(j.filename, 'plongée vidéo.mp4');
    assert.equal(fs.readdirSync(path.join(srv.root, c.id, 'Photo')).length, 2);
  });
  await t.test("dossier d'un étudiant, fichier vide, ancien format", async () => {
    assert.equal((await up(`/api/courses/${c.id}/students/${encodeURIComponent(c.zoe)}/upload`, 'médical.pdf', 'pdf')).status, 200);
    assert.ok(fs.existsSync(path.join(srv.root, c.id, c.zoe, 'médical.pdf')));
    assert.equal((await up(`/api/courses/${c.id}/upload`, 'vide.txt', '')).status, 200);
    assert.equal(fs.statSync(path.join(srv.root, c.id, 'vide.txt')).size, 0);
    const legacy = await srv.api('POST', `/api/courses/${c.id}/upload`, { filename: 'ancien.txt', dataBase64: Buffer.from('salut').toString('base64') });
    assert.equal(legacy.status, 200);
    assert.equal(fs.readFileSync(path.join(srv.root, c.id, 'ancien.txt'), 'utf8'), 'salut');
  });
  await t.test('refus : sans nom, cours inconnu', async () => {
    assert.equal((await srv.raw('POST', `/api/courses/${c.id}/upload`, { headers: { 'Content-Type': 'application/octet-stream' }, body: 'x' })).status, 400);
    assert.equal((await up('/api/courses/INCONNU_01JAN2030/upload', 'a.txt', 'x')).status, 404);
  });
  await t.test('les fichiers apparaissent dans la fiche, sans fichier temporaire', async () => {
    const d = (await srv.api('GET', `/api/courses/${c.id}`)).data;
    assert.ok(d.students.find(s => s.folder === c.zoe).files.includes('médical.pdf'));
    assert.ok(d.photos.includes('plongée vidéo.mp4'));
    assert.ok(![...d.files, ...d.photos].some(f => f.endsWith('.tmp')));
  });
});

test('corbeille : supprimer, restaurer, purger', async (t) => {
  const srv = await startServer({ port: 45413 });
  t.after(() => srv.stop());
  const c = await seedCourse(srv);
  const trash = async () => (await srv.api('GET', '/api/trash')).data;
  const students = async () => (await srv.api('GET', `/api/courses/${c.id}`)).data.students.map(s => s.folder).sort();
  fs.writeFileSync(path.join(srv.root, c.id, c.marc, 'médical.pdf'), 'document');

  await t.test('un étudiant supprimé part à la corbeille avec ses documents', async () => {
    assert.equal((await srv.api('DELETE', `/api/courses/${c.id}/students/${encodeURIComponent(c.marc)}`)).status, 200);
    assert.deepEqual(await students(), [c.zoe]);
    const items = await trash();
    assert.equal(items.length, 1); assert.equal(items[0].kind, 'student'); assert.equal(items[0].name, c.marc); assert.equal(items[0].courseId, c.id); assert.equal(items[0].restorable, true);
    assert.equal(fs.readFileSync(path.join(srv.root, '_Corbeille', items[0].tid, c.marc, 'médical.pdf'), 'utf8'), 'document');
  });
  await t.test('restauration : il retrouve sa place, la corbeille se vide', async () => {
    const [it] = await trash();
    assert.equal((await srv.api('POST', `/api/trash/${it.tid}/restore`)).status, 200);
    assert.deepEqual(await students(), [c.marc, c.zoe].sort());
    assert.equal(fs.readFileSync(path.join(srv.root, c.id, c.marc, 'médical.pdf'), 'utf8'), 'document');
    assert.deepEqual(await trash(), []);
  });
  await t.test("un étudiant ne se restaure pas sans son cours ; le cours se restaure d'abord", async () => {
    await srv.api('DELETE', `/api/courses/${c.id}/students/${encodeURIComponent(c.marc)}`);
    await srv.api('DELETE', `/api/courses/${c.id}`);
    assert.deepEqual((await srv.api('GET', '/api/courses')).data, [], 'le cours a disparu de la liste');
    const items = await trash();
    const st = items.find(i => i.kind === 'student'), co = items.find(i => i.kind === 'course');
    assert.equal((await srv.api('POST', `/api/trash/${st.tid}/restore`)).data.error, 'COURSE_NOT_FOUND');
    assert.equal((await srv.api('POST', `/api/trash/${co.tid}/restore`)).status, 200);
    assert.equal((await srv.api('POST', `/api/trash/${st.tid}/restore`)).status, 200);
    assert.deepEqual(await students(), [c.marc, c.zoe].sort());
  });
  await t.test('restauration refusée si un cours du même nom existe déjà', async () => {
    await srv.api('DELETE', `/api/courses/${c.id}`);
    await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: '2030-06-15' } });
    const [it] = await trash();
    assert.equal((await srv.api('POST', `/api/trash/${it.tid}/restore`)).data.error, 'COURSE_EXISTS');
    assert.equal((await trash()).length, 1, "l'élément reste dans la corbeille");
  });
  await t.test('suppression définitive et vidage', async () => {
    const [it] = await trash();
    assert.equal((await srv.api('DELETE', `/api/trash/${it.tid}`)).status, 200);
    assert.deepEqual(await trash(), []);
    await srv.api('DELETE', `/api/courses/${c.id}`);
    assert.equal((await srv.api('DELETE', '/api/trash')).data.removed, 1);
    assert.deepEqual(fs.readdirSync(path.join(srv.root, '_Corbeille')), []);
  });
});

test('sauvegarde : un zip complet et valide', async (t) => {
  const srv = await startServer({ port: 45413 });
  t.after(() => srv.stop());
  const c = await seedCourse(srv);
  const photo = crypto.randomBytes(300000);
  fs.writeFileSync(path.join(srv.root, c.id, 'Photo', 'groupe été.jpg'), photo);
  fs.writeFileSync(path.join(srv.root, c.id, c.zoe, 'Décharge médicale.txt'), 'texte répétitif '.repeat(5000));
  fs.writeFileSync(path.join(srv.root, c.id, 'reste.json.123.tmp'), 'temporaire');

  const start = await srv.api('POST', '/api/backup');
  assert.equal(start.status, 200); assert.match(start.data.filename, /^PLONGEE_BACKUP_\d{8}_\d{4}\.zip$/);
  const job = await waitFor(async () => { const s = (await srv.api('GET', '/api/backup/status')).data; if (s.state === 'error') throw new Error(s.error); return s.state === 'done' ? s : null; }, 20000, 'fin de la sauvegarde');
  assert.deepEqual(job.skipped, []);
  const res = await srv.raw('GET', '/api/backup/download/' + job.id);
  assert.equal(res.status, 200);
  const zipFile = path.join(os.tmpdir(), `scubapilot-test-${process.pid}.zip`);
  fs.writeFileSync(zipFile, Buffer.from(await res.arrayBuffer()));
  t.after(() => rmrf(zipFile));

  const zip = readZip(zipFile); // vérifie tailles et CRC de chaque entrée
  assert.ok(zip.get(`${c.id}/Photo/groupe été.jpg`).equals(photo), 'photo identique');
  assert.equal(zip.get(`${c.id}/${c.zoe}/Décharge médicale.txt`).toString('utf8'), 'texte répétitif '.repeat(5000));
  assert.ok(zip.names.includes('_ScubaPilot/centers.json'), 'les réglages sont dans la sauvegarde');
  assert.ok(zip.names.includes(`${c.id}/course.json`) && zip.names.includes(`${c.id}/${c.marc}/student.json`));
  assert.ok(!zip.names.some(n => n.endsWith('.tmp')), 'pas de fichier temporaire');
  assert.ok(zip.entries.every(e => e.utf8), 'noms en UTF-8');
  assert.equal((await srv.raw('GET', '/api/backup/download/' + job.id)).status, 404, 'le zip temporaire est retiré après téléchargement');
  // La date de la sauvegarde est notée avec les réglages, et renvoyée par /api/settings.
  const lb = await waitFor(async () => (await srv.api('GET', '/api/settings')).data.lastBackup, 5000, 'date de sauvegarde');
  assert.equal(lb.filename, job.filename); assert.ok(Date.now() - Date.parse(lb.at) < 60000);
  assert.ok(fs.existsSync(path.join(srv.root, '_ScubaPilot', 'derniere-sauvegarde.json')));
  // Elle n'est jamais réécrite dans settings.json par l'interface.
  const s = (await srv.api('GET', '/api/settings')).data;
  await srv.api('PUT', '/api/settings', { ...s, instructorName: 'X' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(srv.root, '_ScubaPilot', 'settings.json'), 'utf8')).lastBackup, undefined);
});

test('copies en conflit de OneDrive : repérées', async () => {
  const srv = await startServer({ port: 45413 });
  try {
    const c = await seedCourse(srv);
    assert.deepEqual((await srv.api('GET', '/api/conflicts')).data, []);
    fs.writeFileSync(path.join(srv.root, c.id, c.zoe, 'student-BUREAU-PC.json'), '{}');
    fs.writeFileSync(path.join(srv.root, c.id, 'course-PORTABLE.json'), '{}');
    fs.writeFileSync(path.join(srv.root, '_ScubaPilot', 'centers-BUREAU-PC.json'), '[]');
    fs.writeFileSync(path.join(srv.root, c.id, c.zoe, 'resultats-examen.json'), '{}');   // autre fichier : ignoré
    fs.writeFileSync(path.join(srv.root, c.id, c.zoe, 'student.json.123.tmp'), '{}');   // fichier temporaire : ignoré
    const found = (await srv.api('GET', '/api/conflicts')).data.map(x => x.rel).sort();
    assert.deepEqual(found, ['_ScubaPilot/centers-BUREAU-PC.json', `${c.id}/${c.zoe}/student-BUREAU-PC.json`, `${c.id}/course-PORTABLE.json`].sort());
    const one = (await srv.api('GET', '/api/conflicts')).data.find(x => x.studentFolder);
    assert.equal(one.original, 'student.json'); assert.equal(one.courseId, c.id); assert.equal(one.studentFolder, c.zoe);
  } finally { await srv.stop(); }
});

test('sauvegarde refusée si le répertoire racine est vide', async () => {
  const srv = await startServer({ port: 45413 });
  try {
    fs.rmSync(path.join(srv.root, '_ScubaPilot'), { recursive: true, force: true });
    assert.equal((await srv.api('POST', '/api/backup')).data.error, 'ROOT_EMPTY');
  } finally { await srv.stop(); }
});
