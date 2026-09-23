'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseNasab } = require('../src/names/nasab');
const { extractRegexBio } = require('../src/extract/regex-bio');
const { buildPersonRecord } = require('../src/extract/merge');
const { checkValid } = require('../src/schema/validate');
const { extractEvents } = require('../src/classify/events');
const { labelPassages, labelSentence } = require('../src/classify/spans');
const { suffixOverlap } = require('../src/graph/genealogy');

const fixtures = require('./fixtures/entries.json');

function personFor(entryNumber) {
  const fixture = fixtures.find((f) => f.raw.entry_number === entryNumber);
  const { raw, placement } = fixture;
  return buildPersonRecord({
    entry: {
      person_id: raw.person_id,
      entry_number: raw.entry_number,
      entry_number_is_ambiguous: placement.entry_number_is_ambiguous,
      start_id: raw.start_id,
      end_id: raw.end_id,
      volume: raw.volume,
      page_start: raw.page_start,
      page_end: raw.page_end,
      display_name: raw.display_name,
      display_name_norm: placement.display_name_norm,
    },
    raw,
    placement: placement.placement,
    nasab: parseNasab(raw.text_body, {
      displayName: raw.display_name,
      entryNumber: raw.entry_number,
    }),
    extraction: extractRegexBio(raw.text_body, {
      qism: placement.placement.qism,
      sectionType: placement.placement.section_type,
    }),
    extractionSource: 'regex',
    meta: { version: 'test', extracted_at: '2026-01-01T00:00:00.000Z' },
    entryMarker: placement.entry_marker ?? null,
  });
}

test('v3 person records validate and carry labels, features, events', () => {
  for (const fixture of fixtures) {
    const person = personFor(fixture.raw.entry_number);
    assert.equal(checkValid('person', person), null, `entry ${fixture.raw.entry_number}`);
    assert.equal(person.schema_version, '3.0.0');
    assert.ok(person.entry.kind);
    assert.ok(person.entry.length_class);
    assert.ok(Array.isArray(person.labels));
    assert.ok(person.features);
    assert.ok(person.features.label_coverage >= 0);
  }
});

test('ز marker becomes added_zay label', () => {
  const person = personFor(102);
  assert.equal(person.entry.marker, 'ز');
  assert.ok(person.labels.some((row) => row.key === 'added_zay'));
});

test('qism 4 is classified as qism4_refutation', () => {
  const fixture = fixtures.find((f) => f.placement.placement.qism === 4);
  const person = personFor(fixture.raw.entry_number);
  assert.equal(person.entry.kind, 'qism4_refutation');
  assert.ok(person.labels.some((row) => row.key === 'qism4'));
});

test('known and unknown battles both extract; wound and wufd classify', () => {
  const text = 'شهد بدرا وخيبر، وجرح يوم أحد، ووفد على النبي، وغزا غزوة لا اسم لها في المعجم';
  const events = extractEvents(text, { source: 'regex', confidence: 0.3 });
  assert.ok(events.some((e) => e.key === 'badr'));
  assert.ok(events.some((e) => e.key === 'khaybar'));
  assert.ok(events.some((e) => e.kind === 'wound'));
  assert.ok(events.some((e) => e.kind === 'wufd'));
});

test('every sentence gets a label or unlabeled, offsets inside text', () => {
  const text = '1- زيد بن عمرو.\nشهد بدرا. قلت: هذا وهم.';
  const spans = labelPassages('isabah:9767:1-10', text);
  assert.ok(spans.length >= 2);
  for (const span of spans) {
    assert.ok(span.end <= text.length);
    assert.equal(text.slice(span.start, span.end), span.quote);
    assert.ok(span.label);
  }
  assert.equal(labelSentence('قلت: والصواب خلاف ذلك'), 'ibn_hajar_voice');
});

test('genealogy suffix overlap scores shared ancestors', () => {
  assert.ok(suffixOverlap(['زيد', 'عمرو', 'قصي'], ['عمرو', 'قصي']) >= 2);
  assert.equal(suffixOverlap(['زيد'], ['بكر']), 0);
});
