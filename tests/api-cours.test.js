// Réglages, cours, étudiants, statistiques, fichiers illisibles, import de réglages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, seedCourse, tmpDir, rmrf } = require('./helpers');

test('premier démarrage : aucune racine, puis choix de la racine', async () => {
  const srv = await startServer({ port: 45411, root: null });
  const root = tmpDir('root');
  try {
    assert.equal((await srv.api('GET', '/api/courses')).data.error, 'ROOT_NOT_SET');
    assert.equal((await srv.api('GET', '/api/settings')).data.rootDir, '');
    assert.equal((await srv.api('PUT', '/api/settings', { rootDir: path.join(root, 'nexiste-pas') })).data.error, 'ROOT_NOT_FOUND');
    const r = await srv.api('PUT', '/api/settings', { rootDir: root, instructorName: 'Test Instructeur' });
    assert.equal(r.status, 200);
    // Les réglages vivent dans <racine>/_ScubaPilot, le chemin de la racine dans le profil local.
    assert.ok(fs.existsSync(path.join(root, '_ScubaPilot', 'course_types.json')), 'réglages par défaut recopiés');
    const saved = JSON.parse(fs.readFileSync(path.join(root, '_ScubaPilot', 'settings.json'), 'utf8'));
    assert.equal(saved.instructorName, 'Test Instructeur');
    assert.equal(saved.rootDir, undefined, 'le chemin de la racine ne va pas dans les réglages partagés');
    assert.equal(JSON.parse(fs.readFileSync(path.join(srv.localDir, 'local.json'), 'utf8')).rootDir, root);
    const s = (await srv.api('GET', '/api/settings')).data;
    assert.equal(s.rootDir, root); assert.equal(s.instructorName, 'Test Instructeur');
    assert.deepEqual((await srv.api('GET', '/api/courses')).data, []);
  } finally { await srv.stop(); rmrf(root); }
});

test('une racine qui a déjà ses réglages est adoptée telle quelle', async () => {
  const root = tmpDir('root');
  fs.mkdirSync(path.join(root, '_ScubaPilot'));
  fs.writeFileSync(path.join(root, '_ScubaPilot', 'settings.json'), JSON.stringify({ instructorName: 'Déjà Là' }));
  fs.writeFileSync(path.join(root, '_ScubaPilot', 'centers.json'), JSON.stringify([{ id: 'x', name: 'Centre existant' }]));
  const srv = await startServer({ port: 45411, root: null });
  try {
    const r = await srv.api('PUT', '/api/settings', { rootDir: root, instructorName: '' });
    assert.equal(r.data.adopted, true);
    assert.equal((await srv.api('GET', '/api/settings')).data.instructorName, 'Déjà Là');
    assert.equal((await srv.api('GET', '/api/centers')).data[0].name, 'Centre existant');
  } finally { await srv.stop(); rmrf(root); }
});

test('racine introuvable : signalée clairement', async () => {
  const root = tmpDir('root');
  const srv = await startServer({ port: 45411, root });
  try {
    fs.renameSync(root, root + '-deplace');
    const r = await srv.api('GET', '/api/courses');
    assert.equal(r.data.error, 'ROOT_NOT_FOUND'); assert.equal(r.data.rootDir, root);
    assert.equal((await srv.api('GET', '/api/settings')).data.rootMissing, true);
    fs.renameSync(root + '-deplace', root);
    assert.equal((await srv.api('GET', '/api/courses')).status, 200);
  } finally { await srv.stop(); rmrf(root); rmrf(root + '-deplace'); }
});

