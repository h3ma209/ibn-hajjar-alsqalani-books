const MDBReader = require('mdb-reader').default;
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const MDB = path.join(ROOT, 'isabah.mdb');
const HTML = path.join(ROOT, 'isabah-from-bok.html');
const PDF = path.join(ROOT, 'الإصابة في تمييز الصحابة.pdf');

function ar(s) {
  if (s == null) return '';
  return iconv.decode(Buffer.from(String(s), 'binary'), 'windows-1256');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Chrome/Edge not found');
}

const reader = new MDBReader(fs.readFileSync(MDB));
const main = reader.getTable('Main').getData()[0];
const title = ar(main.Bk);
const auth = ar(main.Auth);
const betaka = ar(main.Betaka);
const pages = reader
  .getTable('b9767')
  .getData()
  .map((r) => ({
    id: r.id,
    page: r.page,
    part: r.part,
    nass: ar(r.nass),
  }))
  .sort((a, b) => (a.id || 0) - (b.id || 0));

console.log(`title=${title}`);
console.log(`pages=${pages.length}`);

const css = `
html { direction: rtl; }
body {
  font-family: "Traditional Arabic", "Arial", "Tahoma", serif;
  font-size: 18px;
  line-height: 1.85;
  color: #111;
  margin: 0;
  padding: 0;
  background: #fff;
}
.cover {
  page-break-after: always;
  padding: 80px 48px;
  text-align: center;
}
.cover h1 { font-size: 42px; margin: 0 0 16px; }
.cover h2 { font-size: 28px; font-weight: normal; margin: 0 0 32px; color: #333; }
.cover pre {
  white-space: pre-wrap;
  text-align: right;
  font-family: inherit;
  font-size: 16px;
  background: #f7f7f7;
  padding: 20px;
  border-radius: 8px;
}
.page {
  page-break-after: always;
  padding: 36px 42px 48px;
}
.meta {
  font-size: 12px;
  color: #666;
  border-bottom: 1px solid #ddd;
  padding-bottom: 8px;
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
}
.nass {
  white-space: pre-wrap;
  word-wrap: break-word;
}
`;

let html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">`;
html += `<title>${esc(title)}</title><style>${css}</style></head><body>`;
html += `<section class="cover"><h1>${esc(title)}</h1><h2>${esc(auth)}</h2>`;
html += `<pre>${esc(betaka)}</pre></section>`;

for (const p of pages) {
  html += `<section class="page">`;
  html += `<div class="meta"><span>ج ${esc(p.part ?? '')} / ص ${esc(p.page ?? '')}</span><span>#${esc(p.id)}</span></div>`;
  html += `<div class="nass">${esc(p.nass)}</div></section>`;
}
html += `</body></html>`;

fs.writeFileSync(HTML, html, 'utf8');
console.log(`html_bytes=${Buffer.byteLength(html, 'utf8')}`);

const chrome = findChrome();
console.log(`browser=${chrome}`);
console.log('printing pdf...');

const fileUrl = 'file:///' + HTML.replace(/\\/g, '/');
const result = spawnSync(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${PDF}`,
    '--print-to-pdf-no-header',
    fileUrl,
  ],
  { encoding: 'utf8', timeout: 600000 }
);

if (result.error) throw result.error;
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  throw new Error(`chrome exit ${result.status}`);
}

if (!fs.existsSync(PDF)) {
  throw new Error('PDF not created');
}
const st = fs.statSync(PDF);
console.log(`pdf=${PDF}`);
console.log(`pdf_bytes=${st.size}`);
