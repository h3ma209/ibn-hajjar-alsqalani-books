'use strict';

const fs = require('fs');

const { PATHS, LLM, ensureDirs } = require('../config');
const { readJsonl, AppendLog, writeJson } = require('../util/jsonl');
const { mapPool } = require('../util/pool');
const { LlmClient, BudgetExceededError, FatalLlmError } = require('../extract/llm-client');
const { extractLlmBio, chunkText, loadPrompt } = require('../extract/llm-bio');
const { writeCheckpoint, shouldCheckpoint } = require('../extract/checkpoint');

/**
 * The LLM extraction pass.
 *
 * Writes append-only so an interrupted run resumes, and every completed request
 * is cached by content hash so a resumed or repeated run costs nothing for work
 * already done.
 */

/** Arabic averages roughly three characters per token for common tokenizers. */
const CHARS_PER_TOKEN = 3;

function estimateCost(targets, client) {
  let inputTokens = 0;
  let requests = 0;
  for (const target of targets) {
    const chunks = chunkText(target.raw.text_body || target.raw.text || '');
    requests += chunks.length;
    const promptOverhead = 1200;
    for (const chunk of chunks) {
      inputTokens += chunk.length / CHARS_PER_TOKEN + promptOverhead;
    }
  }
  // Structured extraction output runs well under the input size.
  const outputTokens = inputTokens * 0.25;
  // The instruction prefix repeats on every request and is served from the
  // provider's prompt cache at a discount once the run is warm.
  const cacheHitRate = 0.97;
  const cachedInput = inputTokens * cacheHitRate;
  const freshInput = inputTokens * (1 - cacheHitRate);
  const cachedRate = client.priceCachedInput ?? client.priceInput / 2;
  const cost =
    (freshInput / 1e6) * client.priceInput +
    (cachedInput / 1e6) * cachedRate +
    (outputTokens / 1e6) * client.priceOutput;
  return {
    requests,
    input_tokens: Math.round(inputTokens),
    output_tokens: Math.round(outputTokens),
    cost_usd: Number(cost.toFixed(4)),
  };
}

