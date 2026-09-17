'use strict';

const fs = require('fs');
const path = require('path');

const { PATHS } = require('../config');
const { sha256 } = require('../util/hash');
const { normalizeArabic, flatten, verificationKey } = require('../util/arabic');
const { QISM_LABEL } = require('../structure/placement');

/**
 * LLM biographical extraction.
 *
 * Long entries are split on paragraph boundaries and merged back, because a
 * single request over a 27,000-character entry both risks truncation and
 * degrades recall on the tail.
 */

const PROMPT_FILE = 'bio-extract.v1.md';
const CHUNK_CHAR_LIMIT = 9000;
const MAX_CHUNKS = 8;

let cachedPrompt = null;

function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const file = path.join(PATHS.PROMPTS_DIR, PROMPT_FILE);
  const text = fs.readFileSync(file, 'utf8');
  cachedPrompt = {
    text,
    version: `${PROMPT_FILE}@${sha256(text).slice(0, 12)}`,
  };
  return cachedPrompt;
}

function loadOutputSchema() {
  return JSON.parse(
    fs.readFileSync(path.join(PATHS.SCHEMA_DIR, 'llm-bio.schema.json'), 'utf8')
  );
}

/** Split on blank lines, packing paragraphs up to the chunk limit. */
function chunkText(text, limit = CHUNK_CHAR_LIMIT) {
  const body = String(text ?? '').trim();
  if (body.length <= limit) return [body];

  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim());
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > limit) {
      chunks.push(current.trim());
      current = '';
    }
    if (paragraph.length > limit) {
      // A single oversized paragraph: split on sentence ends as a last resort.
      const sentences = paragraph.split(/(?<=[.؟!])\s+/u);
      for (const sentence of sentences) {
        if (current.length + sentence.length + 1 > limit) {
          chunks.push(current.trim());
          current = '';
        }
        current += `${sentence} `;
      }
      continue;
    }
    current += `${paragraph}\n\n`;
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.filter(Boolean).slice(0, MAX_CHUNKS);
}

function emptyExtraction() {
  return {
    summary: null,
    kunya: null,
    is_woman: false,
    alternate_names: [],
    name_dispute_notes: [],
    birth: { year_hijri: null, year_candidates: [], year_uncertain: false, place: null, cause: null, evidence: null },
    death: { year_hijri: null, year_candidates: [], year_uncertain: false, place: null, cause: null, evidence: null },
    conversion: [],
    companionship: [],
    battles: [],
    offices: [],
    family: [],
    residences: [],
    traits: [],
    narration: {
      is_prolific: false,
      hadith_count: null,
      narrated_from: [],
      narrated_to: [],
      praise: [],
      criticism: [],
      defenses: [],
    },
    cited_authorities: [],
    cross_references: [],
  };
}

function dedupe(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || !item.value) continue;
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const byValue = (item) => normalizeArabic(item.value);

function mergeLifeEvent(target, incoming) {
  if (!incoming) return target;
  const candidates = [...new Set([...(target.year_candidates || []), ...(incoming.year_candidates || [])])];
  if (incoming.year_hijri != null && !candidates.includes(incoming.year_hijri)) {
    candidates.push(incoming.year_hijri);
  }
  return {
    year_hijri: target.year_hijri ?? incoming.year_hijri ?? null,
    year_candidates: candidates.sort((a, b) => a - b),
    year_uncertain: Boolean(target.year_uncertain || incoming.year_uncertain || candidates.length > 1),
    place: target.place ?? incoming.place ?? null,
    cause: target.cause ?? incoming.cause ?? null,
    evidence: target.evidence ?? incoming.evidence ?? null,
  };
}

/** Combine per-chunk extractions into one record for the entry. */
function mergeExtractions(parts) {
  const merged = emptyExtraction();

  for (const part of parts) {
    if (!part) continue;
    merged.summary = merged.summary ?? part.summary ?? null;
    merged.kunya = merged.kunya ?? part.kunya ?? null;
    merged.is_woman = merged.is_woman || Boolean(part.is_woman);

    merged.alternate_names.push(...(part.alternate_names || []));
    merged.name_dispute_notes.push(...(part.name_dispute_notes || []));
    merged.conversion.push(...(part.conversion || []));
    merged.companionship.push(...(part.companionship || []));
    merged.battles.push(...(part.battles || []));
    merged.offices.push(...(part.offices || []));
    merged.family.push(...(part.family || []));
    merged.residences.push(...(part.residences || []));
    merged.traits.push(...(part.traits || []));
    merged.cited_authorities.push(...(part.cited_authorities || []));
    merged.cross_references.push(...(part.cross_references || []));

    merged.birth = mergeLifeEvent(merged.birth, part.birth);
    merged.death = mergeLifeEvent(merged.death, part.death);

    const narration = part.narration || {};
    merged.narration.is_prolific = merged.narration.is_prolific || Boolean(narration.is_prolific);
    merged.narration.hadith_count = merged.narration.hadith_count ?? narration.hadith_count ?? null;
    merged.narration.narrated_from.push(...(narration.narrated_from || []));
    merged.narration.narrated_to.push(...(narration.narrated_to || []));
    merged.narration.praise.push(...(narration.praise || []));
    merged.narration.criticism.push(...(narration.criticism || []));
    merged.narration.defenses.push(...(narration.defenses || []));
  }

  merged.alternate_names = dedupe(merged.alternate_names, byValue);
  merged.name_dispute_notes = dedupe(merged.name_dispute_notes, byValue);
  merged.conversion = dedupe(merged.conversion, byValue);
  merged.companionship = dedupe(merged.companionship, byValue);
  merged.battles = dedupe(merged.battles, byValue);
  merged.offices = dedupe(merged.offices, byValue);
  merged.family = dedupe(merged.family, (f) => `${f.relation}|${normalizeArabic(f.name || f.value)}`);
  merged.residences = dedupe(merged.residences, byValue);
  merged.traits = dedupe(merged.traits, byValue);
  merged.cited_authorities = dedupe(merged.cited_authorities, (c) => `${normalizeArabic(c.value)}|${c.verb || ''}`);
  merged.cross_references = dedupe(merged.cross_references, byValue);
  merged.narration.narrated_from = dedupe(merged.narration.narrated_from, byValue);
  merged.narration.narrated_to = dedupe(merged.narration.narrated_to, byValue);
  merged.narration.praise = dedupe(merged.narration.praise, byValue);
  merged.narration.criticism = dedupe(merged.narration.criticism, byValue);
  merged.narration.defenses = dedupe(merged.narration.defenses, byValue);

  return merged;
}

