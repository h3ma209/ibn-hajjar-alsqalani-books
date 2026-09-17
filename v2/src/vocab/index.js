'use strict';

const fs = require('fs');
const path = require('path');

const { PATHS } = require('../config');
const { normalizeArabic } = require('../util/arabic');

/**
 * Controlled vocabularies turn free Arabic surface forms into stable keys so the
 * corpus is queryable ("who fought at Khaybar") instead of only greppable.
 */

function loadVocab(name) {
  const file = path.join(PATHS.VOCAB_DIR, `${name}.json`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byKey = new Map();
  const byAlias = new Map();
  for (const term of parsed.terms) {
    byKey.set(term.key, term);
    const aliases = new Set([term.key, term.label_ar, ...(term.aliases || [])]);
    for (const alias of aliases) {
      if (!alias) continue;
      const norm = normalizeArabic(alias);
      if (norm) byAlias.set(norm, term);
    }
  }
  // Longest aliases first so "فتح مكة" wins over "مكة".
  const aliasesByLength = [...byAlias.keys()].sort((a, b) => b.length - a.length);
  return { name, byKey, byAlias, aliasesByLength };
}

const cache = new Map();

function vocab(name) {
  if (!cache.has(name)) cache.set(name, loadVocab(name));
  return cache.get(name);
}

/** Exact lookup on a normalized surface form. */
function lookup(name, surface) {
  const term = vocab(name).byAlias.get(normalizeArabic(surface));
  return term ? term.key : null;
}

/**
 * Find the first vocabulary term mentioned anywhere in a phrase. Used when the
 * model returns a whole clause instead of a bare place or battle name.
 */
function findInText(name, text) {
  const haystack = normalizeArabic(text);
  if (!haystack) return null;
  const dictionary = vocab(name);
  for (const alias of dictionary.aliasesByLength) {
    if (haystack.includes(alias)) return dictionary.byAlias.get(alias).key;
  }
  return null;
}

/** Every vocabulary term mentioned in a phrase, deduplicated, in match order. */
function findAllInText(name, text) {
  const haystack = normalizeArabic(text);
  if (!haystack) return [];
  const dictionary = vocab(name);
  const keys = [];
  for (const alias of dictionary.aliasesByLength) {
    if (!haystack.includes(alias)) continue;
    const key = dictionary.byAlias.get(alias).key;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function resolve(name, surface) {
  return lookup(name, surface) || findInText(name, surface);
}

function term(name, key) {
  return vocab(name).byKey.get(key) || null;
}

module.exports = { vocab, lookup, findInText, findAllInText, resolve, term };
