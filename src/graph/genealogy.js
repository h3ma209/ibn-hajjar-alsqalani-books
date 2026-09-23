'use strict';

const { normalizeArabic } = require('../util/arabic');

function chainKey(chain = []) {
  return chain.map((part) => normalizeArabic(part)).filter(Boolean).join('|');
}

function suffixOverlap(a = [], b = []) {
  const left = a.map(normalizeArabic).filter(Boolean);
  const right = b.map(normalizeArabic).filter(Boolean);
  if (!left.length || !right.length) return 0;
  let score = 0;
  const start = Math.max(0, left.length - 4);
  for (let i = start; i < left.length; i += 1) {
    if (right.includes(left[i])) score += 1;
  }
  return score;
}

function buildGenealogy(persons) {
  const byFather = new Map();
  const byName = new Map();

  const addName = (name, person) => {
    const key = normalizeArabic(name);
    if (!key) return;
    const bucket = byName.get(key) || [];
    bucket.push(person);
    byName.set(key, bucket);
  };

  for (const person of persons) {
    addName(person.identity.display_name, person);
    addName(person.identity.nasab.ism, person);
    addName(person.identity.nasab.full_name, person);
    const father = person.identity.nasab.father;
    if (father) {
      const key = normalizeArabic(father);
      const bucket = byFather.get(key) || [];
      bucket.push(person);
      byFather.set(key, bucket);
    }
  }

  const edges = [];
  for (const child of persons) {
    const fatherName = child.identity.nasab.father;
    if (!fatherName) continue;
    const candidates = byName.get(normalizeArabic(fatherName)) || [];
    const scored = candidates
      .filter((other) => other.person_id !== child.person_id)
      .map((other) => ({
        other,
        overlap: suffixOverlap(child.identity.nasab.chain, other.identity.nasab.chain),
      }))
      .sort((a, b) => b.overlap - a.overlap);

    const best = scored[0];
    const unique = best && (scored.length === 1 || best.overlap > (scored[1]?.overlap || 0));
    edges.push({
      from_person_id: child.person_id,
      to_person_id: unique ? best.other.person_id : null,
      to_literal: unique ? null : fatherName,
      type: 'family',
      relation: 'father',
      source: 'structural',
      evidence: child.identity.nasab.full_name,
      confidence: unique ? 0.7 : 0.4,
      resolved: Boolean(unique),
      ambiguous: !unique && scored.length > 1,
      candidates: !unique && scored.length > 1 ? scored.slice(0, 5).map((row) => row.other.person_id) : [],
    });
  }

  return edges;
}

module.exports = { buildGenealogy, suffixOverlap, chainKey };
