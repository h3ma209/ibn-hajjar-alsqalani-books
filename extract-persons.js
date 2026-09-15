#!/usr/bin/env node
/**
 * Extract companion/person entries from al-Isabah Shamela .bok
 *
 * Usage:
 *   node extract-persons.js search "أبو هريرة"
 *   node extract-persons.js search "abu huraira"
 *   node extract-persons.js get 10680
 *   node extract-persons.js list --out persons-index.json
 *   node extract-persons.js export --query "أسامة" --out out.json
 *   node extract-persons.js export --all --index-only --out all-persons.json
 *
 * Options:
 *   --bok <path>     Path to .bok (default: first *.bok in cwd)
 *   --out <path>     Write JSON to file (default: stdout for get/search)
 *   --limit <n>      Max search/export hits (default: 20 search, unlimited export)
 *   --index-only     Export metadata only (no full biography text)
 *   --max-chars <n>  Truncate biography text (0 = full, default: full)
 */

const fs = require('fs');
const path = require('path');
const MDBReader = require('mdb-reader').default;
const iconv = require('iconv-lite');
const { parseBiography } = require('./bio-extract');
const {
  buildBookLayers,
  parseCrossRefs,
  QISM_LABEL,
} = require('./book-structure');
const {
  buildCompanionRecord,
  SCHEMA_VERSION,
  SCHEMA_SECTIONS,
} = require('./companion-schema');

const ENTRY_RE = /^(\d+)\s*[-–—]\s*(.+?)\s*$/;
const FOOTNOTE_RE = /\s*\[\s*\(\d+\)\s*\]/g;
const TRAIL_PUNCT_RE = /[：:\s،,]+$/;
const INLINE_NOTE_RE = /«\s*\d+\s*»|\(\s*\d+\s*\)/g;
const FOOTNOTE_BLOCK_RE = /\n?_{3,}[\s\S]*$/;
const NASAB_LINK_RE = /^(?:بن|ابن|بنت|ابنة)\b/;
const STOP_AFTER_NASAB_RE =
  /^(?:قال|قالت|روى|رواه|أخرج|ذكره|ذكر|صحابي|أدرك|قدم|شهد|كان|كانت|اختُلف|اختلف|ويقال|وقيل|قلت|هذا|كذا|انتهى|توفي|مات|استشهد)/;

function ar(s) {
  if (s == null) return '';
  return iconv.decode(Buffer.from(String(s), 'binary'), 'windows-1256');
}

