'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Buffered JSONL writer. Writes to a temp file and renames on close so an
 * interrupted run never leaves a half-written artifact in place.
 */
class JsonlWriter {
  constructor(outPath, { validate = null } = {}) {
    this.outPath = outPath;
    this.tmpPath = `${outPath}.tmp`;
    this.validate = validate;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    this.stream = fs.createWriteStream(this.tmpPath, { encoding: 'utf8' });
    this.count = 0;
  }

  async write(record) {
    if (this.validate) this.validate(record);
    const line = `${JSON.stringify(record)}\n`;
    this.count += 1;
    if (!this.stream.write(line)) {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          this.stream.off('drain', onDrain);
          reject(err);
        };
        const onDrain = () => {
          this.stream.off('error', onError);
          resolve();
        };
        this.stream.once('error', onError);
        this.stream.once('drain', onDrain);
      });
    }
  }

  async close() {
    await new Promise((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(resolve);
    });
    fs.renameSync(this.tmpPath, this.outPath);
    return { path: this.outPath, count: this.count, bytes: fs.statSync(this.outPath).size };
  }
}

/** Stream a JSONL file record by record without loading it into memory. */
async function* readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing input file: ${filePath}. Run the earlier pipeline step first.`);
  }
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`Bad JSON at ${filePath}:${lineNo} - ${err.message}`);
    }
  }
}

/** Load a whole JSONL file into an array. Only for files known to be small. */
async function loadJsonl(filePath) {
  const out = [];
  for await (const rec of readJsonl(filePath)) out.push(rec);
  return out;
}

/**
 * Append-only progress log. Used so an interrupted LLM run can resume by
 * skipping person_ids that already completed.
 */
class AppendLog {
  constructor(logPath) {
    this.logPath = logPath;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    this.stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  }

  append(record) {
    this.stream.write(`${JSON.stringify(record)}\n`);
  }

  async close() {
    await new Promise((resolve) => this.stream.end(resolve));
  }

  static readIds(logPath, key = 'person_id') {
    const ids = new Set();
    if (!fs.existsSync(logPath)) return ids;
    for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed);
        if (rec[key]) ids.add(rec[key]);
      } catch {
        // Truncated final line from a hard kill. Ignore it.
      }
    }
    return ids;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return filePath;
}

module.exports = { JsonlWriter, readJsonl, loadJsonl, AppendLog, writeJson };
