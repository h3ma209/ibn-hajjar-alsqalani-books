'use strict';

const { normalizeArabic } = require('../util/arabic');
const { suffixOverlap } = require('./genealogy');

/**
 * Cross-book identity matcher.
 *
 * Same-book person_ids are skipped. A link is emitted only when exactly one
 * target wins on normalized ism+father plus nasab-chain overlap. Ambiguous
 * hits stay unlinked — do not invent a unique match.
 */
function nameKey(person) {
  const nasab = person.identity?.nasab || {};
  const ism = nasab.ism || person.identity?.display_name || '';
  const father = nasab.father || '';
  return normalizeArabic([ism, father].filter(Boolean).join('|'));
}

function scorePair(source, target) {
  const sourceKey = nameKey(source);
  const targetKey = nameKey(target);
  if (!sourceKey || sourceKey !== targetKey) return 0;
  const overlap = suffixOverlap(source.identity?.nasab?.chain, target.identity?.nasab?.chain);
  const chainLen = Math.min(
    (source.identity?.nasab?.chain || []).length,
    (target.identity?.nasab?.chain || []).length
  );
  const overlapPart = chainLen ? overlap / chainLen : 0.5;
  return Number(Math.min(1, 0.55 + overlapPart * 0.45).toFixed(3));
}

function matchIdentities(sourcePersons, targetPersons, { minScore = 0.7 } = {}) {
  const byKey = new Map();
  for (const person of targetPersons) {
    const key = nameKey(person);
    if (!key) continue;
    const bucket = byKey.get(key) || [];
    bucket.push(person);
    byKey.set(key, bucket);
  }

  const links = [];
  for (const source of sourcePersons) {
    const key = nameKey(source);
    if (!key) continue;
    const scored = (byKey.get(key) || [])
      .filter((other) => other.person_id !== source.person_id)
      .map((other) => ({ other, score: scorePair(source, other) }))
      .filter((row) => row.score >= minScore)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) continue;
    const best = scored[0];
    const unique = scored.length === 1 || best.score > (scored[1]?.score || 0);
    if (!unique) continue;

    links.push({
      from_id: source.person_id,
      to_id: best.other.person_id,
      method: 'name_nasab',
      score: best.score,
      evidence: source.identity?.nasab?.full_name || source.identity?.display_name || null,
      from_book: source.book?.slug || source.person_id.split(':')[0] || null,
      to_book: best.other.book?.slug || best.other.person_id.split(':')[0] || null,
    });
  }
  return links;
}

function pageMapRow(person) {
  return {
    person_id: person.person_id,
    start_id: person.entry.start_id,
    end_id: person.entry.end_id ?? null,
    page_start: person.entry.page_start ?? null,
    page_end: person.entry.page_end ?? null,
    pdf_page: person.entry.pdf_page ?? null,
    source: person.entry.pdf_page != null ? 'pdf' : 'shamela',
  };
}

module.exports = { matchIdentities, nameKey, scorePair, pageMapRow };