function normalizeArabic(s) {
  return String(s)
    .normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Simple Latin → Arabic aliases for common names */
const ALIASES = {
  'abu huraira': 'ابو هريره',
  'abu hurayrah': 'ابو هريره',
  'abu bakr': 'ابو بكر',
  umar: 'عمر',
  uthman: 'عثمان',
  ali: 'علي',
  aisha: 'عائشه',
  'ibn abbas': 'ابن عباس',
  'ibn umar': 'ابن عمر',
  anas: 'انس',
  bilal: 'بلال',
  hamza: 'حمزه',
  khadija: 'خديجه',
};

function expandQuery(q) {
  const raw = String(q).trim();
  const alias = ALIASES[raw.toLowerCase()];
  return normalizeArabic(alias || raw);
}

function cleanName(raw) {
  return String(raw)
    .replace(FOOTNOTE_RE, '')
    .replace(INLINE_NOTE_RE, '')
    .replace(TRAIL_PUNCT_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip editor footnotes / notes from opening so nasab parse stays clean */
function stripOpeningNoise(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(FOOTNOTE_BLOCK_RE, '')
    .replace(FOOTNOTE_RE, '')
    .replace(INLINE_NOTE_RE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Pull genealogy chain from biography opening.
 * Prefer heading + بن… continuation; also check "اسمه …" / longer "ويقال: …".
 */
function parseFullName(text, tocName, number) {
  const opening = stripOpeningNoise(text).slice(0, 1500);
  const empty = {
    full_name: tocName || '',
    ism: tocName || '',
    father: null,
    grandfather: null,
    great_grandfather: null,
    nasab: tocName ? [tocName] : [],
    nisba: null,
    name_source: 'toc',
  };
  if (!opening) return empty;

  const headRe = new RegExp(`^${number}\\s*[-–—]\\s*([\\s\\S]+)$`);
  const hm = opening.match(headRe);
  let body = hm ? hm[1].trim() : opening;

  // Join "اسم:بن" / "اسم.بن" glued splits common in Shamela text
  body = body.replace(/([^\s])\s*[:：.]\s*(?=(?:بن|ابن|بنت|ابنة)\b)/g, '$1 ');

  const candidates = [];

  const headingChain = takeNasabPhrase(body);
  if (headingChain) candidates.push({ raw: headingChain, source: 'heading' });

  const ismuhu = body.match(
    /اسمه\s+(.+?)(?=\s*(?:وكان|وكان|وشهد|وقال|روى|فإنما|وإنما|وذكر|وهو|\.|$))/s
  );
  if (ismuhu) {
    const raw = cleanName(ismuhu[1]).replace(/[.:،,؛]+$/g, '');
    if (raw && raw.length <= 180) candidates.push({ raw, source: 'ismuhu' });
  }

  for (const m of body.matchAll(
    /ويقال\s*[:：]?\s*([^\n]{3,180}?)(?=\s*(?:أدرك|روى|ذكر|قال|\.|$))/g
  )) {
    const raw = cleanName(m[1]).replace(/[.:،,؛]+$/g, '');
    if (/\s+(?:بن|ابن|بنت|ابنة)\s+/.test(raw)) {
      candidates.push({ raw, source: 'yuqal' });
    }
  }

  if (!candidates.length) return empty;

  candidates.sort((a, b) => nasabScore(b.raw, b.source) - nasabScore(a.raw, a.source));
  let best = candidates[0];
  if (!best || best.raw.length > 260 || /أخبرنا |حدّثني |الإسناد |باطل/.test(best.raw)) {
    const safe = candidates.find(
      (c) => c.raw.length <= 260 && !/أخبرنا |حدّثني |الإسناد |باطل/.test(c.raw)
    );
    if (!safe) return empty;
    best = safe;
  }
  return splitNasabRecord(best.raw, best.source, tocName);
}

function nasabScore(s, source) {
  const links = (String(s).match(/\s+(?:بن|ابن|بنت|ابنة)\s+/g) || []).length;
  let score = links * 100 + Math.min(String(s).length, 200);
  // Prefer real genealogy over bare short heading when اسمه exists
  if (source === 'ismuhu' && links >= 1) score += 50;
  if (source === 'yuqal' && links >= 2) score += 30;
  // Penalize runaway prose dumps
  if (String(s).length > 220) score -= 500;
  if (/قال |روى |أخبرنا |حدّثني /.test(s)) score -= 400;
  return score;
}

/** Walk from start; keep name + بن-chain until biography prose starts */
function takeNasabPhrase(body) {
  let flat = String(body)
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';

  // Hard stop before alternate-name / prose markers
  const hard = flat.search(
    /\s(?:وقيل|ويقال|قال |قالت |روى |رواه |أخرج |ذكره |ذكر |صحابي|أدرك |قدم |شهد |كان |كانت |اختُلف|اختلف |قلت |انتهى|توفي |مات |استشهد |هكذا )/
  );
  if (hard > 8) flat = flat.slice(0, hard);

  const prose = flat.search(
    /\.\s+(?=قال|روى|أخرج|ذكر|صحابي|أدرك|قدم|شهد|كان |كانت |اخت|هكذا)/
  );
  if (prose > 20) flat = flat.slice(0, prose);

  flat = cleanName(flat.replace(/[.:،,؛]+$/g, ''));

  let parts = splitNasabParts(flat);
  // Drop trailing descriptive fluff (الزاهد المشهور، إلخ)
  while (
    parts.length > 1 &&
    /^(?:الزاهد|المشهور|المعروف|التابعي|الصحابي|الحافظ)$/.test(parts[parts.length - 1])
  ) {
    parts.pop();
  }
  if (parts.length > 18) parts = parts.slice(0, 18);
  while (parts.length && STOP_AFTER_NASAB_RE.test(parts[parts.length - 1])) {
    parts.pop();
  }

  if (parts.length <= 1 && flat.length > 50) {
    return cleanName(parts[0] || flat).slice(0, 50);
  }

  return joinNasabParts(parts);
}

function splitNasabParts(fullName) {
  return String(fullName)
    .split(/\s+(?:بن|ابن|بنت|ابنة)\s+/)
    .map((p) => cleanName(p))
    .filter(Boolean);
}

function joinNasabParts(parts) {
  if (!parts.length) return '';
  return parts.join(' بن ');
}

function detectNisba(parts) {
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  // Split glued "فلان القرشي الأموي" → ancestor + nisba
  const m = last.match(
    /^(.+?)\s+((?:ال[\u0600-\u06FF]+[يى]ّ?)(?:\s+ال[\u0600-\u06FF]+[يى]ّ?)*)$/
  );
  if (m) return { ancestor: m[1], nisba: m[2] };
  if (/[يى]ّ?$/.test(last) && !/\s/.test(last)) return { ancestor: null, nisba: last };
  return { ancestor: null, nisba: null };
}

function splitNasabRecord(fullRaw, source, tocName) {
  let cleaned = cleanName(fullRaw)
    .replace(/\s+(?:الزاهد|المشهور|المعروف|التابعي)\s*$/g, '')
    .replace(/\s+(?:الزاهد|المشهور|المعروف)\s+/g, ' ')
    .trim();
  let parts = splitNasabParts(cleaned);
  if (!parts.length) {
    return {
      full_name: tocName || '',
      ism: tocName || '',
      father: null,
      grandfather: null,
      great_grandfather: null,
      nasab: tocName ? [tocName] : [],
      nisba: null,
      name_source: source,
    };
  }

  // Drop fluff tokens stuck as own nasab segments
  while (
    parts.length > 1 &&
    /^(?:الزاهد|المشهور|المعروف|التابعي|الصحابي|الحافظ)$/.test(parts[parts.length - 1])
  ) {
    parts.pop();
  }
  // Strip trailing fluff glued onto last ancestor/nisba chunk
  if (parts.length) {
    parts[parts.length - 1] = parts[parts.length - 1]
      .replace(/\s+(?:الزاهد|المشهور|المعروف|التابعي|الحافظ)\s*$/g, '')
      .trim();
  }

  const det = detectNisba(parts);
  if (det.ancestor) {
    parts = [...parts.slice(0, -1), det.ancestor];
  }
  const full_name = joinNasabParts(parts) + (det.nisba ? ` ${det.nisba}` : '');

  return {
    full_name: cleanName(full_name),
    ism: parts[0] || tocName || null,
    father: parts[1] || null,
    grandfather: parts[2] || null,
    great_grandfather: parts[3] || null,
    nasab: parts,
    nisba: det.nisba,
    name_source: source,
  };
}

function findBok(explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`bok not found: ${explicit}`);
    return path.resolve(explicit);
  }
  const here = process.cwd();
  const hit = fs.readdirSync(here).find((f) => f.toLowerCase().endsWith('.bok'));
  if (!hit) throw new Error('No .bok in cwd. Pass --bok <path>');
  return path.join(here, hit);
}

function loadBook(bokPath) {
  const buf = fs.readFileSync(bokPath);
  const reader = new MDBReader(buf);
  const tables = reader.getTableNames();
  const bodyTable = tables.find((t) => /^b\d+$/i.test(t));
  const tocTable = tables.find((t) => /^t\d+$/i.test(t));
  if (!bodyTable || !tocTable) {
    throw new Error(`Unexpected bok schema. tables=${tables.join(',')}`);
  }

  const main = reader.getTable('Main').getData()[0] || {};
  const meta = {
    book_id: main.BkId,
    book: ar(main.Bk),
    author: ar(main.Auth),
    card: ar(main.Betaka),
    bok: path.basename(bokPath),
    body_table: bodyTable,
    toc_table: tocTable,
  };

  const pages = reader
    .getTable(bodyTable)
    .getData()
    .map((r) => ({
      id: r.id,
      page: r.page,
      part: r.part == null ? null : String(r.part),
      nass: ar(r.nass),
    }))
    .sort((a, b) => (a.id || 0) - (b.id || 0));

  const pageById = new Map(pages.map((p) => [p.id, p]));

  // Person entries live mainly at toc lvl 5 as "N- Name"
  const toc = reader
    .getTable(tocTable)
    .getData()
    .map((r) => ({
      tit: ar(r.tit),
      lvl: r.lvl,
      sub: r.sub,
      id: r.id,
    }))
    .sort((a, b) => a.id - b.id);

  const persons = [];
  for (const t of toc) {
    const m = t.tit.match(ENTRY_RE);
    if (!m) continue;
    // skip front-matter numbered headings that are not biographies
    if (t.lvl < 5 && Number(m[1]) < 20 && !/^[آأاإ]/.test(m[2]) && t.lvl <= 4) {
      // keep lvl>=5 primarily; still allow lvl 5+
    }
    if (t.lvl < 5) continue;
    const number = Number(m[1]);
    const name = cleanName(m[2]);
    if (!name || Number.isNaN(number)) continue;
    persons.push({
      number,
      name,
      name_raw: t.tit,
      toc_lvl: t.lvl,
      start_id: t.id,
      name_norm: normalizeArabic(name),
    });
  }

  // Attach end bounds + page metadata
  for (let i = 0; i < persons.length; i++) {
    const cur = persons[i];
    const next = persons[i + 1];
    cur.end_id = next ? next.start_id - 1 : pages[pages.length - 1]?.id;
    const startPage = pageById.get(cur.start_id);
    const endPage = pageById.get(cur.end_id) || startPage;
    cur.volume = startPage?.part ?? null;
    cur.page_start = startPage?.page ?? null;
    cur.page_end = endPage?.page ?? null;
  }

  const layers = buildBookLayers(toc, pages, persons);

  return {
    meta,
    pages,
    pageById,
    toc,
    persons,
    chapters: layers.chapters,
    coverage: layers.coverage,
    qism_labels: layers.qism_labels,
  };
}

function getText(book, person, maxChars = 0) {
  const pages = book.pages;
  // binary search first page >= start_id
  let lo = 0;
  let hi = pages.length - 1;
  let startIdx = pages.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].id < person.start_id) lo = mid + 1;
    else {
      startIdx = mid;
      hi = mid - 1;
    }
  }
  const chunks = [];
  for (let i = startIdx; i < pages.length; i++) {
    const p = pages[i];
    if (p.id > person.end_id) break;
    chunks.push(p.nass);
  }
  let text = chunks.join('\n\n').trim();
  const marker = new RegExp(String(person.number) + '\\s*[-–—]\\s*');
  const idx = text.search(marker);
  if (idx > 0) text = text.slice(idx);
  if (maxChars > 0 && text.length > maxChars) {
    text = text.slice(0, maxChars) + '\n…';
  }
  return text;
}

