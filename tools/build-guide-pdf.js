#!/usr/bin/env node
// Outil de développement (pas utilisé par l'application) : produit le guide PDF à partir de
// docs/GUIDE.md. Nécessite les paquets « marked » et « playwright » (Chromium) installés à part,
// par exemple globalement :  NODE_PATH=$(npm root -g) node tools/build-guide-pdf.js 1.23
//   → docs/ScubaPilot-Guide-v1.23.pdf
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const version = process.argv[2] || require(path.join(ROOT, 'package.json')).version;
const out = process.argv[3] || path.join(ROOT, 'docs', `ScubaPilot-Guide-v${version}.pdf`);

// Ancres identiques à celles de GitHub (pour que la table des matières fonctionne dans le PDF).
function slug(text) {
  return text.toLowerCase().trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
let md = fs.readFileSync(path.join(ROOT, 'docs', 'GUIDE.md'), 'utf8');
// Le titre et la ligne de version vont sur la page de garde.
md = md.replace(/^# .*\n+\*\*Version[^\n]*\*\*\n+/, '');
const seen = {};
const renderer = new marked.Renderer();
renderer.heading = function (tokOrText, levelArg) {
  const text = typeof tokOrText === 'object' ? tokOrText.text : tokOrText;
  const level = typeof tokOrText === 'object' ? tokOrText.depth : levelArg;
  const inner = typeof tokOrText === 'object' ? this.parser.parseInline(tokOrText.tokens) : text;
  let id = slug(text);
  if (seen[id] !== undefined) { seen[id]++; id += '-' + seen[id]; } else seen[id] = 0;
  return `<h${level} id="${id}">${inner}</h${level}>\n`;
};
marked.use({ renderer, gfm: true });
let body = marked.parse(md);
// Image suivie de sa légende en italique -> figure insécable.
body = body.replace(/<p><img([^>]*)>(?:<\/p>\s*<p>|\s*)<em>([\s\S]*?)<\/em><\/p>/g, '<figure><img$1><figcaption>$2</figcaption></figure>');
const figures = (body.match(/<figure>/g) || []).length;
const loose = (body.match(/<img/g) || []).length - figures;

const logo = fs.readFileSync(path.join(ROOT, 'public', 'logo.svg'), 'utf8');
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><base href="file://${path.join(ROOT, 'docs')}/">
<style>
  @page { size: Letter; margin: 18mm 16mm 18mm 16mm; }
  body { font-family: "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #1d2b36; }
  .cover { height: 230mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; page-break-after: always; }
  .cover svg { width: 120px; height: 120px; }
  .cover h1 { font-size: 34pt; color: #094a75; margin: 18px 0 6px; border: 0; }
  .cover .sub { font-size: 13pt; color: #4a5a6a; }
  .cover .ver { margin-top: 28px; font-size: 10pt; font-weight: 700; letter-spacing: .12em; color: #0e6ba8; text-transform: uppercase; }
  h2 { font-size: 15pt; color: #094a75; border-bottom: 2px solid #0e6ba8; padding-bottom: 4px; margin: 26px 0 10px; page-break-after: avoid; }
  h3 { font-size: 11.5pt; color: #0e6ba8; margin: 18px 0 6px; page-break-after: avoid; }
  h4 { font-size: 10.5pt; margin: 14px 0 4px; page-break-after: avoid; }
  a { color: #0e6ba8; text-decoration: none; }
  code { font-family: Consolas, "SF Mono", Menlo, monospace; font-size: 8.8pt; background: #eef3f6; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f4f7f9; border: 1px solid #dde3e8; border-radius: 6px; padding: 8px 10px; white-space: pre-wrap; page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9pt; page-break-inside: avoid; }
  th, td { border: 1px solid #dde3e8; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #eef3f6; }
  blockquote { margin: 10px 0; padding: 6px 12px; border-left: 4px solid #0e6ba8; background: #f0f6fa; }
  figure { margin: 12px 0; text-align: center; page-break-inside: avoid; }
  figure img { max-width: 100%; max-height: 190mm; border: 1px solid #dde3e8; border-radius: 4px; }
  figcaption { font-size: 8.5pt; font-style: italic; color: #4a5a6a; margin-top: 4px; }
  img { max-width: 100%; }
  ul, ol { padding-left: 20px; }
  li { margin: 2px 0; }
</style></head><body>
<section class="cover">${logo}<h1>ScubaPilot</h1><div class="sub">Guide complet — installation et utilisation</div><div class="ver">Version ${version} · ${new Date().toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' })}</div></section>
${body}
</body></html>`;

(async () => {
  const tmp = path.join(require('os').tmpdir(), 'scubapilot-guide.html');
  fs.writeFileSync(tmp, html);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
  const broken = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href').slice(1)).filter(id => !document.getElementById(decodeURIComponent(id))));
  const missingImgs = await page.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src')));
  await page.pdf({
    path: out, format: 'Letter', printBackground: true, displayHeaderFooter: true,
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="font-size:7pt;color:#667;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>ScubaPilot — Guide complet · version ${version}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
  });
  await browser.close();
  console.log(`${out}\nfigures : ${figures} | images hors figure : ${loose} | liens internes cassés : ${JSON.stringify(broken)} | images introuvables : ${JSON.stringify(missingImgs)}`);
})().catch(e => { console.error(e); process.exit(1); });
