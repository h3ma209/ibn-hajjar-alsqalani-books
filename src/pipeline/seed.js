'use strict';

const fs = require('fs');
const path = require('path');

const { PATHS, ensureDirs } = require('../config');

const SEED_FILES = [
  'raw-text.jsonl',
  'placement.jsonl',
  'chapters.jsonl',
  'llm-facts.jsonl',
  'llm-progress.jsonl',
  'manifest.json',
];

function seedFromV2({ log = () => {}, force = false } = {}) {
  ensureDirs();
  const srcDir = path.join(PATHS.DATA_ROOT, 'v2', 'corpus');
  if (!fs.existsSync(srcDir)) throw new Error(`Missing v2 corpus at ${srcDir}`);

  const copied = [];
  const skipped = [];
  for (const file of SEED_FILES) {
    const from = path.join(srcDir, file);
    const to = path.join(PATHS.DATA_DIR, file);
    if (!fs.existsSync(from)) {
      skipped.push({ file, reason: 'source missing' });
      continue;
    }
    if (fs.existsSync(to) && !force) {
      skipped.push({ file, reason: 'already present' });
      continue;
    }
    fs.copyFileSync(from, to);
    copied.push(file);
  }

  const baselineV2 = PATHS.qualityBaselineV2;
  const v2Quality = path.join(PATHS.DATA_ROOT, 'v2', 'reports', 'quality.json');
  if (fs.existsSync(v2Quality) && !fs.existsSync(baselineV2)) {
    fs.mkdirSync(path.dirname(baselineV2), { recursive: true });
    fs.copyFileSync(v2Quality, baselineV2);
    copied.push(path.relative(PATHS.CODE_ROOT, baselineV2));
  }

  log(`seed v3: copied ${copied.length}, skipped ${skipped.length}`);
  return { copied, skipped, dest: PATHS.DATA_DIR };
}

module.exports = { seedFromV2 };
