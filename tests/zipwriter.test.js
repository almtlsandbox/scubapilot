// Écriture des archives .zip (sauvegarde) : contenu exact, accents, ZIP64, fichiers illisibles.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createZip, crc32 } = require('../zipwriter');
const { tmpDir, rmrf, readZip } = require('./helpers');

function makeTree() {
  const dir = tmpDir('zip');
  const src = path.join(dir, 'src');
  fs.mkdirSync(path.join(src, 'OWD_20NOV2026', 'Zoé LÉVESQUE'), { recursive: true });
  fs.mkdirSync(path.join(src, 'OWD_20NOV2026', 'Photo'));
  fs.mkdirSync(path.join(src, 'dossier vide'));
  const files = {
    'OWD_20NOV2026/Zoé LÉVESQUE/student.json': Buffer.from('{"prénom":"Zoé"}'),
    'OWD_20NOV2026/Zoé LÉVESQUE/Décharge médicale.txt': Buffer.from('texte répétitif '.repeat(20000)),
    'OWD_20NOV2026/Photo/plongée 1.jpg': crypto.randomBytes(300000),
    'OWD_20NOV2026/vide.txt': Buffer.alloc(0)
  };
  for (const [rel, data] of Object.entries(files)) fs.writeFileSync(path.join(src, rel), data);
  fs.writeFileSync(path.join(src, 'OWD_20NOV2026', 'course.json.99.tmp'), 'temporaire');
  return { dir, src, files };
}
const skipTmp = (abs, d) => d.isFile() && d.name.endsWith('.tmp');

test('CRC-32 conforme', () => {
  assert.equal(crc32(Buffer.from('123456789'), 0), 0xcbf43926);
  assert.equal(crc32(Buffer.from('6789'), crc32(Buffer.from('12345'), 0)), 0xcbf43926, 'calcul par morceaux');
});

test('archive standard : contenu identique, noms accentués, dossiers vides', async () => {
  const { dir, src, files } = makeTree();
  try {
    const out = path.join(dir, 'a.zip');
    const progress = [];
    const r = await createZip(out, src, { skip: skipTmp, onProgress: p => progress.push({ ...p }) });
    const zip = readZip(out);
    for (const [rel, data] of Object.entries(files)) assert.ok(zip.get(rel).equals(data), rel);
    assert.ok(zip.names.includes('dossier vide/'), 'les dossiers vides sont conservés');
    assert.ok(!zip.names.some(n => n.endsWith('.tmp')));
    assert.ok(zip.entries.every(e => e.utf8) && !zip.zip64);
    assert.equal(zip.entries.find(e => e.name.endsWith('.jpg')).method, 0, 'les images ne sont pas recompressées');
    assert.equal(zip.entries.find(e => e.name.endsWith('.txt') && e.content.length > 0).method, 8);
    assert.equal(r.files, 4); assert.deepEqual(r.skipped, []);
    assert.equal(r.zipBytes, fs.statSync(out).size);
    const last = progress[progress.length - 1];
    assert.equal(last.filesDone, 4); assert.equal(last.filesTotal, 4); assert.equal(last.bytesDone, last.bytesTotal);
  } finally { rmrf(dir); }
});

for (const limit of [200000, 1000]) {
  test(`ZIP64 (seuil abaissé à ${limit} octets pour le test) : toujours lisible et identique`, async () => {
    const { dir, src, files } = makeTree();
    try {
      const out = path.join(dir, 'b.zip');
      await createZip(out, src, { skip: skipTmp, zip64Limit: limit });
      const zip = readZip(out);
      assert.ok(zip.zip64, 'la fin de fichier ZIP64 est présente');
      assert.ok(zip.entries.some(e => e.zip64));
      for (const [rel, data] of Object.entries(files)) assert.ok(zip.get(rel).equals(data), rel);
    } finally { rmrf(dir); }
  });
}

// Test long (écrit 66 000 fichiers) : lancé seulement avec SCUBAPILOT_TESTS_LONGS=1.
test('plus de 65 535 entrées', { skip: !process.env.SCUBAPILOT_TESTS_LONGS && 'test long, activé par SCUBAPILOT_TESTS_LONGS=1' }, async () => {
  const dir = tmpDir('zipmany');
  try {
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    for (let i = 0; i < 66000; i++) fs.writeFileSync(path.join(src, `f${i}.txt`), String(i));
    const out = path.join(dir, 'c.zip');
    await createZip(out, src, {});
    const zip = readZip(out);
    assert.equal(zip.entries.length, 66000); assert.ok(zip.zip64);
    assert.equal(zip.get('f65999.txt').toString(), '65999');
  } finally { rmrf(dir); }
});

test("un fichier qui disparaît pendant la sauvegarde est noté, les autres sont sauvés", async () => {
  const dir = tmpDir('zipgone');
  try {
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    const data = { 'f1.dat': crypto.randomBytes(100000), 'f2.dat': crypto.randomBytes(100000), 'f3.dat': crypto.randomBytes(100000) };
    for (const [n, d] of Object.entries(data)) fs.writeFileSync(path.join(src, n), d);
    const out = path.join(dir, 'd.zip');
    let removed = false;
    const r = await createZip(out, src, { onProgress: p => { if (!removed && p.filesDone >= 1) { removed = true; fs.unlinkSync(path.join(src, 'f2.dat')); } } });
    assert.deepEqual(r.skipped.map(s => s.file), ['f2.dat']);
    const zip = readZip(out);
    assert.deepEqual(zip.names.sort(), ['f1.dat', 'f3.dat']);
    assert.ok(zip.get('f1.dat').equals(data['f1.dat']) && zip.get('f3.dat').equals(data['f3.dat']));
  } finally { rmrf(dir); }
});
