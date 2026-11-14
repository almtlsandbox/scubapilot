// Création d'une archive .zip en Node pur, sans dépendance et sans PowerShell.
//
// Pourquoi : la sauvegarde passait par « Compress-Archive » (PowerShell), limité à 2 Go, lent, et
// propre à Windows. Ici les fichiers sont lus et compressés en flux, un par un : la mémoire utilisée
// reste faible quelle que soit la taille du dossier, et le format ZIP64 est employé quand il le faut
// (fichier ou archive de plus de 4 Go, plus de 65 535 entrées).
//
// Compatibilité : chaque entrée a son en-tête complété après coup (pas de « data descriptor »), les
// noms sont en UTF-8 (accents corrects dans l'Explorateur Windows, macOS, 7-Zip...).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Transform, Writable, pipeline } = require('stream');

// ---- CRC-32 (table), calcul incrémental ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf, crc) {
  let c = (crc ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Formats déjà compressés : les recompresser ne fait que perdre du temps.
const STORE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.mp4', '.mov', '.m4v', '.avi',
  '.mkv', '.mp3', '.m4a', '.zip', '.7z', '.rar', '.gz', '.docx', '.xlsx', '.pptx']);

function dosDateTime(d) {
  const year = Math.max(1980, Math.min(2107, d.getFullYear()));
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// Parcourt l'arborescence et renvoie la liste des entrées (dossiers puis fichiers), triée.
function listEntries(rootDir, skip) {
  const out = [];
  (function walk(dir, rel) {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const it of items) {
      const abs = path.join(dir, it.name);
      const r = rel ? rel + '/' + it.name : it.name;
      if (skip && skip(abs, it)) continue;
      if (it.isDirectory()) { out.push({ rel: r + '/', abs, isDir: true, size: 0, mtime: safeMtime(abs) }); walk(abs, r); }
      else if (it.isFile()) {
        let st; try { st = fs.statSync(abs); } catch (e) { continue; }
        out.push({ rel: r, abs, isDir: false, size: st.size, mtime: st.mtime });
      }
      // liens symboliques et fichiers spéciaux : ignorés
    }
  })(rootDir, '');
  return out;
}
function safeMtime(p) { try { return fs.statSync(p).mtime; } catch (e) { return new Date(); } }

function writeAll(fd, buf, pos) {
  return new Promise((resolve, reject) => {
    (function next(off) {
      if (off >= buf.length) return resolve();
      fs.write(fd, buf, off, buf.length - off, pos + off, (err, n) => err ? reject(err) : next(off + n));
    })(0);
  });
}

/**
 * Crée zipPath à partir du contenu de rootDir.
 * options.onProgress({ filesDone, filesTotal, bytesDone, bytesTotal, current })
 * options.skip(abs, dirent) -> true pour ignorer
 * options.zip64Limit : seuil (octets) au-delà duquel on passe en ZIP64 — réglable pour les tests.
 * Renvoie { files, dirs, bytes, zipBytes, skipped: [{ file, reason }] }.
 */
