'use strict';

const { PATHS, ensureDirs } = require('../config');
const { JsonlWriter, loadJsonl, writeJson } = require('../util/jsonl');
const { writerValidator } = require('../schema/validate');
const { normalizeArabic } = require('../util/arabic');
const { buildGenealogy } = require('../graph/genealogy');
const { checkValid } = require('../schema/validate');

function nameRows(person) {
  const rows = [];
  const push = (form, kind, source = 'structural') => {
    if (!form) return;
    rows.push({
      person_id: person.person_id,
      form,
      form_norm: normalizeArabic(form),
      kind,
      source,
    });
  };
  push(person.identity.display_name, 'display');
  push(person.identity.nasab.full_name, 'full_nasab');
  push(person.identity.kunya, 'kunya');
  push(person.identity.laqab, 'laqab');
  for (const fact of person.identity.alternate_names || []) {
    push(fact.value, fact.kind || 'other', fact.source);
  }
  for (const fact of person.identity.name_dispute_notes || []) {
    const bits = String(fact.value).split(/قيل |ويقال |فقيل /u).slice(1, 6);
    for (const bit of bits) {
      const name = bit.replace(/[،.].*$/u, '').trim();
      if (name.length >= 3 && name.length <= 40) push(name, 'dispute', fact.source);
    }
  }
  return rows;
}

function bump(map, key) {
  if (key == null || key === '') return;
  map[key] = (map[key] || 0) + 1;
}

async function enrich({ log = () => {} } = {}) {
  ensureDirs();
  const persons = await loadJsonl(PATHS.persons);
  log(`enrich loaded ${persons.length} persons`);

  const genealogy = buildGenealogy(persons);
  const geneWriter = new JsonlWriter(PATHS.genealogy);
  for (const edge of genealogy) await geneWriter.write(edge);
  const geneResult = await geneWriter.close();

  const nameWriter = new JsonlWriter(PATHS.names, { validate: writerValidator('name') });
  let nameCount = 0;
  for (const person of persons) {
    for (const row of nameRows(person)) {
      const problem = checkValid('name', row);
      if (problem) continue;
      await nameWriter.write(row);
      nameCount += 1;
    }
  }
  await nameWriter.close();

  const facets = {
    qism: {},
    letter: {},
    marker: {},
    entry_kind: {},
    label: {},
    nisba: {},
    battle: {},
    event: {},
    origin: {},
  };
  for (const person of persons) {
    if (person.classification.qism === 4) {
      bump(facets.qism, 4);
      bump(facets.entry_kind, person.entry.kind);
      continue;
    }
    bump(facets.qism, person.classification.qism);
    bump(facets.letter, person.classification.letter);
    bump(facets.marker, person.entry.marker || 'none');
    bump(facets.entry_kind, person.entry.kind);
    bump(facets.origin, person.classification.origin);
    for (const label of person.labels || []) bump(facets.label, label.key);
    for (const key of person.classification.nisba_keys || []) bump(facets.nisba, key);
    for (const battle of person.life.battles || []) bump(facets.battle, battle.key);
    for (const event of person.life.events || []) bump(facets.event, event.kind);
  }

  writeJson(PATHS.facets, {
    generated_at: new Date().toISOString(),
    note: 'qism 4 excluded from non-qism facet counts',
    facets,
    genealogy_edges: geneResult.count,
    names: nameCount,
  });

  log(`wrote ${geneResult.count} genealogy edges, ${nameCount} names, facets at ${PATHS.facets}`);
  return { genealogy: geneResult.count, names: nameCount, facets };
}

module.exports = { enrich, nameRows };
