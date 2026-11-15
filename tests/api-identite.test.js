// Identifiant d'étudiant : migration des anciennes fiches, homonymes, renommage, fusion, détachement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, tmpDir, rmrf } = require('./helpers');

const ID = /^etu_[0-9a-f]{12}$/;
const enc = encodeURIComponent;

// Écrit une racine « d'avant la version 1.15 » : des fiches sans identifiant.
function legacyRoot(courses) {
  const root = tmpDir('root');
  for (const [courseId, students] of Object.entries(courses)) {
    fs.mkdirSync(path.join(root, courseId, 'Photo'), { recursive: true });
    const folders = [];
    for (const s of students) {
      const folder = s._folder || `${s.firstName} ${s.lastName.toUpperCase()}`;
      const { _folder, ...data } = s;
      fs.mkdirSync(path.join(root, courseId, folder));
      fs.writeFileSync(path.join(root, courseId, folder, 'student.json'), s._raw !== undefined ? s._raw : JSON.stringify({ ...data, preDocs: {}, postDocs: {} }));
      folders.push(folder);
    }
    fs.writeFileSync(path.join(root, courseId, 'course.json'), JSON.stringify({ typeCode: 'OWD', centerId: 'c1', sessions: [{ date: '2026-01-10' }], students: folders }));
  }
  return root;
}
const read = (root, c, f) => JSON.parse(fs.readFileSync(path.join(root, c, f, 'student.json'), 'utf8'));

