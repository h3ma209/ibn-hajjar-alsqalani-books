'use strict';

const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const { PATHS, ensureDirs, SCHEMA_VERSION } = require('../config');
const { readJsonl } = require('../util/jsonl');

const SCHEMA_SQL = `
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
PRAGMA foreign_keys = OFF;

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE persons (
  person_id TEXT PRIMARY KEY,
  entry_number INTEGER NOT NULL,
  display_name TEXT,
  display_name_norm TEXT,
  full_name TEXT,
  full_name_norm TEXT,
  kunya TEXT,
  nisba TEXT,
  is_woman INTEGER NOT NULL DEFAULT 0,
  qism INTEGER,
  section_type TEXT,
  letter TEXT,
  volume TEXT,
  page_start INTEGER,
  page_end INTEGER,
  char_len INTEGER,
  death_year_hijri INTEGER,
  nasab_confidence REAL,
  entry_number_is_ambiguous INTEGER NOT NULL DEFAULT 0,
  entry_marker TEXT,
  entry_kind TEXT,
  length_class TEXT,
  person_json TEXT NOT NULL
);

CREATE TABLE raw (
  person_id TEXT PRIMARY KEY,
  text_body TEXT,
  footnotes TEXT
);

CREATE VIRTUAL TABLE fts USING fts5(
  person_id UNINDEXED,
  display_name,
  full_name,
  name_keys,
  text_body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE postings (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  person_id TEXT NOT NULL,
  extra TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (kind, key, person_id, extra)
);

CREATE TABLE passage_labels (
  person_id TEXT NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  label TEXT NOT NULL,
  quote TEXT,
  confidence REAL
);
CREATE INDEX idx_passage_person ON passage_labels(person_id);
CREATE INDEX idx_passage_label ON passage_labels(label);

CREATE TABLE events (
  person_id TEXT NOT NULL,
  kind TEXT,
  key TEXT,
  year_hijri INTEGER,
  place TEXT,
  value TEXT
);
CREATE INDEX idx_events_kind ON events(kind, key);

CREATE TABLE neighbors (
  from_person_id TEXT NOT NULL,
  to_person_id TEXT,
  to_literal TEXT,
  type TEXT NOT NULL,
  relation TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  ambiguous INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  evidence TEXT
);
CREATE INDEX idx_neighbors_from ON neighbors(from_person_id);
CREATE INDEX idx_neighbors_to ON neighbors(to_person_id);

CREATE TABLE citations (
  person_id TEXT NOT NULL,
  authority TEXT,
  authority_key TEXT,
  verb TEXT,
  evidence TEXT
);
CREATE INDEX idx_citations_person ON citations(person_id);
CREATE INDEX idx_citations_auth ON citations(authority_key);

CREATE TABLE chapters (
  id INTEGER PRIMARY KEY,
  chapter_id TEXT,
  title TEXT,
  kind TEXT,
  lvl INTEGER,
  start_id INTEGER,
  end_id INTEGER,
  char_len INTEGER,
  text TEXT
);

CREATE INDEX idx_persons_number ON persons(entry_number);
CREATE INDEX idx_persons_qism ON persons(qism);
CREATE INDEX idx_persons_letter ON persons(letter);
CREATE INDEX idx_persons_kind ON persons(entry_kind);
CREATE INDEX idx_persons_section ON persons(section_type);
CREATE INDEX idx_postings_kind_key ON postings(kind, key);
`;

function exists(filePath) {
  return fs.existsSync(filePath);
}

function insertPosting(stmt, kind, key, personId, extra = '') {
  if (!key || !personId) return;
  stmt.run(kind, String(key), personId, extra || '');
}

/**
 * Pack JSONL into corpus.sqlite so search and browse do not load 60MB of
 * objects into RAM. FTS5 covers names and biography text.
 */
