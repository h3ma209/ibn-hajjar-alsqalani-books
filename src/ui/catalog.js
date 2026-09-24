'use strict';

const fs = require('fs');
const { PATHS, BOOK } = require('../config');
const { normalizeArabic } = require('../util/arabic');
const { vocab } = require('../vocab');
const { openDb } = require('../pipeline/db');

/** Same aliases as the CLI, so the web search behaves identically. */
const LATIN_ALIASES = {
  'abu huraira': 'أبو هريرة',
  'abu hurayra': 'أبو هريرة',
  abu: 'أبو',
  'abu bakr': 'أبو بكر',
  umar: 'عمر',
  uthman: 'عثمان',
  ali: 'علي',
  aisha: 'عائشة',
  anas: 'أنس',
  bilal: 'بلال',
  hamza: 'حمزة',
  khadija: 'خديجة',
  'ibn umar': 'عبد الله بن عمر',
  'ibn abbas': 'عبد الله بن عباس',
  'ibn masud': 'عبد الله بن مسعود',
  salman: 'سلمان',
  muadh: 'معاذ',
};

const LETTER_ORDER = [
  'حرف الألف',
  'حرف الهمزة',
  'حرف الباء',
  'حرف التاء',
  'حرف الثاء',
  'حرف الجيم',
  'حرف الحاء المهملة',
  'حرف الخاء المعجمة',
  'حرف الدال المهملة',
  'حرف الذال المعجمة',
  'حرف الراء',
  'حرف الزاي',
  'حرف السين المهملة',
  'حرف الشين المعجمة',
  'حرف الصاد المهملة',
  'حرف الضاد المعجمة',
  'حرف الطاء المهملة',
  'حرف الظاء',
  'حرف العين المهملة',
  'حرف الغين المعجمة',
  'حرف الفاء',
  'حرف القاف',
  'حرف الكاف',
  'حرف اللام',
  'حرف الميم',
  'حرف النون',
  'حرف الهاء',
  'حرف الواو',
  'حرف الياء',
];

const INDEX_COLUMNS = [
  'person_id', 'entry_number', 'display_name', 'display_name_norm', 'full_name', 'full_name_norm',
  'kunya', 'nisba', 'is_woman', 'qism', 'section_type', 'letter', 'volume', 'page_start', 'page_end',
  'char_len', 'death_year_hijri', 'nasab_confidence', 'entry_number_is_ambiguous',
  'entry_marker', 'entry_kind', 'length_class',
].join(', ');
const INDEX_COLUMNS_P = INDEX_COLUMNS.split(', ').map((col) => `p.${col}`).join(', ');

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${filePath}. Run \`npm run pipeline\` first.`);
  }
  const rows = [];
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function indexJsonlBuffer(filePath, getKey) {
  if (!fs.existsSync(filePath)) return { buf: Buffer.alloc(0), map: new Map() };
  const buf = fs.readFileSync(filePath);
  const map = new Map();
  let start = 0;
  for (let i = 0; i <= buf.length; i += 1) {
    if (i !== buf.length && buf[i] !== 0x0a) continue;
    if (i > start) {
      const line = buf.subarray(start, i);
      const rec = JSON.parse(line.toString('utf8'));
      const key = getKey(rec);
      if (key) map.set(key, { start, length: line.length });
    }
    start = i + 1;
  }
  return { buf, map };
}

function parseAt(index, key) {
  const loc = index.map.get(key);
  if (!loc) return null;
  return JSON.parse(index.buf.subarray(loc.start, loc.start + loc.length).toString('utf8'));
}

function pushIndex(map, key, value) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function scoreHit(row, query, rawQuery) {
  if (String(row.entry_number) === rawQuery) return 0;
  const haystacks = [row.display_name_norm, row.full_name_norm].filter(Boolean);
  if (haystacks.some((h) => h === query)) return 1;
  if (haystacks.some((h) => h.startsWith(query))) return 2;
  if (haystacks.some((h) => h.includes(query))) return 3;
  return null;
}

function matchesFilters(row, filters) {
  if (filters.qism != null && row.qism !== filters.qism) return false;
  if (filters.section && row.section_type !== filters.section) return false;
  if (filters.letter && row.letter !== filters.letter) return false;
  if (filters.woman === true && !row.is_woman) return false;
  if (filters.woman === false && row.is_woman) return false;
  if (filters.marker && (row.entry_marker || 'none') !== filters.marker) return false;
  if (filters.entry_kind && row.entry_kind !== filters.entry_kind) return false;
  return true;
}

