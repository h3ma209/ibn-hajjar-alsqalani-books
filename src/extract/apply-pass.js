'use strict';

const fs = require('fs');

const { PATHS } = require('../config');
const { readJsonl, loadJsonl, JsonlWriter, writeJson } = require('../util/jsonl');
const { writerValidator } = require('../schema/validate');
const { makeEvidenceVerifier } = require('./llm-bio');
const { term } = require('../vocab');
const { CONFIDENCE } = require('./merge');

function loadRows(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const map = new Map();
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row.person_id && !row.error) map.set(row.person_id, row);
    } catch {
      // ignore truncated tail
    }
  }
  return map;
}

function factsAt(person, field) {
  const parts = field.split('.');
  let cur = person;
  for (const part of parts) {
    if (cur == null) return null;
    cur = cur[part];
  }
  return cur;
}

function applyRepairs(person, row, verify) {
  if (!row?.repairs) return 0;
  let n = 0;
  for (const repair of row.repairs) {
    const bag = factsAt(person, repair.field);
    const fact = Array.isArray(bag) ? bag[repair.index] : bag;
    if (!fact || fact.value !== repair.value) continue;
    const evidence = repair.evidence ? String(repair.evidence).trim() : null;
    if (!evidence) {
      fact.evidence = null;
      fact.confidence = CONFIDENCE.llmNoEvidence;
      n += 1;
      continue;
    }
    const status = verify(evidence);
    if (status !== 'verified') continue;
    fact.evidence = evidence;
    fact.confidence = CONFIDENCE.llmVerified;
    n += 1;
  }
  return n;
}

function applyKinds(person, row) {
  if (!row?.assignments) return 0;
  let n = 0;
  for (const item of row.assignments) {
    const bag = factsAt(person, item.field);
    const fact = Array.isArray(bag) ? bag[item.index] : bag;
    if (!fact || fact.value !== item.value) continue;
    if (!item.kind) continue;
    fact.kind = item.field === 'life.events' && item.kind === 'other' ? 'incident' : item.kind;
    n += 1;
  }
  return n;
}

function applyHadith(person, row) {
  if (!row || row.count == null) return 0;
  const current = person.narration.hadith_count;
  if (!current) return 0;
  person.narration.hadith_count = {
    ...current,
    count: row.count,
    uncertain: Boolean(row.uncertain),
    evidence: row.evidence ?? current.evidence ?? null,
    source: 'llm',
    confidence: row.evidence ? 0.9 : 0.7,
  };
  return 1;
}

function applyVerdictKeys(person, row) {
  if (!row?.verdicts?.length) return 0;
  const keys = new Set(person.narration.verdict_keys || []);
  for (const item of row.verdicts) {
    if (item.key) keys.add(item.key);
  }
  person.narration.verdict_keys = [...keys];
  return row.verdicts.length;
}

function deriveTimeline(person) {
  const items = [];
  const push = (kind, value, year, key, source) => {
    if (!value) return;
    items.push({
      kind,
      value,
      year_hijri: year ?? null,
      key: key ?? null,
      source: source || 'structural',
    });
  };

  if (person.life.birth?.year_hijri != null) {
    push('birth', person.life.birth.place || 'مولد', person.life.birth.year_hijri, null, person.life.birth.source);
  }
  for (const battle of person.life.battles || []) {
    const meta = battle.key ? term('battles', battle.key) : null;
    push('battle', battle.value, battle.year_hijri ?? meta?.year_hijri ?? null, battle.key, battle.source);
  }
  for (const event of person.life.events || []) {
    const meta = event.key ? term('battles', event.key) : null;
    push(event.kind, event.value, event.year_hijri ?? meta?.year_hijri ?? null, event.key, event.source);
  }
  if (person.life.death?.year_hijri != null) {
    push('death', person.life.death.cause || 'وفاة', person.life.death.year_hijri, person.life.death.cause_key, person.life.death.source);
  }

  items.sort((a, b) => {
    if (a.year_hijri == null && b.year_hijri == null) return 0;
    if (a.year_hijri == null) return 1;
    if (b.year_hijri == null) return -1;
    return a.year_hijri - b.year_hijri;
  });
  return { person_id: person.person_id, items };
}

