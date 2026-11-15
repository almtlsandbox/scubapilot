// Lanceur (launcher.js) : une seule copie, remplacement d'une autre copie, arrêt, journal,
// démarrage automatique. Tout se passe dans des copies temporaires de l'application, sur un port de test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { APP_DIR, tmpDir, rmrf, waitFor } = require('./helpers');

const PORT = 45414;
const URL = `http://127.0.0.1:${PORT}`;
// Les copies temporaires n'ont pas de dossier node_modules : on leur indique où trouver Express.
const NODE_PATH = [path.join(APP_DIR, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);

function copyApp(version) {
  const dir = tmpDir('app');
  for (const f of ['server.js', 'launcher.js', 'zipwriter.js', 'package.json']) fs.copyFileSync(path.join(APP_DIR, f), path.join(dir, f));
  fs.cpSync(path.join(APP_DIR, 'data'), path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'public'));
  fs.copyFileSync(path.join(APP_DIR, 'public', 'index.html'), path.join(dir, 'public', 'index.html'));
  if (version) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); pkg.version = version;
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  }
  return fs.realpathSync(dir);
}
function launch(dir, args, env) {
  return new Promise(resolve => {
    execFile(process.execPath, [path.join(dir, 'launcher.js'), ...(args || [])], { env: { ...process.env, SCUBAPILOT_PORT: String(PORT), NODE_PATH, ...(env || {}) }, timeout: 40000 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code === undefined ? 1 : err.code) : 0, out: String(stdout) + String(stderr) }));
  });
}
const info = async () => { try { return await (await fetch(URL + '/api/app-info')).json(); } catch (e) { return null; } };
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