function enrichName(book, person, openingText) {
  if (person._nameParsed) return person._nameParsed;
  const opening =
    openingText != null ? String(openingText).slice(0, 1800) : getText(book, person, 1800);
  person._nameParsed = parseFullName(opening, person.name, person.number);
  person.name_norm_full = normalizeArabic(person._nameParsed.full_name || person.name);
  return person._nameParsed;
}

function toRecord(
  book,
  person,
  { withText = false, maxChars = 0, withBio = true, withCrossRefs = true } = {}
) {
  let fullText = null;
  if (withText || withBio || withCrossRefs || !person._nameParsed) {
    fullText = getText(book, person, 0);
  }
  const parsed = enrichName(book, person, fullText || undefined);
  const place = person.placement || {};
  const placement = {
    volume: place.volume || null,
    section_type: place.section_type || null,
    letter: place.letter || null,
    qism: place.qism || null,
    qism_label: place.qism_label || (place.qism ? QISM_LABEL[place.qism] : null),
    qism_title: place.qism_title || null,
    bab: place.bab || null,
    toc_path: place.toc_path || [],
  };
  const ruling = {
    ibn_hajar_grade: place.qism || null,
    grade_meaning: placement.qism_label || null,
    in_kunya_book: place.section_type === 'kunya',
    in_women_book: place.section_type === 'women',
  };
  const textForBio = fullText || '';
  let bio = {};
  let crossRefs = [];
  if (withBio && textForBio) {
    bio = parseBiography(textForBio, {
      name: person.name,
      full_name: parsed.full_name,
      ism: parsed.ism,
      nisba: parsed.nisba,
    });
  }
  if (withCrossRefs && textForBio) {
    crossRefs = parseCrossRefs(textForBio, person.number);
  }
  const rec = buildCompanionRecord({
    person,
    parsed,
    bio,
    crossRefs,
    placement,
    ruling,
  });
  // Full raw text intentionally omitted from JSON exports.
  if (withText && textForBio) {
    let excerpt = textForBio.slice(0, maxChars > 0 ? maxChars : 280).replace(/\s+/g, ' ').trim();
    if (maxChars > 0 && textForBio.length > maxChars) excerpt += '…';
    rec._excerpt = excerpt;
  }
  return rec;
}

