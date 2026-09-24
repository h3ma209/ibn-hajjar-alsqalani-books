'use strict';

const fs = require('fs');
const path = require('path');

const { writeJson } = require('../util/jsonl');

/**
 * Atomic JSON checkpoint. Written every N fetched persons so a kill mid-run
 * still leaves a resume-able snapshot (append logs + this file).
 */
function writeCheckpoint(filePath, payload) {
  const body = {
    ...payload,
    written_at: new Date().toISOString(),
  };
  const tmp = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
  return body;
}

function readCheckpoint(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function shouldCheckpoint(fetched, every) {
  return fetched > 0 && fetched % every === 0;
}

module.exports = { writeCheckpoint, readCheckpoint, shouldCheckpoint, writeJson };
