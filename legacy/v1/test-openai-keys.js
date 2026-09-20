#!/usr/bin/env node
/**
 * Test OpenAI API keys (GET /v1/models — free, no tokens used).
 * Usage:
 *   node test-openai-keys.js              # reads ./api-keys.txt
 *   node test-openai-keys.js keys.txt
 *   echo "sk-..." | node test-openai-keys.js -
 */

const fs = require("fs");
const path = require("path");

const ENDPOINT = "https://api.openai.com/v1/models";
const CONCURRENCY = 5;

function loadKeys(source) {
  let text;
  if (source === "-") {
    text = fs.readFileSync(0, "utf8");
  } else {
    const file = path.resolve(source || "api-keys.txt");
    if (!fs.existsSync(file)) {
      console.error(`Missing keys file: ${file}`);
      console.error("Put one key per line, or: node test-openai-keys.js -");
      process.exit(1);
    }
    text = fs.readFileSync(file, "utf8");
  }
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.startsWith("sk-"))
    ),
  ];
}

function mask(key) {
  if (key.length < 12) return "***";
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

async function testKey(key) {
  try {
    const res = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.text();
    let detail = "";
    try {
      const j = JSON.parse(body);
      detail = j.error?.message || (j.data ? `${j.data.length} models` : "");
    } catch {
      detail = body.slice(0, 80);
    }
    return { key, ok: res.ok, status: res.status, detail };
  } catch (err) {
    return { key, ok: false, status: 0, detail: err.message };
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  const keys = loadKeys(process.argv[2]);
  if (!keys.length) {
    console.error("No sk- keys found.");
    process.exit(1);
  }

  console.log(`Testing ${keys.length} key(s)...\n`);
  const results = await mapPool(keys, CONCURRENCY, testKey);

  let valid = 0;
  for (const r of results) {
    const tag = r.ok ? "OK " : "FAIL";
    if (r.ok) valid++;
    console.log(`[${tag}] ${mask(r.key)}  HTTP ${r.status}  ${r.detail}`);
  }

  console.log(`\n${valid}/${results.length} valid`);
  process.exit(valid === results.length ? 0 : 1);
}

main();