test('migration : la règle « même nom + même courriel ou même date de naissance »', async (t) => {
  const root = legacyRoot({
    OWD_10JAN2026: [
      { firstName: 'Léa', lastName: 'Tremblay', email: 'lea@exemple.ca', note: 'à conserver' },
      { firstName: 'Marc', lastName: 'Roy', birthDate: '1988-01-22' },
      { firstName: 'Jean', lastName: 'Côté' },
      { firstName: 'Abîmée', lastName: 'Fiche', _raw: '{"firstName":"Ab' }],
    AOWD_05MAR2026: [
      { firstName: 'Lea', lastName: 'TREMBLAY', email: 'LEA@exemple.ca ', birthDate: '1996-09-03' },   // même courriel, casse et accent différents
      { firstName: 'Marc', lastName: 'Roy', birthDate: '1988-01-22', email: 'marc@exemple.ca' },        // même date de naissance
      { firstName: 'Jean', lastName: 'Côté' }],                                                           // même nom, rien pour le confirmer
    RESCUE_20JUN2026: [
      { firstName: 'Léa', lastName: 'Tremblay', birthDate: '1996-09-03' },                               // rejoint Léa par la date (transitivité)
      { firstName: 'Marc', lastName: 'Roy', email: 'autre.marc@exemple.ca', birthDate: '1975-05-05' },  // homonyme : autre courriel, autre date
      { firstName: 'Marc', lastName: 'Royer', birthDate: '1988-01-22' }]                                 // même date mais autre nom
  });
  const srv = await startServer({ port: 45415, root });
  t.after(async () => { await srv.stop(); rmrf(root); });
  const id = (c, f) => read(root, c, f).studentId;

  await t.test('toutes les fiches lisibles reçoivent un identifiant, sans rien perdre', () => {
    for (const [c, f] of [['OWD_10JAN2026', 'Léa TREMBLAY'], ['AOWD_05MAR2026', 'Lea TREMBLAY'], ['RESCUE_20JUN2026', 'Marc ROYER'], ['OWD_10JAN2026', 'Jean CÔTÉ']]) assert.match(id(c, f), ID);
    const lea = read(root, 'OWD_10JAN2026', 'Léa TREMBLAY');
    assert.equal(lea.note, 'à conserver'); assert.equal(lea.email, 'lea@exemple.ca'); assert.deepEqual(lea.preDocs, {});
  });
  await t.test('même courriel (casse, accents et espaces ignorés) : même personne ; transitivité par la date de naissance', () => {
    assert.equal(id('OWD_10JAN2026', 'Léa TREMBLAY'), id('AOWD_05MAR2026', 'Lea TREMBLAY'));
    assert.equal(id('AOWD_05MAR2026', 'Lea TREMBLAY'), id('RESCUE_20JUN2026', 'Léa TREMBLAY'));
  });
  await t.test('même date de naissance : même personne', () => assert.equal(id('OWD_10JAN2026', 'Marc ROY'), id('AOWD_05MAR2026', 'Marc ROY')));
  await t.test('homonyme sans courriel ni date en commun : deux personnes', () => {
    assert.notEqual(id('RESCUE_20JUN2026', 'Marc ROY'), id('OWD_10JAN2026', 'Marc ROY'));
    assert.notEqual(id('OWD_10JAN2026', 'Jean CÔTÉ'), id('AOWD_05MAR2026', 'Jean CÔTÉ'), 'rien ne confirme : on ne fusionne pas');
  });
  await t.test('même date mais autre nom : deux personnes', () => assert.notEqual(id('RESCUE_20JUN2026', 'Marc ROYER'), id('OWD_10JAN2026', 'Marc ROY')));
  await t.test("une fiche illisible n'est pas touchée", () => assert.equal(fs.readFileSync(path.join(root, 'OWD_10JAN2026', 'Abîmée FICHE', 'student.json'), 'utf8'), '{"firstName":"Ab'));
  await t.test("une copie des fiches d'origine est conservée", () => {
    const keep = fs.readdirSync(path.join(root, '_ScubaPilot')).filter(n => n.startsWith('_avant-identifiants-'));
    assert.equal(keep.length, 1);
    const orig = JSON.parse(fs.readFileSync(path.join(root, '_ScubaPilot', keep[0], 'OWD_10JAN2026', 'Léa TREMBLAY', 'student.json'), 'utf8'));
    assert.equal(orig.studentId, undefined); assert.equal(orig.note, 'à conserver');
  });
  await t.test('la migration ne se refait pas : identifiants stables, pas de seconde copie', async () => {
    const before = id('OWD_10JAN2026', 'Léa TREMBLAY');
    await srv.api('GET', '/api/courses'); await srv.api('GET', '/api/global-students');
    assert.equal(id('OWD_10JAN2026', 'Léa TREMBLAY'), before);
    assert.equal(fs.readdirSync(path.join(root, '_ScubaPilot')).filter(n => n.startsWith('_avant-identifiants-')).length, 1);
  });
  await t.test("une fiche sans identifiant apparue plus tard (autre ordinateur, ancienne version) est rattachée", async () => {
    fs.mkdirSync(path.join(root, 'OWD_10JAN2026', 'Léa TREMBLAY (bis)'));
    fs.writeFileSync(path.join(root, 'OWD_10JAN2026', 'Léa TREMBLAY (bis)', 'student.json'), JSON.stringify({ firstName: 'Léa', lastName: 'Tremblay', email: 'lea@exemple.ca' }));
    const c = JSON.parse(fs.readFileSync(path.join(root, 'OWD_10JAN2026', 'course.json'), 'utf8')); c.students.push('Léa TREMBLAY (bis)');
    fs.writeFileSync(path.join(root, 'OWD_10JAN2026', 'course.json'), JSON.stringify(c));
    await srv.api('GET', '/api/courses');   // repère la fiche sans identifiant
    await srv.api('GET', '/api/courses');   // la complète
    assert.equal(id('OWD_10JAN2026', 'Léa TREMBLAY (bis)'), id('OWD_10JAN2026', 'Léa TREMBLAY'));
  });
  await t.test('fiche globale : toutes les fiches d\'une personne, et elles seules', async () => {
    const recs = (await srv.api('GET', '/api/global-students?sid=' + id('OWD_10JAN2026', 'Marc ROY'))).data;
    assert.deepEqual(recs.map(r => r.courseId).sort(), ['AOWD_05MAR2026', 'OWD_10JAN2026']);
  });
});

