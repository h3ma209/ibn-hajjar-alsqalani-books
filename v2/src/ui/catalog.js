'use strict';

const fs = require('fs');
const { PATHS, BOOK } = require('../config');
const { normalizeArabic } = require('../util/arabic');
const { vocab } = require('../vocab');

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

/**
 * Byte-offset index over a JSONL file. The raw-text corpus is 28 MB; keeping it
 * as a buffer and parsing one line on demand is cheaper than inflating 12k
 * extra objects at startup.
 */
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
  return true;
}

function parseFilters(query) {
  const qismRaw = query.qism;
  const qism = qismRaw === undefined || qismRaw === '' ? null : Number(qismRaw);
  const womanRaw = query.woman;
  let woman = null;
  if (womanRaw === '1' || womanRaw === 'true') woman = true;
  if (womanRaw === '0' || womanRaw === 'false') woman = false;
  return {
    q: typeof query.q === 'string' ? query.q.trim() : '',
    qism: Number.isFinite(qism) ? qism : null,
    section: typeof query.section === 'string' ? query.section : '',
    letter: typeof query.letter === 'string' ? query.letter : '',
    woman,
    limit: Math.min(100, Math.max(1, Number(query.limit) || 40)),
    offset: Math.max(0, Number(query.offset) || 0),
  };
}

function decorateRow(row) {
  return {
    person_id: row.person_id,
    entry_number: row.entry_number,
    display_name: row.display_name,
    full_name: row.full_name,
    kunya: row.kunya,
    nisba: row.nisba,
    is_woman: row.is_woman,
    qism: row.qism,
    section_type: row.section_type,
    letter: row.letter,
    volume: row.volume,
    page_start: row.page_start,
    page_end: row.page_end,
    char_len: row.char_len,
    death_year_hijri: row.death_year_hijri,
    nasab_confidence: row.nasab_confidence,
    entry_number_is_ambiguous: row.entry_number_is_ambiguous,
  };
}

function letterCounts(indexRows) {
  const counts = new Map();
  for (const row of indexRows) {
    counts.set(row.letter, (counts.get(row.letter) || 0) + 1);
  }
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

class Catalog {
  constructor() {
    this.ready = false;
  }

  load({ log = () => {} } = {}) {
    const started = Date.now();
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

    this.quality = readJsonIfPresent(PATHS.quality);
    this.graphReport = readJsonIfPresent(PATHS.graphReport);
    this.manifest = readJsonIfPresent(PATHS.manifest);
    this.letters = letterCounts(this.indexRows);
    this.ready = true;
    log(`catalog ready in ${Date.now() - started}ms (${this.indexRows.length} persons)`);
    return this;
  }

  meta() {
    return {
      book: BOOK,
      ready: this.ready,
      counts: {
        persons: this.indexRows.length,
        women: this.indexRows.filter((r) => r.is_woman).length,
        edges: this.edges.length,
        citations: this.citations.length,
        letters: this.letters.length,
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
      featured: this.featured(),
    };
  }

  featured() {
    const wanted = [10680, 4852, 7610, 503];
    return wanted
      .map((n) => this.byNumber.get(n)?.[0])
      .filter(Boolean)
      .map(decorateRow);
  }

  search(rawQuery) {
    const filters = parseFilters(rawQuery);
    const alias = LATIN_ALIASES[filters.q.toLowerCase()];
    const resolvedQuery = alias || filters.q;
    const needle = normalizeArabic(resolvedQuery);
    const asNumber = Number(filters.q);

    const hits = [];
    for (const row of this.indexRows) {
      if (!matchesFilters(row, filters)) continue;
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

  person(needle) {
    if (!needle) return { error: 'missing id', status: 400 };
    const asNumber = Number(needle);
    if (/^\d+$/.test(needle) && Number.isFinite(asNumber)) {
      const rows = this.byNumber.get(asNumber) || [];
      if (rows.length === 0) return { error: `no entry ${needle}`, status: 404 };
      if (rows.length > 1) {
        return {
          ambiguous: true,
          entry_number: asNumber,
          candidates: rows.map(decorateRow),
        };
      }
      return this.personById(rows[0].person_id);
    }
    return this.personById(needle);
  }

  personById(personId) {
    const person = this.persons.get(personId);
    const row = this.byId.get(personId);
    if (!person || !row) return { error: `no person ${personId}`, status: 404 };

    const outgoing = this.edgesFrom.get(personId) || [];
    const incoming = this.edgesTo.get(personId) || [];
    return {
      person,
      index: decorateRow(row),
      neighbors: this.neighborhood(personId),
      citations: this.citationsByPerson.get(personId) || [],
      edge_counts: {
        outgoing: outgoing.length,
        incoming: incoming.length,
        resolved: [...outgoing, ...incoming].filter((e) => e.resolved).length,
      },
    };
  }

  raw(personId) {
    const rec = parseAt(this.rawText, personId);
    if (!rec) return { error: `no raw text for ${personId}`, status: 404 };
    return rec;
  }

  neighborhood(personId, { maxNodes = 28 } = {}) {
    const outgoing = this.edgesFrom.get(personId) || [];
    const incoming = this.edgesTo.get(personId) || [];
    const nodes = new Map();
    const links = [];

    const addNode = (id, fallbackName) => {
      if (!id || nodes.has(id)) return;
      const row = this.byId.get(id);
      nodes.set(id, {
        person_id: id,
        display_name: row?.display_name || fallbackName || id,
        qism: row?.qism ?? null,
        is_woman: row?.is_woman ?? false,
        entry_number: row?.entry_number ?? null,
      });
    };

    addNode(personId, this.byId.get(personId)?.display_name);

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
      })),
      unresolved_total: unresolved.length,
    };
  }
}

module.exports = {
  Catalog,
  LATIN_ALIASES,
  LETTER_ORDER,
  parseFilters,
  scoreHit,
  decorateRow,
};