test('lanceur', async (t) => {
  const local = tmpDir('local'), root = tmpDir('root');
  fs.writeFileSync(path.join(local, 'local.json'), JSON.stringify({ rootDir: root }));
  const env = { SCUBAPILOT_LOCAL_DIR: local };
  const appA = copyApp(), appB = copyApp('9.9.9');
  t.after(async () => { await launch(appA, ['--stop'], env); rmrf(appA); rmrf(appB); rmrf(local); rmrf(root); });

  await t.test('démarre en arrière-plan et tient un journal', async () => {
    const r = await launch(appA, [], env);
    assert.equal(r.code, 0, r.out); assert.match(r.out, /est démarré/);
    const i = await info();
    assert.ok(i && same(i.installDir, appA));
    assert.ok(fs.readFileSync(path.join(appA, 'app.log'), 'utf8').includes('ScubaPilot'), 'le démarrage est noté dans app.log');
  });
  await t.test('relancer la même copie ne fait rien', async () => {
    const before = (await info()).pid;
    const r = await launch(appA, [], env);
    assert.equal(r.code, 0); assert.match(r.out, /déjà en marche/);
    assert.equal((await info()).pid, before, 'même processus');
  });
  await t.test('lancer une autre copie (autre dossier, autre version) remplace la première', async () => {
    const r = await launch(appB, [], env);
    assert.equal(r.code, 0, r.out); assert.match(r.out, /arrêtée et remplacée/);
    const i = await info();
    assert.ok(same(i.installDir, appB)); assert.equal(i.version, '9.9.9');
  });
  await t.test('--stop arrête, et le dit quand il n\'y a rien à arrêter', async () => {
    const r = await launch(appB, ['--stop'], env);
    assert.equal(r.code, 0); assert.match(r.out, /est arrêté/);
    assert.equal(await info(), null);
    assert.match((await launch(appB, ['--stop'], env)).out, /n'était pas en marche/);
  });
  await t.test('une ancienne version (sans arrêt à distance) est arrêtée par son processus', async () => {
    const script = path.join(appA, 'vieux.js');
    fs.writeFileSync(script, `require('http').createServer((q, r) => { if (q.url === '/') { r.setHeader('Content-Type', 'text/html'); r.end('<title>ScubaPilot</title>'); } else { r.statusCode = 404; r.end('Cannot GET'); } }).listen(${PORT}, '127.0.0.1');`);
    const old = spawn(process.execPath, [script], { stdio: 'ignore' });
    let oldExited = false; old.on('exit', () => { oldExited = true; });
    await waitFor(async () => (await fetch(URL + '/')).ok, 5000, 'ancienne version en marche');
    const r = await launch(appA, [], env);
    assert.equal(r.code, 0, r.out); assert.match(r.out, /arrêtée et remplacée/);
    await waitFor(() => oldExited, 5000, "arrêt de l'ancienne version");
    assert.ok(same((await info()).installDir, appA));
    await launch(appA, ['--stop'], env);
  });
  await t.test("port pris par un autre programme : message clair, rien n'est arrêté", async () => {
    const foreign = http.createServer((q, r) => r.end('Je suis un autre programme'));
    await new Promise(res => foreign.listen(PORT, '127.0.0.1', res));
    try {
      const r = await launch(appA, [], env);
      assert.equal(r.code, 1); assert.match(r.out, /utilisé par un autre programme/);
      const stop = await launch(appA, ['--stop'], env);
      assert.equal(stop.code, 1); assert.match(stop.out, /rien n'a été arrêté/);
      assert.equal(await (await fetch(URL + '/')).text(), 'Je suis un autre programme', 'le programme étranger répond toujours');
      assert.match(fs.readFileSync(path.join(appA, 'app.log'), 'utf8'), /Lanceur : Impossible de démarrer/, "l'échec est noté dans le journal");
    } finally { await new Promise(res => foreign.close(res)); }
  });
  await t.test('journal archivé au-delà de 1 Mo', async () => {
    fs.writeFileSync(path.join(appA, 'app.log'), 'x'.repeat(1500000));
    const r = await launch(appA, [], env);
    assert.equal(r.code, 0, r.out);
    assert.equal(fs.statSync(path.join(appA, 'app.log.1')).size, 1500000);
    assert.ok(fs.statSync(path.join(appA, 'app.log')).size < 100000);
    await launch(appA, ['--stop'], env);
  });
  await t.test('composants absents : message clair', async () => {
    const r = await launch(appA, [], { ...env, NODE_PATH: '' });
    if (r.code === 0) { await launch(appA, ['--stop'], env); t.skip('Express est installé globalement sur cette machine'); return; }
    assert.match(r.out, /composants de ScubaPilot ne sont pas installés/);
  });
});

test('démarrage automatique : un fichier .cmd, sans PowerShell', async (t) => {
  const startup = tmpDir('startup'), app = copyApp();
  t.after(() => { rmrf(startup); rmrf(app); });
  const env = { SCUBAPILOT_STARTUP_DIR: startup };
  const lnk = (name, target) => fs.writeFileSync(path.join(startup, name), Buffer.concat([Buffer.from([0x4c, 0, 0, 0]), Buffer.alloc(40, 1), Buffer.from(target, 'utf16le')]));
  lnk('ScubaPilot ancien.lnk', 'C:\\Vieux\\scubapilot-v1.0\\Demarrage-automatique.vbs');
  lnk('Autre appli.lnk', 'C:\\Program Files\\Autre\\autre.exe');
  fs.writeFileSync(path.join(startup, 'notes.txt'), 'rien à voir');

  await t.test('installation : crée le fichier, retire les anciens lancements, laisse le reste', async () => {
    const r = await launch(app, ['--install-startup'], env);
    assert.equal(r.code, 0, r.out); assert.match(r.out, /Ancien lancement retiré : ScubaPilot ancien\.lnk/);
    assert.deepEqual(fs.readdirSync(startup).sort(), ['Autre appli.lnk', 'ScubaPilot.cmd', 'notes.txt']);
    const cmd = fs.readFileSync(path.join(startup, 'ScubaPilot.cmd'), 'utf8');
    assert.ok(cmd.includes(`"${process.execPath}" "${path.join(app, 'launcher.js')}"`), cmd);
    assert.match(cmd, /^@echo off\r\n/); assert.match(cmd, /start "ScubaPilot" \/min /);
    assert.ok(!/powershell|wscript|\.vbs"/i.test(cmd.replace(/^rem .*$/gm, '')), 'ni PowerShell ni VBScript');
  });
  await t.test('le lanceur lui-même n\'appelle jamais PowerShell', () => {
    const src = fs.readFileSync(path.join(APP_DIR, 'launcher.js'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/powershell/i.test(src));
  });
  await t.test('réinstaller ne duplique rien ; retirer enlève le fichier', async () => {
    await launch(app, ['--install-startup'], env);
    assert.equal(fs.readdirSync(startup).filter(n => /scubapilot/i.test(n)).length, 1);
    const r = await launch(app, ['--remove-startup'], env);
    assert.equal(r.code, 0); assert.deepEqual(fs.readdirSync(startup).sort(), ['Autre appli.lnk', 'notes.txt']);
  });
});
