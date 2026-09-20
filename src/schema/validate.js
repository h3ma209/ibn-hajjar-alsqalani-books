'use strict';

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { PATHS } = require('../config');

/**
 * Schema validation for every artifact the pipeline writes.
 *
 * Validation is wired into the write path rather than offered as an optional
 * check, so a malformed record cannot reach disk in the first place.
 */

const SCHEMA_FILES = [
  'fact.schema.json',
  'raw-text.schema.json',
  'person.schema.json',
  'edge.schema.json',
  'citation.schema.json',
];

let ajv = null;
const validators = new Map();

function init() {
  if (ajv) return ajv;
  ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const file of SCHEMA_FILES) {
    const schema = JSON.parse(fs.readFileSync(path.join(PATHS.SCHEMA_DIR, file), 'utf8'));
    ajv.addSchema(schema, schema.$id);
  }
  return ajv;
}

const SCHEMA_IDS = {
  person: 'https://isabah-corpus.local/schema/person.schema.json',
  rawText: 'https://isabah-corpus.local/schema/raw-text.schema.json',
  edge: 'https://isabah-corpus.local/schema/edge.schema.json',
  citation: 'https://isabah-corpus.local/schema/citation.schema.json',
};

function validatorFor(kind) {
  if (!SCHEMA_IDS[kind]) throw new Error(`Unknown schema kind: ${kind}`);
  if (!validators.has(kind)) {
    validators.set(kind, init().getSchema(SCHEMA_IDS[kind]));
  }
  return validators.get(kind);
}

function formatErrors(errors, record) {
  const label = record?.person_id || record?.from_person_id || 'record';
  const details = (errors || [])
    .slice(0, 6)
    .map((err) => `  ${err.instancePath || '/'} ${err.message}`)
    .join('\n');
  return `Schema validation failed for ${label}:\n${details}`;
}

/** Validate and return the record, throwing on failure. */
function assertValid(kind, record) {
  const validate = validatorFor(kind);
  if (!validate(record)) throw new Error(formatErrors(validate.errors, record));
  return record;
}

/** Non-throwing variant used by the standalone validate command. */
function checkValid(kind, record) {
  const validate = validatorFor(kind);
  if (validate(record)) return null;
  return formatErrors(validate.errors, record);
}

/** Bind a validator for JsonlWriter. */
function writerValidator(kind) {
  return (record) => assertValid(kind, record);
}

module.exports = { assertValid, checkValid, writerValidator, SCHEMA_IDS };
