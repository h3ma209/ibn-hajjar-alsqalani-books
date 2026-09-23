'use strict';

const fs = require('fs');

const { PATHS, ensureDirs } = require('../config');
const { readJsonl, JsonlWriter, loadJsonl, writeJson } = require('../util/jsonl');
const { writerValidator } = require('../schema/validate');
const {
  extractTextRefs,
  buildResolver,
  refsToEdges,
  narrationToEdges,
  extractCitations,
} = require('../graph/crossrefs');
const { resolutionSplit, buildCitationReport, buildRollups } = require('../report/rollups');

async function loadOptionalJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return loadJsonl(filePath);
}

/**
 * Build the person graph and the citation list.
 *
 * Resolution statistics are written alongside the artifacts, because the useful
 * question about a graph like this is not how many edges exist but how many
 * point at a known entry. In-book pointers and narrator names are scored apart.
 */
async function graph({ log = () => {} } = {}) {
  ensureDirs();

  const indexRows = await loadJsonl(PATHS.index);
  const names = await loadOptionalJsonl(PATHS.names);
  const genealogy = await loadOptionalJsonl(PATHS.genealogy);
  const resolver = buildResolver(indexRows, { names, genealogy });
  log(`resolver indexed ${resolver.size} entries (${names.length} names, ${genealogy.length} genealogy)`);

  const rawById = new Map();
  for await (const raw of readJsonl(PATHS.rawText)) {
    rawById.set(raw.person_id, raw.text_body || raw.text || '');
  }

  const edgeWriter = new JsonlWriter(PATHS.edges, { validate: writerValidator('edge') });
  const citationWriter = new JsonlWriter(PATHS.citations, {
    validate: writerValidator('citation'),
  });

  const stats = {
    persons: 0,
    edges: 0,
    resolved: 0,
    ambiguous: 0,
    unresolved: 0,
    by_type: {},
    citations: 0,
  };

  const persons = [];
  const citations = [];
  const edges = [];

  for await (const person of readJsonl(PATHS.persons)) {
    stats.persons += 1;
    persons.push(person);
    const text = rawById.get(person.person_id) || '';

    const personEdges = [
      ...refsToEdges(person, extractTextRefs(text), resolver),
      ...narrationToEdges(person, resolver),
    ];

    for (const edge of personEdges) {
      await edgeWriter.write(edge);
      edges.push(edge);
      stats.edges += 1;
      stats.by_type[edge.type] = (stats.by_type[edge.type] || 0) + 1;
      if (edge.resolved) stats.resolved += 1;
      else if (edge.ambiguous) stats.ambiguous += 1;
      else stats.unresolved += 1;
    }

    for (const citation of extractCitations(person.person_id, text)) {
      await citationWriter.write(citation);
      citations.push(citation);
      stats.citations += 1;
    }
  }

  const edgeResult = await edgeWriter.close();
  const citationResult = await citationWriter.close();
  const split = resolutionSplit(edges);
  const citationReport = buildCitationReport(citations);
  const rollups = buildRollups(persons, { excludeQism4: true });

  writeJson(PATHS.citationsReport, citationReport);
  writeJson(PATHS.rollups, rollups);

  const report = {
    generated_at: new Date().toISOString(),
    ...stats,
    resolution_rate: stats.edges ? Number((stats.resolved / stats.edges).toFixed(4)) : 0,
    resolution_rate_in_book: split.resolution_rate_in_book,
    resolution_rate_narrators: split.resolution_rate_narrators,
    in_book: split.in_book,
    narrators: split.narrators,
    top_authorities: citationReport.top.slice(0, 25).map((row) => ({ key: row.key, count: row.count })),
    artifacts: {
      edges: edgeResult,
      citations: citationResult,
      citations_report: PATHS.citationsReport,
      rollups: PATHS.rollups,
    },
  };
  writeJson(PATHS.graphReport, report);

  log(
    `wrote ${stats.edges} edges (in-book ${(100 * split.resolution_rate_in_book).toFixed(1)}% resolved, ` +
      `narrators ${(100 * split.resolution_rate_narrators).toFixed(1)}%) and ${stats.citations} citations`
  );

  return report;
}

module.exports = { graph };
