'use strict';

const { flatten, parseArabicYear, normalizeArabic } = require('../util/arabic');
const { vocab, findAllInText } = require('../vocab');

/**
 * Heuristic fallback extractor.
 *
 * This layer exists only so an entry is never left empty when an LLM call fails
 * or is skipped. Unlike the v1 parser it contains no person-specific patterns,
 * and everything it produces is labelled `regex` with low confidence so callers
 * can tell heuristic guesses from model extractions.
 *
 * It emits the same intermediate shape as the LLM extractor, so merging is uniform.
 */

const VERSION = 'regex-bio/2.0.0';
const REGEX_CONFIDENCE = 0.3;

const SENTENCE_SPLIT_RE = /(?<=[.؟!])\s+|\n+/u;

function sentences(text) {
  return flatten(text)
    .split(/(?<=[.؟!])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

function fact(value, evidence) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  return { value: trimmed.slice(0, 300), evidence: evidence ? evidence.slice(0, 400) : null };
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Collect sentences matching a trigger, as facts whose evidence is the sentence. */
function factsFromSentences(sents, trigger, limit = 12) {
  const out = [];
  for (const sentence of sents) {
    if (!trigger.test(sentence)) continue;
    out.push(fact(sentence, sentence));
    if (out.length >= limit) break;
  }
  return uniqueBy(out, (f) => normalizeArabic(f.value));
}

const COLLECTIVE_RE = /^(?:و?آخرون|و?كثيرون|و?جماعة|و?غيرهم|و?خلق|و?جمع|من الصحابة|وغير واحد)$/u;

/** Split "ابن عمر، وجابر، وأنس" into individual names. */
function splitNameList(chunk, limit = 30) {
  if (!chunk) return [];
  const parts = String(chunk)
    .replace(/[،؛]/g, ',')
    .split(/,|\s+و(?=[\u0621-\u064A])/u)
    .map((part) =>
      flatten(part)
        .replace(/^(?:عن|من|ولده|ابنه|أخوه)\s+/u, '')
        .replace(/[.:،؛]+$/u, '')
        .trim()
    )
    .filter(
      (part) =>
        part.length >= 3 &&
        part.length <= 60 &&
        !COLLECTIVE_RE.test(part) &&
        !/^(?:قال|روى|أخرج|وهو|وهي|في|على|عن)\b/u.test(part)
    );
  return parts.slice(0, limit);
}

function emptyLifeEvent() {
  return {
    year_hijri: null,
    year_candidates: [],
    year_uncertain: false,
    place: null,
    cause: null,
    evidence: null,
  };
}

/** Pull Hijri years out of "سنة سبع وخمسين" or "سنة 57". */
function extractYears(text, triggerRe) {
  const flat = flatten(text);
  const years = [];
  let evidence = null;
  for (const match of flat.matchAll(triggerRe)) {
    const year = parseArabicYear(match[1]);
    if (year == null) continue;
    if (!years.includes(year)) years.push(year);
    if (!evidence) evidence = match[0].slice(0, 200);
  }
  return { years, evidence };
}

const DEATH_YEAR_RE =
  /(?:مات(?:ت)?|توفي(?:ت)?|استشهد(?:ت)?|قتل(?:ت)?|وفاته|هلك)[^.]{0,40}?سنة\s+([^\s.،]{2,30}(?:\s+و[^\s.،]{2,20}){0,2})/gu;
const BIRTH_YEAR_RE =
  /(?:ولد(?:ت)?|مولده|مولدها)[^.]{0,30}?سنة\s+([^\s.،]{2,30}(?:\s+و[^\s.،]{2,20}){0,2})/gu;

const CONVERSION_RE = /أسلم|إسلامه|هاجر|هجرته|قدم المدينة|مقدمه|بيعة الرضوان|أول من أسلم/u;
const COMPANIONSHIP_RE =
  /صحب|الصحبة|له صحبة|خدم النبي|رأى النبي|رآه النبي|سمع النبي|سمع من النبي|بعثه النبي|وفد على النبي|صلى مع النبي|أدرك النبي/u;
const TRAIT_RE =
  /كان (?:طويلا|قصيرا|آدم|أبيض|أشقر|أسمر|جسيما|نحيفا)|كان يخضب|كان من أعبد|كان يصوم|كان يصلي|كان كثير|زاهدا|فاضلا|شجاعا/u;
const PRAISE_RE = /فاضل|من خيار|من أفاضل|ثقة|جليل|من السابقين|من أهل بدر|شهد له|بشره النبي/u;
const CRITICISM_RE =
  /لا يصح|لا يثبت|وهم|أخطأ|تصحيف|غلط|أنكر|ضعيف|لا يعرف|ليس بشيء|فيه نظر|منقطع|مرسل/u;
const DEFENSE_RE = /والصواب|والصحيح|والأصح|فالجواب|وليس كذلك|بل هو|والمعتمد|قلت:/u;
const RESIDENCE_RE = /سكن|نزل|عداده في|كان ينزل|أهل/u;

const OFFICE_RE =
  /((?:استعمله|استعمل|ولّاه|ولاه|أمّره|أمره|استخلفه|بعثه|استقضاه|قدّمه)\s+[^.]{4,140})/gu;
const NARRATED_FROM_RE = /(?:روى|يروي|حدث|سمع)\s+عن\s+([^.]{4,200})/gu;
const NARRATED_TO_RE = /روى\s+عنه(?:ا)?\s+([^.]{4,300})/gu;
const FAMILY_PATTERNS = [
  { relation: 'mother', re: /(?:أمه|أمها|وأمه|وأمها)\s+([^.،]{3,60})/gu },
  { relation: 'brother', re: /(?:أخوه|وأخوه|أخو)\s+([^.،]{3,60})/gu },
  { relation: 'sister', re: /(?:أخته|وأخته)\s+([^.،]{3,60})/gu },
  { relation: 'son', re: /(?:ابنه|ولده|وابنه)\s+([^.،]{3,60})/gu },
  { relation: 'daughter', re: /(?:ابنته|بنته)\s+([^.،]{3,60})/gu },
  { relation: 'wife', re: /(?:زوجته|امرأته|وزوجته)\s+([^.،]{3,60})/gu },
  { relation: 'husband', re: /(?:زوجها|وزوجها)\s+([^.،]{3,60})/gu },
];

const PROLIFIC_RE = /من المكثرين|أكثر الصحابة حديثا|أكثر عن النبي|كثير الحديث|من المكثرين في الرواية/u;
const HADITH_COUNT_RE = /(?:له|روى|عنده)\s+(?:نحو\s+)?([^.]{0,20}(?:حديث|أحاديث)[^.]{0,30})/u;

const CITATION_VERB_RE =
  /(ذكره|ذكرها|قاله|قال|أخرجه|أخرج|روى|رواه|أورده|نقله|حكاه)\s+([^.،]{2,40})/gu;

const CROSS_REF_PATTERNS = [
  {
    kind: 'see_qism',
    re: /(?:يأتي|سيأتي|تقدم|سيعاد|مضى)\s+في\s+(?:ال)?قسم\s+(الأول|الاول|الثاني|الثالث|الرابع)/gu,
  },
  { kind: 'see_section', re: /(?:يأتي|سيأتي|تقدم|مضى)\s+في\s+(الكنى|النساء)/gu },
  { kind: 'see_letter', re: /(?:يأتي|سيأتي|تقدم|مضى)\s+في\s+حرف\s+([^\s.،]{1,20})/gu },
  { kind: 'see_entry', re: /(?:يأتي|سيأتي|تقدم|مضى)[^.]{0,30}?رقم\s*(\d{1,5})/gu },
];

const QISM_WORD_NUM = { الأول: 1, الاول: 1, الثاني: 2, الثالث: 3, الرابع: 4 };

function extractOffices(flat) {
  const out = [];
  const places = vocab('places');
  for (const match of flat.matchAll(OFFICE_RE)) {
    const clause = flatten(match[1]).slice(0, 200);
    let place = null;
    for (const alias of places.aliasesByLength) {
      if (normalizeArabic(clause).includes(alias)) {
        place = places.byAlias.get(alias).label_ar;
        break;
      }
    }
    const roleMatch = clause.match(/(?:على|قاضي|أمير|عامل)\s+([^\s.،]{2,30})/u);
    out.push({
      value: clause,
      role: roleMatch ? roleMatch[0].slice(0, 60) : null,
      place,
      appointed_by: null,
      period: null,
      evidence: clause,
    });
    if (out.length >= 8) break;
  }
  return uniqueBy(out, (o) => normalizeArabic(o.value));
}

function extractFamily(flat) {
  const out = [];
  for (const { relation, re } of FAMILY_PATTERNS) {
    for (const match of flat.matchAll(re)) {
      const name = flatten(match[1]).replace(/[.:،؛]+$/u, '').trim();
      if (name.length < 3) continue;
      out.push({ value: match[0].slice(0, 200), relation, name, evidence: match[0].slice(0, 200) });
      if (out.length >= 12) break;
    }
  }
  return uniqueBy(out, (f) => `${f.relation}|${normalizeArabic(f.name)}`);
}

function extractNames(flat, re, limit) {
  const names = [];
  for (const match of flat.matchAll(re)) {
    for (const name of splitNameList(match[1], limit)) {
      names.push(fact(name, match[0].slice(0, 300)));
    }
    if (names.length >= limit) break;
  }
  return uniqueBy(names, (f) => normalizeArabic(f.value)).slice(0, limit);
}

function extractCitations(flat) {
  const authorities = vocab('authorities');
  const out = [];
  for (const match of flat.matchAll(CITATION_VERB_RE)) {
    const candidate = flatten(match[2]);
    const norm = normalizeArabic(candidate);
    let hit = null;
    for (const alias of authorities.aliasesByLength) {
      if (norm.includes(alias)) {
        hit = authorities.byAlias.get(alias);
        break;
      }
    }
    if (!hit) continue;
    out.push({ value: hit.label_ar, verb: match[1], evidence: match[0].slice(0, 200) });
    if (out.length >= 20) break;
  }
  return uniqueBy(out, (c) => `${c.value}|${c.verb}`);
}

function extractCrossRefs(flat) {
  const out = [];
  for (const { kind, re } of CROSS_REF_PATTERNS) {
    for (const match of flat.matchAll(re)) {
      out.push({
        value: match[0].slice(0, 160),
        kind,
        target_entry_number: kind === 'see_entry' ? Number(match[1]) : null,
        target_qism: kind === 'see_qism' ? QISM_WORD_NUM[match[1]] ?? null : null,
        target_name: kind === 'see_section' || kind === 'see_letter' ? match[1] : null,
        evidence: match[0].slice(0, 200),
      });
      if (out.length >= 20) break;
    }
  }
  return uniqueBy(out, (r) => r.value);
}

/**
 * @param {string} text entry body text (footnotes stripped)
 * @param {{ displayName?: string, qism?: number|null, sectionType?: string }} hints
 */
function extractRegexBio(text, hints = {}) {
  const flat = flatten(text);
  const sents = sentences(text);

  const death = emptyLifeEvent();
  const deathYears = extractYears(flat, DEATH_YEAR_RE);
  if (deathYears.years.length) {
    death.year_candidates = deathYears.years;
    death.year_hijri = deathYears.years[0];
    death.year_uncertain = deathYears.years.length > 1;
    death.evidence = deathYears.evidence;
  }

  const birth = emptyLifeEvent();
  const birthYears = extractYears(flat, BIRTH_YEAR_RE);
  if (birthYears.years.length) {
    birth.year_candidates = birthYears.years;
    birth.year_hijri = birthYears.years[0];
    birth.year_uncertain = birthYears.years.length > 1;
    birth.evidence = birthYears.evidence;
  }

  const battleKeys = findAllInText('battles', flat);
  const battles = [];
  if (/شهد|غزا|حضر|قاتل|كان يوم|يوم/u.test(flat)) {
    const dictionary = vocab('battles');
    for (const key of battleKeys) {
      const term = dictionary.byKey.get(key);
      const evidence = sents.find((s) =>
        normalizeArabic(s).includes(normalizeArabic(term.label_ar))
      );
      if (!evidence || !/شهد|غزا|حضر|قاتل|يوم|كان في/u.test(evidence)) continue;
      battles.push(fact(term.label_ar, evidence));
    }
  }

  const hadithCount = flat.match(HADITH_COUNT_RE);

  return {
    summary: sents[0] ? sents[0].slice(0, 400) : null,
    kunya: null,
    is_woman: hints.sectionType === 'women' || /بنت |وهي |أمها /u.test(flat.slice(0, 200)),
    alternate_names: [],
    name_dispute_notes: factsFromSentences(
      sents,
      /اختلف في اسمه|اختلفوا في اسمه|في اسمه أقوال|قيل اسمه/u,
      6
    ),
    birth,
    death,
    conversion: factsFromSentences(sents, CONVERSION_RE, 8),
    companionship: factsFromSentences(sents, COMPANIONSHIP_RE, 8),
    battles: battles.slice(0, 12),
    offices: extractOffices(flat),
    family: extractFamily(flat),
    residences: factsFromSentences(sents, RESIDENCE_RE, 5),
    traits: factsFromSentences(sents, TRAIT_RE, 8),
    narration: {
      is_prolific: PROLIFIC_RE.test(flat),
      hadith_count: hadithCount ? flatten(hadithCount[0]).slice(0, 120) : null,
      narrated_from: extractNames(flat, NARRATED_FROM_RE, 20),
      narrated_to: extractNames(flat, NARRATED_TO_RE, 25),
      praise: factsFromSentences(sents, PRAISE_RE, 8),
      criticism: factsFromSentences(sents, CRITICISM_RE, 10),
      defenses: factsFromSentences(sents, DEFENSE_RE, 8),
    },
    cited_authorities: extractCitations(flat),
    cross_references: extractCrossRefs(flat),
  };
}

module.exports = {
  VERSION,
  REGEX_CONFIDENCE,
  extractRegexBio,
  splitNameList,
  sentences,
  SENTENCE_SPLIT_RE,
};
