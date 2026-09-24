'use strict';

const { PATHS, LLM, ensureDirs } = require('../config');
const { readJsonl } = require('../util/jsonl');
const { extract } = require('./extract');
const { PASSES } = require('../extract/passes');
const { runPass } = require('../extract/pass-runner');
const { applyPassResults } = require('../extract/apply-pass');

const LLM_KINDS = ['repair', 'kinds', 'spans', 'verdicts', 'isnad', 'hadith'];
const ALL_KINDS = ['bio', ...LLM_KINDS, 'timeline'];

async function loadCorpus() {
  const persons = [];
  for await (const person of readJsonl(PATHS.persons)) persons.push(person);
  const rawById = new Map();
  for await (const raw of readJsonl(PATHS.rawText)) rawById.set(raw.person_id, raw);
  return { persons, rawById };
}

async function extractPass({
  kind = 'all',
  limit = 0,
  resume = true,
  dryRun = false,
  useCache = true,
  apply = true,
  clientOptions = {},
  checkpointEvery = LLM.checkpointEvery,
  log = () => {},
} = {}) {
  ensureDirs();
  const kinds = kind === 'all' ? ALL_KINDS : [kind];
  for (const name of kinds) {
    if (name !== 'bio' && name !== 'timeline' && !PASSES[name]) {
      throw new Error(`Unknown extract-pass kind: ${name}`);
    }
  }

  const results = [];
  const budgetCap = clientOptions.maxCostUsd ?? LLM.maxCostUsd;
  let spentUsd = 0;

  function optionsForPass(concurrencyDefault) {
    return {
      ...clientOptions,
      concurrency: clientOptions.concurrency ?? concurrencyDefault,
      maxCostUsd: Math.max(0, Number((budgetCap - spentUsd).toFixed(4))),
    };
  }

  if (kinds.includes('bio')) {
    log('pass bio: resume leftover v1 facts');
    results.push(
      await extract({
        limit,
        resume,
        dryRun,
        useCache,
        clientOptions: optionsForPass(LLM.concurrency),
        checkpointEvery,
        log,
      })
    );
    spentUsd += results.at(-1)?.usage?.cost_usd ?? 0;
    if (results.at(-1)?.fatal_error || results.at(-1)?.budget_exhausted) {
      return { results, applied: null };
    }
  }

  const needCorpus = kinds.some((name) => name !== 'bio');
  const corpus = needCorpus ? await loadCorpus() : null;
  if (corpus) log(`loaded ${corpus.persons.length} persons for extract-pass`);

  for (const name of kinds) {
    if (name === 'bio' || name === 'timeline') continue;
    const result = await runPass(PASSES[name], {
      corpus,
      resume,
      limit,
      dryRun,
      useCache,
      clientOptions: optionsForPass(LLM.passConcurrency),
      checkpointEvery,
      log,
    });
    results.push(result);
    spentUsd += result.usage?.cost_usd ?? 0;
    if (result.fatal_error || result.budget_exhausted) return { results, applied: null };
  }

  let applied = null;
  if (apply && !dryRun && kinds.some((name) => name !== 'bio')) {
    applied = await applyPassResults({ log });
  }

  return { results, applied };
}

module.exports = { extractPass, loadCorpus, ALL_KINDS, LLM_KINDS };
