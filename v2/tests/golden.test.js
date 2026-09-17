'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseNasab } = require('../src/names/nasab');
const { extractRegexBio } = require('../src/extract/regex-bio');
const { buildPersonRecord, buildIndexRow } = require('../src/extract/merge');
const { chunkText, makeEvidenceVerifier, mergeExtractions } = require('../src/extract/llm-bio');
const { resolve: resolveVocab } = require('../src/vocab');

const fixtures = require('./fixtures/entries.json');

function personFor(entryNumber) {
  const fixture = fixtures.find((f) => f.raw.entry_number === entryNumber);
  assert.ok(fixture, `fixture ${entryNumber} is missing`);
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
    meta: { version: 'test', extracted_at: '2026-01-01T00:00:00.000Z' },
  });
}

test('a long kunya-section entry is placed and identified correctly', () => {
  const person = personFor(10680);
  assert.equal(person.identity.display_name, 'أبو هريرة');
  assert.equal(person.identity.kunya, 'أبو هريرة');
  assert.equal(person.classification.section_type, 'kunya');
  assert.equal(person.classification.qism, 1);
  assert.equal(person.identity.nasab.rejected_reason, null);
  assert.ok(person.entry.char_len > 20000);
});

test('a short stub still produces a complete, valid record', () => {
  const person = personFor(102);
  assert.equal(person.identity.display_name, 'أسد بن عبد الله');
  assert.equal(person.identity.nasab.rejected_reason, null);
  assert.ok(person.entry.char_len < 500);
  assert.deepEqual(person.extraction.layers, ['structural', 'regex']);
});

test('women-section entries are marked as women', () => {
  for (const fixture of fixtures) {
    if (fixture.placement.placement.section_type !== 'women') continue;
    const person = personFor(fixture.raw.entry_number);
    assert.equal(person.identity.is_woman, true, `entry ${fixture.raw.entry_number}`);
  }
});

test('qism and toc_heading are separate fields and never conflated', () => {
  for (const fixture of fixtures) {
    const person = personFor(fixture.raw.entry_number);
    const { qism, qism_label: label, toc_heading: heading } = person.classification;
    if (qism != null) {
      assert.match(label, /^(?:الأول|الثاني|الثالث|الرابع)/u);
      assert.notEqual(label, heading, 'qism_label must not be a TOC heading');
    }
  }
});

test('a qism 4 entry is labelled as a disputed attribution', () => {
  const fixture = fixtures.find((f) => f.placement.placement.qism === 4);
  assert.ok(fixture, 'no qism 4 fixture available');
  const person = personFor(fixture.raw.entry_number);
  assert.equal(person.classification.qism, 4);
  assert.match(person.classification.qism_label, /غلطا|تصحيف/u);
});

test('every regex-layer fact is labelled with its source and low confidence', () => {
  const person = personFor(4852);
  const facts = [
    ...person.life.conversion,
    ...person.life.companionship,
    ...person.life.battles,
    ...person.life.traits,
    ...person.narration.narrated_from,
    ...person.narration.narrated_to,
  ];
  for (const fact of facts) {
    assert.equal(fact.source, 'regex');
    assert.ok(fact.confidence <= 0.3, 'regex output must not claim high confidence');
  }
});

test('battles resolve to controlled-vocabulary keys', () => {
  assert.equal(resolveVocab('battles', 'خيبر'), 'khaybar');
  assert.equal(resolveVocab('battles', 'يوم اليرموك'), 'yarmuk');
  assert.equal(resolveVocab('battles', 'شهد فتح مكة مع النبي'), 'fath_makkah');
  assert.equal(resolveVocab('battles', 'شيء غير معروف'), null);
  assert.equal(resolveVocab('places', 'المدينة'), 'madinah');
});

test('the index row carries the fields needed to browse without the full record', () => {
  const row = buildIndexRow(personFor(10680));
  for (const field of ['person_id', 'entry_number', 'display_name', 'qism', 'section_type', 'letter']) {
    assert.ok(row[field] != null, `index row is missing ${field}`);
  }
});