function parseFilters(query) {
  const qismRaw = query.qism;
  const qism = qismRaw === undefined || qismRaw === '' ? null : Number(qismRaw);
  const womanRaw = query.woman;
  let woman = null;
  if (womanRaw === '1' || womanRaw === 'true') woman = true;
  if (womanRaw === '0' || womanRaw === 'false') woman = false;
  const inText = query.in_text === '1' || query.in_text === 'true';
  const includeQism4 = query.include_qism4 === '1' || query.include_qism4 === 'true';
  return {
    q: typeof query.q === 'string' ? query.q.trim() : '',
    qism: Number.isFinite(qism) ? qism : null,
    section: typeof query.section === 'string' ? query.section : '',
    letter: typeof query.letter === 'string' ? query.letter : '',
    woman,
    marker: typeof query.marker === 'string' ? query.marker : '',
    entry_kind: typeof query.entry_kind === 'string' ? query.entry_kind : '',
    label: typeof query.label === 'string' ? query.label : '',
    nisba: typeof query.nisba === 'string' ? query.nisba : '',
    battle: typeof query.battle === 'string' ? query.battle : '',
    place: typeof query.place === 'string' ? query.place : '',
    authority: typeof query.authority === 'string' ? query.authority : '',
    in_text: inText,
    include_qism4: includeQism4,
    limit: Math.min(100, Math.max(1, Number(query.limit) || 40)),
    offset: Math.max(0, Number(query.offset) || 0),
  };
}

function decorateRow(row) {
  const nisba = Array.isArray(row.nisba)
    ? row.nisba
    : typeof row.nisba === 'string'
      ? JSON.parse(row.nisba || '[]')
      : [];
  return {
    person_id: row.person_id,
    entry_number: row.entry_number,
    display_name: row.display_name,
    full_name: row.full_name,
    kunya: row.kunya,
    nisba,
    is_woman: Boolean(row.is_woman),
    qism: row.qism,
    section_type: row.section_type,
    letter: row.letter,
    volume: row.volume,
    page_start: row.page_start,
    page_end: row.page_end,
    char_len: row.char_len,
    death_year_hijri: row.death_year_hijri,
    nasab_confidence: row.nasab_confidence,
    entry_number_is_ambiguous: Boolean(row.entry_number_is_ambiguous),
    entry_marker: row.entry_marker ?? null,
    entry_kind: row.entry_kind ?? null,
  };
}

function letterCounts(indexRows) {
  const counts = new Map();
  for (const row of indexRows) {
    counts.set(row.letter, (counts.get(row.letter) || 0) + 1);
  }
  return letterCountsFromMap(counts);
}

function letterCountsFromMap(counts) {
  const known = LETTER_ORDER.filter((letter) => counts.has(letter)).map((letter) => ({
    letter,
    count: counts.get(letter),
  }));
  const extra = [...counts.keys()]
    .filter((letter) => !LETTER_ORDER.includes(letter))
    .sort()
    .map((letter) => ({ letter, count: counts.get(letter) }));
  return [...known, ...extra];
}

