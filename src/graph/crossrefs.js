'use strict';

const { flatten, normalizeArabic, normalizeDigits } = require('../util/arabic');
const { resolve: resolveVocab, vocab } = require('../vocab');
const { suffixOverlap } = require('./genealogy');

/**
 * Cross-reference and narrator-graph resolution.
 *
 * v1 produced 1,245 reference snippets and resolved none of them. Here every
 * reference is either resolved to a person_id, marked ambiguous with its
 * candidates listed, or kept as an explicit literal. Unresolved is a reported
 * outcome, not a silent drop.
 */

const QISM_WORD_NUM = {
  الأول: 1,
  الاول: 1,
  الثاني: 2,
  الثالث: 3,
  الرابع: 4,
  // Ibn Hajar routinely calls the fourth qism "the last one".
  الأخير: 4,
  الاخير: 4,
};

const SECTION_WORD = {
  الأسماء: 'names',
  الاسماء: 'names',
  الكنى: 'kunya',
  النساء: 'women',
  المبهمات: 'mubhamat',
};

/** Letter-block names, since references often omit the word حرف entirely. */
const LETTER_NAMES = [
  'الهمزة', 'الألف', 'الباء', 'التاء', 'الثاء', 'الجيم', 'الحاء', 'الخاء',
  'الدال', 'الذال', 'الراء', 'الزاي', 'السين', 'الشين', 'الصاد', 'الضاد',
  'الطاء', 'الظاء', 'العين', 'الغين', 'الفاء', 'القاف', 'الكاف', 'اللام',
  'الميم', 'النون', 'الهاء', 'الواو', 'الياء',
];
const LETTER_SET = new Set(LETTER_NAMES);

/** Relational pointers such as "تقدم نسبه في ترجمة أبيه". */
const RELATION_WORD = {
  أبيه: 'father', أبيها: 'father', والده: 'father', والدها: 'father',
  جده: 'grandfather', جدها: 'grandfather',
  أخيه: 'brother', أخيها: 'brother', أخته: 'sister',
  ابنه: 'son', ابنها: 'son', ولده: 'son',
  زوجها: 'husband', زوجه: 'wife', أمه: 'mother', أمها: 'mother',
  عمه: 'uncle', عمها: 'uncle',
};

const FORWARD_RE = /يأتي|سيأتي|سيعاد|انظر/u;

/**
 * A reference is a pointer verb followed by where to look. Classifying the
 * target phrase after one scan beats maintaining a regex per phrasing, and it
 * makes the unclassifiable remainder visible instead of invisible.
 */
const TRIGGER_RE =
  /(يأتي|سيأتي|سيعاد|تقدم|تقدمت|تقدموا|تقدما|مضى|مضت|انظر)(?:\s+(?:نسبه|نسبها|ذكره|ذكرها|ذكر|أيضا|قريبا))?\s+(?:في|عند)\s+([^.،؛]{1,60})/gu;

const NEXT_RE = /^(?:ال[ّ]?ذي|التي)\s+بعده/u;
const PREV_RE = /^(?:ال[ّ]?ذي|التي)\s+قبله/u;
const SELF_RE = /^ترجمت[هها]/u;

function classifyTarget(target) {
  const text = target.trim();

  if (SELF_RE.test(text)) return null;
  if (NEXT_RE.test(text)) return { kind: 'see_adjacent', offset: 1 };
  if (PREV_RE.test(text)) return { kind: 'see_adjacent', offset: -1 };

  const relation = text.match(/^ترجمة\s+([^\s.،]{2,12})/u);
  if (relation && RELATION_WORD[relation[1]]) {
    return { kind: 'see_relation', relation: RELATION_WORD[relation[1]] };
  }

  const numeric = text.match(/^(?:ترجمة\s+)?(?:رقم\s*)?(\d{1,5})/u);
  if (numeric) return { kind: 'see_entry', entryNumber: Number(numeric[1]) };

  const qism = text.match(/^(?:(?:ال)?قسم\s+)?(الأول|الاول|الثاني|الثالث|الرابع|الأخير|الاخير)/u);
  if (qism && QISM_WORD_NUM[qism[1]]) return { kind: 'see_qism', qism: QISM_WORD_NUM[qism[1]] };

  const section = text.match(/^([^\s.،]{2,12})/u);
  if (section && SECTION_WORD[section[1]]) {
    return { kind: 'see_section', section: SECTION_WORD[section[1]] };
  }

  const letter = text.match(/^(?:حرف\s+)?([^\s.،]{2,12})/u);
  if (letter && LETTER_SET.has(letter[1])) {
    return { kind: 'see_letter', letter: `حرف ${letter[1]}` };
  }

  return null;
}

