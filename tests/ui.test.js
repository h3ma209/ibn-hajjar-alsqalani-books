'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');

const { PATHS } = require('../src/config');
const { Catalog, parseFilters, scoreHit, LATIN_ALIASES } = require('../src/ui/catalog');

test('parseFilters reads paging, qism, and woman flags', () => {
  const f = parseFilters({ q: 'عمر', qism: '4', woman: '1', limit: '12', offset: '40' });
  assert.equal(f.q, 'عمر');
  assert.equal(f.qism, 4);
  assert.equal(f.woman, true);
  assert.equal(f.limit, 12);
  assert.equal(f.offset, 40);
});

test('scoreHit ranks exact names above contains', () => {
  const row = {
    entry_number: 10680,
    display_name_norm: 'ابو هريره',
    full_name_norm: 'ابو هريره بن عامر',
  };
  assert.equal(scoreHit(row, 'ابو هريره', 'أبو هريرة'), 1);
  assert.equal(scoreHit(row, 'هريره', 'هريرة'), 3);
  assert.equal(scoreHit(row, 'xxx', 'xxx'), null);
  assert.equal(scoreHit(row, 'nope', '10680'), 0);
});

test('latin aliases include the names the CLI already taught', () => {
  assert.equal(LATIN_ALIASES['abu hurayra'], 'أبو هريرة');
  assert.equal(LATIN_ALIASES.aisha, 'عائشة');
});

const hasCorpus = fs.existsSync(PATHS.index) && fs.existsSync(PATHS.persons);

test('catalog search and person lookup against the built corpus', { skip: !hasCorpus }, () => {
  const catalog = new Catalog();
  catalog.load({ log() {} });

  const hits = catalog.search({ q: 'abu hurayra', limit: '5' });
  assert.ok(hits.total >= 1);
  assert.equal(hits.results[0].entry_number, 10680);
  assert.equal(hits.resolved_query, 'أبو هريرة');

  const byNumber = catalog.person('10680');
  assert.equal(byNumber.person.identity.display_name, 'أبو هريرة');
  assert.ok(byNumber.citations.length > 0);

  const raw = catalog.raw(byNumber.person.person_id);
  assert.match(raw.text_body, /أبو هريرة/);

  const women = catalog.search({ woman: '1', section: 'women', limit: '3' });
  assert.ok(women.total > 1000);
  assert.ok(women.results.every((row) => row.is_woman && row.section_type === 'women'));

  const qism4 = catalog.search({ qism: '4', limit: '1' });
  assert.equal(qism4.results[0].qism, 4);

  const graph = catalog.neighborhood(byNumber.person.person_id);
  assert.equal(graph.center, byNumber.person.person_id);
  assert.ok(graph.nodes.length >= 1);
});

test('HTTP API serves meta, search, and a person record', { skip: !hasCorpus }, async (t) => {
  const { startUi } = require('../src/ui/server');
  const { server, url } = await startUi({ port: 0, host: '127.0.0.1', log() {} });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const addr = `http://127.0.0.1:${server.address().port}`;
  const get = (path) =>
    new Promise((resolve, reject) => {
      http.get(`${addr}${path}`, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }).on('error', reject);
    });

  const meta = await get('/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.counts.persons, 11931);
  assert.equal(meta.body.book.slug, 'isabah');

  const search = await get('/api/search?q=10680');
  assert.equal(search.body.results[0].display_name, 'أبو هريرة');

  const person = await get(`/api/person/${encodeURIComponent(search.body.results[0].person_id)}`);
  assert.equal(person.body.person.classification.section_type, 'kunya');

  assert.equal(url.startsWith('http://127.0.0.1:'), true);
});