async function buildDb({ log = () => {} } = {}) {
  ensureDirs();
  if (!exists(PATHS.persons) || !exists(PATHS.index)) {
    throw new Error('Missing persons/index. Run `npm run build` first.');
  }

  const tmpPath = `${PATHS.sqlite}.tmp`;
  fs.rmSync(tmpPath, { force: true });
  fs.rmSync(PATHS.sqlite, { force: true });

  const db = new DatabaseSync(tmpPath);
  db.exec(SCHEMA_SQL);

  const insertPerson = db.prepare(`
    INSERT INTO persons (
      person_id, entry_number, display_name, display_name_norm, full_name, full_name_norm,
      kunya, nisba, is_woman, qism, section_type, letter, volume, page_start, page_end,
      char_len, death_year_hijri, nasab_confidence, entry_number_is_ambiguous,
      entry_marker, entry_kind, length_class, person_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  const insertRaw = db.prepare('INSERT INTO raw (person_id, text_body, footnotes) VALUES (?, ?, ?)');
  const insertFts = db.prepare(
    'INSERT INTO fts (person_id, display_name, full_name, name_keys, text_body) VALUES (?, ?, ?, ?, ?)'
  );
  const insertPostingStmt = db.prepare(
    'INSERT OR IGNORE INTO postings (kind, key, person_id, extra) VALUES (?, ?, ?, ?)'
  );
  const insertSpan = db.prepare(
    'INSERT INTO passage_labels (person_id, start, end, label, quote, confidence) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertEvent = db.prepare(
    'INSERT INTO events (person_id, kind, key, year_hijri, place, value) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertNeighbor = db.prepare(
    'INSERT INTO neighbors (from_person_id, to_person_id, to_literal, type, relation, resolved, ambiguous, source, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertCitation = db.prepare(
    'INSERT INTO citations (person_id, authority, authority_key, verb, evidence) VALUES (?, ?, ?, ?, ?)'
  );
  const insertChapter = db.prepare(
    'INSERT INTO chapters (chapter_id, title, kind, lvl, start_id, end_id, char_len, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');

  const rawById = new Map();
  if (exists(PATHS.rawText)) {
    for await (const raw of readJsonl(PATHS.rawText)) {
      rawById.set(raw.person_id, raw);
    }
  }
  log(`db loaded ${rawById.size} raw texts`);

  db.exec('BEGIN');

  let persons = 0;
  for await (const person of readJsonl(PATHS.persons)) {
    const identity = person.identity || {};
    const nasab = identity.nasab || {};
    const classification = person.classification || {};
    const entry = person.entry || {};
    insertPerson.run(
      person.person_id,
      entry.number ?? null,
      identity.display_name ?? null,
      identity.display_name_norm ?? null,
      nasab.full_name ?? null,
      nasab.full_name_norm ?? null,
      identity.kunya ?? null,
      JSON.stringify(nasab.nisba || []),
      identity.is_woman ? 1 : 0,
      classification.qism ?? null,
      classification.section_type ?? null,
      classification.letter ?? null,
      entry.volume ?? null,
      entry.page_start ?? null,
      entry.page_end ?? null,
      entry.char_len ?? null,
      person.life?.death?.year_hijri ?? null,
      nasab.confidence ?? null,
      entry.number_is_ambiguous ? 1 : 0,
      entry.marker ?? null,
      entry.kind ?? classification.entry_kind ?? null,
      entry.length_class ?? null,
      JSON.stringify(person)
    );
    persons += 1;
  }
  log(`db wrote ${persons} persons`);

  let indexRows = 0;
  for await (const row of readJsonl(PATHS.index)) {
    indexRows += 1;
    const raw = rawById.get(row.person_id);
    const text = raw?.text_body || raw?.text || '';
    insertRaw.run(row.person_id, text, JSON.stringify(raw?.footnotes || []));
    insertFts.run(
      row.person_id,
      row.display_name || '',
      row.full_name || '',
      (row.name_keys || []).join(' '),
      text
    );

    insertPosting(insertPostingStmt, 'entry_kind', row.entry_kind, row.person_id);
    insertPosting(insertPostingStmt, 'marker', row.entry_marker || 'none', row.person_id);
    for (const key of row.nisba_keys || []) insertPosting(insertPostingStmt, 'nisba', key, row.person_id);
    for (const key of row.battle_keys || []) insertPosting(insertPostingStmt, 'battle', key, row.person_id);
    for (const key of row.event_keys || []) insertPosting(insertPostingStmt, 'event', key, row.person_id);
    for (const key of row.place_keys || []) insertPosting(insertPostingStmt, 'place', key, row.person_id);
    for (const key of row.labels || []) insertPosting(insertPostingStmt, 'label', key, row.person_id);
  }
  log(`db indexed ${indexRows} rows + FTS`);

  if (exists(PATHS.passageLabels)) {
    let spans = 0;
    for await (const row of readJsonl(PATHS.passageLabels)) {
      insertSpan.run(row.person_id, row.start, row.end, row.label, row.quote || null, row.confidence ?? null);
      spans += 1;
    }
    log(`db wrote ${spans} passage labels`);
  }

  if (exists(PATHS.events)) {
    let events = 0;
    for await (const row of readJsonl(PATHS.events)) {
      insertEvent.run(row.person_id, row.kind, row.key, row.year_hijri ?? null, row.place ?? null, row.value ?? null);
      events += 1;
    }
    log(`db wrote ${events} events`);
  }

  const addNeighbor = (edge, source) => {
    insertNeighbor.run(
      edge.from_person_id,
      edge.to_person_id ?? null,
      edge.to_literal ?? null,
      edge.type,
      edge.relation ?? null,
      edge.resolved ? 1 : 0,
      edge.ambiguous ? 1 : 0,
      source,
      edge.evidence ?? null
    );
  };

  let neighborCount = 0;
  if (exists(PATHS.edges)) {
    for await (const edge of readJsonl(PATHS.edges)) {
      addNeighbor(edge, edge.source || 'edge');
      neighborCount += 1;
    }
  }
  if (exists(PATHS.genealogy)) {
    for await (const edge of readJsonl(PATHS.genealogy)) {
      addNeighbor(edge, 'genealogy');
      neighborCount += 1;
    }
  }
  log(`db wrote ${neighborCount} neighbors`);

  let citationCount = 0;
  if (exists(PATHS.citations)) {
    for await (const row of readJsonl(PATHS.citations)) {
      insertCitation.run(
        row.person_id,
        row.authority,
        row.authority_key ?? null,
        row.verb ?? null,
        row.evidence ?? null
      );
      insertPosting(insertPostingStmt, 'authority', row.authority_key || row.authority, row.person_id, row.verb || '');
      citationCount += 1;
    }
  }
  log(`db wrote ${citationCount} citations`);

  let chapterCount = 0;
  if (exists(PATHS.chapters)) {
    for await (const row of readJsonl(PATHS.chapters)) {
      insertChapter.run(
        row.chapter_id,
        row.title,
        row.kind,
        row.lvl ?? null,
        row.start_id ?? null,
        row.end_id ?? null,
        row.char_len ?? 0,
        row.text || ''
      );
      chapterCount += 1;
    }
  }

  insertMeta.run('schema_version', SCHEMA_VERSION);
  insertMeta.run('built_at', new Date().toISOString());
  insertMeta.run('persons', String(persons));
  insertMeta.run('citations', String(citationCount));
  insertMeta.run('chapters', String(chapterCount));
  db.exec('COMMIT');
  db.close();

  fs.renameSync(tmpPath, PATHS.sqlite);
  const bytes = fs.statSync(PATHS.sqlite).size;
  log(`wrote ${PATHS.sqlite} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  return { path: PATHS.sqlite, persons, citations: citationCount, chapters: chapterCount, bytes };
}

function openDb({ readOnly = true } = {}) {
  if (!exists(PATHS.sqlite)) return null;
  return new DatabaseSync(PATHS.sqlite, { readOnly });
}

module.exports = { buildDb, openDb, SCHEMA_SQL };
