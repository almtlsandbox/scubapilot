// Archivage d'un ancien cours : zip complet et vérifié, dossier d'origine à la corbeille.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startServer, readZip } = require('./helpers');

test('archivage', async (t) => {
  const srv = await startServer({ port: 45416 });
  t.after(() => srv.stop());
  await srv.api('PUT', '/api/centers', [{ id: 'c1', name: 'Centre' }]);
  const id = (await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: '2019-08-15' } })).data.id;
  await srv.api('POST', `/api/courses/${id}/students`, { firstName: 'Zoé', lastName: 'Lévesque', email: 'zoe@exemple.ca' });
  const photo = crypto.randomBytes(200000);
  fs.writeFileSync(path.join(srv.root, id, 'Photo', 'groupe été.jpg'), photo);
  fs.writeFileSync(path.join(srv.root, id, 'Zoé LÉVESQUE', 'médical.pdf'), 'document médical');
  const before = fs.readFileSync(path.join(srv.root, id, 'course.json'), 'utf8');

  await t.test('rien à archiver au départ', async () => {
    const a = (await srv.api('GET', '/api/archives')).data;
    assert.deepEqual(a.archives, []); assert.equal(a.dir, path.join(srv.root, '_Archives'));
  });
  await t.test("archiver : un zip complet, rangé dans un dossier au nom du cours", async () => {
    const r = await srv.api('POST', `/api/courses/${id}/archive`);
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.zip, `${id}.zip`);
    const zip = readZip(path.join(srv.root, '_Archives', `${id}.zip`)); // vérifie tailles et CRC
    assert.ok(zip.names.every(n => n.startsWith(id + '/')), "tout est sous le dossier du cours");
    assert.equal(zip.get(`${id}/course.json`).toString('utf8'), before);
    assert.ok(zip.get(`${id}/Photo/groupe été.jpg`).equals(photo));
    assert.equal(zip.get(`${id}/Zoé LÉVESQUE/médical.pdf`).toString('utf8'), 'document médical');
    assert.ok(zip.names.includes(`${id}/Zoé LÉVESQUE/student.json`));
  });
  await t.test('le cours quitte les listes ; son dossier attend dans la corbeille', async () => {
    assert.deepEqual((await srv.api('GET', '/api/courses')).data, []);
    assert.ok(!fs.existsSync(path.join(srv.root, id)));
    const trash = (await srv.api('GET', '/api/trash')).data;
    assert.equal(trash.length, 1); assert.equal(trash[0].name, id); assert.equal(trash[0].archivedAs, `${id}.zip`); assert.equal(trash[0].restorable, true);
    assert.equal((await srv.api('GET', '/api/archives')).data.archives[0].name, `${id}.zip`);
  });
  await t.test("le dossier _Archives n'est jamais pris pour un cours", async () => {
    assert.equal((await srv.api('DELETE', '/api/courses/_Archives')).data.error, 'INVALID_PATH');
    assert.equal((await srv.api('POST', '/api/courses/_Archives/archive')).data.error, 'INVALID_PATH');
    assert.ok(fs.existsSync(path.join(srv.root, '_Archives', `${id}.zip`)));
  });
  await t.test('restaurer depuis la corbeille, puis archiver de nouveau : un second zip, le premier est conservé', async () => {
    const [it] = (await srv.api('GET', '/api/trash')).data;
    assert.equal((await srv.api('POST', `/api/trash/${it.tid}/restore`)).status, 200);
    assert.equal((await srv.api('GET', '/api/courses')).data.length, 1);
    const r = await srv.api('POST', `/api/courses/${id}/archive`);
    assert.equal(r.data.zip, `${id} (2).zip`);
    assert.deepEqual(fs.readdirSync(path.join(srv.root, '_Archives')).sort(), [`${id} (2).zip`, `${id}.zip`]);
  });
  await t.test('refus : cours inconnu, cours illisible (rien n\'est créé ni déplacé)', async () => {
    assert.equal((await srv.api('POST', '/api/courses/INCONNU_01JAN2019/archive')).status, 404);
    const c2 = (await srv.api('POST', '/api/courses', { typeCode: 'OWD', centerId: 'c1', session: { date: '2018-05-01' } })).data.id;
    fs.writeFileSync(path.join(srv.root, c2, 'course.json'), '{"typeCode":');
    assert.equal((await srv.api('POST', `/api/courses/${c2}/archive`)).data.error, 'CORRUPT_FILE');
    assert.ok(fs.existsSync(path.join(srv.root, c2)));
    assert.ok(!fs.readdirSync(path.join(srv.root, '_Archives')).some(n => n.startsWith(c2)));
  });
  await t.test('la sauvegarde complète contient aussi les archives', async () => {
    await srv.api('POST', '/api/backup');
    const { waitFor } = require('./helpers');
    const job = await waitFor(async () => { const s = (await srv.api('GET', '/api/backup/status')).data; return s.state === 'done' ? s : null; }, 20000, 'sauvegarde');
    const res = await srv.raw('GET', '/api/backup/download/' + job.id);
    const f = path.join(srv.localDir, 'b.zip'); fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    assert.ok(readZip(f).names.includes(`_Archives/${id}.zip`));
  });
});
