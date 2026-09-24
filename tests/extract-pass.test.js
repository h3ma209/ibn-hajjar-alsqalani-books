'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { shouldCheckpoint, writeCheckpoint, readCheckpoint } = require('../src/extract/checkpoint');
const {
  selectRepair,
  selectKinds,
  selectSpans,
  selectVerdicts,
  selectHadith,
  PASSES,
} = require('../src/extract/passes');
const { applyKinds, applyRepairs, applyHadith, deriveTimeline } = require('../src/extract/apply-pass');
const { runPass } = require('../src/extract/pass-runner');
const { CONFIDENCE } = require('../src/extract/merge');
const { assertValid } = require('../src/schema/validate');

function personStub(overrides = {}) {
  return {
    person_id: 'isabah:9767:1-10',
    entry: { number: 1, kind: 'biography', flags: [] },
    classification: { qism: 1, entry_kind: 'biography' },
    identity: { display_name: 'زيد', alternate_names: [], name_dispute_notes: [] },
    life: {
      conversion: [],
      companionship: [],
      battles: [{ value: 'بدر', key: 'badr', source: 'regex' }],
      offices: [],
      family: [],
      residences: [],
      traits: [],
      events: [{ value: 'وفد على النبي', kind: 'incident', source: 'regex' }],
      wounds: [],
      birth: { year_hijri: null },
      death: { year_hijri: 11, cause: 'طاعون', source: 'regex' },
    },
    narration: {
      praise: [],
      criticism: [{ value: 'لا يصح', kind: 'other', source: 'llm', evidence: 'لا يصح هذا' }],
      defenses: [{ value: 'والصواب ثبوته', kind: 'other', source: 'llm' }],
      hadith_count: { value: 'نحو خمسة آلاف', count: null, source: 'llm', confidence: 0.7 },
      verdict_keys: [],
    },
    cited_authorities: [],
    cross_references: [],
    ...overrides,
  };
}

test('shouldCheckpoint fires every N fetched persons', () => {
  assert.equal(shouldCheckpoint(0, 50), false);
  assert.equal(shouldCheckpoint(49, 50), false);
  assert.equal(shouldCheckpoint(50, 50), true);
  assert.equal(shouldCheckpoint(100, 50), true);
  assert.equal(shouldCheckpoint(51, 50), false);
});

test('writeCheckpoint is atomic and readable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isabah-ckpt-'));
  const file = path.join(dir, 'checkpoint.json');
  writeCheckpoint(file, { kind: 'extract-pass-checkpoint', fetched: 50, pass: 'spans' });
  const loaded = readCheckpoint(file);
  assert.equal(loaded.fetched, 50);
  assert.equal(loaded.pass, 'spans');
  assert.ok(loaded.written_at);
});

test('selectRepair only keeps unverified LLM quotes', () => {
  const text = 'شهد بدرا وأحدا ومات بالمدينة.';
  const person = personStub({
    narration: {
      praise: [],
      criticism: [
        {
          value: 'شهد بدرا',
          kind: 'other',
          source: 'llm',
          evidence: 'this quote is not in the text at all',
          confidence: 0.55,
        },
        {
          value: 'مات بالمدينة',
          kind: 'other',
          source: 'llm',
          evidence: 'ومات بالمدينة',
          confidence: 0.9,
        },
      ],
      defenses: [],
      verdict_keys: [],
    },
  });
  const selected = selectRepair({
    persons: [person],
    rawById: new Map([[person.person_id, { text_body: text }]]),
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].items.length, 1);
  assert.equal(selected[0].items[0].value, 'شهد بدرا');
});

test('selectKinds only leftover other/incident', () => {
  const person = personStub();
  const selected = selectKinds({
    persons: [person],
    rawById: new Map([[person.person_id, { text_body: 'وفد على النبي لا يصح' }]]),
  });
  assert.equal(selected.length, 1);
  const fields = selected[0].items.map((i) => i.field).sort();
  assert.deepEqual(fields, ['life.events', 'narration.criticism', 'narration.defenses']);
});

test('selectSpans skips stubs and already-labeled sentences', () => {
  const stub = personStub({ entry: { number: 1, kind: 'name_only', flags: [] } });
  const bio = personStub({ person_id: 'isabah:9767:2-20', entry: { number: 2, kind: 'biography', flags: [] } });
  const unlabeledText = 'كان رجلا من أهل اليمن يسكن البادية مع قومه.';
  const selected = selectSpans({
    persons: [stub, bio],
    rawById: new Map([
      [stub.person_id, { text_body: unlabeledText }],
      [bio.person_id, { text_body: unlabeledText }],
    ]),
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].person_id, bio.person_id);
  assert.ok(selected[0].items.length >= 1);
});