test('cours, étudiants et statistiques', async (t) => {
  const srv = await startServer({ port: 45411 });
  t.after(() => srv.stop());
  await srv.api('PUT', '/api/centers', [{ id: 'c1', name: 'Centre Test' }]);

  await t.test('validation à la création', async () => {
    assert.equal((await srv.api('POST', '/api/courses', { typeCode: 'OWD', session: { date: '2030-06-15' } })).data.error, 'CENTER_REQUIRED');
    assert.equal((await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: '15/06/2030' } })).data.error, 'INVALID_DATE');
    const ok = await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: '2030-06-15' } });
    assert.equal(ok.status, 200); assert.equal(ok.data.id, 'OWD_15JUN2030');
    assert.equal(ok.data.billable, true, 'facturé par défaut');
    assert.equal((await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: '2030-06-15' } })).data.error, 'COURSE_EXISTS');
    const nb = await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', billable: false, session: { date: '2030-07-01' } });
    assert.equal(nb.data.billable, false);
    assert.ok(fs.existsSync(path.join(srv.root, 'OWD_15JUN2030', 'Photo')), 'sous-dossier Photo créé');
  });

  await t.test('étudiants : ajout, doublon, import en lot, modification', async () => {
    const a = await srv.api('POST', '/api/courses/OWD_15JUN2030/students', { firstName: 'Zoé', lastName: 'Lévesque', email: 'zoe@exemple.ca', status: 'both' });
    assert.equal(a.data.folder, 'Zoé LÉVESQUE');
    const dup = await srv.api('POST', '/api/courses/OWD_15JUN2030/students', { firstName: 'Zoé', lastName: 'Lévesque' });
    assert.ok(dup.status >= 400, 'un doublon est refusé');
    const bulk = await srv.api('POST', '/api/courses/OWD_15JUN2030/students/bulk', { students: [
      { firstName: 'Marc', lastName: 'Roy', status: 'cours' }, { firstName: 'Zoé', lastName: 'Lévesque' }, { firstName: 'SansNom' }] });
    assert.deepEqual(bulk.data.created, ['Marc ROY']); assert.equal(bulk.data.skipped.length, 2);
    const put = await srv.api('PUT', `/api/courses/OWD_15JUN2030/students/${encodeURIComponent('Zoé LÉVESQUE')}`, { note: 'allergie aux noix', certificationConfirmed: true });
    assert.equal(put.data.note, 'allergie aux noix');
    const onDisk = JSON.parse(fs.readFileSync(path.join(srv.root, 'OWD_15JUN2030', 'Zoé LÉVESQUE', 'student.json'), 'utf8'));
    assert.equal(onDisk.email, 'zoe@exemple.ca', 'la modification fusionne, elle ne remplace pas');
    assert.equal(onDisk.note, 'allergie aux noix');
  });

  await t.test('statistiques de la liste des cours', async () => {
    const list = (await srv.api('GET', '/api/courses')).data;
    const c = list.find(x => x.id === 'OWD_15JUN2030');
    assert.equal(c.stats.studentCount, 2);
    const zoe = c.stats.students.find(s => s.folder === 'Zoé LÉVESQUE'), marc = c.stats.students.find(s => s.folder === 'Marc ROY');
    assert.equal(zoe.certificationConfirmed, true); assert.equal(zoe.courseOnly, false); assert.equal(zoe.hasEmail, true);
    assert.equal(marc.courseOnly, true); assert.equal(marc.hasEmail, false); assert.equal(marc.lastMail, null);
    assert.ok(zoe.preMissing > 0, 'documents pré-cours manquants comptés');
    assert.equal(c.stats.prePercent, 0);
    // Cocher tous les documents pré-cours de Zoé fait monter le pourcentage.
    const detail = (await srv.api('GET', '/api/courses/OWD_15JUN2030')).data;
    const z = detail.students.find(s => s.folder === 'Zoé LÉVESQUE');
    const preDocs = Object.fromEntries(Object.keys(z.preDocs).map(k => [k, { ...z.preDocs[k], collected: true, date: '2030-06-01' }]));
    await srv.api('PUT', `/api/courses/OWD_15JUN2030/students/${encodeURIComponent('Zoé LÉVESQUE')}`, { preDocs, mailLog: [{ date: '2030-06-02', kind: 'groupe', template: 'Convocation' }] });
    const after = (await srv.api('GET', '/api/courses')).data.find(x => x.id === 'OWD_15JUN2030');
    const z2 = after.stats.students.find(s => s.folder === 'Zoé LÉVESQUE');
    assert.equal(z2.preMissing, 0); assert.equal(z2.prePercent, 100); assert.equal(z2.lastMail.date, '2030-06-02');
    assert.ok(after.stats.prePercent > 0 && after.stats.prePercent < 100);
  });

  await t.test('les dossiers réservés ne sont jamais des cours', async () => {
    const ids = (await srv.api('GET', '/api/courses')).data.map(c => c.id);
    assert.ok(!ids.includes('_ScubaPilot') && !ids.includes('_Corbeille'));
    assert.equal((await srv.api('GET', '/api/courses/_ScubaPilot')).data.error, 'INVALID_PATH');
  });
});