test('inscription : reconnaissance, homonymes dans un même cours', async (t) => {
  const srv = await startServer({ port: 45415 });
  t.after(() => srv.stop());
  await srv.api('PUT', '/api/centers', [{ id: 'c1', name: 'Centre' }]);
  const c1 = (await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: '2030-01-10' } })).data.id;
  const c2 = (await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: '2030-02-10' } })).data.id;
  const add = (c, body) => srv.api('POST', `/api/courses/${c}/students`, body);

  const lea = (await add(c1, { firstName: 'Léa', lastName: 'Tremblay', email: 'lea@exemple.ca' })).data;
  await t.test('un nouvel étudiant reçoit un identifiant', () => assert.match(lea.studentId, ID));
  await t.test('réinscrit ailleurs avec le même courriel : reconnu', async () => {
    assert.equal((await add(c2, { firstName: 'Léa', lastName: 'Tremblay', email: 'Lea@Exemple.ca' })).data.studentId, lea.studentId);
  });
  await t.test('homonyme dans le même cours : refusé, puis accepté sur confirmation', async () => {
    const refused = await add(c1, { firstName: 'Léa', lastName: 'Tremblay', email: 'autre.lea@exemple.ca' });
    assert.equal(refused.data.error, 'STUDENT_EXISTS'); assert.equal(refused.data.homonym, true);
    const ok = await add(c1, { firstName: 'Léa', lastName: 'Tremblay', email: 'autre.lea@exemple.ca', homonym: true });
    assert.equal(ok.status, 200); assert.equal(ok.data.folder, 'Léa TREMBLAY (2)'); assert.notEqual(ok.data.studentId, lea.studentId);
    assert.equal(read(srv.root, c1, 'Léa TREMBLAY (2)').homonym, undefined, 'le drapeau n\'est pas enregistré');
    assert.deepEqual((await srv.api('GET', `/api/courses/${c1}`)).data.students.map(s => s.folder).sort(), ['Léa TREMBLAY', 'Léa TREMBLAY (2)']);
  });
  await t.test('la même personne deux fois dans un cours : toujours refusé', async () => {
    const r = await add(c1, { firstName: 'Léa', lastName: 'Tremblay', email: 'lea@exemple.ca', homonym: true });
    assert.equal(r.data.error, 'STUDENT_EXISTS'); assert.equal(r.data.samePerson, true);
  });
  await t.test("l'identifiant ne change pas par une simple modification de la fiche", async () => {
    const r = await srv.api('PUT', `/api/courses/${c1}/students/${enc('Léa TREMBLAY')}`, { studentId: 'etu_000000000000', note: 'x' });
    assert.equal(r.data.studentId, lea.studentId); assert.equal(r.data.note, 'x');
  });
  await t.test('import en lot : identifiants attribués, personnes connues reconnues', async () => {
    const r = await srv.api('POST', `/api/courses/${c2}/students/bulk`, { students: [{ firstName: 'Omar', lastName: 'Haddad', birthDate: '1990-01-01' }, { firstName: 'Omar', lastName: 'Haddad', birthDate: '1990-01-01' }] });
    assert.deepEqual(r.data.created, ['Omar HADDAD']);
    assert.match(read(srv.root, c2, 'Omar HADDAD').studentId, ID);
    const again = (await add(c1, { firstName: 'Omar', lastName: 'Haddad', birthDate: '1990-01-01' })).data;
    assert.equal(again.studentId, read(srv.root, c2, 'Omar HADDAD').studentId);
  });
});