async function applyPassResults({ log = () => {} } = {}) {
  const repairs = loadRows(PATHS.llmRepair);
  const kinds = loadRows(PATHS.llmKinds);
  const spans = loadRows(PATHS.llmSpans);
  const verdictRows = loadRows(PATHS.llmVerdicts);
  const isnadRows = loadRows(PATHS.llmIsnads);
  const hadith = loadRows(PATHS.llmHadith);

  const rawById = new Map();
  if (fs.existsSync(PATHS.rawText)) {
    for await (const raw of readJsonl(PATHS.rawText)) rawById.set(raw.person_id, raw);
  }

  const personWriter = new JsonlWriter(PATHS.persons, { validate: writerValidator('person') });
  const verdictWriter = new JsonlWriter(PATHS.verdicts, { validate: writerValidator('verdict') });
  const isnadWriter = new JsonlWriter(PATHS.isnads, { validate: writerValidator('isnad') });
  const timelineWriter = new JsonlWriter(PATHS.timelines, { validate: writerValidator('timeline') });

  const stats = {
    persons: 0,
    repairs: 0,
    kinds: 0,
    hadith: 0,
    verdicts: 0,
    isnads: 0,
    timelines: 0,
    spans_replaced: 0,
  };

  const spanReplacements = new Map();
  for (const [id, row] of spans) {
    if (row.labels?.length) spanReplacements.set(id, row.labels);
  }

  for await (const person of readJsonl(PATHS.persons)) {
    const raw = rawById.get(person.person_id);
    const verify = makeEvidenceVerifier(raw?.text_body || '');
    stats.repairs += applyRepairs(person, repairs.get(person.person_id), verify);
    stats.kinds += applyKinds(person, kinds.get(person.person_id));
    stats.hadith += applyHadith(person, hadith.get(person.person_id));
    stats.verdicts += applyVerdictKeys(person, verdictRows.get(person.person_id));

    const vrow = verdictRows.get(person.person_id);
    for (const item of vrow?.verdicts || []) {
      if (!item.evidence) continue;
      await verdictWriter.write({
        person_id: person.person_id,
        key: item.key,
        value: item.value || item.key,
        source: 'llm',
        evidence: item.evidence,
        confidence: verify(item.evidence) === 'verified' ? 0.9 : 0.55,
        about: null,
      });
    }

    const irow = isnadRows.get(person.person_id);
    for (const item of irow?.isnads || []) {
      if (!item.names || item.names.length < 2) continue;
      await isnadWriter.write({
        person_id: person.person_id,
        names: item.names,
        subject_index: item.subject_index ?? null,
        source: 'llm',
        evidence: item.evidence ?? null,
        confidence: 0.7,
      });
      stats.isnads += 1;
    }

    const timeline = deriveTimeline(person);
    if (timeline.items.length) {
      await timelineWriter.write(timeline);
      stats.timelines += 1;
    }

    await personWriter.write(person);
    stats.persons += 1;
  }

  await personWriter.close();
  await verdictWriter.close();
  await isnadWriter.close();
  await timelineWriter.close();

  if (spanReplacements.size && fs.existsSync(PATHS.passageLabels)) {
    const spanWriter = new JsonlWriter(PATHS.passageLabels, { validate: writerValidator('passageLabel') });
    for await (const span of readJsonl(PATHS.passageLabels)) {
      const replacements = spanReplacements.get(span.person_id);
      if (replacements && span.label === 'unlabeled') {
        const hit = replacements.find((row) => row.start === span.start && row.end === span.end);
        if (hit && hit.label && hit.label !== 'unlabeled') {
          span.label = hit.label;
          span.source = 'llm';
          span.confidence = 0.7;
          stats.spans_replaced += 1;
        }
      }
      await spanWriter.write(span);
    }
    await spanWriter.close();
  }

  const report = {
    generated_at: new Date().toISOString(),
    ...stats,
  };
  writeJson(pathJoinReport(), report);
  log(
    `apply: persons=${stats.persons} repairs=${stats.repairs} kinds=${stats.kinds} ` +
      `spans=${stats.spans_replaced} verdicts=${stats.verdicts} isnads=${stats.isnads} ` +
      `timelines=${stats.timelines}`
  );
  return report;
}

function pathJoinReport() {
  return PATHS.extractPassUsage.replace('extract-pass-usage.json', 'extract-pass-apply.json');
}

module.exports = {
  applyPassResults,
  applyRepairs,
  applyKinds,
  applyHadith,
  deriveTimeline,
  loadRows,
};
