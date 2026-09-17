'use strict';

const fs = require('fs');
const path = require('path');

const { LLM, PATHS } = require('../config');
const { sha256 } = require('../util/hash');
const { sleep } = require('../util/pool');

/**
 * Minimal client for any OpenAI-compatible /chat/completions endpoint.
 *
 * Three things make a 9,730-entry run survivable: a content-addressed cache so
 * re-runs cost nothing, a hard budget guard so a mistake cannot drain an
 * account, and structured-output enforcement so responses parse by construction.
 */

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/**
 * Some 4xx responses arrive with a retryable status but can never succeed: an
 * exhausted balance or a bad key will not fix itself. Retrying them burns the
 * whole backoff schedule per entry and buries the real cause, so they abort.
 */
const FATAL_ERROR_CODES = [
  'insufficient_quota',
  'credit_balance_exhausted',
  'billing_hard_limit_reached',
  'invalid_api_key',
  'account_deactivated',
  'model_not_found',
];

class FatalLlmError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'FatalLlmError';
    this.status = status;
  }
}

function fatalReason(err) {
  if (err.status === 401 || err.status === 403) return 'authentication rejected';
  const body = String(err.body || '');
  const hit = FATAL_ERROR_CODES.find((code) => body.includes(code));
  return hit ? hit.replace(/_/g, ' ') : null;
}

/** Parse the `1m30s` / `500ms` / `2.5s` durations OpenAI returns in reset headers. */
function parseDuration(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text) * 1000; // bare seconds
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    matched = true;
    const scale = { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit];
    total += Number(amount) * scale;
  }
  return matched ? total : null;
}

/**
 * How long to wait after a 429.
 *
 * A token-per-minute limit refills on the provider's clock, not ours, and it
 * advertises exactly when. Guessing with exponential backoff means a run can
 * exhaust its attempts inside a single 60s window and record avoidable
 * failures, so the advertised reset is used whenever it is present.
 */
function rateLimitDelay(err, attempt) {
  const headers = err.headers || {};
  const advertised =
    parseDuration(headers['retry-after-ms']) ??
    (parseDuration(headers['retry-after']) ||
      Math.max(
        parseDuration(headers['x-ratelimit-reset-tokens']) ?? 0,
        parseDuration(headers['x-ratelimit-reset-requests']) ?? 0
      ) ||
      null);

  const base = advertised ?? Math.min(60000, 1000 * 2 ** attempt);
  // Pad past the boundary and stagger workers so they do not all wake together.
  return Math.min(90000, base + 750) + Math.random() * 500;
}

class BudgetExceededError extends Error {
  constructor(spent, limit) {
    super(`LLM budget exhausted: spent $${spent.toFixed(4)} of $${limit.toFixed(2)} limit`);
    this.name = 'BudgetExceededError';
    this.spent = spent;
    this.limit = limit;
  }
}

class LlmClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? LLM.apiKey;
    this.baseUrl = options.baseUrl ?? LLM.baseUrl;
    this.model = options.model ?? LLM.model;
    this.maxTokens = options.maxTokens ?? LLM.maxTokens;
    this.maxCostUsd = options.maxCostUsd ?? LLM.maxCostUsd;
    this.priceInput = options.priceInputPerMTok ?? LLM.priceInputPerMTok;
    this.priceOutput = options.priceOutputPerMTok ?? LLM.priceOutputPerMTok;
    this.priceCachedInput =
      options.priceCachedInputPerMTok ?? LLM.priceCachedInputPerMTok ?? this.priceInput / 2;
    this.cacheDir = options.cacheDir ?? PATHS.llmCache;
    this.useCache = options.useCache !== false;
    this.maxRetries = options.maxRetries ?? 5;
    /**
     * Waiting out a token-per-minute limit is not a failure, so it gets its own
     * larger allowance. Sharing the error budget meant a long run gave up on
     * entries that only needed the quota window to roll over.
     */
    this.maxRateLimitWaits = options.maxRateLimitWaits ?? 12;
    this.temperature = options.temperature ?? 0;

    this.supportsJsonSchema = true;
    this.usage = {
      requests: 0,
      cache_hits: 0,
      prompt_tokens: 0,
      cached_prompt_tokens: 0,
      completion_tokens: 0,
      cost_usd: 0,
      failures: 0,
      repairs: 0,
      rate_limit_waits: 0,
    };

    if (this.useCache) fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  assertConfigured() {
    if (!this.apiKey) {
      throw new Error(
        'OPENAI_API_KEY is not set. Copy v2/.env.example to v2/.env and add a key, ' +
          'or export the variable in your shell.'
      );
    }
  }

  costOf(usage) {
    const prompt = usage?.prompt_tokens ?? 0;
    const cached = Math.min(usage?.cached_tokens ?? 0, prompt);
    const fresh = prompt - cached;
    return (
      (fresh / 1e6) * this.priceInput +
      (cached / 1e6) * this.priceCachedInput +
      ((usage?.completion_tokens ?? 0) / 1e6) * this.priceOutput
    );
  }

  budgetRemaining() {
    return this.maxCostUsd - this.usage.cost_usd;
  }

  /** Cache identity covers everything that can change the answer. */
  cacheKey({ system, user, schemaName, schemaVersion }) {
    return sha256(
      JSON.stringify({
        model: this.model,
        schemaName,
        schemaVersion,
        temperature: this.temperature,
        system,
        user,
      })
    );
  }

  cachePath(key) {
    return path.join(this.cacheDir, `${key}.json`);
  }

  readCache(key) {
    if (!this.useCache) return null;
    const file = this.cachePath(key);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  writeCache(key, payload) {
    if (!this.useCache) return;
    const file = this.cachePath(key);
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  }

  async postChat(body) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`LLM HTTP ${response.status}: ${text.slice(0, 400)}`);
      error.status = response.status;
      error.body = text;
      error.headers = Object.fromEntries(response.headers);
      throw error;
    }
    return JSON.parse(text);
  }

  buildBody({ system, user, jsonSchema }) {
    const body = {
      model: this.model,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };

    if (jsonSchema && this.supportsJsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: jsonSchema.name,
          strict: jsonSchema.strict !== false,
          schema: jsonSchema.schema,
        },
      };
    } else if (jsonSchema) {
      // Provider rejected json_schema; fall back to plain JSON mode and put the
      // contract in the prompt instead.
      body.response_format = { type: 'json_object' };
      body.messages[0].content +=
        `\n\nReturn JSON conforming exactly to this schema:\n${JSON.stringify(
          jsonSchema.schema
        )}`;
    }

    return body;
  }

  /**
   * Run one completion, returning parsed JSON.
   *
   * @param {{ system: string, user: string, jsonSchema?: object, validate?: (data:any)=>string|null }} request
   */
  async complete(request) {
    const { system, user, jsonSchema, validate } = request;
    const key = this.cacheKey({
      system,
      user,
      schemaName: jsonSchema?.name ?? 'freeform',
      schemaVersion: jsonSchema ? sha256(JSON.stringify(jsonSchema.schema)).slice(0, 12) : null,
    });

    const cached = this.readCache(key);
    if (cached) {
      this.usage.cache_hits += 1;
      return { data: cached.data, usage: cached.usage, cached: true };
    }

    this.assertConfigured();
    if (this.budgetRemaining() <= 0) {
      throw new BudgetExceededError(this.usage.cost_usd, this.maxCostUsd);
    }

    let lastError = null;
    let repairNote = null;
    let attempt = 0;
    let rateLimitWaits = 0;

    while (attempt <= this.maxRetries) {
      try {
        const body = this.buildBody({
          system: repairNote ? `${system}\n\n${repairNote}` : system,
          user,
          jsonSchema,
        });
        const response = await this.postChat(body);

        const usage = {
          prompt_tokens: response.usage?.prompt_tokens ?? 0,
          completion_tokens: response.usage?.completion_tokens ?? 0,
          cached_tokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        };
        this.usage.requests += 1;
        this.usage.prompt_tokens += usage.prompt_tokens;
        this.usage.completion_tokens += usage.completion_tokens;
        this.usage.cached_prompt_tokens += usage.cached_tokens;
        this.usage.cost_usd += this.costOf(usage);

        const content = response.choices?.[0]?.message?.content ?? '';
        const finishReason = response.choices?.[0]?.finish_reason ?? null;
        let data;
        try {
          data = JSON.parse(stripFences(content));
        } catch (err) {
          throw new SchemaError(
            finishReason === 'length'
              ? 'Response was cut off before valid JSON completed. Return a more compact object.'
              : `Response was not valid JSON: ${err.message}`
          );
        }

        const problem = validate ? validate(data) : null;
        if (problem) throw new SchemaError(problem);

        this.writeCache(key, { data, usage, model: this.model, created_at: new Date().toISOString() });
        return { data, usage, cached: false };
      } catch (err) {
        lastError = err;

        const fatal = fatalReason(err);
        if (fatal) {
          throw new FatalLlmError(
            `LLM request cannot succeed (${fatal}). Fix the account or key, then re-run; ` +
              'completed entries are cached and will not be charged again.',
            err.status
          );
        }

        if (err instanceof SchemaError) {
          this.usage.repairs += 1;
          repairNote = `Your previous response was rejected: ${err.message} Return corrected JSON only.`;
          attempt += 1;
          continue;
        }

        // Some providers reject json_schema outright. Downgrade once and retry.
        if (
          err.status === 400 &&
          this.supportsJsonSchema &&
          /response_format|json_schema|schema/i.test(err.body || '')
        ) {
          this.supportsJsonSchema = false;
          process.stderr.write(
            'warning: provider rejected json_schema response_format; falling back to json_object mode\n'
          );
          attempt += 1;
          continue;
        }

        if (err.status === 429 && rateLimitWaits < this.maxRateLimitWaits) {
          rateLimitWaits += 1;
          this.usage.rate_limit_waits += 1;
          await sleep(rateLimitDelay(err, rateLimitWaits));
          continue;
        }

        if (RETRYABLE_STATUS.has(err.status) || err.name === 'TypeError') {
          await sleep(Math.min(30000, 500 * 2 ** attempt) + Math.random() * 250);
          attempt += 1;
          continue;
        }

        break;
      }
    }

    this.usage.failures += 1;
    throw lastError ?? new Error('LLM request failed for an unknown reason');
  }

  usageReport() {
    return {
      model: this.model,
      base_url: this.baseUrl,
      ...this.usage,
      cost_usd: Number(this.usage.cost_usd.toFixed(6)),
      budget_usd: this.maxCostUsd,
      prompt_cache_hit_rate: this.usage.prompt_tokens
        ? Number((this.usage.cached_prompt_tokens / this.usage.prompt_tokens).toFixed(4))
        : 0,
      price_input_per_mtok: this.priceInput,
      price_cached_input_per_mtok: this.priceCachedInput,
      price_output_per_mtok: this.priceOutput,
    };
  }
}

class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

function stripFences(text) {
  const trimmed = String(text ?? '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

module.exports = {
  LlmClient,
  BudgetExceededError,
  SchemaError,
  FatalLlmError,
  parseDuration,
  rateLimitDelay,
};
