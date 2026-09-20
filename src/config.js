'use strict';

const fs = require('fs');
const path = require('path');

const CODE_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(CODE_ROOT, '..');
const DATA_ROOT = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : path.join(WORKSPACE_ROOT, 'data');

try {
  process.loadEnvFile(path.join(CODE_ROOT, '.env'));
} catch {
  // No .env present. Env vars may still come from the shell.
}

const DATA_DIR = path.join(DATA_ROOT, 'v2', 'corpus');
const REPORTS_DIR = path.join(DATA_ROOT, 'v2', 'reports');
const SOURCE_DIR = path.join(DATA_ROOT, 'source', 'isabah');
const SAMPLES_DIR = path.join(CODE_ROOT, 'samples');
const SCHEMA_DIR = path.join(CODE_ROOT, 'schema');
const PROMPTS_DIR = path.join(CODE_ROOT, 'prompts');
const VOCAB_DIR = path.join(CODE_ROOT, 'vocab');

const SCHEMA_VERSION = '2.0.0';

/** Book identity. The slug is the namespace half of every person_id. */
const BOOK = {
  slug: 'isabah',
  expected_book_id: 9767,
  title_ar: 'الإصابة في تمييز الصحابة',
  title_en: 'al-Isabah fi Tamyiz al-Sahabah',
  author_ar: 'ابن حجر العسقلاني',
};

const PATHS = {
  CODE_ROOT,
  WORKSPACE_ROOT,
  DATA_ROOT,
  SOURCE_DIR,
  DATA_DIR,
  REPORTS_DIR,
  SAMPLES_DIR,
  SCHEMA_DIR,
  PROMPTS_DIR,
  VOCAB_DIR,
  rawText: path.join(DATA_DIR, 'raw-text.jsonl'),
  placement: path.join(DATA_DIR, 'placement.jsonl'),
  persons: path.join(DATA_DIR, 'persons.jsonl'),
  index: path.join(DATA_DIR, 'index.jsonl'),
  edges: path.join(DATA_DIR, 'edges.jsonl'),
  citations: path.join(DATA_DIR, 'citations.jsonl'),
  chapters: path.join(DATA_DIR, 'chapters.jsonl'),
  llmFacts: path.join(DATA_DIR, 'llm-facts.jsonl'),
  llmProgress: path.join(DATA_DIR, 'llm-progress.jsonl'),
  llmCache: path.join(DATA_ROOT, 'v2', 'llm-cache'),
  manifest: path.join(DATA_DIR, 'manifest.json'),
  quality: path.join(REPORTS_DIR, 'quality.json'),
  graphReport: path.join(REPORTS_DIR, 'graph.json'),
  qualityBaseline: path.join(CODE_ROOT, 'reports-baseline', 'quality.json'),
  llmUsage: path.join(REPORTS_DIR, 'llm-usage.json'),
};

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const LLM = {
  apiKey: process.env.OPENAI_API_KEY || null,
  baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  model: process.env.LLM_MODEL || 'gpt-4o-mini',
  concurrency: Math.max(1, num(process.env.LLM_CONCURRENCY, 8)),
  /** p90 completion is ~630 tokens; 2048 leaves headroom without slowing generation. */
  maxTokens: Math.max(256, num(process.env.LLM_MAX_TOKENS, 2048)),
  maxCostUsd: num(process.env.LLM_MAX_COST, 15),
  priceInputPerMTok: num(process.env.LLM_PRICE_INPUT_PER_MTOK, 0.15),
  priceOutputPerMTok: num(process.env.LLM_PRICE_OUTPUT_PER_MTOK, 0.6),
  /**
   * Every request repeats the same ~2.1k-token instruction prefix, which the
   * provider serves from its own prompt cache at a discount. Pricing those at the
   * full input rate overstates the bill roughly twofold and makes the budget
   * guard stop less than halfway through its allowance.
   */
  priceCachedInputPerMTok: num(
    process.env.LLM_PRICE_CACHED_INPUT_PER_MTOK,
    num(process.env.LLM_PRICE_INPUT_PER_MTOK, 0.15) / 2
  ),
};

/**
 * Locate the Shamela .bok. Explicit path wins, then BOK_PATH, then data/source/isabah.
 */
function findBok(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.BOK_PATH) candidates.push(process.env.BOK_PATH);

  for (const c of candidates) {
    const resolved = path.isAbsolute(c) ? c : path.resolve(CODE_ROOT, c);
    if (fs.existsSync(resolved)) return resolved;
    throw new Error(`Book file not found: ${resolved}`);
  }

  for (const dir of [SOURCE_DIR, CODE_ROOT, WORKSPACE_ROOT]) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.bok'))
      .sort()[0];
    if (hit) return path.join(dir, hit);
  }

  throw new Error(
    `No .bok found in ${SOURCE_DIR}. Pass --bok <path>, set BOK_PATH, or place the book in data/source/isabah/.`
  );
}

function ensureDirs() {
  for (const dir of [DATA_DIR, REPORTS_DIR, PATHS.llmCache]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = {
  SCHEMA_VERSION,
  BOOK,
  PATHS,
  LLM,
  findBok,
  ensureDirs,
};