function indexRowFromRecord(rec) {
  const cat = rec.categorization_and_identity;
  const nasab = cat.nasab || {};
  const place = cat.placement || {};
  return {
    number: rec.id.number,
    name: cat.names.display,
    full_name: nasab.full_name,
    ism: nasab.ism,
    father: nasab.father,
    grandfather: nasab.grandfather,
    qism: cat.ibn_hajar_category,
    letter: place.letter,
    section_type: cat.section_type,
    volume: place.volume_print,
    page_start: place.page_start,
    page_end: place.page_end,
  };
}

/** Stream large export to avoid holding entire JSON in RAM */
function exportPersonsStream(
  book,
  persons,
  outPath,
  { withText = false, withBio = true, maxChars = 0 } = {}
) {
  const out = fs.createWriteStream(outPath, { encoding: 'utf8' });
  out.setMaxListeners(0);
  const write = (s) =>
    new Promise((resolve, reject) => {
      const onErr = (err) => reject(err);
      out.once('error', onErr);
      if (out.write(s)) {
        out.removeListener('error', onErr);
        resolve();
      } else {
        out.once('drain', () => {
          out.removeListener('error', onErr);
          resolve();
        });
      }
    });

  return (async () => {
    await write('{\n');
    await write(`  "source": ${JSON.stringify(book.meta, null, 2).replace(/\n/g, '\n  ')},\n`);
    await write(
      `  "schema": ${JSON.stringify({ version: SCHEMA_VERSION, sections: SCHEMA_SECTIONS }, null, 2).replace(/\n/g, '\n  ')},\n`
    );
    await write(`  "count": ${persons.length},\n`);
    await write('  "persons": [\n');
    const t0 = Date.now();
    for (let i = 0; i < persons.length; i++) {
      const rec = toRecord(book, persons[i], {
        withText: false,
        withBio,
        maxChars,
      });
      const chunk = JSON.stringify(rec, null, 2)
        .split('\n')
        .map((line) => '    ' + line)
        .join('\n');
      await write((i ? ',\n' : '') + chunk);
      if (i > 0 && i % 500 === 0) {
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        process.stderr.write(`  … ${i}/${persons.length} (${sec}s)\n`);
      }
    }
    await write('\n  ]\n}\n');
    await new Promise((resolve, reject) => {
      out.end(() => resolve());
      out.on('error', reject);
    });
    const st = fs.statSync(outPath);
    process.stderr.write(
      `wrote ${outPath} (${st.size} bytes, ${persons.length} persons, ${((Date.now() - t0) / 1000).toFixed(1)}s)\n`
    );
  })();
}