/** Pull in-book references out of one entry's text. */
function extractTextRefs(text) {
  const flat = normalizeDigits(flatten(text));
  const refs = [];
  const seen = new Set();

  for (const match of flat.matchAll(TRIGGER_RE)) {
    const classified = classifyTarget(match[2]);
    if (!classified) continue;
    const ref = {
      direction: FORWARD_RE.test(match[1]) ? 'forward' : 'backward',
      evidence: match[0].replace(/\s+/g, ' ').slice(0, 200),
      ...classified,
    };
    const key = `${ref.kind}|${ref.entryNumber ?? ''}|${ref.qism ?? ''}|${ref.section ?? ''}|${ref.letter ?? ''}|${ref.relation ?? ''}|${ref.offset ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    if (refs.length >= 40) break;
  }

  return refs;
}

function nameTokens(value) {
  if (Array.isArray(value)) return value.map((part) => normalizeArabic(part)).filter(Boolean);
  return String(value || '')
    .split(/\s+بن\s+/u)
    .map((part) => normalizeArabic(part))
    .filter(Boolean);
}

const NO_RESOLUTION = { resolved: false, ambiguous: false, person_id: null, candidates: [] };

function uniqueIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Lookup tables over the index so references can be turned into person_ids.
 * Indexes display, full nasab, kunya, ism+father, and extra name variants.
 */
function buildResolver(indexRows, { names = [], genealogy = [] } = {}) {
  const byNumber = new Map();
  const byName = new Map();
  const meta = new Map();
  const order = indexRows.map((row) => row.person_id);
  const position = new Map(order.map((id, index) => [id, index]));
  const relationTarget = new Map();

  const addName = (key, personId) => {
    const norm = normalizeArabic(key);
    if (!norm) return;
    const bucket = byName.get(norm);
    if (bucket) bucket.push(personId);
    else byName.set(norm, [personId]);
  };

  for (const row of indexRows) {
    meta.set(row.person_id, row);

    const numberBucket = byNumber.get(row.entry_number);
    if (numberBucket) numberBucket.push(row.person_id);
    else byNumber.set(row.entry_number, [row.person_id]);

    addName(row.display_name_norm, row.person_id);
    addName(row.full_name_norm, row.person_id);
    addName(row.kunya, row.person_id);
    addName(row.kunya_norm, row.person_id);
    addName(row.ism_norm, row.person_id);
    for (const key of row.name_keys || []) addName(key, row.person_id);
    if (row.ism_norm && row.father_norm) {
      addName(`${row.ism_norm} بن ${row.father_norm}`, row.person_id);
    }
  }

  for (const name of names) {
    addName(name.form_norm || name.form, name.person_id);
  }

  for (const edge of genealogy) {
    if (!edge.resolved || !edge.to_person_id || !edge.from_person_id) continue;
    const bucket = relationTarget.get(edge.from_person_id) || {};
    if (edge.relation) bucket[edge.relation] = edge.to_person_id;
    relationTarget.set(edge.from_person_id, bucket);
  }

  function resolveNumber(entryNumber) {
    const candidates = uniqueIds(byNumber.get(entryNumber) || []);
    return {
      resolved: candidates.length === 1,
      ambiguous: candidates.length > 1,
      person_id: candidates.length === 1 ? candidates[0] : null,
      candidates,
    };
  }

  function applyFilters(candidates, filters) {
    if (candidates.length <= 1) return candidates;
    const hasFilter =
      filters.section ||
      filters.letter ||
      filters.qism ||
      filters.is_woman != null ||
      filters.nisba_key;
    if (!hasFilter) return candidates;

    const filtered = candidates.filter((id) => {
      const row = meta.get(id);
      if (!row) return false;
      if (filters.section && row.section_type !== filters.section) return false;
      if (filters.letter && row.letter !== filters.letter) return false;
      if (filters.qism && row.qism !== filters.qism) return false;
      if (filters.is_woman != null && row.is_woman !== filters.is_woman) return false;
      if (filters.nisba_key && !(row.nisba_keys || []).includes(filters.nisba_key)) return false;
      return true;
    });
    return filtered.length ? filtered : candidates;
  }

  function applyNasabOverlap(candidates, nasabChain) {
    if (candidates.length <= 1 || !nasabChain || !nasabChain.length) return candidates;
    const scored = candidates.map((id) => {
      const row = meta.get(id);
      const tokens = nameTokens(row?.full_name_norm || row?.display_name_norm);
      return { id, overlap: suffixOverlap(nasabChain, tokens) };
    });
    scored.sort((a, b) => b.overlap - a.overlap);
    const best = scored[0];
    const next = scored[1];
    if (best.overlap >= 1 && best.overlap > (next?.overlap || 0)) return [best.id];
    return candidates;
  }

  function resolveName(name, filters = {}) {
    const key = normalizeArabic(name);
    let candidates = uniqueIds(byName.get(key) || []);

    if (!candidates.length) {
      const tokens = nameTokens(name);
      if (tokens.length >= 2) {
        candidates = uniqueIds(byName.get(`${tokens[0]} بن ${tokens[1]}`) || []);
      }
    }

    candidates = applyFilters(candidates, filters);
    candidates = applyNasabOverlap(candidates, filters.nasabChain);

    return {
      resolved: candidates.length === 1,
      ambiguous: candidates.length > 1,
      person_id: candidates.length === 1 ? candidates[0] : null,
      candidates,
    };
  }

  function resolveRelation(fromPersonId, relation) {
    const hit = relationTarget.get(fromPersonId)?.[relation];
    if (!hit) return NO_RESOLUTION;
    return { resolved: true, ambiguous: false, person_id: hit, candidates: [hit] };
  }

  /** "الذي بعده" and "الذي قبله" are exact pointers once entries are in document order. */
  function neighbor(personId, offset) {
    const index = position.get(personId);
    if (index == null) return { resolved: false, ambiguous: false, person_id: null, candidates: [] };
    const target = order[index + offset];
    return {
      resolved: Boolean(target),
      ambiguous: false,
      person_id: target ?? null,
      candidates: target ? [target] : [],
    };
  }

  return {
    resolveNumber,
    resolveName,
    resolveRelation,
    neighbor,
    meta,
    order,
    size: indexRows.length,
  };
}

function edge(fields) {
  return {
    from_person_id: fields.from,
    to_person_id: fields.to ?? null,
    to_literal: fields.literal ?? null,
    type: fields.type,
    relation: fields.relation ?? null,
    direction: fields.direction ?? null,
    target_entry_number: fields.targetEntryNumber ?? null,
    target_qism: fields.targetQism ?? null,
    target_section: fields.targetSection ?? null,
    target_letter: fields.targetLetter ?? null,
    source: fields.source,
    evidence: fields.evidence ?? null,
    confidence: fields.confidence ?? 0.5,
    resolved: Boolean(fields.resolved),
    ambiguous: Boolean(fields.ambiguous),
    candidates: fields.candidates && fields.candidates.length > 1 ? fields.candidates : [],
  };
}

/**
 * Turn text references into edges, resolving targets where possible.
 *
 * A section or qism pointer without a name cannot identify a single entry, so it
 * stays unresolved but keeps its typed target, which is still a usable filter.
 */
function refsToEdges(person, refs, resolver) {
  const personId = person.person_id;
  const edges = [];

  for (const ref of refs) {
    let resolution = NO_RESOLUTION;

    if (ref.kind === 'see_entry' && Number.isFinite(ref.entryNumber)) {
      resolution = resolver.resolveNumber(ref.entryNumber);
    } else if (ref.kind === 'see_adjacent') {
      resolution = resolver.neighbor(personId, ref.offset);
    } else if (ref.kind === 'see_relation') {
      if (resolver.resolveRelation) {
        resolution = resolver.resolveRelation(personId, ref.relation);
      }
      if (!resolution.resolved) {
        const nasab = person.identity?.nasab ?? {};
        const relativeName =
          ref.relation === 'father'
            ? nasab.father
            : ref.relation === 'grandfather'
              ? nasab.grandfather
              : null;
        if (relativeName) {
          resolution = resolver.resolveName(relativeName, {
            nasabChain: nasab.chain,
          });
        }
      }
    }

    edges.push(
      edge({
        from: personId,
        to: resolution.person_id,
        literal: resolution.person_id ? null : ref.evidence,
        type: ref.kind,
        relation: ref.relation ?? null,
        direction: ref.direction,
        targetEntryNumber: ref.entryNumber ?? null,
        targetQism: ref.qism ?? null,
        targetSection: ref.section ?? null,
        targetLetter: ref.letter ?? null,
        source: 'structural',
        evidence: ref.evidence,
        confidence: 0.8,
        resolved: resolution.resolved,
        ambiguous: resolution.ambiguous,
        candidates: resolution.candidates,
      })
    );
  }

  return edges;
}

const COLLECTIVE_RE = /آخرون|كثيرون|جماعة|غيرهم|خلق|جمع|غير واحد|وغيره/u;

/** Turn extracted narrator names and family links into edges. */
function narrationToEdges(person, resolver) {
  const edges = [];
  const personId = person.person_id;

  const addNameEdges = (facts, type) => {
    for (const fact of facts || []) {
      if (COLLECTIVE_RE.test(fact.value)) continue;
      const resolution = resolver.resolveName(fact.value, {
        nasabChain: person.identity?.nasab?.chain,
      });
      edges.push(
        edge({
          from: personId,
          to: resolution.person_id,
          literal: resolution.person_id ? null : fact.value,
          type,
          source: fact.source,
          evidence: fact.evidence,
          confidence: fact.confidence,
          resolved: resolution.resolved,
          ambiguous: resolution.ambiguous,
          candidates: resolution.candidates,
        })
      );
    }
  };

  addNameEdges(person.narration?.narrated_from, 'narrated_from');
  addNameEdges(person.narration?.narrated_to, 'narrated_to');

  for (const member of person.life?.family || []) {
    const memberName = member.name || member.value;
    if (!memberName) continue;
    if (COLLECTIVE_RE.test(memberName)) continue;
    const resolution = resolver.resolveName(memberName, {
      nasabChain: person.identity?.nasab?.chain,
      is_woman: member.relation === 'mother' || member.relation === 'sister' || member.relation === 'wife' || member.relation === 'daughter'
        ? true
        : undefined,
    });
    edges.push(
      edge({
        from: personId,
        to: resolution.person_id,
        literal: resolution.person_id ? null : memberName,
        type: 'family',
        relation: member.relation ?? null,
        source: member.source,
        evidence: member.evidence,
        confidence: member.confidence,
        resolved: resolution.resolved,
        ambiguous: resolution.ambiguous,
        candidates: resolution.candidates,
      })
    );
  }

  return edges;
}

const CITATION_RE =
  /(ذكره|ذكرها|ذكر|قاله|قال|أخرجه|أخرج|رواه|روى|أورده|نقله|حكاه|وثقه|ضعفه)\s+([^.،؛]{2,45})/gu;

/**
 * Named authorities and works cited inside an entry. These are sources of
 * claims, so they go to citations.jsonl instead of the person graph.
 */
function extractCitations(personId, text, extractionCitations = []) {
  const out = [];
  const seen = new Set();
  const authorities = vocab('authorities');

  const push = (label, key, verb, evidence, source, confidence) => {
    const dedupeKey = `${key || label}|${verb || ''}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push({
      person_id: personId,
      authority: label,
      authority_key: key,
      verb: verb || null,
      evidence: evidence ? evidence.slice(0, 300) : null,
      source,
      confidence,
    });
  };

  for (const item of extractionCitations) {
    if (!item?.value) continue;
    const key = resolveVocab('authorities', item.value);
    push(item.value, key, item.verb, item.evidence, item.source || 'llm', item.confidence ?? 0.7);
  }

  const flat = flatten(text);
  for (const match of flat.matchAll(CITATION_RE)) {
    const candidate = normalizeArabic(match[2]);
    let hit = null;
    for (const alias of authorities.aliasesByLength) {
      if (candidate.includes(alias)) {
        hit = authorities.byAlias.get(alias);
        break;
      }
    }
    if (!hit) continue;
    push(hit.label_ar, hit.key, match[1], match[0], 'structural', 0.8);
    if (out.length >= 40) break;
  }

  return out;
}

module.exports = {
  extractTextRefs,
  buildResolver,
  refsToEdges,
  narrationToEdges,
  extractCitations,
  QISM_WORD_NUM,
};