/** Spread a sample across qism, section, and entry length. */
function stratify(targets, size) {
  const buckets = new Map();
  for (const target of targets) {
    const length = target.raw.char_len;
    const lengthBucket = length < 800 ? 'short' : length < 4000 ? 'medium' : 'long';
    const key = `${target.placement.placement.qism ?? 'none'}|${target.placement.placement.section_type}|${lengthBucket}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(target);
  }

  const keys = [...buckets.keys()].sort();
  const picked = [];
  let index = 0;
  while (picked.length < size) {
    let addedThisRound = false;
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (index >= bucket.length) continue;
      picked.push(bucket[index]);
      addedThisRound = true;
      if (picked.length >= size) break;
    }
    if (!addedThisRound) break;
    index += 1;
  }
  return picked;
}

function readCompletedIds() {
  const done = new Set();
  if (!fs.existsSync(PATHS.llmFacts)) return done;
  for (const line of fs.readFileSync(PATHS.llmFacts, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record.person_id && !record.error) done.add(record.person_id);
    } catch {
      // Partial trailing line from an interrupted run.
    }
  }
  return done;
}

async function extract({
  limit = 0,
  numbers = null,
  stratified = 0,
  resume = true,
  dryRun = false,
  useCache = true,
  clientOptions = {},
  checkpointEvery = LLM.checkpointEvery,
  log = () => {},
} = {}) {
  ensureDirs();

  const placements = new Map();
  for await (const row of readJsonl(PATHS.placement)) placements.set(row.person_id, row);

  let targets = [];
  const wanted = numbers ? new Set(numbers) : null;
  for await (const raw of readJsonl(PATHS.rawText)) {
    if (wanted && !wanted.has(raw.entry_number)) continue;
    const placement = placements.get(raw.person_id);
    if (!placement) continue;
    targets.push({ raw, placement });
  }

  if (stratified > 0) targets = stratify(targets, stratified);
  if (limit > 0) targets = targets.slice(0, limit);

  const completed = resume ? readCompletedIds() : new Set();
  const pending = targets.filter((t) => !completed.has(t.raw.person_id));

  const client = new LlmClient({ ...clientOptions, useCache });
  const estimate = estimateCost(pending, client);
  const prompt = loadPrompt();

  log(`prompt ${prompt.version}, model ${client.model}`);
  log(
    `targets=${targets.length} already_done=${targets.length - pending.length} pending=${pending.length}`
  );
  log(
    `estimate: ${estimate.requests} requests, ~${(estimate.input_tokens / 1e6).toFixed(2)}M input tokens, ` +
      `~$${estimate.cost_usd} (budget $${client.maxCostUsd})`
  );

  if (dryRun) {
    log('dry run: no requests sent');
    return { estimate, processed: 0, failures: 0, usage: client.usageReport() };
  }

  if (!pending.length) {
    log('nothing to do');
    return { estimate, processed: 0, failures: 0, usage: client.usageReport() };
  }

  client.assertConfigured();

  const factsLog = new AppendLog(PATHS.llmFacts);
  const progressLog = new AppendLog(PATHS.llmProgress);

  let processed = 0;
  let fetched = 0;
  let failures = 0;
  let budgetHit = false;
  let fatalError = null;
  const startedAt = Date.now();

  async function persistCheckpoint(status, extra = {}) {
    await factsLog.flush();
    await progressLog.flush();
    writeCheckpoint(PATHS.extractCheckpoint, {
      kind: 'extraction-checkpoint',
      pass: 'bio',
      status,
      prompt_version: prompt.version,
      model: client.model,
      targets: targets.length,
      pending: pending.length,
      processed,
      fetched,
      failures,
      checkpoint_every: checkpointEvery,
      spent_usd: Number(client.usage.cost_usd.toFixed(4)),
      cache_hits: client.usage.cache_hits,
      resume_command: 'node src/cli.js extract',
      ...extra,
    });
  }

  const { stopped } = await mapPool(
    pending,
    Math.max(1, clientOptions.concurrency ?? LLM.concurrency),
    async (target) => {
      try {
        const { data, meta } = await extractLlmBio(client, target.raw, {
          qism: target.placement.placement.qism,
          sectionType: target.placement.placement.section_type,
        });
        return {
          person_id: target.raw.person_id,
          entry_number: target.raw.entry_number,
          extraction: data,
          meta,
          fetched: !meta.cached,
        };
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          budgetHit = true;
          return { person_id: target.raw.person_id, stop: true, error: err.message };
        }
        if (err instanceof FatalLlmError) {
          fatalError = err;
          return { person_id: target.raw.person_id, stop: true, error: err.message };
        }
        return {
          person_id: target.raw.person_id,
          entry_number: target.raw.entry_number,
          fetched: true,
          error: String(err.message || err).slice(0, 500),
        };
      }
    },
    async (result) => {
      if (result.stop) {
        progressLog.append({ ...result, at: new Date().toISOString() });
        await persistCheckpoint('stopped', { last_person_id: result.person_id, error: result.error });
        return 'stop';
      }

      const { fetched: didFetch, ...row } = result;
      factsLog.append(row);
      progressLog.append({
        person_id: result.person_id,
        ok: !result.error,
        error: result.error ?? null,
        at: new Date().toISOString(),
      });

      if (result.error) failures += 1;
      processed += 1;
      if (didFetch) fetched += 1;

      if (shouldCheckpoint(fetched, checkpointEvery)) {
        const elapsed = (Date.now() - startedAt) / 1000;
        log(
          `  bio checkpoint ${fetched} fetched / ${processed}/${pending.length} processed, ` +
            `${failures} failed, $${client.usage.cost_usd.toFixed(4)}, ` +
            `${(processed / Math.max(elapsed, 0.001)).toFixed(1)}/s`
        );
        await persistCheckpoint('running', { last_person_id: result.person_id });
      }

      if (client.budgetRemaining() <= 0) {
        budgetHit = true;
        await persistCheckpoint('budget', { last_person_id: result.person_id });
        return 'stop';
      }
      return undefined;
    }
  );

  await persistCheckpoint(budgetHit || fatalError ? 'stopped' : 'complete', {
    last_person_id: null,
  });
  await factsLog.close();
  await progressLog.close();

  const usage = client.usageReport();
  writeJson(PATHS.llmUsage, {
    generated_at: new Date().toISOString(),
    prompt_version: prompt.version,
    targets: targets.length,
    processed,
    failures,
    budget_exhausted: budgetHit,
    stopped_early: stopped,
    estimate,
    usage,
  });

  log(
    `processed ${processed}, failures ${failures}, spent $${usage.cost_usd.toFixed(4)} ` +
      `(${usage.cache_hits} cache hits, ${usage.repairs} schema repairs)`
  );
  if (budgetHit) {
    log('budget limit reached; raise LLM_MAX_COST and re-run to continue where it stopped');
  }
  if (fatalError) {
    log(`aborted: ${fatalError.message}`);
  } else {
    log('run `npm run build` to fold these facts into persons.jsonl');
  }

  return {
    estimate,
    processed,
    fetched,
    failures,
    usage,
    budget_exhausted: budgetHit,
    fatal_error: fatalError ? fatalError.message : null,
  };
}

module.exports = { extract, estimateCost, stratify };
