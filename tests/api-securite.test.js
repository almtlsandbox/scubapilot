// Sécurité : rien ne sort du répertoire racine, accès limité à cet ordinateur.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startServer, seedCourse, tmpDir, rmrf } = require('./helpers');

// fetch() normalise les « .. » dans les adresses : on envoie donc la requête brute.
function rawRequest(port, method, urlPath, opts) {
  return new Promise((resolve, reject) => {
    const body = opts && opts.body;
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}), ...((opts && opts.headers) || {}) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, data: j }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('aucune requête ne peut sortir du répertoire racine', async (t) => {
  const world = tmpDir('world');
  const root = path.join(world, 'racine'), precious = path.join(world, 'precieux');
  fs.mkdirSync(root); fs.mkdirSync(precious); fs.writeFileSync(path.join(precious, 'important.txt'), 'à garder');
  fs.mkdirSync(path.join(root, 'Vacances')); fs.writeFileSync(path.join(root, 'Vacances', 'photo.txt'), 'à garder');
  const srv = await startServer({ port: 45412, root });
  t.after(async () => { await srv.stop(); rmrf(world); });
  const c = await seedCourse(srv);
  const intact = () => {
    assert.equal(fs.readFileSync(path.join(precious, 'important.txt'), 'utf8'), 'à garder');
    assert.equal(fs.readFileSync(path.join(root, 'Vacances', 'photo.txt'), 'utf8'), 'à garder');
    assert.deepEqual(fs.readdirSync(world).sort(), ['precieux', 'racine']);
  };

  await t.test('suppression de cours avec un chemin piégé', async () => {
    for (const bad of ['..%2Fprecieux', '..', '%2E%2E', '..%5Cprecieux', '%2E', '..%2F..']) {
      const r = await rawRequest(srv.port, 'DELETE', '/api/courses/' + bad);
      assert.ok(r.status === 400 || r.status === 404, `DELETE ${bad} -> ${r.status}`);
    }
    intact();
  });
  await t.test("un dossier qui n'est pas un cours n'est jamais supprimé", async () => {
    assert.equal((await srv.api('DELETE', '/api/courses/Vacances')).data.error, 'NOT_A_COURSE');
    assert.equal((await srv.api('DELETE', `/api/courses/${c.id}/students/Photo`)).data.error, 'NOT_A_STUDENT');
    assert.ok(fs.existsSync(path.join(root, c.id, 'Photo')));
    for (const reserved of ['_ScubaPilot', '_Corbeille']) assert.equal((await srv.api('DELETE', '/api/courses/' + reserved)).data.error, 'INVALID_PATH');
    assert.ok(fs.existsSync(path.join(root, '_ScubaPilot')));
    intact();
  });
  await t.test('écriture, étudiant, corbeille et Explorateur avec un chemin piégé', async () => {
    assert.equal((await rawRequest(srv.port, 'PUT', '/api/courses/..%2Fprecieux', { body: '{"x":1}' })).status, 400);
    assert.equal((await rawRequest(srv.port, 'DELETE', `/api/courses/${c.id}/students/%2E%2E`)).status, 400);
    assert.equal((await rawRequest(srv.port, 'DELETE', '/api/trash/..%2F..%2Fprecieux')).status, 400);
    assert.equal((await rawRequest(srv.port, 'DELETE', '/api/trash/%2E%2E')).status, 400);
    assert.equal((await srv.api('POST', '/api/open-explorer', { courseId: '..' })).data.error, 'INVALID_PATH');
    assert.equal((await srv.api('POST', '/api/open-explorer', { courseId: c.id, sub: '../../precieux' })).data.error, 'INVALID_PATH');
    assert.ok(!fs.existsSync(path.join(precious, 'course.json')));
    intact();
  });
  await t.test("un fichier déposé avec un nom piégé reste dans le dossier du cours", async () => {
    const r = await srv.raw('POST', `/api/courses/${c.id}/upload?filename=${encodeURIComponent('../../evil.txt')}`, { headers: { 'Content-Type': 'application/octet-stream' }, body: 'x' });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.ok(!/[\\/]/.test(j.filename) && !j.filename.startsWith('.'), 'nom nettoyé : ' + j.filename);
    assert.ok(fs.existsSync(path.join(root, c.id, j.filename)));
    assert.ok(!fs.existsSync(path.join(world, 'evil.txt')) && !fs.existsSync(path.join(root, 'evil.txt')));
    intact();
  });
});

test("accès limité à cet ordinateur", async (t) => {
  const srv = await startServer({ port: 45412 });
  t.after(() => srv.stop());
  await t.test("une requête visant un autre nom d'hôte est refusée", async () => {
    const r = await rawRequest(srv.port, 'GET', '/api/settings', { headers: { Host: 'site-malveillant.example' } });
    assert.equal(r.status, 403); assert.equal(r.data.error, 'FORBIDDEN_HOST');
    assert.equal((await rawRequest(srv.port, 'GET', '/api/settings', { headers: { Host: 'localhost:' + srv.port } })).status, 200);
  });
  await t.test("le serveur n'écoute que sur 127.0.0.1", async () => {
    const os = require('os');
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    for (const ip of ips) {
      const refused = await new Promise(resolve => {
        const req = http.get({ host: ip, port: srv.port, path: '/api/app-info', timeout: 1500 }, () => resolve(false));
        req.on('error', () => resolve(true)); req.on('timeout', () => { req.destroy(); resolve(true); });
      });
      assert.ok(refused, `le port ne doit pas répondre sur ${ip}`);
    }
  });
  await t.test("l'arrêt à distance exige l'en-tête du lanceur", async () => {
    assert.equal((await srv.api('POST', '/api/shutdown')).status, 403);
    assert.equal((await srv.api('GET', '/api/app-info')).status, 200, 'toujours en marche');
  });
});
