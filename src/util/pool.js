'use strict';

/**
 * Run an async worker over items with bounded concurrency, in order of
 * completion. `onResult` is awaited so callers can stream results to disk
 * without buffering the whole corpus.
 */
async function mapPool(items, limit, worker, onResult) {
  const size = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  let stopped = false;

  async function run() {
    while (!stopped) {
      const index = cursor++;
      if (index >= items.length) return;
      const result = await worker(items[index], index);
      if (onResult) {
        const signal = await onResult(result, items[index], index);
        if (signal === 'stop') stopped = true;
      }
    }
  }

  await Promise.all(Array.from({ length: size }, run));
  return { stopped, processed: Math.min(cursor, items.length) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { mapPool, sleep };
