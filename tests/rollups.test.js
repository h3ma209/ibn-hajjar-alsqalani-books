'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { resolutionSplit, buildCitationReport, buildRollups } = require('../src/report/rollups');

test('resolution split scores in-book pointers apart from narrators', () => {
  const split = resolutionSplit([
    { type: 'see_adjacent', resolved: true, ambiguous: false },
    { type: 'see_relation', resolved: false, ambiguous: true },
    { type: 'family', resolved: true, ambiguous: false },
    { type: 'narrated_from', resolved: false, ambiguous: false },
    { type: 'narrated_to', resolved: false, ambiguous: false },
    { type: 'narrated_from', resolved: true, ambiguous: false },
  ]);
  assert.equal(split.in_book.edges, 3);
  assert.equal(split.in_book.resolved, 2);
  assert.equal(split.resolution_rate_in_book, 0.6667);
  assert.equal(split.narrators.edges, 3);
  assert.equal(split.narrators.resolved, 1);
  assert.equal(split.resolution_rate_narrators, 0.3333);
});

test('citation report groups verbs and person ids per authority', () => {
  const report = buildCitationReport([
    { person_id: 'isabah:9767:1-10', authority: 'ابن سعد', authority_key: 'ibn_sad', verb: 'ذكره' },
    { person_id: 'isabah:9767:1-10', authority: 'ابن سعد', authority_key: 'ibn_sad', verb: 'قال' },
    { person_id: 'isabah:9767:2-10', authority: 'ابن سعد', authority_key: 'ibn_sad', verb: 'ذكره' },
    { person_id: 'isabah:9767:3-10', authority: 'البخاري', authority_key: 'al_bukhari', verb: 'أخرج' },
  ]);
  assert.equal(report.authorities, 2);
  assert.equal(report.citations, 4);
  assert.equal(report.top[0].key, 'ibn_sad');
  assert.equal(report.top[0].count, 3);
  assert.equal(report.top[0].person_count, 2);
  assert.equal(report.top[0].verbs.ذكره, 2);
  assert.equal(report.top[0].verbs.قال, 1);
});

test('battle and place rollups exclude qism 4 unless asked', () => {
  const persons = [
    {
      person_id: 'isabah:9767:1-10',
      classification: { qism: 1 },
      life: {
        battles: [{ key: 'badr' }],
        events: [{ kind: 'battle' }],
        death: { place_key: 'kufa' },
        residences: [{ key: 'medina' }],
      },
    },
    {
      person_id: 'isabah:9767:2-10',
      classification: { qism: 4 },
      life: {
        battles: [{ key: 'badr' }],
        events: [{ kind: 'battle' }],
        death: { place_key: 'kufa' },
        residences: [],
      },
    },
  ];

  const safe = buildRollups(persons);
  assert.equal(safe.skipped_qism4, 1);
  assert.equal(safe.persons_included, 1);
  assert.equal(safe.battles.badr.count, 1);
  assert.deepEqual(safe.battles.badr.person_ids, ['isabah:9767:1-10']);
  assert.equal(safe.places.kufa.death.count, 1);
  assert.equal(safe.places.medina.residence.count, 1);
  assert.equal(safe.events.battle.count, 1);

  const all = buildRollups(persons, { excludeQism4: false });
  assert.equal(all.skipped_qism4, 0);
  assert.equal(all.battles.badr.count, 2);
  assert.equal(all.places.kufa.death.count, 2);
});
