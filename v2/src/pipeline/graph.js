'use strict';

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

/**
 * Build the person graph and the citation list.
 *
 * Resolution statistics are written alongside the artifacts, because the useful
 * question about a graph like this is not how many edges exist but how many
 * point at a known entry.
 */
async function graph({ log = () => {} } = {}) {
  ensureDirs();

  const indexRows = await loadJsonl(PATHS.index);
  const resolver = buildResolver(indexRows);
  log(`resolver indexed ${resolver.size} entries`);

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
    citation_keys: {},
  };

  for await (const person of readJsonl(PATHS.persons)) {
    stats.persons += 1;
    const text = rawById.get(person.person_id) || '';

    const edges = [
      ...refsToEdges(person, extractTextRefs(text), resolver),
      ...narrationToEdges(person, resolver),
    ];

    for (const edge of edges) {
      await edgeWriter.write(edge);
      stats.edges += 1;
      stats.by_type[edge.type] = (stats.by_type[edge.type] || 0) + 1;
      if (edge.resolved) stats.resolved += 1;
      else if (edge.ambiguous) stats.ambiguous += 1;
      else stats.unresolved += 1;
    }

    // Authorities the LLM layer surfaced are not stored on the person record,
    // so re-derive them from the text; both paths are labelled by source.
    for (const citation of extractCitations(person.person_id, text)) {
      await citationWriter.write(citation);
      stats.citations += 1;
      const key = citation.authority_key || citation.authority;
      stats.citation_keys[key] = (stats.citation_keys[key] || 0) + 1;
    }
  }

  const edgeResult = await edgeWriter.close();
  const citationResult = await citationWriter.close();

  const report = {
    generated_at: new Date().toISOString(),
    ...stats,
    resolution_rate: stats.edges ? Number((stats.resolved / stats.edges).toFixed(4)) : 0,
    top_authorities: Object.entries(stats.citation_keys)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([key, count]) => ({ key, count })),
    artifacts: { edges: edgeResult, citations: citationResult },
  };
  delete report.citation_keys;
  writeJson(PATHS.graphReport, report);

  log(
    `wrote ${stats.edges} edges (${(100 * report.resolution_rate).toFixed(1)}% resolved, ` +
      `${stats.ambiguous} ambiguous) and ${stats.citations} citations`
  );

  return report;
}

module.exports = { graph };
