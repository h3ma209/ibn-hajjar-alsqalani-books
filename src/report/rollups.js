'use strict';

const IN_BOOK_TYPES = new Set([
  'see_entry',
  'see_adjacent',
  'see_relation',
  'see_qism',
  'see_section',
  'see_letter',
  'family',
]);

const NARRATOR_TYPES = new Set(['narrated_from', 'narrated_to']);

function emptyBucket() {
  return { count: 0, person_ids: [] };
}

function addPerson(bucket, personId) {
  bucket.count += 1;
  if (personId && bucket.person_ids.length < 200 && !bucket.person_ids.includes(personId)) {
    bucket.person_ids.push(personId);
  }
}

function resolutionSplit(edges) {
  const split = {
    in_book: { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0 },
    narrators: { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0 },
  };

  for (const edge of edges) {
    const bucket = IN_BOOK_TYPES.has(edge.type)
      ? split.in_book
      : NARRATOR_TYPES.has(edge.type)
        ? split.narrators
        : null;
    if (!bucket) continue;
    bucket.edges += 1;
    if (edge.resolved) bucket.resolved += 1;
    else if (edge.ambiguous) bucket.ambiguous += 1;
    else bucket.unresolved += 1;
  }

  const rate = (part) => (part.edges ? Number((part.resolved / part.edges).toFixed(4)) : 0);
  return {
    ...split,
    resolution_rate_in_book: rate(split.in_book),
    resolution_rate_narrators: rate(split.narrators),
  };
}

function buildCitationReport(citations) {
  const byKey = new Map();
  for (const row of citations) {
    const key = row.authority_key || row.authority;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        key,
        label_ar: row.authority,
        count: 0,
        verbs: {},
        person_count: 0,
        person_ids: [],
        seen: new Set(),
      };
      byKey.set(key, bucket);
    }
    bucket.count += 1;
    const verb = row.verb || 'other';
    bucket.verbs[verb] = (bucket.verbs[verb] || 0) + 1;
    if (!bucket.seen.has(row.person_id)) {
      bucket.seen.add(row.person_id);
      bucket.person_count += 1;
      if (bucket.person_ids.length < 80) bucket.person_ids.push(row.person_id);
    }
  }

  const authorities = [...byKey.values()]
    .map(({ seen, ...rest }) => rest)
    .sort((a, b) => b.count - a.count);

  return {
    generated_at: new Date().toISOString(),
    authorities: authorities.length,
    citations: citations.length,
    top: authorities.slice(0, 40),
  };
}

function buildRollups(persons, { excludeQism4 = true } = {}) {
  const battles = {};
  const places = {};
  const events = {};
  let included = 0;
  let skippedQism4 = 0;

  for (const person of persons) {
    if (excludeQism4 && person.classification?.qism === 4) {
      skippedQism4 += 1;
      continue;
    }
    included += 1;

    for (const battle of person.life?.battles || []) {
      const key = battle.key || battle.value;
      if (!key) continue;
      if (!battles[key]) battles[key] = emptyBucket();
      addPerson(battles[key], person.person_id);
    }

    for (const event of person.life?.events || []) {
      const key = event.kind;
      if (!events[key]) events[key] = emptyBucket();
      addPerson(events[key], person.person_id);
    }

    const deathKey = person.life?.death?.place_key;
    if (deathKey) {
      if (!places[deathKey]) places[deathKey] = { death: emptyBucket(), residence: emptyBucket() };
      addPerson(places[deathKey].death, person.person_id);
    }
    for (const residence of person.life?.residences || []) {
      const key = residence.key;
      if (!key) continue;
      if (!places[key]) places[key] = { death: emptyBucket(), residence: emptyBucket() };
      addPerson(places[key].residence, person.person_id);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    exclude_qism4: excludeQism4,
    persons_included: included,
    skipped_qism4: skippedQism4,
    battles,
    places,
    events,
  };
}

module.exports = {
  IN_BOOK_TYPES,
  NARRATOR_TYPES,
  resolutionSplit,
  buildCitationReport,
  buildRollups,
};
