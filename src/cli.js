#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { PATHS, LLM, SCHEMA_VERSION } = require('./config');
const { readJsonl, loadJsonl, writeJson } = require('./util/jsonl');
const { normalizeArabic } = require('./util/arabic');
const { checkValid } = require('./schema/validate');
const { PERSON_ID_PATTERN } = require('./bok/entries');
const { compareToBaseline } = require('./report/quality');
const { ingest } = require('./pipeline/ingest');
const { build } = require('./pipeline/build');
const { extract } = require('./pipeline/extract');
const { graph } = require('./pipeline/graph');

const log = (message) => process.stderr.write(`${message}\n`);
const out = (data) => process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);

/** Convenience transliterations so common names are reachable without an Arabic keyboard. */
const LATIN_ALIASES = {
  'abu huraira': 'أبو هريرة',
  'abu hurayra': 'أبو هريرة',
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

function parseArgs(argv) {
  const args = { command: argv[0] ?? null, positional: [], flags: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args.positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args.flags[name] = true;
    } else {
      args.flags[name] = next;
      i += 1;
    }
  }
  return args;
}

function intFlag(flags, name, fallback = 0) {
  const value = flags[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireArtifact(filePath, hint) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${path.basename(filePath)}. ${hint}`);
  }
}

function help() {
  process.stdout.write(`al-Isabah corpus pipeline (schema ${SCHEMA_VERSION})

Pipeline
  ingest [--bok <path>] [--limit n]   Decode the .bok into raw-text/placement/chapters JSONL
  extract [options]                    Run LLM extraction into llm-facts.jsonl
  build [--no-llm] [--limit n]         Assemble persons.jsonl + index.jsonl + quality report
  graph                                Resolve cross-references into edges.jsonl + citations.jsonl

Verification
  validate                             Re-validate every artifact against its schema
  gate [--update-baseline]             Fail if fill rates regressed against the baseline
  stats                                Print the current quality report
  samples                              Refresh committed sample records

Query
  get <entry-number|person_id> [--text]
  search <query> [--limit n]
  ui [--port n]                        Local web UI on 127.0.0.1 (default 4173)

extract options
  --limit n           Cap how many entries to process
  --stratified n      Pilot on n entries spread across qism, section, and length
  --numbers 1,2,3     Only these entry numbers
  --model <name>      Override LLM_MODEL
  --max-cost <usd>    Override LLM_MAX_COST
  --concurrency n     Override LLM_CONCURRENCY
  --dry-run           Print the cost estimate and exit
  --no-resume         Re-extract entries that already succeeded
  --no-cache          Ignore the on-disk response cache

Environment: copy .env.example to .env for OPENAI_API_KEY, OPENAI_BASE_URL, LLM_MODEL.
`);
}

async function cmdIngest(args) {
  const manifest = await ingest({
    bokPath: typeof args.flags.bok === 'string' ? args.flags.bok : null,
    limit: intFlag(args.flags, 'limit'),
    log,
  });
  log(`manifest written to ${PATHS.manifest}`);
  out({
    entries: manifest.counts.entries,
    chapters: manifest.counts.chapters,
    ambiguous_entry_numbers: manifest.counts.ambiguous_entry_numbers,
    page_coverage: manifest.page_coverage.coverage_ratio,
    corpus_chars: manifest.corpus_chars,
    book_sha256: manifest.book.file_sha256,
  });
}

async function cmdBuild(args) {
  requireArtifact(PATHS.rawText, 'Run `npm run ingest` first.');
  const report = await build({
    useLlm: args.flags['no-llm'] !== true,
    limit: intFlag(args.flags, 'limit'),
    log,
  });
  out({
    total_persons: report.total_persons,
    layers: report.layers,
    llm_fact_coverage: report.llm_fact_coverage,
    nasab_rejection_rate: report.nasab_rejection_rate,
    fill_rates: Object.fromEntries(
      Object.entries(report.fill_rates).map(([field, value]) => [field, value.rate])
    ),
  });
}

async function cmdExtract(args) {
  requireArtifact(PATHS.rawText, 'Run `npm run ingest` first.');
  const numbers = typeof args.flags.numbers === 'string'
    ? args.flags.numbers.split(',').map((n) => Number(n.trim())).filter(Number.isFinite)
    : null;

  const clientOptions = {};
  if (typeof args.flags.model === 'string') clientOptions.model = args.flags.model;
  if (args.flags['max-cost'] !== undefined) {
    clientOptions.maxCostUsd = intFlag(args.flags, 'max-cost', LLM.maxCostUsd);
  }
  if (args.flags.concurrency !== undefined) {
    clientOptions.concurrency = intFlag(args.flags, 'concurrency', LLM.concurrency);
  }

  const result = await extract({
    limit: intFlag(args.flags, 'limit'),
    stratified: intFlag(args.flags, 'stratified'),
    numbers,
    resume: args.flags['no-resume'] !== true,
    dryRun: args.flags['dry-run'] === true,
    useCache: args.flags['no-cache'] !== true,
    clientOptions,
    log,
  });
  out({
    estimate: result.estimate,
    processed: result.processed,
    failures: result.failures,
    cost_usd: result.usage.cost_usd,
    cache_hits: result.usage.cache_hits,
    budget_exhausted: Boolean(result.budget_exhausted),
  });
}

async function cmdGraph() {
  requireArtifact(PATHS.persons, 'Run `npm run build` first.');
  const report = await graph({ log });
  out({
    edges: report.edges,
    resolution_rate: report.resolution_rate,
    ambiguous: report.ambiguous,
    unresolved: report.unresolved,
    by_type: report.by_type,
    citations: report.citations,
    top_authorities: report.top_authorities.slice(0, 10),
  });
}

const VALIDATE_TARGETS = [
  ['rawText', () => PATHS.rawText],
  ['person', () => PATHS.persons],
  ['edge', () => PATHS.edges],
  ['citation', () => PATHS.citations],
];

async function cmdValidate() {
  const results = {};
  let failed = 0;

  for (const [kind, getPath] of VALIDATE_TARGETS) {
    const filePath = getPath();
    if (!fs.existsSync(filePath)) {
      results[kind] = { skipped: true, reason: 'artifact not present' };
      continue;
    }
    let checked = 0;
    const errors = [];
    for await (const record of readJsonl(filePath)) {
      checked += 1;
      const problem = checkValid(kind, record);
      if (problem && errors.length < 5) errors.push(problem);
      if (problem) failed += 1;
    }
    results[kind] = { file: path.basename(filePath), checked, invalid: errors.length ? errors : 0 };
    log(`${kind}: checked ${checked}${errors.length ? `, ${errors.length} shown of failures` : ', all valid'}`);
  }

  out({ status: failed ? 'fail' : 'pass', results });
  if (failed) process.exitCode = 1;
}

async function cmdGate(args) {
  requireArtifact(PATHS.quality, 'Run `npm run build` first.');
  const report = JSON.parse(fs.readFileSync(PATHS.quality, 'utf8'));

  if (args.flags['update-baseline']) {
    writeJson(PATHS.qualityBaseline, report);
    log(`baseline updated at ${PATHS.qualityBaseline}`);
    out({ status: 'baseline_updated', total_persons: report.total_persons });
    return;
  }

  const comparison = compareToBaseline(report, PATHS.qualityBaseline);
  if (comparison.status === 'no_baseline') {
    log('no baseline recorded yet; run `node src/cli.js gate --update-baseline` to set one');
  }
  for (const regression of comparison.regressions) {
    log(
      `regression: ${regression.field} ${regression.baseline} -> ${regression.current} (${regression.delta})`
    );
  }
  out(comparison);
  if (comparison.status === 'fail') process.exitCode = 1;
}

async function cmdStats() {
  requireArtifact(PATHS.quality, 'Run `npm run build` first.');
  const report = JSON.parse(fs.readFileSync(PATHS.quality, 'utf8'));
  const graphReport = fs.existsSync(PATHS.graphReport)
    ? JSON.parse(fs.readFileSync(PATHS.graphReport, 'utf8'))
    : null;
  const manifest = fs.existsSync(PATHS.manifest)
    ? JSON.parse(fs.readFileSync(PATHS.manifest, 'utf8'))
    : null;

  out({
    book: manifest ? { title: manifest.book.title, sha256: manifest.book.file_sha256 } : null,
    total_persons: report.total_persons,
    layers: report.layers,
    qism_distribution: report.qism_distribution,
    section_distribution: report.section_distribution,
    women_count: report.women_count,
    ambiguous_entry_numbers: report.ambiguous_entry_numbers,
    nasab_rejection_rate: report.nasab_rejection_rate,
    evidence: report.evidence,
    fill_rates: Object.fromEntries(
      Object.entries(report.fill_rates).map(([field, value]) => [field, value.rate])
    ),
    graph: graphReport
      ? {
          edges: graphReport.edges,
          resolution_rate: graphReport.resolution_rate,
          citations: graphReport.citations,
        }
      : null,
  });
}

async function findPerson(needle) {
  const isPersonId = new RegExp(PERSON_ID_PATTERN).test(needle);
  const wantedNumber = Number(needle);
  for await (const person of readJsonl(PATHS.persons)) {
    if (isPersonId ? person.person_id === needle : person.entry.number === wantedNumber) {
      return person;
    }
  }
  return null;
}

async function cmdGet(args) {
  requireArtifact(PATHS.persons, 'Run `npm run build` first.');
  const needle = args.positional[0];
  if (!needle) throw new Error('Usage: get <entry-number|person_id> [--text]');

  const person = await findPerson(needle);
  if (!person) throw new Error(`No entry found for "${needle}"`);

  const payload = { person };
  if (args.flags.text) {
    for await (const raw of readJsonl(PATHS.rawText)) {
      if (raw.person_id === person.person_id) {
        payload.raw_text = raw;
        break;
      }
    }
  }
  out(payload);
}

async function cmdSearch(args) {
  requireArtifact(PATHS.index, 'Run `npm run build` first.');
  const rawQuery = args.positional.join(' ').trim();
  if (!rawQuery) throw new Error('Usage: search <query> [--limit n]');

  const alias = LATIN_ALIASES[rawQuery.toLowerCase()];
  const query = normalizeArabic(alias || rawQuery);
  const limit = intFlag(args.flags, 'limit', 20);

  const hits = [];
  for await (const row of readJsonl(PATHS.index)) {
    const haystacks = [row.display_name_norm, row.full_name_norm].filter(Boolean);
    if (String(row.entry_number) === rawQuery.trim()) {
      hits.push({ score: 0, row });
      continue;
    }
    const exact = haystacks.some((h) => h === query);
    const starts = haystacks.some((h) => h.startsWith(query));
    const contains = haystacks.some((h) => h.includes(query));
    if (!contains) continue;
    hits.push({ score: exact ? 0 : starts ? 1 : 2, row });
  }

  hits.sort((a, b) => a.score - b.score || a.row.entry_number - b.row.entry_number);
  out({
    query: rawQuery,
    resolved_query: alias || rawQuery,
    count: Math.min(hits.length, limit),
    total_matches: hits.length,
    results: hits.slice(0, limit).map((hit) => hit.row),
  });
}

/** Entries chosen to cover the range of shapes a reviewer should be able to eyeball. */
const SAMPLE_ENTRIES = [
  { number: 10680, label: 'long-kunya-section' },
  { number: 4852, label: 'long-names-section' },
  { number: 7610, label: 'short-stub' },
];

async function cmdSamples() {
  requireArtifact(PATHS.persons, 'Run `npm run build` first.');
  fs.mkdirSync(PATHS.SAMPLES_DIR, { recursive: true });

  const wanted = new Map(SAMPLE_ENTRIES.map((s) => [s.number, s.label]));
  const written = [];

  for await (const person of readJsonl(PATHS.persons)) {
    const label = wanted.get(person.entry.number);
    if (!label) continue;
    const file = path.join(PATHS.SAMPLES_DIR, `${label}-${person.entry.number}.json`);
    writeJson(file, person);
    written.push(path.basename(file));
  }

  // One qism 4 entry, whichever comes first, to show a rejected attribution.
  for await (const person of readJsonl(PATHS.persons)) {
    if (person.classification.qism !== 4) continue;
    const file = path.join(PATHS.SAMPLES_DIR, `qism4-${person.entry.number}.json`);
    writeJson(file, person);
    written.push(path.basename(file));
    break;
  }

  out({ samples_dir: PATHS.SAMPLES_DIR, written });
}

async function cmdUi(args) {
  requireArtifact(PATHS.index, 'Run `npm run pipeline` first.');
  const { startUi } = require('./ui/server');
  const port = intFlag(args.flags, 'port', Number(process.env.UI_PORT) || 4173);
  await startUi({ port, log });
  await new Promise(() => {});
}

const COMMANDS = {
  ingest: cmdIngest,
  build: cmdBuild,
  structural: cmdBuild,
  extract: cmdExtract,
  graph: cmdGraph,
  validate: cmdValidate,
  gate: cmdGate,
  stats: cmdStats,
  get: cmdGet,
  search: cmdSearch,
  samples: cmdSamples,
  ui: cmdUi,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === 'help' || args.flags.help) {
    help();
    process.exitCode = args.command ? 0 : 1;
    return;
  }
  const handler = COMMANDS[args.command];
  if (!handler) {
    help();
    throw new Error(`Unknown command: ${args.command}`);
  }
  await handler(args);
}

if (require.main === module) {
  main().catch((err) => {
    log(`error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, COMMANDS };
