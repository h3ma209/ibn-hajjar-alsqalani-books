'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { LlmClient } = require('../src/extract/llm-client');
const { extractLlmBio, emptyExtraction } = require('../src/extract/llm-bio');
const { parseNasab } = require('../src/names/nasab');
const { buildPersonRecord, CONFIDENCE } = require('../src/extract/merge');
const { checkValid } = require('../src/schema/validate');
const { flatten, normalizeArabic } = require('../src/util/arabic');

const fixtures = require('./fixtures/entries.json');

/**
 * Exercises the full LLM path with a stub provider: chunked requests, merged
 * results, evidence verification, and assembly into a schema-valid record.
 */

const FIXTURE = fixtures.find((f) => f.raw.entry_number === 7610);

/**
 * A quote genuinely present in the entry, and one that is not. The real quote is
 * taken from the flattened body so it cannot land halfway through a footnote
 * marker, which would make a legitimate quote look fabricated.
 */
const REAL_QUOTE = flatten(FIXTURE.raw.text_body).slice(40, 110);
const FABRICATED_QUOTE = 'هذه عبارة مختلقة لا توجد في الترجمة على الإطلاق أبدا';

function stubResponse() {
  return {
    ...emptyExtraction(),
    summary: 'صحابي له ولأبيه صحبة',
    kunya: 'أبو سعيد',
    battles: [
      { value: 'خيبر', evidence: REAL_QUOTE },
      { value: 'اليرموك', evidence: FABRICATED_QUOTE },
      { value: 'تبوك', evidence: null },
    ],
    death: {
      year_hijri: 92,
      year_candidates: [92],
      year_uncertain: false,
      place: 'المدينة',
      cause: null,
      evidence: REAL_QUOTE,
    },
    residences: [{ value: 'المدينة', evidence: REAL_QUOTE }],
    family: [{ value: 'أبوه أوس', relation: 'father', name: 'أوس', evidence: REAL_QUOTE }],
    offices: [
      {
        value: 'استعمله عمر على الصدقات',
        role: 'عامل',
        place: 'المدينة',
        appointed_by: 'عمر',
        period: null,
        evidence: REAL_QUOTE,
      },
    ],
    narration: {
      is_prolific: false,
      hadith_count: null,
      narrated_from: [{ value: 'عمر بن الخطاب', evidence: REAL_QUOTE }],
      narrated_to: [{ value: 'الزهري', evidence: null }],
      praise: [],
      criticism: [],
      defenses: [],
    },
  };
}

async function startStub(payloadFor) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      calls += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(payloadFor(calls, JSON.parse(body))) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 500, completion_tokens: 200 },
        })
      );
    });
  });
  const baseUrl = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${server.address().port}/v1`)
    );
  });
  return { server, baseUrl, callCount: () => calls };
}

function client(baseUrl) {
  return new LlmClient({
    apiKey: 'test-key',
    baseUrl,
    model: 'stub-model',
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'isabah-bio-')),
  });
}

function assemble(extraction, meta) {
  const { raw, placement } = FIXTURE;
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
    extraction,
    extractionSource: 'llm',
    meta,
  });
}

test('an LLM extraction assembles into a schema-valid person record', async (t) => {
  const stub = await startStub(() => stubResponse());
  t.after(() => stub.server.close());

  const { data, meta } = await extractLlmBio(client(stub.baseUrl), FIXTURE.raw, { qism: 1 });
  const person = assemble(data, meta);

  assert.equal(checkValid('person', person), null);
  assert.deepEqual(person.extraction.layers, ['structural', 'llm']);
  assert.equal(person.extraction.llm.model, 'stub-model');
  assert.match(person.extraction.llm.prompt_version, /^bio-extract\.v1\.md@/);
});

test('confidence follows whether the quoted evidence exists in the entry', async (t) => {
  const stub = await startStub(() => stubResponse());
  t.after(() => stub.server.close());

  const { data, meta } = await extractLlmBio(client(stub.baseUrl), FIXTURE.raw, { qism: 1 });
  const person = assemble(data, meta);
  const byValue = new Map(person.life.battles.map((b) => [b.value, b]));

  assert.equal(byValue.get('خيبر').confidence, CONFIDENCE.llmVerified);
  assert.equal(byValue.get('اليرموك').confidence, CONFIDENCE.llmUnverified);
  assert.equal(byValue.get('تبوك').confidence, CONFIDENCE.llmNoEvidence);
  assert.ok(
    byValue.get('اليرموك').confidence < byValue.get('خيبر').confidence,
    'a fabricated quote must score below a verified one'
  );
});

test('extracted values are mapped onto controlled-vocabulary keys', async (t) => {
  const stub = await startStub(() => stubResponse());
  t.after(() => stub.server.close());

  const { data, meta } = await extractLlmBio(client(stub.baseUrl), FIXTURE.raw, { qism: 1 });
  const person = assemble(data, meta);

  assert.deepEqual(
    person.life.battles.map((b) => b.key),
    ['khaybar', 'yarmuk', 'tabuk']
  );
  assert.equal(person.life.death.place_key, 'madinah');
  assert.equal(person.life.residences[0].key, 'madinah');
  assert.equal(person.life.offices[0].place_key, 'madinah');
});

test('every LLM fact is labelled with its source', async (t) => {
  const stub = await startStub(() => stubResponse());
  t.after(() => stub.server.close());

  const { data, meta } = await extractLlmBio(client(stub.baseUrl), FIXTURE.raw, { qism: 1 });
  const person = assemble(data, meta);

  const facts = [
    person.life.summary,
    ...person.life.battles,
    ...person.life.offices,
    ...person.life.family,
    ...person.narration.narrated_from,
    ...person.narration.narrated_to,
  ];
  for (const fact of facts) assert.equal(fact.source, 'llm');
});

test('a long entry issues one request per chunk and merges the results', async (t) => {
  const long = fixtures.find((f) => f.raw.entry_number === 10680);
  const stub = await startStub((call) => ({
    ...emptyExtraction(),
    battles: [{ value: call === 1 ? 'خيبر' : 'تبوك', evidence: null }],
  }));
  t.after(() => stub.server.close());

  const { data, meta } = await extractLlmBio(client(stub.baseUrl), long.raw, { qism: 1 });

  assert.ok(meta.chunks > 1, 'a 24k-character entry must be chunked');
  assert.equal(stub.callCount(), meta.chunks, 'one request per chunk');
  const values = data.battles.map((b) => b.value);
  assert.ok(values.includes('خيبر') && values.includes('تبوك'), 'chunk results must merge');
});

test('the structural layer is preserved when the LLM layer runs', async (t) => {
  const stub = await startStub(() => stubResponse());
  t.after(() => stub.server.close());

  const { data, meta } = await extractLlmBio(client(stub.baseUrl), FIXTURE.raw, { qism: 1 });
  const person = assemble(data, meta);

  // The parsed lineage comes from the deterministic layer, not the model.
  assert.equal(
    normalizeArabic(person.identity.nasab.full_name),
    normalizeArabic('مالك بن أوس بن عبد الله بن حجر الأسلمي')
  );
  assert.equal(person.identity.nasab.source, 'heading');
  assert.equal(person.identity.nasab.link_count, 3);
  assert.deepEqual(person.identity.nasab.nisba, ['الأسلمي']);
  assert.equal(person.classification.qism, 1);
});