/** Shape check run before a response is accepted or cached. */
function validateExtraction(data) {
  if (!data || typeof data !== 'object') return 'Response was not a JSON object.';
  const arrayFields = [
    'alternate_names',
    'name_dispute_notes',
    'conversion',
    'companionship',
    'battles',
    'offices',
    'family',
    'residences',
    'traits',
    'cited_authorities',
    'cross_references',
  ];
  for (const field of arrayFields) {
    if (data[field] != null && !Array.isArray(data[field])) {
      return `Field "${field}" must be an array.`;
    }
  }
  if (data.narration != null && typeof data.narration !== 'object') {
    return 'Field "narration" must be an object.';
  }
  for (const field of ['birth', 'death']) {
    const event = data[field];
    if (event == null) continue;
    if (typeof event !== 'object') return `Field "${field}" must be an object.`;
    if (event.year_hijri != null && !Number.isInteger(event.year_hijri)) {
      return `Field "${field}.year_hijri" must be an integer Hijri year or null.`;
    }
  }
  return null;
}

function buildUserMessage({ raw, hints, chunk, chunkIndex, chunkCount }) {
  const lines = [
    `Entry number: ${raw.entry_number}`,
    `Name as listed: ${raw.display_name}`,
  ];
  if (hints.qism) {
    lines.push(`Qism ${hints.qism}: ${QISM_LABEL[hints.qism]}`);
  }
  if (hints.sectionType) lines.push(`Section: ${hints.sectionType}`);
  if (hints.fullName) lines.push(`Parsed lineage: ${hints.fullName}`);
  if (chunkCount > 1) {
    lines.push(
      `This is part ${chunkIndex + 1} of ${chunkCount} of a long entry. Extract only what this part states.`
    );
  }
  lines.push('', 'Entry text:', '---', chunk, '---');
  return lines.join('\n');
}

/**
 * Extract one entry with the LLM.
 *
 * @param {import('./llm-client').LlmClient} client
 * @param {object} raw raw-text.jsonl record
 * @param {{ qism?: number|null, sectionType?: string, fullName?: string|null }} hints
 */
async function extractLlmBio(client, raw, hints = {}) {
  const prompt = loadPrompt();
  const schema = loadOutputSchema();
  const chunks = chunkText(raw.text_body || raw.text || '');

  const parts = [];
  let cachedAll = true;
  for (let i = 0; i < chunks.length; i += 1) {
    const { data, cached } = await client.complete({
      system: prompt.text,
      user: buildUserMessage({
        raw,
        hints,
        chunk: chunks[i],
        chunkIndex: i,
        chunkCount: chunks.length,
      }),
      jsonSchema: schema,
      validate: validateExtraction,
    });
    if (!cached) cachedAll = false;
    parts.push(data);
  }

  return {
    data: mergeExtractions(parts),
    meta: {
      model: client.model,
      prompt_version: prompt.version,
      chunks: chunks.length,
      truncated: (raw.text_body || '').length > CHUNK_CHAR_LIMIT * MAX_CHUNKS,
      extracted_at: new Date().toISOString(),
      cached: cachedAll,
    },
  };
}

/**
 * Does the model's quoted evidence actually occur in the entry?
 * This is the corpus's main defence against fabricated support.
 */
/** Leading connective the model often adds or drops when quoting a clause. */
const LEADING_CONNECTIVE = /^(?:و|ف|ثم|قال)\s*/u;

function makeEvidenceVerifier(sourceText) {
  const haystack = verificationKey(sourceText);
  return function verify(evidence) {
    if (!evidence) return 'absent';
    const needle = verificationKey(evidence);
    if (needle.length < 8) return 'too_short';
    if (haystack.includes(needle)) return 'verified';
    // A quote that only differs by the connective it opens with is still a quote.
    const trimmed = needle.replace(LEADING_CONNECTIVE, '');
    if (trimmed.length >= 8 && trimmed !== needle && haystack.includes(trimmed)) {
      return 'verified';
    }
    return 'unverified';
  };
}

module.exports = {
  extractLlmBio,
  chunkText,
  mergeExtractions,
  validateExtraction,
  makeEvidenceVerifier,
  emptyExtraction,
  loadPrompt,
  loadOutputSchema,
  CHUNK_CHAR_LIMIT,
  MAX_CHUNKS,
};
