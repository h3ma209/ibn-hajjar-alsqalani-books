'use strict';

const { SCHEMA_VERSION, BOOK } = require('../config');
const { normalizeArabic } = require('../util/arabic');
const { resolve: resolveVocab } = require('../vocab');
const { REGEX_CONFIDENCE } = require('./regex-bio');
const { makeEvidenceVerifier } = require('./llm-bio');

/**
 * Assemble the final person record from the deterministic structural layer plus
 * whichever extraction layer produced facts.
 *
 * Confidence is assigned here, not by the model: a model asked to score itself
 * mostly reports its own fluency. Instead an LLM fact is scored by whether its
 * quoted evidence can actually be found in the entry text.
 */

const CONFIDENCE = {
  regex: REGEX_CONFIDENCE,
  llmVerified: 0.9,
  llmNoEvidence: 0.7,
  llmUnverified: 0.55,
};

function confidenceFor(source, evidenceStatus) {
  if (source === 'regex') return CONFIDENCE.regex;
  if (source === 'structural') return 1;
  if (evidenceStatus === 'verified') return CONFIDENCE.llmVerified;
  if (evidenceStatus === 'absent' || evidenceStatus === 'too_short') return CONFIDENCE.llmNoEvidence;
  return CONFIDENCE.llmUnverified;
}

function makeFactBuilder(source, verify) {
  return function toFact(item) {
    if (!item) return null;
    const value = String(item.value ?? '').trim();
    if (!value) return null;
    const evidence = item.evidence ? String(item.evidence).trim() : null;
    return {
      value,
      source,
      evidence: evidence || null,
      confidence: confidenceFor(source, verify(evidence)),
    };
  };
}

function mapFacts(items, toFact) {
  return (items || []).map(toFact).filter(Boolean);
}

function toNamedFacts(items, toFact) {
  return mapFacts(items, toFact).map((fact) => ({
    ...fact,
    normalized: normalizeArabic(fact.value) || null,
  }));
}

function toVocabFacts(items, vocabName, toFact) {
  return mapFacts(items, toFact).map((fact) => ({
    ...fact,
    key: resolveVocab(vocabName, fact.value) || null,
  }));
}

function toOfficeFacts(items, toFact) {
  return (items || [])
    .map((item) => {
      const base = toFact(item);
      if (!base) return null;
      return {
        ...base,
        role: item.role ?? null,
        place: item.place ?? null,
        place_key: item.place ? resolveVocab('places', item.place) : null,
        appointed_by: item.appointed_by ?? null,
        period: item.period ?? null,
      };
    })
    .filter(Boolean);
}

function toFamilyFacts(items, toFact) {
  return (items || [])
    .map((item) => {
      const base = toFact(item);
      if (!base) return null;
      return {
        ...base,
        relation: item.relation ?? null,
        name: item.name ?? null,
      };
    })
    .filter(Boolean);
}

function toLifeEvent(event, toFact) {
  const source = event || {};
  const candidates = [...new Set(source.year_candidates || [])]
    .filter((year) => Number.isInteger(year) && year > 0 && year <= 1500)
    .sort((a, b) => a - b);
  const year = Number.isInteger(source.year_hijri) ? source.year_hijri : null;
  if (year != null && !candidates.includes(year)) candidates.push(year);

  const notes = [];
  if (source.evidence) {
    const note = toFact({ value: source.evidence, evidence: source.evidence });
    if (note) notes.push(note);
  }

  return {
    year_hijri: year,
    year_candidates: candidates.sort((a, b) => a - b),
    year_uncertain: Boolean(source.year_uncertain) || candidates.length > 1,
    place: source.place ?? null,
    place_key: source.place ? resolveVocab('places', source.place) : null,
    cause: source.cause ?? null,
    notes,
  };
}

function emptyLife() {
  return {
    summary: null,
    birth: toLifeEvent(null, () => null),
    death: toLifeEvent(null, () => null),
    conversion: [],
    companionship: [],
    battles: [],
    offices: [],
    family: [],
    residences: [],
    traits: [],
  };
}

function emptyNarration() {
  return {
    is_prolific: false,
    hadith_count: null,
    narrated_from: [],
    narrated_to: [],
    praise: [],
    criticism: [],
    defenses: [],
  };
}

/**
 * @param {object} args
 * @param {object} args.entry entry metadata from buildEntries
 * @param {object} args.raw raw-text record
 * @param {object} args.placement structural placement
 * @param {object} args.nasab parsed genealogy
 * @param {object|null} args.extraction intermediate extraction shape
 * @param {'llm'|'regex'|null} args.extractionSource
 * @param {object|null} args.meta extractor metadata
 */