test('fichiers illisibles : signalés, jamais écrasés', async (t) => {
  const srv = await startServer({ port: 45411 });
  t.after(() => srv.stop());
  const c = await seedCourse(srv);
  const sFile = path.join(srv.root, c.id, c.marc, 'student.json'), cFile = path.join(srv.root, c.id, 'course.json');

  await t.test('fiche étudiant tronquée', async () => {
    const broken = fs.readFileSync(sFile, 'utf8').slice(0, 30);
    fs.writeFileSync(sFile, broken);
    const put = await srv.api('PUT', `/api/courses/${c.id}/students/${encodeURIComponent(c.marc)}`, { note: 'x' });
    assert.equal(put.data.error, 'CORRUPT_FILE');
    assert.equal(fs.readFileSync(sFile, 'utf8'), broken, 'le fichier abîmé est laissé intact');
    const detail = (await srv.api('GET', `/api/courses/${c.id}`)).data;
    assert.equal(detail.students.find(s => s.folder === c.marc).corrupted, true);
    assert.equal((await srv.api('GET', '/api/courses')).data[0].stats.corruptedStudents, 1);
  });

  await t.test('fichier avec BOM (retouché au Bloc-notes) : lu normalement', async () => {
    fs.writeFileSync(sFile, '\uFEFF' + JSON.stringify({ firstName: 'Marc', lastName: 'Roy', preDocs: {}, postDocs: {} }));
    const put = await srv.api('PUT', `/api/courses/${c.id}/students/${encodeURIComponent(c.marc)}`, { note: 'ok' });
    assert.equal(put.status, 200); assert.equal(put.data.note, 'ok');
  });

  await t.test('course.json vide : le cours reste visible, toute écriture est refusée', async () => {
    const good = fs.readFileSync(cFile);
    fs.writeFileSync(cFile, '');
    assert.equal((await srv.api('POST', `/api/courses/${c.id}/students`, { firstName: 'A', lastName: 'B' })).data.error, 'CORRUPT_FILE');
    assert.equal((await srv.api('DELETE', `/api/courses/${c.id}/students/${encodeURIComponent(c.marc)}`)).data.error, 'CORRUPT_FILE');
    assert.equal((await srv.api('PUT', `/api/courses/${c.id}`, { completed: true })).data.error, 'CORRUPT_FILE');
    assert.equal(fs.statSync(cFile).size, 0);
    assert.ok(fs.existsSync(path.join(srv.root, c.id, c.marc)), "aucun dossier d'étudiant supprimé");
    const list = (await srv.api('GET', '/api/courses')).data;
    assert.equal(list.find(x => x.id === c.id).corrupted, true);
    fs.writeFileSync(cFile, good);
    assert.equal((await srv.api('GET', `/api/courses/${c.id}`)).status, 200);
  });

  await t.test("aucun fichier temporaire n'est laissé derrière", () => {
    const stack = [srv.root]; const tmps = [];
    while (stack.length) { const d = stack.pop(); for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) stack.push(p); else if (e.name.endsWith('.tmp')) tmps.push(p); } }
    assert.deepEqual(tmps, []);
  });
});

test("import des réglages d'une ancienne installation", async () => {
  const srv = await startServer({ port: 45411 });
  const old = tmpDir('old');
  try {
    await srv.api('PUT', '/api/centers', [{ id: 'c1', name: 'Actuel' }]);
    fs.mkdirSync(path.join(old, 'data'));
    fs.writeFileSync(path.join(old, 'data', 'centers.json'), JSON.stringify([{ id: 'z', name: 'Ancien centre' }]));
    fs.writeFileSync(path.join(old, 'data', 'settings.json'), JSON.stringify({ rootDir: 'C:/ailleurs', instructorName: 'Ancien' }));
    const r = await srv.api('POST', '/api/config/import', { dir: old });
    assert.equal(r.status, 200); assert.ok(r.data.imported.includes('centers.json'));
    assert.equal((await srv.api('GET', '/api/centers')).data[0].name, 'Ancien centre');
    const s = (await srv.api('GET', '/api/settings')).data;
    assert.equal(s.instructorName, 'Ancien'); assert.equal(s.rootDir, srv.root, "la racine n'est pas changée par l'import");
    assert.ok(fs.readdirSync(path.join(srv.root, '_ScubaPilot')).some(n => n.startsWith('_avant-import-')), 'les réglages précédents sont mis de côté');
    // Un fichier abîmé dans la source : rien n'est importé.
    fs.writeFileSync(path.join(old, 'data', 'centers.json'), '[{"id":');
    assert.equal((await srv.api('POST', '/api/config/import', { dir: old })).data.error, 'CORRUPT_FILE');
    assert.equal((await srv.api('GET', '/api/centers')).data[0].name, 'Ancien centre');
    assert.equal((await srv.api('POST', '/api/config/import', { dir: path.join(old, 'vide') })).data.error, 'IMPORT_DIR_NOT_FOUND');
  } finally { await srv.stop(); rmrf(old); }
});
