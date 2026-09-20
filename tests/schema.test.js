'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { assertValid, checkValid } = require('../src/schema/validate');
const { parseNasab } = require('../src/names/nasab');
const { extractRegexBio } = require('../src/extract/regex-bio');
const { buildPersonRecord } = require('../src/extract/merge');

const fixtures = require('./fixtures/entries.json');

function personFrom(fixture) {
  const { raw, placement } = fixture;
  const nasab = parseNasab(raw.text_body, {
    displayName: raw.display_name,
    entryNumber: raw.entry_number,
  });
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
    nasab,
    extraction: extractRegexBio(raw.text_body, {
      qism: placement.placement.qism,
      sectionType: placement.placement.section_type,
    }),
    extractionSource: 'regex',
    meta: { version: 'test', extracted_at: new Date().toISOString() },
  });
}

test('every fixture builds a schema-valid person record', () => {
  for (const fixture of fixtures) {
    const person = personFrom(fixture);
    assert.equal(
      checkValid('person', person),
      null,
      `entry ${fixture.raw.entry_number} failed validation`
    );
  }
});

test('every fixture raw-text record is schema-valid', () => {
  for (const fixture of fixtures) {
    assert.equal(checkValid('rawText', fixture.raw), null);
  }
});

test('a missing required field is rejected', () => {
  const person = personFrom(fixtures[0]);
  delete person.classification;
  assert.ok(checkValid('person', person));
});

test('an unexpected field is rejected, so schema drift cannot pass silently', () => {
  const person = personFrom(fixtures[0]);
  person.surprise = 'unexpected';
  assert.ok(checkValid('person', person));
});

test('a malformed person_id is rejected', () => {
  const person = personFrom(fixtures[0]);
  person.person_id = 'not-an-id';
  assert.ok(checkValid('person', person));
});

test('an out-of-range qism is rejected', () => {
  const person = personFrom(fixtures[0]);
  person.classification.qism = 7;
  assert.ok(checkValid('person', person));
});

test('a fact without a source is rejected', () => {
  const person = personFrom(fixtures[0]);
  person.life.traits = [{ value: 'كان طويلا', confidence: 0.5 }];
  assert.ok(checkValid('person', person));
});

test('confidence outside 0..1 is rejected', () => {
  const person = personFrom(fixtures[0]);
  person.life.traits = [{ value: 'كان طويلا', source: 'regex', confidence: 4 }];
  assert.ok(checkValid('person', person));
});

test('assertValid throws with the offending person_id in the message', () => {
  const person = personFrom(fixtures[0]);
  person.classification.section_type = 'nonsense';
  assert.throws(() => assertValid('person', person), new RegExp(person.person_id));
});

test('edge and citation records validate', () => {
  assert.equal(
    checkValid('edge', {
      from_person_id: 'isabah:9767:1-10',
      to_person_id: null,
      to_literal: 'ابن عمر',
      type: 'narrated_to',
      source: 'regex',
      evidence: 'روى عنه ابن عمر',
      confidence: 0.3,
      resolved: false,
      ambiguous: false,
    }),
    null
  );
  assert.equal(
    checkValid('citation', {
      person_id: 'isabah:9767:1-10',
      authority: 'ابن مندة',
      authority_key: 'ibn_manda',
      verb: 'ذكره',
      evidence: 'ذكره ابن مندة',
      source: 'structural',
      confidence: 0.8,
    }),
    null
  );
});