test('selectVerdicts picks qism 4 and cue hits', () => {
  const q4 = personStub({
    person_id: 'isabah:9767:4-40',
    classification: { qism: 4, entry_kind: 'qism4_refutation' },
    narration: { praise: [], criticism: [], defenses: [], verdict_keys: [] },
  });
  const quiet = personStub({
    person_id: 'isabah:9767:5-50',
    narration: { praise: [], criticism: [], defenses: [], verdict_keys: [] },
  });
  const selected = selectVerdicts({
    persons: [q4, quiet],
    rawById: new Map([
      [q4.person_id, { text_body: 'ذكره بعضهم وليس كذلك.' }],
      [quiet.person_id, { text_body: 'شهد أحدا.' }],
    ]),
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].person_id, q4.person_id);
});

test('selectHadith only unparsed counts', () => {
  const person = personStub();
  const selected = selectHadith({
    persons: [person],
    rawById: new Map([[person.person_id, { text_body: 'له نحو خمسة آلاف حديث' }]]),
  });
  assert.equal(selected.length, 1);
});

test('applyKinds + applyRepairs + deriveTimeline', () => {
  const person = personStub();
  const n = applyKinds(person, {
    assignments: [
      { field: 'life.events', index: 0, value: 'وفد على النبي', kind: 'wufd' },
      { field: 'narration.criticism', index: 0, value: 'لا يصح', kind: 'adala' },
      { field: 'life.events', index: 0, value: 'mismatch', kind: 'battle' },
    ],
  });
  assert.equal(n, 2);
  assert.equal(person.life.events[0].kind, 'wufd');
  assert.equal(person.narration.criticism[0].kind, 'adala');

  const repaired = applyRepairs(
    person,
    {
      repairs: [
        {
          field: 'narration.criticism',
          index: 0,
          value: 'لا يصح',
          evidence: 'لا يصح هذا',
        },
      ],
    },
    () => 'verified'
  );
  assert.equal(repaired, 1);
  assert.equal(person.narration.criticism[0].confidence, CONFIDENCE.llmVerified);

  applyHadith(person, { count: 5000, uncertain: true, evidence: 'نحو خمسة آلاف' });
  assert.equal(person.narration.hadith_count.count, 5000);

  const timeline = deriveTimeline(person);
  assert.ok(timeline.items.some((i) => i.key === 'badr' && i.year_hijri === 2));
  assert.ok(timeline.items.some((i) => i.kind === 'death' && i.year_hijri === 11));
});

test('new corpus schemas accept a row', () => {
  assertValid('verdict', {
    person_id: 'isabah:9767:1-10',
    key: 'not_companion',
    value: 'ليست له صحبة',
    source: 'llm',
    evidence: 'ليست له صحبة',
    confidence: 0.9,
    about: null,
  });
  assertValid('isnad', {
    person_id: 'isabah:9767:1-10',
    names: ['أبو هريرة', 'سعيد بن المسيب'],
    subject_index: 0,
    source: 'llm',
    evidence: 'عن أبي هريرة',
    confidence: 0.7,
  });
  assertValid('timeline', {
    person_id: 'isabah:9767:1-10',
    items: [{ kind: 'battle', value: 'بدر', year_hijri: 2, key: 'badr', source: 'regex' }],
  });
});

function startServer(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => handler(JSON.parse(body || '{}'), res));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
    });
  });
}

test('runPass checkpoints every N fetched persons', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isabah-pass-'));
  const { server, baseUrl } = await startServer((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ labels: [{ i: 0, label: 'event' }] }) } }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      })
    );
  });

  const persons = [];
  const rawById = new Map();
  for (let i = 0; i < 4; i += 1) {
    const id = `isabah:9767:${i + 1}-${100 + i}`;
    persons.push(
      personStub({
        person_id: id,
        entry: { number: i + 1, kind: 'biography', flags: [] },
      })
    );
    rawById.set(id, { text_body: 'كان رجلا من أهل اليمن يسكن البادية مع قومه في ذلك العام.' });
  }

  try {
    const result = await runPass(
      { ...PASSES.spans, outPath: path.join(dir, 'spans.jsonl') },
      {
        corpus: { persons, rawById },
        resume: false,
        useCache: false,
        checkpointEvery: 2,
        checkpointPath: path.join(dir, 'checkpoint.json'),
        clientOptions: {
          apiKey: 'test',
          baseUrl,
          model: 'stub',
          concurrency: 1,
          maxCostUsd: 5,
          cacheDir: path.join(dir, 'cache'),
        },
        log: () => {},
      }
    );
    assert.equal(result.fetched, 4);
    assert.equal(result.processed, 4);
    const ckpt = readCheckpoint(path.join(dir, 'checkpoint.json'));
    assert.equal(ckpt.fetched, 4);
    assert.equal(ckpt.pass, 'spans');
    assert.ok(ckpt.status === 'complete' || ckpt.status === 'running');
    const lines = fs.readFileSync(path.join(dir, 'spans.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
