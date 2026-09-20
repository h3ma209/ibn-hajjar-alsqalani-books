'use strict';

const { PATHS, BOOK, SCHEMA_VERSION, findBok, ensureDirs } = require('../config');
const { readBook } = require('../bok/reader');
const { buildEntries, buildRawTextRecord } = require('../bok/entries');
const { buildPlacementIndex, placementFor } = require('../structure/placement');
const { extractChapters, auditCoverage } = require('../structure/chapters');
const { JsonlWriter, writeJson } = require('../util/jsonl');
const { writerValidator } = require('../schema/validate');

/**
 * Phase 1 of the pipeline: turn the .bok into preserved, validated artifacts.
 *
 * After this step the source book is no longer needed. Everything downstream
 * reads raw-text.jsonl and placement.jsonl, which means an extraction bug is
 * always re-runnable and auditable.
 */
async function ingest({ bokPath = null, limit = 0, log = () => {} } = {}) {
  ensureDirs();

  const resolvedBok = findBok(bokPath);
  log(`reading ${resolvedBok}`);
  const book = readBook(resolvedBok);
  log(`pages=${book.pages.length} toc=${book.toc.length}`);

  const { entries, ambiguousNumbers, rejected, markerCounts, suspectNumbers } =
    buildEntries(book);
  log(
    `entries=${entries.length} ambiguous_numbers=${ambiguousNumbers.length} ` +
      `markers=${JSON.stringify(markerCounts)}`
  );

  const placementIndex = buildPlacementIndex(book.toc);
  const chapters = extractChapters({
    toc: book.toc,
    pages: book.pages,
    entryStartIds: entries.map((e) => e.start_id),
  });
  const coverage = auditCoverage({ pages: book.pages, entries, chapters });
  log(
    `chapters=${chapters.length} page_coverage=${(coverage.coverage_ratio * 100).toFixed(2)}%`
  );

  const selected = limit > 0 ? entries.slice(0, limit) : entries;

  const rawWriter = new JsonlWriter(PATHS.rawText, { validate: writerValidator('rawText') });
  const placementWriter = new JsonlWriter(PATHS.placement);
  const chapterWriter = new JsonlWriter(PATHS.chapters);

  const pageIndexById = new Map(book.pages.map((page, index) => [page.id, index]));

  let totalChars = 0;
  for (const entry of selected) {
    const raw = buildRawTextRecord(book.pages, entry, { pageIndexById });
    totalChars += raw.char_len;
    await rawWriter.write(raw);
    await placementWriter.write({
      person_id: entry.person_id,
      entry_number: entry.entry_number,
      entry_number_is_ambiguous: entry.entry_number_is_ambiguous,
      entry_marker: entry.entry_marker,
      entry_number_suspect: entry.entry_number_suspect,
      start_id: entry.start_id,
      end_id: entry.end_id,
      volume: raw.volume,
      page_start: raw.page_start,
      page_end: raw.page_end,
      display_name: entry.display_name,
      display_name_norm: entry.display_name_norm,
      toc_lvl: entry.toc_lvl,
      toc_title: entry.toc_title,
      placement: placementFor(placementIndex, entry.start_id),
    });
  }

  for (const chapter of chapters) await chapterWriter.write(chapter);

  const rawResult = await rawWriter.close();
  const placementResult = await placementWriter.close();
  const chapterResult = await chapterWriter.close();

  const manifest = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    book: { ...BOOK, ...book.source },
    counts: {
      pages: book.pages.length,
      toc_nodes: book.toc.length,
      entries: selected.length,
      entries_total: entries.length,
      chapters: chapters.length,
      ambiguous_entry_numbers: ambiguousNumbers.length,
      rejected_toc_candidates: rejected.length,
    },
    entry_markers: markerCounts,
    ambiguous_entry_numbers: ambiguousNumbers,
    suspect_entry_numbers: suspectNumbers,
    rejected_toc_candidates: rejected,
    page_coverage: coverage,
    corpus_chars: totalChars,
    artifacts: {
      raw_text: rawResult,
      placement: placementResult,
      chapters: chapterResult,
    },
  };
  writeJson(PATHS.manifest, manifest);

  log(
    `wrote ${rawResult.count} raw entries (${(rawResult.bytes / 1e6).toFixed(1)} MB), ` +
      `${chapterResult.count} chapters, corpus ${(totalChars / 1e6).toFixed(1)}M chars`
  );

  return manifest;
}

module.exports = { ingest };