function searchPersons(book, query, limit = 20) {
  const q = expandQuery(query);
  if (!q) return [];
  const scored = [];
  for (const p of book.persons) {
    const parsed = enrichName(book, p);
    const usable =
      parsed.full_name &&
      parsed.full_name.length <= 260 &&
      !/أخبرنا |حدّثني |الإسناد /.test(parsed.full_name);
    const full = usable ? parsed.full_name : '';
    const nasab = usable ? parsed.nasab || [] : [];
    const hay = normalizeArabic(
      [p.name, full, usable ? parsed.ism : '', usable ? parsed.father : '', ...nasab]
        .filter(Boolean)
        .join(' ')
    );
    const numHit = String(p.number) === query.trim();
    if (!hay.includes(q) && !numHit) continue;
    const exact =
      p.name_norm === q ||
      normalizeArabic(full) === q ||
      normalizeArabic(parsed.ism || '') === q;
    const starts =
      p.name_norm.startsWith(q) ||
      normalizeArabic(full).startsWith(q) ||
      normalizeArabic(parsed.ism || '').startsWith(q);
    scored.push({
      person: p,
      score: exact ? 0 : starts ? 1 : 2,
    });
  }
  scored.sort((a, b) => a.score - b.score || a.person.number - b.person.number);
  return scored.slice(0, limit).map((s) => s.person);
}