/** Turn a user string into an FTS5 MATCH expression. Prefix last tokens. */
function ftsMatch(query, { inText = false } = {}) {
  const cleaned = String(query || '')
    .replace(/["'^:(){}]/g, ' ')
    .trim();
  const tokens = cleaned.split(/\s+/).filter((part) => part.length >= 1);
  if (!tokens.length) return null;
  const expr = tokens.map((token) => `${token}*`).join(' AND ');
  const columns = inText
    ? 'display_name full_name name_keys text_body'
    : 'display_name full_name name_keys';
  return `{${columns}} : (${expr})`;
}

function vocabLabel(kind, key) {
  if (!key) return key;
  const table = kind === 'authority' ? 'authorities' : kind === 'nisba' ? 'tribes' : `${kind}s`;
  const names = {
    battle: 'battles',
    place: 'places',
    nisba: 'tribes',
    label: 'labels',
    authority: 'authorities',
    event: 'events',
  };
  const vocabName = names[kind] || table;
  try {
    return vocab(vocabName).byKey.get(key)?.label_ar || key;
  } catch {
    return key;
  }
}

class Catalog {
  constructor() {
    this.ready = false;
    this.mode = 'jsonl';
    this.db = null;
  }

  load({ log = () => {} } = {}) {
    const started = Date.now();
    this.quality = readJsonIfPresent(PATHS.quality);
    this.graphReport = readJsonIfPresent(PATHS.graphReport);
    this.manifest = readJsonIfPresent(PATHS.manifest);
    this.facetsFile = readJsonIfPresent(PATHS.facets);
    this.rollups = readJsonIfPresent(PATHS.rollups);
    this.citationsReport = readJsonIfPresent(PATHS.citationsReport);

    if (fs.existsSync(PATHS.sqlite)) {
      this.db = openDb({ readOnly: true });
      this.mode = 'sqlite';
      this.letters = this.sqliteLetters();
      this.ready = true;
      log(`catalog ready in ${Date.now() - started}ms (sqlite)`);
      return this;
    }

    log('loading index…');
    this.indexRows = loadJsonl(PATHS.index);
    this.byId = new Map(this.indexRows.map((row) => [row.person_id, row]));
    this.byNumber = new Map();
    for (const row of this.indexRows) pushIndex(this.byNumber, row.entry_number, row);

    log('loading persons…');
    this.persons = new Map();
    for (const person of loadJsonl(PATHS.persons)) {
      this.persons.set(person.person_id, person);
    }

    log('indexing raw text…');
    this.rawText = indexJsonlBuffer(PATHS.rawText, (rec) => rec.person_id);

    log('loading graph…');
    this.edges = fs.existsSync(PATHS.edges) ? loadJsonl(PATHS.edges) : [];
    if (fs.existsSync(PATHS.genealogy)) this.edges.push(...loadJsonl(PATHS.genealogy));
    this.edgesFrom = new Map();
    this.edgesTo = new Map();
    for (const edge of this.edges) {
      pushIndex(this.edgesFrom, edge.from_person_id, edge);
      if (edge.to_person_id) pushIndex(this.edgesTo, edge.to_person_id, edge);
    }

    log('loading citations…');
    this.citations = fs.existsSync(PATHS.citations) ? loadJsonl(PATHS.citations) : [];
    this.citationsByPerson = new Map();
    for (const citation of this.citations) {
      pushIndex(this.citationsByPerson, citation.person_id, citation);
    }

    this.letters = letterCounts(this.indexRows);
    this.ready = true;
    log(`catalog ready in ${Date.now() - started}ms (${this.indexRows.length} persons, jsonl)`);
    return this;
  }

  sqliteCount(sql, params = {}) {
    return this.db.prepare(sql).get(params).n;
  }

  sqliteLetters() {
    const rows = this.db.prepare(
      'SELECT letter, COUNT(*) AS count FROM persons WHERE letter IS NOT NULL GROUP BY letter'
    ).all();
    const counts = new Map(rows.map((row) => [row.letter, row.count]));
    return letterCountsFromMap(counts);
  }

  meta() {
    const persons = this.db
      ? this.sqliteCount('SELECT COUNT(*) AS n FROM persons')
      : this.indexRows.length;
    const women = this.db
      ? this.sqliteCount('SELECT COUNT(*) AS n FROM persons WHERE is_woman = 1')
      : this.indexRows.filter((r) => r.is_woman).length;
    const edges = this.db
      ? this.sqliteCount("SELECT COUNT(*) AS n FROM neighbors WHERE source != 'genealogy'")
      : this.edges.filter((e) => e.source !== 'genealogy').length;
    const citations = this.db
      ? this.sqliteCount('SELECT COUNT(*) AS n FROM citations')
      : this.citations.length;

    return {
      book: BOOK,
      ready: this.ready,
      mode: this.mode,
      counts: {
        persons,
        women,
        edges,
        citations,
        letters: this.letters.length,
        chapters: this.db ? this.sqliteCount('SELECT COUNT(*) AS n FROM chapters') : 0,
      },
      qism: this.quality?.qism_distribution ?? null,
      sections: this.quality?.section_distribution ?? null,
      graph: this.graphReport
        ? {
            edges: this.graphReport.edges,
            resolved: this.graphReport.resolved,
            ambiguous: this.graphReport.ambiguous,
            unresolved: this.graphReport.unresolved,
            resolution_rate: this.graphReport.resolution_rate,
            resolution_rate_in_book: this.graphReport.resolution_rate_in_book,
            resolution_rate_narrators: this.graphReport.resolution_rate_narrators,
            by_type: this.graphReport.by_type,
            top_authorities: (this.graphReport.top_authorities || []).map((row) => ({
              ...row,
              label_ar: vocab('authorities').byKey.get(row.key)?.label_ar || row.key,
            })),
          }
        : null,
      quality: this.quality
        ? {
            nasab_rejection_rate: this.quality.nasab_rejection_rate,
            fill_rates: this.quality.fill_rates,
            layers: this.quality.layers,
            llm_fact_coverage: this.quality.llm_fact_coverage,
            evidence: this.quality.evidence,
            nasab_rejections: this.quality.nasab_rejections,
            women_count: this.quality.women_count,
            ambiguous_entry_numbers: this.quality.ambiguous_entry_numbers,
          }
        : null,
      manifest: this.manifest
        ? {
            entries: this.manifest.counts?.entries,
            chapters: this.manifest.counts?.chapters,
            pages: this.manifest.counts?.pages,
            coverage: this.manifest.page_coverage?.coverage_ratio,
            corpus_chars: this.manifest.corpus_chars,
            title: this.manifest.book?.title,
          }
        : null,
      letters: this.letters,
      facets: this.facetSummary(),
      featured: this.featured(),
    };
  }

  facetSummary() {
    return this.facetsFile?.facets || {};
  }

  featured() {
    const wanted = [10680, 4852, 7610, 503];
    if (this.db) {
      const stmt = this.db.prepare(`SELECT ${INDEX_COLUMNS} FROM persons WHERE entry_number = ? LIMIT 1`);
      return wanted.map((n) => stmt.get(n)).filter(Boolean).map(decorateRow);
    }
    return wanted
      .map((n) => this.byNumber.get(n)?.[0])
      .filter(Boolean)
      .map(decorateRow);
  }

  search(rawQuery) {
    const filters = parseFilters(rawQuery);
    const alias = LATIN_ALIASES[filters.q.toLowerCase()];
    const resolvedQuery = alias || filters.q;
    if (this.db) return this.searchSqlite(filters, resolvedQuery);
    return this.searchJsonl(filters, resolvedQuery);
  }

  searchJsonl(filters, resolvedQuery) {
    const needle = normalizeArabic(resolvedQuery);
    const asNumber = Number(filters.q);
    const hits = [];
    for (const row of this.indexRows) {
      if (!matchesFilters(row, filters)) continue;
      if (filters.label && !(row.labels || []).includes(filters.label)) continue;
      if (filters.nisba && !(row.nisba_keys || []).includes(filters.nisba)) continue;
      if (filters.battle && !(row.battle_keys || []).includes(filters.battle)) continue;
      if (filters.place && !(row.place_keys || []).includes(filters.place)) continue;
      if (!needle) {
        hits.push({ score: 4, row });
        continue;
      }
      const score = scoreHit(row, needle, filters.q);
      if (score == null && !(Number.isFinite(asNumber) && row.entry_number === asNumber)) continue;
      hits.push({ score: score ?? 0, row });
    }
    hits.sort((a, b) => a.score - b.score || a.row.entry_number - b.row.entry_number);
    const slice = hits.slice(filters.offset, filters.offset + filters.limit);
    return {
      query: filters.q,
      resolved_query: resolvedQuery,
      filters,
      total: hits.length,
      offset: filters.offset,
      results: slice.map((hit) => decorateRow(hit.row)),
    };
  }

  searchSqlite(filters, resolvedQuery) {
    const where = [];
    const params = {};
    if (filters.qism != null) {
      where.push('p.qism = @qism');
      params.qism = filters.qism;
    }
    if (filters.section) {
      where.push('p.section_type = @section');
      params.section = filters.section;
    }
    if (filters.letter) {
      where.push('p.letter = @letter');
      params.letter = filters.letter;
    }
    if (filters.woman === true) where.push('p.is_woman = 1');
    if (filters.woman === false) where.push('p.is_woman = 0');
    if (filters.marker) {
      where.push("COALESCE(p.entry_marker, 'none') = @marker");
      params.marker = filters.marker;
    }
    if (filters.entry_kind) {
      where.push('p.entry_kind = @entry_kind');
      params.entry_kind = filters.entry_kind;
    }

    const posting = (kind, key, param) => {
      if (!key) return;
      where.push(
        `p.person_id IN (SELECT person_id FROM postings WHERE kind = '${kind}' AND key = @${param})`
      );
      params[param] = key;
    };
    posting('label', filters.label, 'label');
    posting('nisba', filters.nisba, 'nisba');
    posting('battle', filters.battle, 'battle');
    posting('place', filters.place, 'place');
    posting('authority', filters.authority, 'authority');

    const rollupFilter = filters.battle || filters.place || filters.nisba;
    if (rollupFilter && filters.qism == null && !filters.include_qism4) {
      where.push('(p.qism IS NULL OR p.qism != 4)');
    }

    let from = 'persons p';
    let order = 'p.entry_number ASC';
    const asNumber = Number(filters.q);
    if (filters.q && /^\d+$/.test(filters.q) && Number.isFinite(asNumber)) {
      where.push('p.entry_number = @num');
      params.num = asNumber;
    } else if (filters.q) {
      const match = ftsMatch(resolvedQuery, { inText: filters.in_text });
      if (match) {
        from = 'persons p JOIN fts ON fts.person_id = p.person_id';
        where.push('fts MATCH @match');
        params.match = match;
        order = 'rank, p.entry_number';
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = this.db
      .prepare(`SELECT COUNT(*) AS n FROM ${from} ${whereSql}`)
      .get(params).n;
    const rows = this.db
      .prepare(
        `SELECT ${INDEX_COLUMNS_P} FROM ${from} ${whereSql} ORDER BY ${order} LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: filters.limit, offset: filters.offset });

    return {
      query: filters.q,
      resolved_query: resolvedQuery,
      filters,
      total: count,
      offset: filters.offset,
      in_text: filters.in_text,
      results: rows.map(decorateRow),
    };
  }

  person(needle) {
    if (!needle) return { error: 'missing id', status: 400 };
    const asNumber = Number(needle);
    if (/^\d+$/.test(needle) && Number.isFinite(asNumber)) {
      const rows = this.rowsByNumber(asNumber);
      if (rows.length === 0) return { error: `no entry ${needle}`, status: 404 };
      if (rows.length > 1) {
        return { ambiguous: true, entry_number: asNumber, candidates: rows.map(decorateRow) };
      }
      return this.personById(rows[0].person_id);
    }
    return this.personById(needle);
  }

  rowsByNumber(entryNumber) {
    if (this.db) {
      return this.db.prepare(`SELECT ${INDEX_COLUMNS} FROM persons WHERE entry_number = ?`).all(entryNumber);
    }
    return this.byNumber.get(entryNumber) || [];
  }

  indexRow(personId) {
    if (this.db) {
      return this.db.prepare(`SELECT ${INDEX_COLUMNS} FROM persons WHERE person_id = ?`).get(personId);
    }
    return this.byId.get(personId);
  }

  personById(personId) {
    let person;
    let row;
    if (this.db) {
      const rec = this.db.prepare('SELECT person_json FROM persons WHERE person_id = ?').get(personId);
      row = this.indexRow(personId);
      if (!rec || !row) return { error: `no person ${personId}`, status: 404 };
      person = JSON.parse(rec.person_json);
    } else {
      person = this.persons.get(personId);
      row = this.byId.get(personId);
      if (!person || !row) return { error: `no person ${personId}`, status: 404 };
    }

    const outgoing = this.edgesFor(personId, 'from');
    const incoming = this.edgesFor(personId, 'to');
    return {
      person,
      index: decorateRow(row),
      neighbors: this.neighborhood(personId),
      citations: this.citationsFor(personId),
      spans: this.spansFor(personId),
      edge_counts: {
        outgoing: outgoing.length,
        incoming: incoming.length,
        resolved: [...outgoing, ...incoming].filter((e) => e.resolved).length,
      },
    };
  }

  citationsFor(personId) {
    if (this.db) {
      return this.db.prepare('SELECT * FROM citations WHERE person_id = ?').all(personId);
    }
    return this.citationsByPerson.get(personId) || [];
  }

  spansFor(personId) {
    if (!this.db) return [];
    const { labelPassages, labelSentence } = require('../classify/spans');
    const raw = this.db.prepare('SELECT text_body FROM raw WHERE person_id = ?').get(personId);
    if (raw?.text_body) return labelPassages(personId, raw.text_body);
    return this.db
      .prepare(
        'SELECT start, end, label, quote, confidence FROM passage_labels WHERE person_id = ? ORDER BY start'
      )
      .all(personId)
      .map((row) => ({
        ...row,
        label: row.quote ? labelSentence(row.quote) : row.label,
      }));
  }

  edgesFor(personId, side) {
    if (this.db) {
      const col = side === 'from' ? 'from_person_id' : 'to_person_id';
      return this.db.prepare(`SELECT * FROM neighbors WHERE ${col} = ?`).all(personId).map((edge) => ({
        ...edge,
        resolved: Boolean(edge.resolved),
        ambiguous: Boolean(edge.ambiguous),
      }));
    }
    return side === 'from' ? this.edgesFrom.get(personId) || [] : this.edgesTo.get(personId) || [];
  }

  raw(personId) {
    if (this.db) {
      const rec = this.db.prepare('SELECT text_body, footnotes FROM raw WHERE person_id = ?').get(personId);
      if (!rec) return { error: `no raw text for ${personId}`, status: 404 };
      return {
        person_id: personId,
        text_body: rec.text_body || '',
        footnotes: rec.footnotes ? JSON.parse(rec.footnotes) : [],
      };
    }
    const rec = parseAt(this.rawText, personId);
    if (!rec) return { error: `no raw text for ${personId}`, status: 404 };
    return rec;
  }

  neighborhood(personId, { maxNodes = 28 } = {}) {
    const outgoing = this.edgesFor(personId, 'from');
    const incoming = this.edgesFor(personId, 'to');
    const nodes = new Map();
    const links = [];

    const addNode = (id, fallbackName) => {
      if (!id || nodes.has(id)) return;
      const row = this.indexRow(id);
      nodes.set(id, {
        person_id: id,
        display_name: row?.display_name || fallbackName || id,
        qism: row?.qism ?? null,
        is_woman: Boolean(row?.is_woman),
        entry_number: row?.entry_number ?? null,
      });
    };

    addNode(personId, this.indexRow(personId)?.display_name);

    const resolved = [];
    const unresolved = [];
    for (const edge of outgoing) {
      if (edge.resolved && edge.to_person_id) resolved.push({ edge, direction: 'out' });
      else unresolved.push(edge);
    }
    for (const edge of incoming) {
      if (edge.from_person_id === personId) continue;
      if (edge.resolved) resolved.push({ edge, direction: 'in' });
    }

    for (const { edge, direction } of resolved) {
      if (nodes.size >= maxNodes && !nodes.has(edge.to_person_id) && !nodes.has(edge.from_person_id)) {
        continue;
      }
      const otherId = direction === 'out' ? edge.to_person_id : edge.from_person_id;
      addNode(otherId, edge.to_literal);
      links.push({
        from: edge.from_person_id,
        to: edge.to_person_id,
        type: edge.type,
        relation: edge.relation,
        direction,
        resolved: true,
        source: edge.source,
        evidence: edge.evidence,
      });
    }

    return {
      center: personId,
      nodes: [...nodes.values()],
      links,
      unresolved: unresolved.slice(0, 40).map((edge) => ({
        type: edge.type,
        relation: edge.relation,
        to_literal: edge.to_literal,
        target_section: edge.target_section,
        target_qism: edge.target_qism,
        target_letter: edge.target_letter,
        ambiguous: edge.ambiguous,
        candidates: edge.candidates,
        evidence: edge.evidence,
        source: edge.source,
      })),
      unresolved_total: unresolved.length,
    };
  }

  postings(kind, { limit = 80, includeQism4 = false } = {}) {
    if (this.db) {
      const sql = includeQism4
        ? `SELECT key, COUNT(*) AS count FROM postings WHERE kind = ? GROUP BY key ORDER BY count DESC LIMIT ?`
        : `SELECT po.key, COUNT(*) AS count
           FROM postings po JOIN persons p ON p.person_id = po.person_id
           WHERE po.kind = ? AND (p.qism IS NULL OR p.qism != 4)
           GROUP BY po.key ORDER BY count DESC LIMIT ?`;
      return this.db.prepare(sql).all(kind, limit).map((row) => ({
        key: row.key,
        label_ar: vocabLabel(kind, row.key),
        count: row.count,
      }));
    }
    const facets = this.facetSummary();
    const map = facets[kind === 'nisba' ? 'nisba' : kind === 'battle' ? 'battle' : kind] || {};
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, count]) => ({ key, label_ar: vocabLabel(kind, key), count }));
  }

  chapters() {
    if (!this.db) return [];
    return this.db
      .prepare(
        'SELECT id, chapter_id, title, kind, lvl, start_id, end_id, char_len FROM chapters ORDER BY start_id, lvl, id'
      )
      .all();
  }

  chapter(id) {
    if (!this.db) return { error: 'sqlite required', status: 404 };
    const row = this.db.prepare('SELECT * FROM chapters WHERE id = ?').get(Number(id));
    if (!row) return { error: `no chapter ${id}`, status: 404 };
    return row;
  }
}

module.exports = {
  Catalog,
  LATIN_ALIASES,
  LETTER_ORDER,
  parseFilters,
  scoreHit,
  decorateRow,
  ftsMatch,
};
