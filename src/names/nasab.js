'use strict';

const { stripNoteMarkers, normalizeArabic } = require('../util/arabic');

/**
 * Strict genealogy (nasab) tokenizer.
 *
 * The v1 parser scored candidate substrings and kept the best-looking one, which
 * let biographical prose leak into ancestor slots (`حجر الأسلمي. له ولأبيه صحبة`).
 * Here the chain is cut at the first boundary marker, then every segment must
 * pass validation; if any segment fails the whole chain is rejected and we fall
 * back to the table-of-contents name with an explicit reason recorded.
 */

const OPENING_WINDOW = 1400;

const CHAIN_LINK_RE = /\s+(بن|ابن|بنت|ابنة)\s+/g;

/** Tokens that mean the genealogy has ended and biography has begun. */
const BOUNDARY_TOKENS = [
  'قال', 'قالت', 'قلت', 'قيل', 'وقيل', 'فقيل', 'يقال', 'ويقال',
  'روى', 'رواه', 'يروي', 'حدث', 'حدثنا', 'حدثني', 'أخبرنا', 'أخرج', 'أخرجه',
  'ذكر', 'ذكره', 'ذكرها', 'وذكر', 'فذكر',
  'يأتي', 'سيأتي', 'تقدم', 'سيعاد', 'ينظر', 'يحرر',
  'صحابي', 'صحابية', 'أدرك', 'أدركت', 'قدم', 'قدمت', 'شهد', 'شهدت',
  'كان', 'كانت', 'اختلف', 'اختلفوا', 'اختُلف', 'انتهى',
  'توفي', 'توفيت', 'مات', 'ماتت', 'استشهد', 'قتل',
  'أسلم', 'أسلمت', 'هاجر', 'هاجرت', 'بايع', 'بايعت', 'وفد', 'نزل', 'سكن',
  'له', 'لها', 'وله', 'ولها', 'أمه', 'أمها', 'وأمه', 'وأمها',
  'هكذا', 'وهو', 'وهي', 'عداده', 'أخو', 'أخت', 'زوج', 'زوجة', 'مولى', 'حليف',
];

const BOUNDARY_RE = new RegExp(
  `(?:^|\\s)(?:${BOUNDARY_TOKENS.join('|')})(?=\\s|$)`,
  'u'
);

/** Hard sentence terminators. Everything after the first one is prose. */
const HARD_STOP_RE = /[.؛:!؟]/u;

const SOFT_STOP_RE = /[،,]/u;

const SEGMENT_MAX_LEN = 40;
const SEGMENT_MAX_WORDS = 4;
const CHAIN_MAX_LINKS = 20;