function parseArgs(argv) {
  const args = {
    cmd: null,
    query: null,
    number: null,
    bok: null,
    out: null,
    limit: null,
    indexOnly: false,
    all: false,
    maxChars: 0,
  };
  const rest = [...argv];
  args.cmd = rest.shift() || null;
  while (rest.length) {
    const a = rest.shift();
    if (a === '--bok') args.bok = rest.shift();
    else if (a === '--out') args.out = rest.shift();
    else if (a === '--limit') args.limit = Number(rest.shift());
    else if (a === '--max-chars') args.maxChars = Number(rest.shift());
    else if (a === '--index-only') args.indexOnly = true;
    else if (a === '--all') args.all = true;
    else if (a === '--query') args.query = rest.shift();
    else if (a === '--help' || a === '-h') args.cmd = 'help';
    else if (!a.startsWith('-')) {
      if (args.cmd === 'get' && args.number == null) args.number = Number(a);
      else if ((args.cmd === 'search' || args.cmd === 'export') && args.query == null) args.query = a;
      else if (!args.query) args.query = a;
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  return args;
}

function writeOut(data, outPath) {
  const json = JSON.stringify(data, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json, 'utf8');
    process.stderr.write(`wrote ${outPath} (${Buffer.byteLength(json, 'utf8')} bytes)\n`);
  } else {
    process.stdout.write(json + '\n');
  }
}

function help() {
  console.log(`Extract persons from الإصابة .bok

Commands:
  search <query>     Find persons by Arabic/Latin name
  get <number>       Full entry + placement + bio + cross-refs
  list               Dump person index (with qism/letter)
  export             Export matches (or --all)
  structure          Dump chapters + coverage + qism labels
  graph              Build cross-ref edge list (sample or --all)

Examples:
  node extract-persons.js search "abu huraira"
  node extract-persons.js get 10680 --out abu-huraira.json
  node extract-persons.js structure --out book-structure.json
  node extract-persons.js graph --all --out cross-refs.json
  node extract-persons.js export --all --out all-persons.json
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cmd || args.cmd === 'help') {
    help();
    process.exit(args.cmd ? 0 : 1);
  }

  const bokPath = findBok(args.bok);
  process.stderr.write(`loading ${bokPath}...\n`);
  const book = loadBook(bokPath);
  process.stderr.write(
    `persons=${book.persons.length} pages=${book.pages.length} chapters=${book.chapters.length} coverage=${book.coverage.coverage_ratio}\n`
  );

  if (args.cmd === 'structure') {
    const chaptersOut = book.chapters.map((c) => ({
      id: c.id,
      title: c.title,
      lvl: c.lvl,
      kind: c.kind,
      end_id: c.end_id,
      text_len: c.text.length,
      text: c.text.length > 5000 ? c.text.slice(0, 5000) + '\n…' : c.text,
    }));
    writeOut(
      {
        source: book.meta,
        qism_labels: book.qism_labels,
        coverage: book.coverage,
        chapter_count: chaptersOut.length,
        chapters: chaptersOut,
      },
      args.out || 'book-structure.json'
    );
    return;
  }

  if (args.cmd === 'graph') {
    const selected = args.all
      ? book.persons
      : args.number
        ? book.persons.filter((p) => p.number === args.number)
        : args.query
          ? searchPersons(book, args.query, args.limit ?? 50)
          : book.persons.filter((p) => p.number === 10680);
    const edges = [];
    for (const p of selected) {
      const text = getText(book, p);
      for (const e of parseCrossRefs(text, p.number)) edges.push(e);
    }
    writeOut(
      {
        source: book.meta,
        count: edges.length,
        persons_scanned: selected.length,
        edges,
      },
      args.out || 'cross-refs.json'
    );
    return;
  }

  if (args.cmd === 'list') {
    const rows = book.persons.map((p) =>
      indexRowFromRecord(
        toRecord(book, p, {
          withText: false,
          withBio: false,
          withCrossRefs: false,
        })
      )
    );
    writeOut(
      {
        source: book.meta,
        schema: { version: SCHEMA_VERSION, sections: SCHEMA_SECTIONS },
        coverage: book.coverage,
        count: rows.length,
        persons: rows,
      },
      args.out || 'persons-index.json'
    );
    return;
  }

  if (args.cmd === 'get') {
    if (!args.number) throw new Error('Usage: get <number>');
    const person = book.persons.find((p) => p.number === args.number);
    if (!person) throw new Error(`Entry not found: ${args.number}`);
    const entry = toRecord(book, person, {
      withText: false,
      withBio: !args.indexOnly,
      withCrossRefs: !args.indexOnly,
      maxChars: args.maxChars,
    });
    writeOut(
      {
        source: book.meta,
        schema: { version: SCHEMA_VERSION, sections: SCHEMA_SECTIONS },
        layers: {
          qism_labels: book.qism_labels,
          coverage: book.coverage,
          related_chapters: book.chapters
            .filter((c) =>
              ['preface', 'definition', 'method', 'virtue_adala'].includes(c.kind)
            )
            .slice(0, 15)
            .map((c) => ({
              id: c.id,
              title: c.title,
              kind: c.kind,
              text_preview: c.text.slice(0, 400),
            })),
        },
        entry,
      },
      args.out
    );
    return;
  }

  if (args.cmd === 'search') {
    if (!args.query) throw new Error('Usage: search <query>');
    const limit = args.limit ?? 20;
    const hits = searchPersons(book, args.query, limit);
    writeOut(
      {
        source: book.meta,
        schema: { version: SCHEMA_VERSION, sections: SCHEMA_SECTIONS },
        query: args.query,
        count: hits.length,
        results: hits.map((p) =>
          toRecord(book, p, {
            withText: false,
            withBio: false,
          })
        ),
      },
      args.out
    );
    return;
  }

  if (args.cmd === 'export') {
    let selected;
    if (args.all) {
      selected = book.persons;
    } else {
      if (!args.query) throw new Error('export needs --query <name> or --all');
      selected = searchPersons(book, args.query, args.limit ?? Infinity);
    }
    const withText = false;
    const withBio = !args.indexOnly;
    const outPath = args.out || (args.all ? 'all-persons.json' : null);
    if (selected.length > 200 && !outPath) {
      throw new Error(
        `Refusing to print ${selected.length} records to stdout. Use --out file`
      );
    }
    if (outPath && selected.length > 200) {
      await exportPersonsStream(book, selected, outPath, {
        withText: false,
        withBio,
        maxChars: args.maxChars,
      });
      return;
    }
    writeOut(
      {
        source: book.meta,
        schema: { version: SCHEMA_VERSION, sections: SCHEMA_SECTIONS },
        coverage: book.coverage,
        count: selected.length,
        persons: selected.map((p) =>
          toRecord(book, p, {
            withText: false,
            withBio,
            maxChars: args.maxChars,
          })
        ),
      },
      outPath
    );
    return;
  }

  throw new Error(`Unknown command: ${args.cmd}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err.message || err));
    process.exit(1);
  });
}

module.exports = {
  loadBook,
  searchPersons,
  getText,
  toRecord,
  indexRowFromRecord,
  parseFullName,
  normalizeArabic,
  expandQuery,
  parseBiography,
  parseCrossRefs,
  SCHEMA_VERSION,
  SCHEMA_SECTIONS,
};