test('renommer, fusionner, détacher', async (t) => {
  const srv = await startServer({ port: 45415 });
  t.after(() => srv.stop());
  await srv.api('PUT', '/api/centers', [{ id: 'c1', name: 'Centre' }]);
  const c1 = (await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: '2030-01-10' } })).data.id;
  const c2 = (await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: '2030-02-10' } })).data.id;
  const a = (await srv.api('POST', `/api/courses/${c1}/students`, { firstName: 'marc', lastName: 'Roi', email: 'marc@exemple.ca' })).data;
  await srv.api('POST', `/api/courses/${c2}/students`, { firstName: 'marc', lastName: 'Roi', email: 'marc@exemple.ca' });
  const other = (await srv.api('POST', `/api/courses/${c1}/students`, { firstName: 'Zoé', lastName: 'Lévesque' })).data;
  fs.writeFileSync(path.join(srv.root, c1, 'marc ROI', 'médical.pdf'), 'document');
  await srv.api('PUT', `/api/courses/${c1}`, { invoice: { groups: [{ id: 'g1', price: 100, share: 1 }], assign: { 'marc ROI': 'g1', 'Zoé LÉVESQUE': 'g1' } } });

  await t.test('renommer une personne : dossiers, fiches, liste du cours et facture suivent, dans tous ses cours', async () => {
    const r = await srv.api('POST', `/api/students/${a.studentId}/rename`, { firstName: 'Marc', lastName: 'Roy' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.renamed.length, 2); assert.deepEqual(r.data.failed, []);
    for (const c of [c1, c2]) {
      assert.ok(fs.existsSync(path.join(srv.root, c, 'Marc ROY')) && !fs.readdirSync(path.join(srv.root, c)).includes('marc ROI'));
      const s = read(srv.root, c, 'Marc ROY');
      assert.equal(s.firstName, 'Marc'); assert.equal(s.lastName, 'Roy'); assert.equal(s.studentId, a.studentId); assert.equal(s.email, 'marc@exemple.ca');
    }
    assert.equal(fs.readFileSync(path.join(srv.root, c1, 'Marc ROY', 'médical.pdf'), 'utf8'), 'document', 'les documents suivent');
    const course = (await srv.api('GET', `/api/courses/${c1}`)).data;
    assert.deepEqual(course.students.map(s => s.folder).sort(), ['Marc ROY', 'Zoé LÉVESQUE']);
    assert.deepEqual(course.invoice.assign, { 'Zoé LÉVESQUE': 'g1', 'Marc ROY': 'g1' });
  });
  await t.test('changer seulement la casse fonctionne aussi', async () => {
    const r = await srv.api('POST', `/api/students/${a.studentId}/rename`, { firstName: 'MARC', lastName: 'Roy' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(fs.readdirSync(path.join(srv.root, c1)).includes('MARC ROY'));
    await srv.api('POST', `/api/students/${a.studentId}/rename`, { firstName: 'Marc', lastName: 'Roy' });
    assert.ok(fs.readdirSync(path.join(srv.root, c1)).includes('Marc ROY'));
  });
  await t.test("renommer vers un nom déjà pris dans le cours : un dossier distinct, personne n'est écrasé", async () => {
    const r = await srv.api('POST', `/api/students/${other.studentId}/rename`, { firstName: 'Marc', lastName: 'Roy' });
    assert.equal(r.status, 200);
    assert.deepEqual(fs.readdirSync(path.join(srv.root, c1)).filter(n => n.startsWith('Marc')).sort(), ['Marc ROY', 'Marc ROY (2)']);
    assert.equal(read(srv.root, c1, 'Marc ROY').studentId, a.studentId);
    assert.equal(read(srv.root, c1, 'Marc ROY (2)').studentId, other.studentId);
    assert.equal(fs.readFileSync(path.join(srv.root, c1, 'Marc ROY', 'médical.pdf'), 'utf8'), 'document');
  });
  await t.test('refus : nom vide, identifiant inconnu ou mal formé', async () => {
    assert.equal((await srv.api('POST', `/api/students/${a.studentId}/rename`, { firstName: ' ', lastName: 'Roy' })).data.error, 'MISSING_FIELDS');
    assert.equal((await srv.api('POST', '/api/students/etu_ffffffffffff/rename', { firstName: 'A', lastName: 'B' })).status, 404);
    assert.equal((await srv.api('POST', '/api/students/..%2F..%2Fx/rename', { firstName: 'A', lastName: 'B' })).data.error, 'INVALID_STUDENT_ID');
  });
  await t.test('fusionner deux fiches, puis en détacher une', async () => {
    const m = await srv.api('POST', '/api/students/merge', { from: other.studentId, into: a.studentId });
    assert.equal(m.data.moved, 1);
    assert.equal(read(srv.root, c1, 'Marc ROY (2)').studentId, a.studentId);
    assert.equal((await srv.api('GET', '/api/global-students?sid=' + a.studentId)).data.length, 3);
    assert.equal((await srv.api('POST', '/api/students/merge', { from: other.studentId, into: a.studentId })).status, 404, "l'ancienne personne n'existe plus");
    const d = await srv.api('POST', `/api/courses/${c1}/students/${enc('Marc ROY (2)')}/detach`);
    assert.match(d.data.studentId, ID); assert.notEqual(d.data.studentId, a.studentId);
    assert.equal((await srv.api('GET', '/api/global-students?sid=' + a.studentId)).data.length, 2);
  });
});
