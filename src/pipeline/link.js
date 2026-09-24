'use strict';

const fs = require('fs');

const { PATHS, ensureDirs } = require('../config');
const { readJsonl, loadJsonl, JsonlWriter, writeJson } = require('../util/jsonl');
const { writerValidator } = require('../schema/validate');
const { matchIdentities, pageMapRow } = require('../graph/identity');

/**
 * Phase 5 stubs: page-map from Shamela pages (pdf_page null) and identity-links
 * only when a second persons.jsonl is supplied. No second ingest → empty links.
 */
async function link({ otherPath = null, log = () => {} } = {}) {
  ensureDirs();
  requirePersons();

  const pageWriter = new JsonlWriter(PATHS.pageMap, { validate: writerValidator('pageMap') });
  let pages = 0;
  const sources = [];
  for await (const person of readJsonl(PATHS.persons)) {
    sources.push({
      person_id: person.person_id,
      book: person.book,
      identity: person.identity,
    });
    await pageWriter.write(pageMapRow(person));
    pages += 1;
  }
  await pageWriter.close();
  log(`page-map ${pages} rows (pdf_page null until a PDF map exists)`);

  let targets = [];
  if (otherPath) {
    if (!fs.existsSync(otherPath)) throw new Error(`Other corpus not found: ${otherPath}`);
    targets = await loadJsonl(otherPath);
    log(`matcher loaded ${targets.length} foreign persons from ${otherPath}`);
  } else {
    log('no --other corpus; identity-links stay empty');
  }

  const links = matchIdentities(sources, targets);
  const linkWriter = new JsonlWriter(PATHS.identityLinks, { validate: writerValidator('identityLink') });
  for (const row of links) await linkWriter.write(row);
  await linkWriter.close();

  const report = {
    generated_at: new Date().toISOString(),
    page_map: pages,
    identity_links: links.length,
    other_path: otherPath,
    other_persons: targets.length,
  };
  writeJson(linkReportPath(), report);
  log(`identity-links ${links.length}`);
  return report;
}

function requirePersons() {
  if (!fs.existsSync(PATHS.persons)) {
    throw new Error('Missing persons.jsonl. Run `npm run build` first.');
  }
}

function linkReportPath() {
  return `${PATHS.REPORTS_DIR}/link.json`;
}

module.exports = { link };
