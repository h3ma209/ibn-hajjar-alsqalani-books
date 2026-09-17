'use strict';

const fs = require('fs');

/**
 * Quality reporting and the regression gate.
 *
 * The v1 corpus looked rich because the schema had many fields, while 69% of
 * entries were nearly empty. Fill rates are therefore treated as a first-class
 * output: `gate` fails when a field's coverage drops below the recorded
 * baseline, so a prompt or parser change cannot quietly degrade the corpus.
 */

const FILL_FIELDS = [
  ['nasab_parsed', (p) => !p.identity.nasab.rejected_reason],
  ['nasab_multi_link', (p) => (p.identity.nasab.link_count || 0) >= 2],
  ['nisba', (p) => (p.identity.nasab.nisba || []).length > 0],
  ['kunya', (p) => Boolean(p.identity.kunya)],
  ['qism', (p) => p.classification.qism != null],
  ['letter', (p) => Boolean(p.classification.letter)],
  ['summary', (p) => Boolean(p.life.summary)],
  ['death_year', (p) => p.life.death?.year_hijri != null],
  ['birth_year', (p) => p.life.birth?.year_hijri != null],
  ['conversion', (p) => (p.life.conversion || []).length > 0],
  ['companionship', (p) => (p.life.companionship || []).length > 0],
  ['battles', (p) => (p.life.battles || []).length > 0],
  ['offices', (p) => (p.life.offices || []).length > 0],
  ['family', (p) => (p.life.family || []).length > 0],
  ['residences', (p) => (p.life.residences || []).length > 0],
  ['traits', (p) => (p.life.traits || []).length > 0],
  ['narrated_from', (p) => (p.narration.narrated_from || []).length > 0],
  ['narrated_to', (p) => (p.narration.narrated_to || []).length > 0],
  ['praise', (p) => (p.narration.praise || []).length > 0],
  ['criticism', (p) => (p.narration.criticism || []).length > 0],
  ['defenses', (p) => (p.narration.defenses || []).length > 0],
  [
    'any_life_fact',
    (p) =>
      Boolean(p.life.summary) ||
      (p.life.conversion || []).length > 0 ||
      (p.life.companionship || []).length > 0 ||
      (p.life.battles || []).length > 0 ||
      (p.life.family || []).length > 0 ||
      p.life.death?.year_hijri != null,
  ],
];

function newAccumulator() {
  const counts = Object.fromEntries(FILL_FIELDS.map(([name]) => [name, 0]));
  return {
    total: 0,
    counts,
    layers: {},
    qism: {},
    sections: {},
    nasab_rejections: {},
    evidence: { verified: 0, unverified: 0, absent: 0 },
    llm_models: {},
    women: 0,
    ambiguous_numbers: 0,
  };
}

function bump(map, key) {
  const label = key == null ? 'null' : String(key);
  map[label] = (map[label] || 0) + 1;
}

function observe(acc, person) {
  acc.total += 1;

  for (const [name, predicate] of FILL_FIELDS) {
    if (predicate(person)) acc.counts[name] += 1;
  }

  for (const layer of person.extraction.layers) bump(acc.layers, layer);
  bump(acc.qism, person.classification.qism);
  bump(acc.sections, person.classification.section_type);
  if (person.identity.nasab.rejected_reason) {
    bump(acc.nasab_rejections, person.identity.nasab.rejected_reason.split(':')[0]);
  }
  if (person.identity.is_woman) acc.women += 1;
  if (person.entry.number_is_ambiguous) acc.ambiguous_numbers += 1;
  if (person.extraction.llm?.model) bump(acc.llm_models, person.extraction.llm.model);

  for (const fact of collectFacts(person)) {
    if (!fact.evidence) acc.evidence.absent += 1;
    else if (fact.confidence >= 0.85) acc.evidence.verified += 1;
    else if (fact.confidence <= 0.6) acc.evidence.unverified += 1;
  }
}

function collectFacts(person) {
  const facts = [];
  const push = (value) => {
    if (Array.isArray(value)) facts.push(...value);
    else if (value && typeof value === 'object' && 'value' in value) facts.push(value);
  };
  push(person.life.summary);
  push(person.life.conversion);
  push(person.life.companionship);
  push(person.life.battles);
  push(person.life.offices);
  push(person.life.family);
  push(person.life.residences);
  push(person.life.traits);
  push(person.life.birth?.notes);
  push(person.life.death?.notes);
  push(person.narration.hadith_count);
  push(person.narration.narrated_from);
  push(person.narration.narrated_to);
  push(person.narration.praise);
  push(person.narration.criticism);
  push(person.narration.defenses);
  return facts;
}

function finalize(acc, extra = {}) {
  const fillRates = {};
  for (const [name, count] of Object.entries(acc.counts)) {
    fillRates[name] = {
      count,
      rate: acc.total ? Number((count / acc.total).toFixed(4)) : 0,
    };
  }
  return {
    generated_at: new Date().toISOString(),
    total_persons: acc.total,
    fill_rates: fillRates,
    layers: acc.layers,
    qism_distribution: acc.qism,
    section_distribution: acc.sections,
    nasab_rejections: acc.nasab_rejections,
    nasab_rejection_rate: acc.total
      ? Number(
          (
            Object.values(acc.nasab_rejections).reduce((sum, n) => sum + n, 0) / acc.total
          ).toFixed(4)
        )
      : 0,
    evidence: acc.evidence,
    women_count: acc.women,
    ambiguous_entry_numbers: acc.ambiguous_numbers,
    llm_models: acc.llm_models,
    ...extra,
  };
}

const GATE_TOLERANCE = 0.02;

/**
 * Compare a report against a baseline. Any field losing more than the tolerance
 * is a regression; improvements are reported so the baseline can be refreshed.
 */
function compareToBaseline(report, baselinePath, { tolerance = GATE_TOLERANCE } = {}) {
  if (!fs.existsSync(baselinePath)) {
    return {
      status: 'no_baseline',
      baseline_path: baselinePath,
      regressions: [],
      improvements: [],
    };
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const regressions = [];
  const improvements = [];

  for (const [field, current] of Object.entries(report.fill_rates)) {
    const before = baseline.fill_rates?.[field];
    if (!before) continue;
    const delta = Number((current.rate - before.rate).toFixed(4));
    if (delta < -tolerance) {
      regressions.push({ field, baseline: before.rate, current: current.rate, delta });
    } else if (delta > tolerance) {
      improvements.push({ field, baseline: before.rate, current: current.rate, delta });
    }
  }

  const nasabDelta = Number(
    (report.nasab_rejection_rate - (baseline.nasab_rejection_rate ?? 0)).toFixed(4)
  );
  if (nasabDelta > tolerance) {
    regressions.push({
      field: 'nasab_rejection_rate',
      baseline: baseline.nasab_rejection_rate,
      current: report.nasab_rejection_rate,
      delta: nasabDelta,
    });
  }

  return {
    status: regressions.length ? 'fail' : 'pass',
    baseline_path: baselinePath,
    baseline_generated_at: baseline.generated_at ?? null,
    tolerance,
    regressions,
    improvements,
  };
}

module.exports = {
  newAccumulator,
  observe,
  finalize,
  compareToBaseline,
  collectFacts,
  FILL_FIELDS,
  GATE_TOLERANCE,
};
