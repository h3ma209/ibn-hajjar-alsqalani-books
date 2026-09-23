'use strict';

const fs = require('fs');

const { PATHS, ensureDirs } = require('../config');
const { readJsonl, JsonlWriter, writeJson, loadJsonl } = require('../util/jsonl');
const { writerValidator, checkValid } = require('../schema/validate');
const { parseNasab } = require('../names/nasab');
const { extractRegexBio, VERSION: REGEX_VERSION } = require('../extract/regex-bio');
const { buildPersonRecord, buildIndexRow } = require('../extract/merge');
const { labelPassages, coverageFrom } = require('../classify/spans');
const quality = require('../report/quality');

/**
 * Assemble person records from the preserved artifacts.
 *
 * LLM facts are used when available for an entry; otherwise the regex layer
 * fills in so no entry is left blank. Which layer produced a record is recorded
 * in `extraction.layers`, and every fact carries its own source, so the two are
 * never confused downstream.
 */
async function build({ useLlm = true, limit = 0, log = () => {} } = {}) {
  ensureDirs();

  const placements = new Map();
  for await (const row of readJsonl(PATHS.placement)) {
    placements.set(row.person_id, row);
  }
  log(`loaded placement for ${placements.size} entries`);

  const llmFacts = new Map();
  if (useLlm && fs.existsSync(PATHS.llmFacts)) {
    for (const row of await loadJsonl(PATHS.llmFacts)) {
      if (row.error) continue;
      llmFacts.set(row.person_id, row);
    }
    log(`loaded LLM facts for ${llmFacts.size} entries`);
  } else if (useLlm) {
    log('no LLM facts found; building from the regex fallback layer only');
  }

  const personWriter = new JsonlWriter(PATHS.persons, { validate: writerValidator('person') });
  const indexWriter = new JsonlWriter(PATHS.index, { validate: writerValidator('index') });
  const eventWriter = new JsonlWriter(PATHS.events, { validate: writerValidator('event') });
  const spanWriter = new JsonlWriter(PATHS.passageLabels, { validate: writerValidator('passageLabel') });
  const accumulator = quality.newAccumulator();
  const coverageAcc = { labeled_chars: 0, total_chars: 0, unlabeled_sents: 0, spans: 0 };

  let processed = 0;
  const rejectedLlm = [];
  const startedAt = Date.now();

  for await (const raw of readJsonl(PATHS.rawText)) {
    if (limit > 0 && processed >= limit) break;

    const placementRow = placements.get(raw.person_id);
    if (!placementRow) {
      throw new Error(
        `No placement for ${raw.person_id}. Re-run ingest so both artifacts come from one pass.`
      );
    }

    const entry = {
      person_id: raw.person_id,
      entry_number: raw.entry_number,
      entry_number_is_ambiguous: placementRow.entry_number_is_ambiguous,
      start_id: raw.start_id,
      end_id: raw.end_id,
      volume: raw.volume,
      page_start: raw.page_start,
      page_end: raw.page_end,
      display_name: raw.display_name ?? placementRow.display_name,
      display_name_norm: placementRow.display_name_norm,
    };

    const nasab = parseNasab(raw.text_body, {
      displayName: entry.display_name,
      entryNumber: entry.entry_number,
    });

    const regexLayer = () => ({
      extraction: extractRegexBio(raw.text_body, {
        displayName: entry.display_name,
        qism: placementRow.placement.qism,
        sectionType: placementRow.placement.section_type,
      }),
      extractionSource: 'regex',
      meta: { version: REGEX_VERSION, extracted_at: new Date().toISOString() },
    });

    const llm = llmFacts.get(raw.person_id);
    const layer = llm
      ? { extraction: llm.extraction, extractionSource: 'llm', meta: llm.meta }
      : regexLayer();

    const assemble = (chosen) =>
      buildPersonRecord({
        entry,
        raw,
        placement: placementRow.placement,
        nasab,
        entryMarker: placementRow.entry_marker ?? null,
        ...chosen,
      });

    let person = assemble(layer);

    /**
     * A model can return a value the schema rejects, and one such response must
     * not abort a 12k-entry build. The offending entry falls back to the
     * deterministic layer and is reported, so the invariant that only valid
     * records reach disk holds without the run being all-or-nothing.
     */
    if (llm) {
      const problem = checkValid('person', person);
      if (problem) {
        rejectedLlm.push({ person_id: raw.person_id, entry_number: raw.entry_number, problem });
        person = assemble(regexLayer());
      }
    }

    await personWriter.write(person);
    await indexWriter.write(buildIndexRow(person));
    for (const event of person.life.events || []) {
      await eventWriter.write({ person_id: person.person_id, ...event });
    }
    const spans = labelPassages(person.person_id, raw.text_body || raw.text || '', {
      source: 'regex',
      confidence: 0.3,
    });
    const coverage = coverageFrom(spans, raw.text_body || raw.text || '');
    coverageAcc.labeled_chars += Math.round(coverage.label_coverage * (raw.char_len || 0));
    coverageAcc.total_chars += raw.char_len || 0;
    coverageAcc.unlabeled_sents += coverage.n_unlabeled_sents;
    coverageAcc.spans += coverage.n_spans;
    for (const span of spans) await spanWriter.write(span);
    quality.observe(accumulator, person);

    processed += 1;
    if (processed % 2000 === 0) {
      log(`  built ${processed} records (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
    }
  }

  const personResult = await personWriter.close();
  const indexResult = await indexWriter.close();
  const eventResult = await eventWriter.close();
  const spanResult = await spanWriter.close();
  writeJson(PATHS.labelCoverage, {
    generated_at: new Date().toISOString(),
    spans: spanResult.count,
    events: eventResult.count,
    unlabeled_sents: coverageAcc.unlabeled_sents,
    label_coverage: coverageAcc.total_chars
      ? Number((coverageAcc.labeled_chars / coverageAcc.total_chars).toFixed(4))
      : 0,
  });

  const usableLlm = Math.max(0, llmFacts.size - rejectedLlm.length);
  const report = quality.finalize(accumulator, {
    artifacts: { persons: personResult, index: indexResult },
    llm_fact_coverage: accumulator.total
      ? Number((usableLlm / accumulator.total).toFixed(4))
      : 0,
    llm_rejected: {
      count: rejectedLlm.length,
      entries: rejectedLlm.slice(0, 20),
    },
  });
  writeJson(PATHS.quality, report);

  log(
    `wrote ${personResult.count} persons (${(personResult.bytes / 1e6).toFixed(1)} MB); ` +
      `quality report at ${PATHS.quality}`
  );
  if (rejectedLlm.length) {
    log(
      `${rejectedLlm.length} LLM extraction(s) failed schema validation and fell back to regex; ` +
        `first: ${rejectedLlm[0].person_id}`
    );
  }

  return report;
}

module.exports = { build };
