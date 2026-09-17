'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  ENTRY_RE,
  STRUCTURAL_NAME_RE,
  PERSON_ID_PATTERN,
  personId,
  buildEntries,
  buildRawTextRecord,
} = require('../src/bok/entries');

test('ENTRY_RE reads plain headings', () => {
  const match = '10680- أبو هريرة'.match(ENTRY_RE);
  assert.equal(match[1], '10680');
  assert.equal(match[3], 'أبو هريرة');
});

test('ENTRY_RE reads headings tagged with an edition marker', () => {
  const ziyada = '4850 ز- عبد الله بن علقمة'.match(ENTRY_RE);
  assert.equal(ziyada[1], '4850');
  assert.equal(ziyada[2], 'ز');
  assert.equal(ziyada[3], 'عبد الله بن علقمة');

  const bracketed = '8968 (م) - هرم بن خنبش'.match(ENTRY_RE);
  assert.equal(bracketed[1], '8968');
  assert.equal(bracketed[3], 'هرم بن خنبش');
});

test('numbered structural headings are recognised as non-biographies', () => {
  assert.ok(STRUCTURAL_NAME_RE.test('القسم الأول:'));
  assert.ok(STRUCTURAL_NAME_RE.test('نسبه ومولده'));
  assert.ok(!STRUCTURAL_NAME_RE.test('أبو هريرة'));
  assert.ok(!STRUCTURAL_NAME_RE.test('عبد الله بن عمر'));
});

test('person_id is stable, readable, and matches the published pattern', () => {
  assert.equal(personId(10680, 3881), 'isabah:9767:10680-3881');
  assert.equal(personId(10680, 3881, 1), 'isabah:9767:10680-3881.1');
  assert.match(personId(10680, 3881), new RegExp(PERSON_ID_PATTERN));
  assert.match(personId(10680, 3881, 2), new RegExp(PERSON_ID_PATTERN));
});

/** Three biographies packed onto one page, which is the common case. */
const book = {
  pages: [
    {
      id: 100,
      page: 10,
      part: '1',
      text: '1- أول\nنص الأول.\n\n2- ثاني\nنص الثاني.\n\n3- ثالث\nنص الثالث بداية',
    },
    { id: 101, page: 11, part: '1', text: 'تكملة نص الثالث.\n__________\n(1) حاشية.' },
  ],
  toc: [
    { id: 100, lvl: 5, title: '1- أول' },
    { id: 100, lvl: 5, title: '2- ثاني' },
    { id: 100, lvl: 5, title: '3- ثالث' },
  ],
};

test('entries sharing a page each get a unique id', () => {
  const { entries } = buildEntries(book);
  assert.equal(entries.length, 3);
  const ids = new Set(entries.map((e) => e.person_id));
  assert.equal(ids.size, 3, 'page id alone is not an identifier');
});

test('entries sharing a page are cut at the next heading, not merged', () => {
  const { entries } = buildEntries(book);
  const first = buildRawTextRecord(book.pages, entries[0]);
  const second = buildRawTextRecord(book.pages, entries[1]);

  assert.match(first.text_body, /نص الأول/);
  assert.ok(!/نص الثاني/.test(first.text_body), 'first entry bled into the second');
  assert.match(second.text_body, /نص الثاني/);
  assert.ok(!/نص الأول/.test(second.text_body));
});

test('an entry spanning pages keeps prose from every page and collects footnotes', () => {
  const { entries } = buildEntries(book);
  const third = buildRawTextRecord(book.pages, entries[2]);

  assert.match(third.text_body, /نص الثالث بداية/);
  assert.match(third.text_body, /تكملة نص الثالث/, 'prose after a footnote block was dropped');
  assert.ok(!/حاشية/.test(third.text_body), 'footnote text leaked into the body');
  assert.equal(third.footnotes.length, 1);
  assert.equal(third.page_start, 10);
  assert.equal(third.page_end, 11);
});

test('repeated entry numbers are flagged rather than silently shadowed', () => {
  const duplicated = {
    pages: [{ id: 1, page: 1, part: '1', text: '170- الأول\nنص.\n\n170- الثاني\nنص آخر.' }],
    toc: [
      { id: 1, lvl: 5, title: '170- الأول' },
      { id: 1, lvl: 5, title: '170- الثاني' },
    ],
  };
  const { entries, ambiguousNumbers } = buildEntries(duplicated);
  assert.deepEqual(ambiguousNumbers, [170]);
  assert.ok(entries.every((e) => e.entry_number_is_ambiguous));
  assert.equal(new Set(entries.map((e) => e.person_id)).size, 2);
});