function buildPersonRecord({
  entry,
  raw,
  placement,
  nasab,
  extraction = null,
  extractionSource = null,
  meta = null,
}) {
  const verify = makeEvidenceVerifier(raw?.text_body || raw?.text || '');
  const toFact = extractionSource ? makeFactBuilder(extractionSource, verify) : () => null;

  const layers = ['structural'];
  if (extractionSource) layers.push(extractionSource);

  const life = emptyLife();
  const narration = emptyNarration();
  let alternateNames = [];
  let disputeNotes = [];
  let extractedKunya = null;
  let extractedIsWoman = false;

  if (extraction && extractionSource) {
    life.summary = extraction.summary
      ? toFact({ value: extraction.summary, evidence: extraction.summary })
      : null;
    life.birth = toLifeEvent(extraction.birth, toFact);
    life.death = toLifeEvent(extraction.death, toFact);
    life.conversion = mapFacts(extraction.conversion, toFact);
    life.companionship = mapFacts(extraction.companionship, toFact);
    life.battles = toVocabFacts(extraction.battles, 'battles', toFact);
    life.offices = toOfficeFacts(extraction.offices, toFact);
    life.family = toFamilyFacts(extraction.family, toFact);
    life.residences = toVocabFacts(extraction.residences, 'places', toFact);
    life.traits = mapFacts(extraction.traits, toFact);

    const source = extraction.narration || {};
    narration.is_prolific = Boolean(source.is_prolific);
    narration.hadith_count = source.hadith_count
      ? toFact({ value: source.hadith_count, evidence: source.hadith_count })
      : null;
    narration.narrated_from = toNamedFacts(source.narrated_from, toFact);
    narration.narrated_to = toNamedFacts(source.narrated_to, toFact);
    narration.praise = mapFacts(source.praise, toFact);
    narration.criticism = mapFacts(source.criticism, toFact);
    narration.defenses = mapFacts(source.defenses, toFact);

    alternateNames = mapFacts(extraction.alternate_names, toFact);
    disputeNotes = mapFacts(extraction.name_dispute_notes, toFact);
    extractedKunya = extraction.kunya || null;
    extractedIsWoman = Boolean(extraction.is_woman);
  }

  const isWoman =
    placement.section_type === 'women' || Boolean(nasab.is_woman_hint) || extractedIsWoman;

  return {
    schema_version: SCHEMA_VERSION,
    person_id: entry.person_id,
    book: { slug: BOOK.slug, book_id: BOOK.expected_book_id },
    entry: {
      number: entry.entry_number,
      number_is_ambiguous: entry.entry_number_is_ambiguous,
      start_id: entry.start_id,
      end_id: entry.end_id,
      volume: entry.volume,
      page_start: entry.page_start,
      page_end: entry.page_end,
      char_len: raw?.char_len ?? 0,
    },
    identity: {
      display_name: entry.display_name,
      display_name_norm: entry.display_name_norm,
      kunya: nasab.kunya || extractedKunya || null,
      is_woman: isWoman,
      nasab: {
        ism: nasab.ism ?? null,
        father: nasab.father ?? null,
        grandfather: nasab.grandfather ?? null,
        great_grandfather: nasab.great_grandfather ?? null,
        chain: nasab.chain ?? [],
        links: nasab.links ?? [],
        nisba: nasab.nisba ?? [],
        full_name: nasab.full_name ?? null,
        full_name_norm: nasab.full_name_norm ?? null,
        source: nasab.source,
        confidence: nasab.confidence,
        rejected_reason: nasab.rejected_reason ?? null,
        link_count: nasab.link_count ?? 0,
      },
      alternate_names: alternateNames,
      name_dispute_notes: disputeNotes,
    },
    classification: {
      qism: placement.qism ?? null,
      qism_label: placement.qism_label ?? null,
      qism_heading: placement.qism_heading ?? null,
      section_type: placement.section_type,
      letter: placement.letter ?? null,
      bab: placement.bab ?? null,
      volume_toc: placement.volume_toc ?? null,
      toc_heading: placement.toc_heading ?? null,
      toc_path: placement.toc_path ?? [],
    },
    life,
    narration,
    extraction: {
      layers,
      llm:
        extractionSource === 'llm' && meta
          ? {
              model: meta.model,
              prompt_version: meta.prompt_version,
              chunks: meta.chunks,
              extracted_at: meta.extracted_at,
              truncated: Boolean(meta.truncated),
            }
          : null,
      regex:
        extractionSource === 'regex' && meta
          ? { version: meta.version, extracted_at: meta.extracted_at }
          : null,
    },
  };
}

/** Lightweight row for the searchable index. */
function buildIndexRow(person) {
  return {
    person_id: person.person_id,
    entry_number: person.entry.number,
    entry_number_is_ambiguous: person.entry.number_is_ambiguous,
    display_name: person.identity.display_name,
    display_name_norm: person.identity.display_name_norm,
    full_name: person.identity.nasab.full_name,
    full_name_norm: person.identity.nasab.full_name_norm,
    kunya: person.identity.kunya,
    nisba: person.identity.nasab.nisba,
    nasab_confidence: person.identity.nasab.confidence,
    is_woman: person.identity.is_woman,
    qism: person.classification.qism,
    section_type: person.classification.section_type,
    letter: person.classification.letter,
    volume: person.entry.volume,
    page_start: person.entry.page_start,
    page_end: person.entry.page_end,
    char_len: person.entry.char_len,
    death_year_hijri: person.life.death?.year_hijri ?? null,
    layers: person.extraction.layers,
  };
}

module.exports = { buildPersonRecord, buildIndexRow, CONFIDENCE, confidenceFor };
