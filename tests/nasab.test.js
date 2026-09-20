'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  parseNasab,
  validateSegment,
  splitNisba,
  cutAtBoundary,
  SEGMENT_MAX_LEN,
  CHAIN_MAX_LINKS,
} = require('../src/names/nasab');

const fixtures = require('./fixtures/entries.json');

/** The failure mode this parser exists to prevent: prose inside the lineage. */
const PROSE_MARKERS = /[»«.،:؛0-9]|\bقال\b|\bروى\b|يأتي|تقدم|صحبة/u;

test('lineage is extracted from the heading, not from following prose', () => {
  const result = parseNasab(
    '4852- عبد اللَّه بن عمر:\nبن الخطاب»\nبن نفيل القرشي العدوي، يأتي نسبه في ترجمة أخيه، أبو عبد الرحمن.',
    { displayName: 'عبد الله بن عمر', entryNumber: 4852 }
  );
  assert.equal(result.rejected_reason, null);
  assert.equal(result.full_name, 'عبد اللَّه بن عمر بن الخطاب بن نفيل القرشي العدوي');
  assert.deepEqual(result.nisba, ['القرشي', 'العدوي']);
  assert.equal(result.kunya, 'أبو عبد الرحمن');
});

test('biographical verbs terminate the chain', () => {
  const result = parseNasab(
    '7610- مالك بن أوس\nبن عبد اللَّه بن حجر الأسلمي.\nله ولأبيه صحبة.',
    { displayName: 'مالك بن أوس', entryNumber: 7610 }
  );
  assert.equal(result.full_name, 'مالك بن أوس بن عبد اللَّه بن حجر الأسلمي');
  assert.ok(!/صحبة/.test(result.full_name));
});

test('a kunya belonging to a cited authority is not taken as the subject kunya', () => {
  const result = parseNasab(
    '7610- مالك بن أوس\nبن عبد اللَّه بن حجر الأسلمي.\nأخرج حديثه أبو نعيم من تاريخ أبي العباس.',
    { displayName: 'مالك بن أوس', entryNumber: 7610 }
  );
  assert.notEqual(result.kunya, 'أبو نعيم');
});

test('a chain running off the page does not leave a dangling link', () => {
  const result = parseNasab('277- أنس بن مالك\nبن النضر بن ضمضم بن', {
    displayName: 'أنس بن مالك',
    entryNumber: 277,
  });
  assert.ok(!/\bبن$/u.test(result.full_name), `dangling link in "${result.full_name}"`);
});

test('an unparseable heading falls back to the TOC name with a stated reason', () => {
  const result = parseNasab('قال البخاريّ: أدرك زمان النبيّ، ولا يعرف له سماع صحيح.', {
    displayName: 'فلان بن فلان',
    entryNumber: 1,
  });
  assert.equal(result.source, 'toc');
  assert.equal(result.full_name, 'فلان بن فلان');
  assert.ok(result.rejected_reason, 'a rejection must state why');
  assert.ok(result.confidence < 0.5);
});

test('segment validation rejects prose, punctuation, and overlong tokens', () => {
  assert.equal(validateSegment('مالك'), null);
  assert.equal(validateSegment('عبد اللَّه'), null);
  assert.ok(validateSegment('قال'));
  assert.ok(validateSegment('حجر الأسلمي. له ولأبيه صحبة'));
  assert.ok(validateSegment('a'.repeat(SEGMENT_MAX_LEN + 1)));
  assert.ok(validateSegment('عامر بن'));
});

test('trailing nisbas are separated from the final ancestor', () => {
  assert.deepEqual(splitNisba('كعب الدوسيّ'), { core: 'كعب', nisba: ['الدوسيّ'] });
  assert.deepEqual(splitNisba('نفيل القرشي العدوي'), {
    core: 'نفيل',
    nisba: ['القرشي', 'العدوي'],
  });
  // A bare nisba with no other word is itself the name.
  assert.deepEqual(splitNisba('الأسلمي'), { core: 'الأسلمي', nisba: [] });
});

test('descriptors that look like nisbas are not treated as lineage', () => {
  const { nisba } = splitNisba('مالك الصحابي');
  assert.deepEqual(nisba, []);
});

test('cutAtBoundary stops at a cross-reference clause', () => {
  const { name } = cutAtBoundary('فلان بن فلان القرشي يأتي نسبه في ترجمة أخيه');
  assert.equal(name, 'فلان بن فلان القرشي');
});

test('every fixture entry yields a clean lineage or an explicit rejection', () => {
  for (const { raw } of fixtures) {
    const result = parseNasab(raw.text_body, {
      displayName: raw.display_name,
      entryNumber: raw.entry_number,
    });
    const label = `entry ${raw.entry_number} (${raw.display_name})`;

    assert.ok(result.chain.length <= CHAIN_MAX_LINKS + 1, `${label}: chain too long`);
    for (const segment of result.chain) {
      assert.ok(
        segment.length <= SEGMENT_MAX_LEN,
        `${label}: segment "${segment}" exceeds ${SEGMENT_MAX_LEN} chars`
      );
    }
    if (!result.rejected_reason) {
      assert.ok(
        !PROSE_MARKERS.test(result.full_name),
        `${label}: prose leaked into lineage "${result.full_name}"`
      );
    }
  }
});

test('Abu Hurayra keeps his full Dawsi lineage', () => {
  const fixture = fixtures.find((f) => f.raw.entry_number === 10680);
  const result = parseNasab(fixture.raw.text_body, {
    displayName: fixture.raw.display_name,
    entryNumber: 10680,
  });
  assert.equal(result.rejected_reason, null);
  assert.equal(result.kunya, 'أبو هريرة');
  assert.ok(result.link_count >= 10, `expected a long chain, got ${result.link_count}`);
  assert.deepEqual(result.nisba, ['الدوسيّ']);
});
