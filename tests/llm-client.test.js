'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LlmClient,
  BudgetExceededError,
  FatalLlmError,
  parseDuration,
  rateLimitDelay,
} = require('../src/extract/llm-client');

/**
 * The client is exercised against a local stub rather than a live account, so
 * caching, retries, repair, and the budget guard are verified deterministically
 * and without spending anything.
 */
function startServer(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => handler(JSON.parse(body || '{}'), res, req));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1` });
    });
  });
}

function reply(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function completion(content, usage = { prompt_tokens: 100, completion_tokens: 50 }) {
  return {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage,
  };
}

function tempCacheDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'isabah-llm-cache-'));
}

function makeClient(baseUrl, overrides = {}) {
  return new LlmClient({
    apiKey: 'test-key',
    baseUrl,
    model: 'stub-model',
    cacheDir: tempCacheDir(),
    maxRetries: 3,
    ...overrides,
  });
}

const REQUEST = { system: 'system prompt', user: 'user prompt' };

test('a successful response is parsed and its cost accounted', async (t) => {
  const { server, baseUrl } = await startServer((_body, res) =>
    reply(res, 200, completion('{"value":42}', { prompt_tokens: 1_000_000, completion_tokens: 0 }))
  );
  t.after(() => server.close());

  const client = makeClient(baseUrl, { priceInputPerMTok: 0.15, priceOutputPerMTok: 0.6 });
  const { data, cached } = await client.complete(REQUEST);

  assert.deepEqual(data, { value: 42 });
  assert.equal(cached, false);
  assert.equal(client.usage.requests, 1);
  assert.ok(Math.abs(client.usage.cost_usd - 0.15) < 1e-9, 'one million input tokens costs $0.15');
});

test('an identical request is served from cache without a second call', async (t) => {
  let calls = 0;
  const { server, baseUrl } = await startServer((_body, res) => {
    calls += 1;
    reply(res, 200, completion('{"value":1}'));
  });
  t.after(() => server.close());

  const client = makeClient(baseUrl);
  await client.complete(REQUEST);
  const second = await client.complete(REQUEST);

  assert.equal(calls, 1, 'the second identical request must not reach the provider');
  assert.equal(second.cached, true);
  assert.equal(client.usage.cache_hits, 1);
});

test('changing the prompt changes the cache key', async (t) => {
  let calls = 0;
  const { server, baseUrl } = await startServer((_body, res) => {
    calls += 1;
    reply(res, 200, completion('{"value":1}'));
  });
  t.after(() => server.close());

  const client = makeClient(baseUrl);
  await client.complete(REQUEST);
  await client.complete({ ...REQUEST, system: 'a revised system prompt' });

  assert.equal(calls, 2);
});

test('markdown fences around JSON are tolerated', async (t) => {
  const { server, baseUrl } = await startServer((_body, res) =>
    reply(res, 200, completion('```json\n{"value":"ok"}\n```'))
  );
  t.after(() => server.close());

  const { data } = await makeClient(baseUrl).complete(REQUEST);
  assert.deepEqual(data, { value: 'ok' });
});

/**
 * Every request repeats the same instruction prefix, which the provider serves
 * from its own prompt cache at half price. Charging those at the full input rate
 * roughly doubled the reported spend and made the budget guard stop early.
 */
test('cached prompt tokens are billed at the cached rate', async (t) => {
  const { server, baseUrl } = await startServer((_body, res) =>
    reply(res, 200, {
      choices: [{ message: { content: '{"value":1}' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
        prompt_tokens_details: { cached_tokens: 1_000_000 },
      },
    })
  );
  t.after(() => server.close());

  const client = makeClient(baseUrl, {
    priceInputPerMTok: 0.15,
    priceCachedInputPerMTok: 0.075,
    priceOutputPerMTok: 0.6,
  });
  await client.complete(REQUEST);

  assert.ok(
    Math.abs(client.usage.cost_usd - 0.075) < 1e-9,
    `a fully cached million tokens costs $0.075, got ${client.usage.cost_usd}`
  );
  assert.equal(client.usage.cached_prompt_tokens, 1_000_000);
  assert.equal(client.usageReport().prompt_cache_hit_rate, 1);
});

test('a partly cached prompt is billed proportionally', () => {
  const client = new LlmClient({
    apiKey: 'k',
    cacheDir: tempCacheDir(),
    priceInputPerMTok: 0.15,
    priceCachedInputPerMTok: 0.075,
    priceOutputPerMTok: 0.6,
  });

  // 2.1k of a 2.4k prompt cached, mirroring the real instruction prefix.
  const cost = client.costOf({
    prompt_tokens: 2_400_000,
    cached_tokens: 2_100_000,
    completion_tokens: 0,
  });
  assert.ok(Math.abs(cost - (0.3 * 0.15 + 2.1 * 0.075)) < 1e-9);

  // Absent details, nothing is assumed to be cached.
  const uncached = client.costOf({ prompt_tokens: 1_000_000, completion_tokens: 0 });
  assert.ok(Math.abs(uncached - 0.15) < 1e-9);

  // A provider over-reporting cached tokens cannot drive the cost negative.
  const clamped = client.costOf({
    prompt_tokens: 1_000_000,
    cached_tokens: 5_000_000,
    completion_tokens: 0,
  });
  assert.ok(Math.abs(clamped - 0.075) < 1e-9);
});

test('reset-header durations are parsed in the formats providers send', () => {
  assert.equal(parseDuration('500ms'), 500);
  assert.equal(parseDuration('2s'), 2000);
  assert.equal(parseDuration('1m30s'), 90000);
  assert.equal(parseDuration('1.5s'), 1500);
  assert.equal(parseDuration('20'), 20000, 'a bare Retry-After value is seconds');
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration(undefined), null);
});

/**
 * A token-per-minute limit refills on the provider's clock. Blind exponential
 * backoff topped out below a 60s window, so entries failed while waiting was all
 * they needed; the advertised reset must win over the guess.
 */
test('a 429 waits for the reset the provider advertises', () => {
  const withHeaders = (headers) => rateLimitDelay({ status: 429, headers }, 1);

  const tokensReset = withHeaders({ 'x-ratelimit-reset-tokens': '6s' });
  assert.ok(tokensReset >= 6000 && tokensReset < 8000, `expected ~6s, got ${tokensReset}`);

  const retryAfter = withHeaders({ 'retry-after': '30' });
  assert.ok(retryAfter >= 30000 && retryAfter < 32000, `expected ~30s, got ${retryAfter}`);

  assert.ok(withHeaders({ 'retry-after-ms': '1200' }) >= 1200);

  // Without headers it still has to outlast a full TPM window eventually.
  assert.ok(rateLimitDelay({ status: 429, headers: {} }, 6) >= 60000);
  // And never sleeps unboundedly.
  assert.ok(rateLimitDelay({ status: 429, headers: { 'retry-after': '3600' } }, 1) <= 91000);
});

test('a token-limit 429 does not consume the error retry budget', async (t) => {
  let calls = 0;
  const { server, baseUrl } = await startServer((_body, res) => {
    calls += 1;
    // More 429s than maxRetries allows, each advertising an immediate reset.
    if (calls <= 5) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'x-ratelimit-reset-tokens': '1ms',
      });
      return res.end(JSON.stringify({ error: { message: 'Rate limit reached on tokens per min' } }));
    }
    return reply(res, 200, completion('{"value":"after the window"}'));
  });
  t.after(() => server.close());

  const client = makeClient(baseUrl, { maxRetries: 2 });
  const { data } = await client.complete(REQUEST);

  assert.deepEqual(data, { value: 'after the window' });
  assert.equal(calls, 6);
  assert.equal(client.usage.failures, 0);
  assert.equal(client.usage.rate_limit_waits, 5);
});

test('a rate limit that never clears still gives up rather than hanging', async (t) => {
  const { server, baseUrl } = await startServer((_body, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json', 'retry-after-ms': '1' });
    res.end(JSON.stringify({ error: { message: 'rate limit' } }));
  });
  t.after(() => server.close());

  const client = makeClient(baseUrl, { maxRetries: 1, maxRateLimitWaits: 3 });
  await assert.rejects(() => client.complete(REQUEST), /429/);
  assert.equal(client.usage.rate_limit_waits, 3);
  assert.equal(client.usage.failures, 1);
});

test('a rate-limited request is retried and then succeeds', async (t) => {
  let calls = 0;
  const { server, baseUrl } = await startServer((_body, res) => {
    calls += 1;
    if (calls < 3) return reply(res, 429, { error: { message: 'slow down' } });
    return reply(res, 200, completion('{"value":"eventually"}'));
  });
  t.after(() => server.close());

  const { data } = await makeClient(baseUrl).complete(REQUEST);
  assert.deepEqual(data, { value: 'eventually' });
  assert.equal(calls, 3);
});

test('an exhausted balance aborts instead of exhausting the retry schedule', async (t) => {
  let calls = 0;
  const { server, baseUrl } = await startServer((_body, res) => {
    calls += 1;
    reply(res, 429, {
      error: { message: 'You have no credits remaining.', code: 'credit_balance_exhausted' },
    });
  });
  t.after(() => server.close());

  await assert.rejects(() => makeClient(baseUrl).complete(REQUEST), FatalLlmError);
  assert.equal(calls, 1, 'a permanent billing failure must not be retried');
});

test('a rejected key aborts immediately', async (t) => {
  const { server, baseUrl } = await startServer((_body, res) =>
    reply(res, 401, { error: { message: 'Incorrect API key provided' } })
  );
  t.after(() => server.close());

  await assert.rejects(() => makeClient(baseUrl).complete(REQUEST), FatalLlmError);
});

test('a schema violation triggers a repair retry', async (t) => {
  let calls = 0;
  const prompts = [];
  const { server, baseUrl } = await startServer((body, res) => {
    calls += 1;
    prompts.push(body.messages[0].content);
    if (calls === 1) return reply(res, 200, completion('{"battles":"not-an-array"}'));
    return reply(res, 200, completion('{"battles":[]}'));
  });
  t.after(() => server.close());

  const client = makeClient(baseUrl);
  const { data } = await client.complete({
    ...REQUEST,
    validate: (parsed) => (Array.isArray(parsed.battles) ? null : 'battles must be an array'),
  });

  assert.deepEqual(data, { battles: [] });
  assert.equal(client.usage.repairs, 1);
  assert.match(prompts[1], /battles must be an array/, 'the repair prompt must state the problem');
});

test('a response that never validates fails rather than being cached', async (t) => {
  const cacheDir = tempCacheDir();
  const { server, baseUrl } = await startServer((_body, res) =>
    reply(res, 200, completion('{"battles":"still-wrong"}'))
  );
  t.after(() => server.close());

  const client = makeClient(baseUrl, { cacheDir, maxRetries: 1 });
  await assert.rejects(() =>
    client.complete({ ...REQUEST, validate: () => 'battles must be an array' })
  );
  assert.equal(fs.readdirSync(cacheDir).length, 0, 'invalid responses must not be cached');
  assert.equal(client.usage.failures, 1);
});

test('invalid JSON is treated as a schema violation and repaired', async (t) => {
  let calls = 0;
  const { server, baseUrl } = await startServer((_body, res) => {
    calls += 1;
    if (calls === 1) return reply(res, 200, completion('this is not json at all'));
    return reply(res, 200, completion('{"ok":true}'));
  });
  t.after(() => server.close());

  const { data } = await makeClient(baseUrl).complete(REQUEST);
  assert.deepEqual(data, { ok: true });
});

test('the budget guard refuses a request once spend reaches the limit', async (t) => {
  const { server, baseUrl } = await startServer((_body, res) =>
    reply(res, 200, completion('{"value":1}', { prompt_tokens: 1_000_000, completion_tokens: 0 }))
  );
  t.after(() => server.close());

  const client = makeClient(baseUrl, {
    maxCostUsd: 0.1,
    priceInputPerMTok: 0.15,
    priceOutputPerMTok: 0,
  });

  await client.complete(REQUEST);
  assert.ok(client.budgetRemaining() < 0);
  await assert.rejects(
    () => client.complete({ ...REQUEST, user: 'a different entry' }),
    BudgetExceededError
  );
});

test('a provider rejecting json_schema falls back to plain JSON mode', async (t) => {
  const formats = [];
  const { server, baseUrl } = await startServer((body, res) => {
    formats.push(body.response_format?.type ?? null);
    if (body.response_format?.type === 'json_schema') {
      return reply(res, 400, {
        error: { message: 'response_format json_schema is not supported' },
      });
    }
    return reply(res, 200, completion('{"value":"fallback"}'));
  });
  t.after(() => server.close());

  const client = makeClient(baseUrl);
  const { data } = await client.complete({
    ...REQUEST,
    jsonSchema: { name: 'stub', strict: true, schema: { type: 'object' } },
  });

  assert.deepEqual(data, { value: 'fallback' });
  assert.deepEqual(formats, ['json_schema', 'json_object']);
  assert.equal(client.supportsJsonSchema, false, 'the downgrade must stick for later calls');
});

test('a missing key is reported before any request is attempted', async () => {
  const client = new LlmClient({ cacheDir: tempCacheDir() });
  client.apiKey = null;
  assert.throws(() => client.assertConfigured(), /OPENAI_API_KEY/);
});