test('long entries are chunked on paragraph boundaries within the size limit', () => {
  const fixture = fixtures.find((f) => f.raw.entry_number === 10680);
  const chunks = chunkText(fixture.raw.text_body);
  assert.ok(chunks.length > 1, 'a 24k-character entry must be split');
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 9000, `chunk of ${chunk.length} exceeds the limit`);
  }
  const rejoined = chunks.join('').replace(/\s+/g, '');
  assert.ok(rejoined.length > 0.95 * fixture.raw.text_body.replace(/\s+/g, '').length);
});

test('quoted evidence is verified against the source text', () => {
  const fixture = fixtures.find((f) => f.raw.entry_number === 7610);
  const verify = makeEvidenceVerifier(fixture.raw.text_body);
  const realQuote = fixture.raw.text_body.slice(30, 90);
  assert.equal(verify(realQuote), 'verified');
  assert.equal(verify('هذا نص لم يرد في الترجمة أبدا ولا يوجد فيها'), 'unverified');
  assert.equal(verify(null), 'absent');
});

/**
 * A model reproducing a clause exactly still tends to close it with a period
 * where the edition has an Arabic comma or nothing at all. Scoring that as an
 * unsupported quote mislabels correct extractions, so punctuation and the
 * opening connective are ignored while wording still has to match.
 */
test('a quote differing only in punctuation still verifies', () => {
  const source = 'وشهد أبان بدرا مشركا، فقتل بها أخواه العاص وعبيدة على الشرك، ونجا أبان';
  const verify = makeEvidenceVerifier(source);

  assert.equal(verify('شهد أبان بدرا مشركا.'), 'verified', 'trailing period');
  assert.equal(verify('فشهد أبان بدرا مشركا'), 'verified', 'swapped opening connective');
  assert.equal(verify('فقتل بها أخواه العاص وعبيدة على الشرك'), 'verified');
  assert.equal(verify('شهد أبان بدرا مسلما.'), 'unverified', 'a changed word is not a quote');
  assert.equal(verify('وشهد أبان تبوك مشركا'), 'unverified', 'a swapped battle is not a quote');
});

test('reordered or invented wording is still rejected', () => {
  const verify = makeEvidenceVerifier('بعث رسول الله أبان بن سعيد على سرية قبل نجد');
  assert.equal(verify('بعث رسول الله أبان بن سعيد على سرية قبل نجد.'), 'verified');
  assert.equal(verify('بعث رسول الله أبان بن سعيد على سرية قبل الشام'), 'unverified');
  assert.equal(verify('على سرية قبل نجد بعث رسول الله أبان'), 'unverified');
});

test('per-chunk extractions merge without duplicating facts', () => {
  const chunkA = {
    summary: 'ملخص',
    battles: [{ value: 'خيبر', evidence: null }],
    death: { year_hijri: 57, year_candidates: [57], year_uncertain: false, place: null, cause: null, evidence: null },
    narration: { narrated_to: [{ value: 'ابن عمر', evidence: null }] },
  };
  const chunkB = {
    battles: [{ value: 'خيبر', evidence: null }, { value: 'تبوك', evidence: null }],
    death: { year_hijri: 58, year_candidates: [58], year_uncertain: false, place: null, cause: null, evidence: null },
    narration: { narrated_to: [{ value: 'ابن عمر', evidence: null }, { value: 'أنس', evidence: null }] },
  };

  const merged = mergeExtractions([chunkA, chunkB]);
  assert.deepEqual(merged.battles.map((b) => b.value), ['خيبر', 'تبوك']);
  assert.deepEqual(merged.narration.narrated_to.map((n) => n.value), ['ابن عمر', 'أنس']);
  assert.deepEqual(merged.death.year_candidates, [57, 58]);
  assert.equal(merged.death.year_uncertain, true, 'competing years must be marked uncertain');
});
