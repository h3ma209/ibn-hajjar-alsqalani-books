'use strict';

const fs = require('fs');
const path = require('path');

const { PATHS, LLM } = require('../config');
const { AppendLog, writeJson } = require('../util/jsonl');
const { mapPool } = require('../util/pool');
const { sha256 } = require('../util/hash');
const { LlmClient, BudgetExceededError, FatalLlmError } = require('./llm-client');
const { writeCheckpoint, shouldCheckpoint } = require('./checkpoint');

const promptCache = new Map();
const schemaCache = new Map();

function loadPrompt(fileName) {
  if (promptCache.has(fileName)) return promptCache.get(fileName);
  const text = fs.readFileSync(path.join(PATHS.PROMPTS_DIR, fileName), 'utf8');
  const loaded = { text, version: `${fileName}@${sha256(text).slice(0, 12)}` };
  promptCache.set(fileName, loaded);
  return loaded;
}

function loadLlmSchema(fileName) {
  if (schemaCache.has(fileName)) return schemaCache.get(fileName);
  const schema = JSON.parse(fs.readFileSync(path.join(PATHS.SCHEMA_DIR, fileName), 'utf8'));
  schemaCache.set(fileName, schema);
  return schema;
}

function readCompletedIds(filePath) {
  const done = new Set();
  if (!fs.existsSync(filePath)) return done;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row.person_id && !row.error) done.add(row.person_id);
    } catch {
      // Truncated last line from a hard kill.
    }
  }
  return done;
}

/**
 * Run one narrow extract-pass. Checkpoints every `checkpointEvery` *fetched*
 * persons (uncached API hits), not cache hits.
 */
async function runPass(pass, {
  corpus,
  resume = true,
  limit = 0,
  dryRun = false,
  useCache = true,
  clientOptions = {},
  checkpointEvery = LLM.checkpointEvery,
  checkpointPath = PATHS.extractPassCheckpoint,
  log = () => {},
} = {}) {
  const targets = pass.select(corpus);
  const completed = resume ? readCompletedIds(pass.outPath) : new Set();
  let pending = targets.filter((t) => !completed.has(t.person_id));
  if (limit > 0) pending = pending.slice(0, limit);

  const client = new LlmClient({
    ...clientOptions,
    useCache,
    maxTokens: clientOptions.maxTokens ?? pass.maxTokens ?? LLM.passMaxTokens,
  });
  const prompt = loadPrompt(pass.promptFile);
  const schema = loadLlmSchema(pass.schemaFile);

  log(
    `pass ${pass.name} prompt ${prompt.version} model ${client.model} ` +
      `targets=${targets.length} done=${targets.length - pending.length} pending=${pending.length}`
  );

  if (dryRun) {
    return {
      pass: pass.name,
      targets: targets.length,
      pending: pending.length,
      processed: 0,
      fetched: 0,
      failures: 0,
      usage: client.usageReport(),
    };
  }

  if (!pending.length) {
    log(`pass ${pass.name}: nothing to do`);
    return {
      pass: pass.name,
      targets: targets.length,
      pending: 0,
      processed: 0,
      fetched: 0,
      failures: 0,
      usage: client.usageReport(),
    };
  }

  client.assertConfigured();

  const outLog = new AppendLog(pass.outPath);
  let processed = 0;
  let fetched = 0;
  let failures = 0;
  let budgetHit = false;
  let fatalError = null;
  const startedAt = Date.now();

  async function persistCheckpoint(status, extra = {}) {
    await outLog.flush();
    writeCheckpoint(checkpointPath, {
      kind: 'extract-pass-checkpoint',
      pass: pass.name,
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
      resume_command: `node src/cli.js extract-pass --kind ${pass.name}`,
      ...extra,
    });
  }

  const { stopped } = await mapPool(
    pending,
    Math.max(1, clientOptions.concurrency ?? LLM.passConcurrency),
    async (target) => {
      try {
        const { data, cached } = await client.complete({
          system: prompt.text,
          user: pass.buildUser(target),
          jsonSchema: schema,
          validate: pass.validate,
        });
        return {
          person_id: target.person_id,
          entry_number: target.entry_number ?? null,
          fetched: !cached,
          record: pass.toRecord(data, target, { cached, prompt_version: prompt.version }),
        };
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          budgetHit = true;
          return { person_id: target.person_id, stop: true, error: err.message };
        }
        if (err instanceof FatalLlmError) {
          fatalError = err;
          return { person_id: target.person_id, stop: true, error: err.message };
        }
        return {
          person_id: target.person_id,
          entry_number: target.entry_number ?? null,
          fetched: true,
          error: String(err.message || err).slice(0, 500),
        };
      }
    },
    async (result) => {
      if (result.stop) {
        await persistCheckpoint('stopped', { last_person_id: result.person_id, error: result.error });
        return 'stop';
      }

      if (result.error) {
        outLog.append({
          person_id: result.person_id,
          entry_number: result.entry_number,
          pass: pass.name,
          error: result.error,
        });
        failures += 1;
      } else {
        outLog.append({
          person_id: result.person_id,
          entry_number: result.entry_number,
          pass: pass.name,
          ...result.record,
        });
      }

      processed += 1;
      if (result.fetched) fetched += 1;

      if (shouldCheckpoint(fetched, checkpointEvery)) {
        const elapsed = (Date.now() - startedAt) / 1000;
        log(
          `  ${pass.name} checkpoint ${fetched} fetched / ${processed} processed, ` +
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
    stopped_early: stopped,
    fatal_error: fatalError ? fatalError.message : null,
  });
  await outLog.close();

  const usage = client.usageReport();
  writeJson(PATHS.extractPassUsage, {
    generated_at: new Date().toISOString(),
    pass: pass.name,
    prompt_version: prompt.version,
    targets: targets.length,
    processed,
    fetched,
    failures,
    budget_exhausted: budgetHit,
    usage,
  });

  log(
    `pass ${pass.name}: processed ${processed}, fetched ${fetched}, failures ${failures}, ` +
      `$${usage.cost_usd.toFixed(4)}`
  );

  return {
    pass: pass.name,
    targets: targets.length,
    pending: pending.length,
    processed,
    fetched,
    failures,
    usage,
    budget_exhausted: budgetHit,
    fatal_error: fatalError ? fatalError.message : null,
  };
}

module.exports = {
  runPass,
  loadPrompt,
  loadLlmSchema,
  readCompletedIds,
};