const FORBIDDEN_IN_SEGMENT = /[0-9\u0660-\u0669.،؛؟:!«»[\]()\-–—_"'|/\\]/u;
const ARABIC_ONLY_RE = /^[\u0621-\u0652\u0670\u0671\s]+$/u;

/** Tribal / regional attributions such as القرشي, العدوي, الأنصارية. */
const NISBA_RE = /^ال[\u0621-\u064A]{2,}(?:يّ?|يّ?ة)$/u;

/** ال-prefixed words that look like a nisba but are descriptors, not lineage. */
const NISBA_DENYLIST = new Set([
  'الصحابي', 'الصحابية', 'التابعي', 'التابعية', 'الحافظ',
  'الآتي', 'الماضي', 'المذكور', 'الراوي',
]);

/** Descriptive tails that get glued onto the final ancestor in the source text. */
const TRAILING_FLUFF = new Set([
  'الزاهد', 'المشهور', 'المعروف', 'التابعي', 'الصحابي', 'الحافظ',
  'المذكور', 'الآتي', 'الماضي',
]);

const LINK_WORDS = new Set(['بن', 'ابن', 'بنت', 'ابنة']);

/** Trailing link with nothing after it: the chain ran off the end of the page. */
const DANGLING_LINK_RE = /\s+(?:بن|ابن|بنت|ابنة)\s*$/u;

const KUNYA_RE = /(?:^|\s)(أبو|أبي|أم)\s+((?:عبد\s+)?(?:ال)?[\u0621-\u064A]{2,20})/u;

function emptyResult(displayName, reason) {
  const name = stripNoteMarkers(displayName || '') || null;
  return {
    ism: name,
    father: null,
    grandfather: null,
    great_grandfather: null,
    chain: name ? [name] : [],
    links: [],
    nisba: [],
    kunya: name && /^(?:أبو|أم)\s/.test(name) ? name : null,
    full_name: name,
    source: 'toc',
    confidence: 0.2,
    rejected_reason: reason,
    link_count: 0,
    is_woman_hint: false,
  };
}

/** Normalise the entry opening into one line and drop the "N- " heading prefix. */
function openingPhrase(text, entryNumber) {
  let opening = stripNoteMarkers(String(text ?? '').replace(/\s+/g, ' ')).slice(
    0,
    OPENING_WINDOW
  );
  // Drop the heading number, tolerating Shamela sub-markers like "4850 ز-".
  const prefix = entryNumber != null ? String(entryNumber) : '\\d{1,5}';
  opening = opening.replace(new RegExp(`^\\s*${prefix}[^-–—]{0,6}?[-–—]\\s*`), '');
  // Shamela glues the chain link onto the previous token: "الخطاب:بن نفيل".
  return opening.replace(/([^\s])\s*[:.]\s*(?=(?:بن|ابن|بنت|ابنة)\s)/g, '$1 ').trim();
}

/**
 * Cut the phrase at the first boundary. Returns the candidate name plus the
 * remainder, which is still useful for finding a kunya.
 */
function cutAtBoundary(phrase) {
  const candidates = [];

  const hard = phrase.search(HARD_STOP_RE);
  if (hard >= 0) candidates.push(hard);

  const soft = phrase.search(SOFT_STOP_RE);
  if (soft >= 0) candidates.push(soft);

  const boundary = phrase.search(BOUNDARY_RE);
  if (boundary >= 0) candidates.push(boundary);

  const cut = candidates.length ? Math.min(...candidates) : phrase.length;
  const name = phrase.slice(0, cut).trim().replace(DANGLING_LINK_RE, '');
  return { name, rest: phrase.slice(cut).trim() };
}

function tokenize(phrase) {
  const segments = [];
  const links = [];
  let last = 0;
  CHAIN_LINK_RE.lastIndex = 0;
  let match;
  while ((match = CHAIN_LINK_RE.exec(phrase))) {
    segments.push(phrase.slice(last, match.index).trim());
    links.push(match[1]);
    last = match.index + match[0].length;
  }
  segments.push(phrase.slice(last).trim());
  return { segments, links };
}

/** Pull trailing nisba words off the final ancestor segment. */
function splitNisba(segment) {
  const words = segment.split(/\s+/).filter(Boolean);
  const nisba = [];
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (NISBA_RE.test(last) && !NISBA_DENYLIST.has(last)) {
      nisba.unshift(words.pop());
      continue;
    }
    if (TRAILING_FLUFF.has(last)) {
      words.pop();
      continue;
    }
    break;
  }
  // A bare nisba with nothing else is itself the ancestor name; keep it.
  if (!words.length) return { core: segment, nisba: [] };
  return { core: words.join(' '), nisba };
}

function validateSegment(segment) {
  if (!segment) return 'empty_segment';
  if (segment.length < 2) return 'segment_too_short';
  if (segment.length > SEGMENT_MAX_LEN) return 'segment_too_long';
  if (FORBIDDEN_IN_SEGMENT.test(segment)) return 'segment_has_punctuation_or_digits';
  if (!ARABIC_ONLY_RE.test(segment)) return 'segment_not_arabic';
  const words = segment.split(/\s+/).filter(Boolean);
  if (words.length > SEGMENT_MAX_WORDS) return 'segment_too_many_words';
  if (LINK_WORDS.has(words[words.length - 1])) return 'segment_ends_with_chain_link';
  for (const word of words) {
    if (BOUNDARY_TOKENS.includes(word)) return `segment_has_verb:${word}`;
  }
  return null;
}

function buildFullName(segments, links, nisba) {
  let name = segments[0] || '';
  for (let i = 1; i < segments.length; i += 1) {
    name += ` ${links[i - 1] || 'بن'} ${segments[i]}`;
  }
  if (nisba.length) name += ` ${nisba.join(' ')}`;
  return name.replace(/\s+/g, ' ').trim();
}

