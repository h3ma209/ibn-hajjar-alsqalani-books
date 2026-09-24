'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { matchIdentities, nameKey, pageMapRow } = require('../src/graph/identity');
const { assertValid, checkValid } = require('../src/schema/validate');

function mini(id, { ism, father, chain, book = 'isabah', display } = {}) {
  return {
    person_id: id,
    book: { slug: book, book_id: 1 },
    identity: {
      display_name: display || ism,
      nasab: {
        ism,
        father,
        chain,
        full_name: [ism, ...chain].join(' بن '),
      },
    },
    entry: {
      start_id: 10,
      end_id: 12,
      page_start: 168,
      page_end: 171,
      pdf_page: null,
    },
  };
}

test('nameKey folds ism+father', () => {
  const person = mini('isabah:9767:1-10', {
    ism: 'محمد',
    father: 'عبد الله',
    chain: ['محمد', 'عبد الله', 'عبد المطلب'],
  });
  assert.equal(nameKey(person), 'محمد|عبد الله');
});

test('unique name+nasab overlap links across books', () => {
  const source = mini('isabah:9767:1-10', {
    ism: 'سعد',
    father: 'أبي وقاص',
    chain: ['سعد', 'أبي وقاص', 'أهيب'],
  });
  const target = mini('tabaqat:123:9-99', {
    ism: 'سعد',
    father: 'أبي وقاص',
    chain: ['سعد', 'أبي وقاص', 'أهيب', 'مناف'],
    book: 'tabaqat',
  });
  const links = matchIdentities([source], [target]);
  assert.equal(links.length, 1);
  assert.equal(links[0].from_id, source.person_id);
  assert.equal(links[0].to_id, target.person_id);
  assert.equal(links[0].method, 'name_nasab');
  assert.ok(links[0].score >= 0.7);
  assertValid('identityLink', links[0]);
});

test('ambiguous same name stays unlinked', () => {
  const source = mini('isabah:9767:1-10', {
    ism: 'زيد',
    father: 'عمرو',
    chain: ['زيد', 'عمرو'],
  });
  const a = mini('tabaqat:1:1-1', { ism: 'زيد', father: 'عمرو', chain: ['زيد', 'عمرو'], book: 'tabaqat' });
  const b = mini('tabaqat:1:2-2', { ism: 'زيد', father: 'عمرو', chain: ['زيد', 'عمرو'], book: 'tabaqat' });
  assert.deepEqual(matchIdentities([source], [a, b]), []);
});

test('same person_id is not linked to itself', () => {
  const person = mini('isabah:9767:1-10', {
    ism: 'خالد',
    father: 'الوليد',
    chain: ['خالد', 'الوليد'],
  });
  assert.deepEqual(matchIdentities([person], [person]), []);
});

test('no second corpus yields empty links', () => {
  const source = mini('isabah:9767:1-10', {
    ism: 'خالد',
    father: 'الوليد',
    chain: ['خالد', 'الوليد'],
  });
  assert.deepEqual(matchIdentities([source], []), []);
});

test('page-map stub keeps pdf_page null', () => {
  const row = pageMapRow(
    mini('isabah:9767:2-154', {
      ism: 'أبان',
      father: 'سعيد',
      chain: ['أبان', 'سعيد'],
    })
  );
  assert.equal(row.pdf_page, null);
  assert.equal(row.page_start, 168);
  assert.equal(row.source, 'shamela');
  assertValid('pageMap', row);
});

test('person schema accepts optional pdf_page', () => {
  const fixtures = require('./fixtures/entries.json');
  const { buildPersonRecord } = require('../src/extract/merge');
  const { parseNasab } = require('../src/names/nasab');
  const { extractRegexBio } = require('../src/extract/regex-bio');
  const fixture = fixtures[0];
  const nasab = parseNasab(fixture.raw.text_body, {
    displayName: fixture.raw.display_name,
    entryNumber: fixture.raw.entry_number,
  });
  const person = buildPersonRecord({
    entry: {
      person_id: fixture.raw.person_id,
      entry_number: fixture.raw.entry_number,
      entry_number_is_ambiguous: fixture.placement.entry_number_is_ambiguous,
      start_id: fixture.raw.start_id,
      end_id: fixture.raw.end_id,
      volume: fixture.raw.volume,
      page_start: fixture.raw.page_start,
      page_end: fixture.raw.page_end,
      display_name: fixture.raw.display_name,
      display_name_norm: fixture.placement.display_name_norm,
    },
    raw: fixture.raw,
    placement: fixture.placement.placement,
    nasab,
    extraction: extractRegexBio(fixture.raw.text_body, {
      qism: fixture.placement.placement.qism,
      sectionType: fixture.placement.placement.section_type,
    }),
    extractionSource: 'regex',
    meta: { version: 'test', extracted_at: new Date().toISOString() },
    entryMarker: fixture.placement.entry_marker ?? null,
  });
  assert.equal(person.entry.pdf_page, null);
  assert.equal(checkValid('person', person), null);
  person.entry.pdf_page = 42;
  assert.equal(checkValid('person', person), null);
});
