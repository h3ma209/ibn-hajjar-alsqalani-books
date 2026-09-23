'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const { PATHS } = require('../src/config');
const { ftsMatch, parseFilters, Catalog } = require('../src/ui/catalog');

test('ftsMatch builds a column-scoped prefix query', () => {
  assert.equal(ftsMatch('أبو هريرة'), '{display_name full_name name_keys} : (أبو* AND هريرة*)');
  assert.ok(ftsMatch('هريرة', { inText: true }).includes('text_body'));
  assert.equal(ftsMatch('""'), null);
});

test('parseFilters reads v3 browse keys', () => {
  const f = parseFilters({
    q: 'خيبر',
    battle: 'khaybar',
    label: 'has_isnad',
    in_text: '1',
    entry_kind: 'biography',
  });
  assert.equal(f.battle, 'khaybar');
  assert.equal(f.label, 'has_isnad');
  assert.equal(f.in_text, true);
  assert.equal(f.entry_kind, 'biography');
});

const hasSqlite = fs.existsSync(PATHS.sqlite);

test('sqlite FTS finds Arabic inside a biography', { skip: !hasSqlite }, () => {
  const catalog = new Catalog();
  catalog.load({ log() {} });
  assert.equal(catalog.mode, 'sqlite');

  const names = catalog.search({ q: 'abu hurayra', limit: '5' });
  assert.ok(names.total >= 1);
  assert.equal(names.results[0].entry_number, 10680);

  const inText = catalog.search({ q: 'الدوسي', in_text: '1', limit: '5' });
  assert.ok(inText.total >= 1, 'FTS over text_body should hit الدوسي');

  const khaybar = catalog.search({ battle: 'khaybar', limit: '3' });
  assert.ok(khaybar.total >= 50);
  assert.ok(khaybar.results.every((row) => row.qism !== 4));

  const chapter = catalog.chapters();
  assert.ok(chapter.length >= 10);
  const first = catalog.chapter(chapter[0].id);
  assert.ok(first.title);
});