function scoreConfidence(linkCount, nisbaCount, source) {
  const base = source === 'ismuhu' ? 0.5 : 0.55;
  const value = base + Math.min(linkCount, 5) * 0.08 + (nisbaCount ? 0.07 : 0);
  return Number(Math.min(0.98, value).toFixed(2));
}

function buildFromPhrase(phrase, source) {
  const { segments, links } = tokenize(phrase);
  if (!segments.length || !segments[0]) {
    return { error: 'no_segments' };
  }

  const lastIndex = segments.length - 1;
  const { core, nisba } = splitNisba(segments[lastIndex]);
  const finalSegments = [...segments.slice(0, lastIndex), core].filter(Boolean);

  if (links.length > CHAIN_MAX_LINKS) return { error: 'chain_too_long' };

  for (const segment of finalSegments) {
    const problem = validateSegment(segment);
    if (problem) return { error: problem };
  }

  const usableLinks = links.slice(0, Math.max(0, finalSegments.length - 1));

  return {
    result: {
      ism: finalSegments[0] || null,
      father: finalSegments[1] || null,
      grandfather: finalSegments[2] || null,
      great_grandfather: finalSegments[3] || null,
      chain: finalSegments,
      links: usableLinks,
      nisba,
      kunya: null,
      full_name: buildFullName(finalSegments, usableLinks, nisba),
      source,
      confidence: scoreConfidence(usableLinks.length, nisba.length, source),
      rejected_reason: null,
      link_count: usableLinks.length,
      is_woman_hint: usableLinks.includes('بنت') || usableLinks.includes('ابنة'),
    },
  };
}

/**
 * Parse the genealogy for one entry.
 *
 * @param {string} text entry body text (footnotes already stripped)
 * @param {{ displayName?: string, entryNumber?: number }} hints
 */
function parseNasab(text, { displayName = '', entryNumber = null } = {}) {
  const phrase = openingPhrase(text, entryNumber);
  if (!phrase) return emptyResult(displayName, 'empty_opening_text');

  const { name, rest } = cutAtBoundary(phrase);
  if (!name) return emptyResult(displayName, 'boundary_at_start');

  const attempts = [{ phrase: name, source: 'heading' }];

  // When the heading carries no chain, Ibn Hajar often gives it as "اسمه X بن Y".
  const ismuhu = phrase.match(/اسمه\s+([^.،؛:]{3,180})/u);
  if (ismuhu) attempts.push({ phrase: cutAtBoundary(ismuhu[1].trim()).name, source: 'ismuhu' });

  let lastError = 'no_candidate';
  const results = [];
  for (const attempt of attempts) {
    if (!attempt.phrase) continue;
    const outcome = buildFromPhrase(attempt.phrase, attempt.source);
    if (outcome.result) results.push(outcome.result);
    else lastError = outcome.error;
  }

  if (!results.length) return emptyResult(displayName, lastError);

  // Prefer the longest valid chain; heading wins ties.
  results.sort((a, b) => b.link_count - a.link_count);
  const best = results[0];

  // A kunya only counts when it appears in the same clause as the name. Scanning
  // further picks up cited authorities such as أبو نعيم from the isnad.
  const sameClause = rest.split(HARD_STOP_RE)[0] || '';
  const kunyaMatch = KUNYA_RE.exec(sameClause);
  if (kunyaMatch) {
    const head = kunyaMatch[1] === 'أبي' ? 'أبو' : kunyaMatch[1];
    best.kunya = `${head} ${kunyaMatch[2]}`.replace(/\s+/g, ' ').trim();
  }
  if (/^(?:أبو|أم)\s/.test(best.ism || '')) best.kunya = best.ism;
  if (/^(?:أم)\s/.test(best.ism || '')) best.is_woman_hint = true;

  best.full_name_norm = normalizeArabic(best.full_name);
  return best;
}

module.exports = {
  parseNasab,
  openingPhrase,
  cutAtBoundary,
  tokenize,
  splitNisba,
  validateSegment,
  BOUNDARY_TOKENS,
  SEGMENT_MAX_LEN,
  CHAIN_MAX_LINKS,
};