async function createZip(zipPath, rootDir, options) {
  const opts = options || {};
  const LIMIT = opts.zip64Limit || 0xFFFFFFFF;
  const entries = listEntries(rootDir, opts.skip);
  const files = entries.filter(e => !e.isDir);
  const bytesTotal = files.reduce((s, e) => s + e.size, 0);
  const progress = { filesDone: 0, filesTotal: files.length, bytesDone: 0, bytesTotal, current: '' };
  const skipped = [];
  const central = [];
  let lastTick = 0;
  if (opts.onProgress) opts.onProgress(progress); // totaux connus dès le départ
  const fd = fs.openSync(zipPath, 'w');
  let pos = 0;
  try {
    for (const e of entries) {
      const name = Buffer.from(e.rel, 'utf8');
      const { time, date } = dosDateTime(e.mtime);
      const headerPos = pos;
      // ZIP64 décidé d'après la taille annoncée (avec marge, car un fichier peu compressible grossit un peu),
      // ou dès que l'entrée commence au-delà de 4 Go : son décalage sera en ZIP64 dans le répertoire central,
      // et certains outils (unzip d'Info-ZIP) signalent une incohérence si l'en-tête local n'a pas, lui aussi,
      // son champ ZIP64.
      const z64 = headerPos >= LIMIT || (!e.isDir && e.size >= LIMIT - Math.min(LIMIT >>> 4, 0x1000000));
      const method = e.isDir ? 0 : (STORE_EXT.has(path.extname(e.rel).toLowerCase()) ? 0 : 8);
      const extra = z64 ? Buffer.alloc(20) : Buffer.alloc(0);
      if (z64) { extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(16, 2); }
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0);
      h.writeUInt16LE(z64 ? 45 : 20, 4);
      h.writeUInt16LE(0x0800, 6);            // noms en UTF-8
      h.writeUInt16LE(method, 8);
      h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12);
      h.writeUInt32LE(0, 14);                // CRC, tailles : complétés après les données
      h.writeUInt32LE(z64 ? 0xFFFFFFFF : 0, 18);
      h.writeUInt32LE(z64 ? 0xFFFFFFFF : 0, 22);
      h.writeUInt16LE(name.length, 26); h.writeUInt16LE(extra.length, 28);
      const head = Buffer.concat([h, name, extra]);
      await writeAll(fd, head, pos);
      pos += head.length;

      let crc = 0, usize = 0, csize = 0;
      if (!e.isDir) {
        progress.current = e.rel;
        try {
          await new Promise((resolve, reject) => {
            const src = fs.createReadStream(e.abs);
            const meter = new Transform({ transform(chunk, enc, cb) {
              crc = crc32(chunk, crc); usize += chunk.length; progress.bytesDone += chunk.length;
              // Avancement aussi PENDANT un gros fichier (toutes les ~8 Mo), pas seulement entre deux fichiers.
              if (opts.onProgress && progress.bytesDone - lastTick >= 8 * 1024 * 1024) { lastTick = progress.bytesDone; opts.onProgress(progress); }
              cb(null, chunk);
            } });
            const sink = new Writable({ write(chunk, enc, cb) { writeAll(fd, chunk, pos).then(() => { pos += chunk.length; csize += chunk.length; cb(); }, cb); } });
            const stages = method === 8 ? [src, meter, zlib.createDeflateRaw({ level: 6 }), sink] : [src, meter, sink];
            pipeline(...stages, err => err ? reject(err) : resolve());
          });
          if (!z64 && (usize >= LIMIT || csize >= LIMIT)) throw new Error('FILE_GREW_PAST_4GB');
        } catch (err) {
          // Fichier illisible (verrouillé, uniquement en ligne et non téléchargeable, supprimé entre-temps...) :
          // on retire ce qui a été écrit pour lui, on le note, et on continue avec les autres.
          skipped.push({ file: e.rel, reason: err.code || err.message || 'ERREUR' });
          progress.bytesDone += Math.max(0, e.size - usize);
          pos = headerPos;
          fs.ftruncateSync(fd, pos);
          progress.filesDone++;
          if (opts.onProgress) opts.onProgress(progress);
          continue;
        }
        // Complète l'en-tête local maintenant que CRC et tailles sont connus.
        const fix = Buffer.alloc(12);
        fix.writeUInt32LE(crc, 0);
        fix.writeUInt32LE(z64 ? 0xFFFFFFFF : csize, 4);
        fix.writeUInt32LE(z64 ? 0xFFFFFFFF : usize, 8);
        await writeAll(fd, fix, headerPos + 14);
        if (z64) {
          const x = Buffer.alloc(16);
          x.writeBigUInt64LE(BigInt(usize), 0); x.writeBigUInt64LE(BigInt(csize), 8);
          await writeAll(fd, x, headerPos + 30 + name.length + 4);
        }
        progress.filesDone++;
        if (opts.onProgress) opts.onProgress(progress);
      }
      central.push({ name, method, time, date, crc, csize, usize, offset: headerPos, isDir: e.isDir, z64 });
    }

    // ---- Répertoire central ----
    const cdStart = pos;
    for (const c of central) {
      // Mêmes choix que dans l'en-tête local : si celui-ci est en ZIP64, les tailles le sont ici aussi.
      const size64 = c.z64 || c.usize >= LIMIT || c.csize >= LIMIT;
      const off64 = c.offset >= LIMIT;
      const need64 = size64 || off64;
      let extra = Buffer.alloc(0);
      if (need64) {
        const parts = [];
        if (size64) { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(c.usize), 0); b.writeBigUInt64LE(BigInt(c.csize), 8); parts.push(b); }
        if (off64) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(c.offset)); parts.push(b); }
        const body = Buffer.concat(parts);
        const hd = Buffer.alloc(4); hd.writeUInt16LE(0x0001, 0); hd.writeUInt16LE(body.length, 2);
        extra = Buffer.concat([hd, body]);
      }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(need64 ? 45 : 20, 4);  // version « créé par » (hôte 0 = MS-DOS/Windows)
      h.writeUInt16LE(need64 ? 45 : 20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(c.method, 10);
      h.writeUInt16LE(c.time, 12); h.writeUInt16LE(c.date, 14);
      h.writeUInt32LE(c.crc, 16);
      h.writeUInt32LE(size64 ? 0xFFFFFFFF : c.csize, 20);
      h.writeUInt32LE(size64 ? 0xFFFFFFFF : c.usize, 24);
      h.writeUInt16LE(c.name.length, 28); h.writeUInt16LE(extra.length, 30);
      h.writeUInt16LE(0, 32); h.writeUInt16LE(0, 34); h.writeUInt16LE(0, 36);
      h.writeUInt32LE(c.isDir ? 0x10 : 0x20, 38);   // attributs : dossier / archive
      h.writeUInt32LE(off64 ? 0xFFFFFFFF : c.offset, 42);
      const rec = Buffer.concat([h, c.name, extra]);
      await writeAll(fd, rec, pos);
      pos += rec.length;
    }
    const cdSize = pos - cdStart;
    const count = central.length;
    if (count >= 0xFFFF || cdSize >= LIMIT || cdStart >= LIMIT) {
      const z = Buffer.alloc(56 + 20);
      z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4);
      z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
      z.writeUInt32LE(0, 16); z.writeUInt32LE(0, 20);
      z.writeBigUInt64LE(BigInt(count), 24); z.writeBigUInt64LE(BigInt(count), 32);
      z.writeBigUInt64LE(BigInt(cdSize), 40); z.writeBigUInt64LE(BigInt(cdStart), 48);
      z.writeUInt32LE(0x07064b50, 56); z.writeUInt32LE(0, 60);
      z.writeBigUInt64LE(BigInt(pos), 64); z.writeUInt32LE(1, 72);
      await writeAll(fd, z, pos);
      pos += z.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(count, 0xFFFF), 8); end.writeUInt16LE(Math.min(count, 0xFFFF), 10);
    end.writeUInt32LE(cdSize >= LIMIT ? 0xFFFFFFFF : cdSize, 12);
    end.writeUInt32LE(cdStart >= LIMIT ? 0xFFFFFFFF : cdStart, 16);
    await writeAll(fd, end, pos);
    pos += end.length;
  } finally {
    fs.closeSync(fd);
  }
  return { files: files.length - skipped.length, dirs: entries.length - files.length, bytes: progress.bytesDone, zipBytes: pos, skipped };
}

module.exports = { createZip, crc32 };
