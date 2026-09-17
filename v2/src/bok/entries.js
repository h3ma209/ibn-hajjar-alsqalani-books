'use strict';

const { BOOK } = require('../config');
const { normalizeArabic, stripNoteMarkers, splitFootnotes } = require('../util/arabic');

/**
 * TOC titles for biographies look like "10680- أبو هريرة", but the edition also
 * tags some entries with a letter between the number and the dash, such as
 * "4850 ز- عبد الله بن علقمة" (ziyada, an entry added from another source).
 * Missing that variant silently drops those biographies from the corpus.
 */
const ENTRY_RE = /^(\d+)\s*(?:([^\d\s\-–—]{1,6})\s*)?[-–—]\s*(.+?)\s*$/;

/**
 * Biographies are not confined to one TOC depth: they appear at levels 4, 5, and
 * 6 depending on how the letter sections nest. Filtering by level drops hundreds
 * of real entries, so entries are identified by shape and only the handful of
 * numbered *structural* headings are excluded by name.
 */
const STRUCTURAL_NAME_RE =
  /^(?:ال)?(?:قسم|فصل|باب|حرف|مجلد)\b|^(?:القسم|الفصل|الباب|المجلد)|نسبه ومولده|ترتيب الإصابة|منهج|تعريف الصحابي|عدالة الصحابة|طبقات الصحابة|ميزات|مقدمة|وصف نسخ/u;

/** Printed numbering in this edition tops out near 12,300. */
const MAX_ENTRY_NUMBER = 13000;

/**
 * A TOC row's `id` is the *page* the heading points at, and Shamela packs several
 * biographies onto one page, so it is not an identifier. Identity therefore
 * combines the printed entry number with that page, and a disambiguating ordinal
 * is appended in the rare case both repeat.
 */
function personId(entryNumber, startId, ordinal = 0) {
  const base = `${BOOK.slug}:${BOOK.expected_book_id}:${entryNumber}-${startId}`;
  return ordinal > 0 ? `${base}.${ordinal}` : base;
}

const PERSON_ID_PATTERN = '^[a-z]+:\\d+:\\d+-\\d+(?:\\.\\d+)?$';

function cleanDisplayName(raw) {
  return stripNoteMarkers(raw)
    .replace(/[：:،,.؛\s]+$/u, '')
    .replace(/[-–—]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Locate an entry heading inside page text. Shamela emits sub-markers such as
 * "4850 ز-" and "8968 (م) -", so a few characters are allowed before the dash.
 */
function markerRegex(entryNumber) {
  return new RegExp(`(?:^|\\n)[^\\S\\n]*${entryNumber}[^\\n]{0,6}?[-–—]`, 'g');
}

function findMarkerOffset(text, entryNumber, fromIndex = 0) {
  const re = markerRegex(entryNumber);
  re.lastIndex = fromIndex;
  const match = re.exec(text);
  return match ? match.index : -1;
}

/**
 * Fallback anchor for the rare heading whose printed number is corrupted: locate
 * the entry by the opening words of its name instead.
 */
function findNameOffset(text, displayName, fromIndex = 0) {
  const words = String(displayName ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
  if (words.length < 4) return -1;
  return text.indexOf(words, fromIndex);
}

/**
 * Build the ordered person list. Entries sharing a page are ordered by where
 * their heading actually appears in that page's text rather than by TOC row
 * order, which is not guaranteed.
 */
function buildEntries({ pages, toc }) {
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const pageIndexById = new Map(pages.map((p, index) => [p.id, index]));

  const candidates = [];
  const rejected = [];
  for (const node of toc) {
    const match = node.title.match(ENTRY_RE);
    if (!match) continue;
    const number = Number(match[1]);
    const name = cleanDisplayName(match[3]);
    if (!name || !Number.isFinite(number)) continue;
    if (STRUCTURAL_NAME_RE.test(name)) {
      rejected.push({ reason: 'structural_heading', lvl: node.lvl, title: node.title });
      continue;
    }
    if (!pageIndexById.has(node.id)) {
      rejected.push({ reason: 'page_missing', lvl: node.lvl, title: node.title });
      continue;
    }
    candidates.push({
      number,
      name,
      marker: match[2] ?? null,
      // The print has occasional numbering typos, e.g. "111936- أم جميل بنت الخطاب".
      numberSuspect: number > MAX_ENTRY_NUMBER,
      startId: node.id,
      lvl: node.lvl,
      tocTitle: node.title,
    });
  }

  // Order entries within each page by heading position in the page text.
  const byPage = new Map();
  for (const candidate of candidates) {
    if (!byPage.has(candidate.startId)) byPage.set(candidate.startId, []);
    byPage.get(candidate.startId).push(candidate);
  }
  for (const [startId, group] of byPage) {
    const text = pageById.get(startId)?.text ?? '';
    let cursor = 0;
    for (const candidate of group) {
      let offset = findMarkerOffset(text, candidate.number, 0);
      if (offset < 0) offset = findNameOffset(text, candidate.name);
      candidate.pageOffset = offset >= 0 ? offset : Number.MAX_SAFE_INTEGER - cursor;
      cursor += 1;
    }
    group.sort((a, b) => a.pageOffset - b.pageOffset);
  }

  const ordered = [...byPage.keys()]
    .sort((a, b) => pageIndexById.get(a) - pageIndexById.get(b))
    .flatMap((startId) => byPage.get(startId));

  const usedIds = new Map();
  const entries = ordered.map((candidate) => {
    let ordinal = 0;
    let id = personId(candidate.number, candidate.startId);
    while (usedIds.has(id)) {
      ordinal += 1;
      id = personId(candidate.number, candidate.startId, ordinal);
    }
    usedIds.set(id, true);

    const startPage = pageById.get(candidate.startId);
    return {
      person_id: id,
      entry_number: candidate.number,
      entry_marker: candidate.marker,
      entry_number_suspect: candidate.numberSuspect,
      entry_number_is_ambiguous: false,
      start_id: candidate.startId,
      end_id: candidate.startId,
      page_offset: candidate.pageOffset,
      toc_lvl: candidate.lvl,
      toc_title: candidate.tocTitle,
      display_name: candidate.name,
      display_name_norm: normalizeArabic(candidate.name),
      volume: startPage?.part ?? null,
      page_start: startPage?.page ?? null,
      page_end: startPage?.page ?? null,
    };
  });

  // The text of an entry can spill onto the page where the next entry begins,
  // so the scan range includes that page and the exact cut is made by marker.
  const lastPageId = pages.length ? pages[pages.length - 1].id : 0;
  for (let i = 0; i < entries.length; i += 1) {
    const next = entries[i + 1];
    entries[i].next_entry_number = next ? next.entry_number : null;
    entries[i].next_display_name = next ? next.display_name : null;
    entries[i].end_id = next ? next.start_id : lastPageId;
  }

  const byNumber = new Map();
  for (const entry of entries) {
    const bucket = byNumber.get(entry.entry_number);
    if (bucket) bucket.push(entry);
    else byNumber.set(entry.entry_number, [entry]);
  }
  const ambiguousNumbers = [];
  for (const [number, bucket] of byNumber) {
    if (bucket.length < 2) continue;
    ambiguousNumbers.push(number);
    for (const entry of bucket) entry.entry_number_is_ambiguous = true;
  }

  const markerCounts = {};
  for (const entry of entries) {
    const key = entry.entry_marker || 'none';
    markerCounts[key] = (markerCounts[key] || 0) + 1;
  }

  return {
    entries,
    ambiguousNumbers: ambiguousNumbers.sort((a, b) => a - b),
    rejected,
    markerCounts,
    suspectNumbers: entries.filter((e) => e.entry_number_suspect).map((e) => e.entry_number),
  };
}

const PAGE_SEPARATOR = '\n\n';

/**
 * Slice out exactly one entry's text: from its own heading to the next entry's
 * heading, tracking which printed pages the slice actually spans.
 */
function entryText(pages, entry, { pageIndexById } = {}) {
  const indexById = pageIndexById || new Map(pages.map((p, index) => [p.id, index]));
  const startIndex = indexById.get(entry.start_id);
  if (startIndex == null) {
    return {
      text: '',
      body: '',
      footnotes: [],
      pageStart: entry.page_start,
      pageEnd: entry.page_end,
      volume: entry.volume,
    };
  }

  const spans = [];
  let combined = '';
  for (let i = startIndex; i < pages.length; i += 1) {
    const page = pages[i];
    if (page.id > entry.end_id) break;
    const offset = combined.length;
    combined += (combined ? PAGE_SEPARATOR : '') + page.text;
    spans.push({ page, start: offset, end: combined.length });
  }

  let startOffset = findMarkerOffset(combined, entry.entry_number, 0);
  if (startOffset < 0) startOffset = findNameOffset(combined, entry.display_name, 0);
  if (startOffset < 0) startOffset = 0;

  let endOffset = combined.length;
  if (entry.next_entry_number != null) {
    let nextOffset = findMarkerOffset(combined, entry.next_entry_number, startOffset + 1);
    if (nextOffset < 0 && entry.next_display_name) {
      nextOffset = findNameOffset(combined, entry.next_display_name, startOffset + 1);
    }
    if (nextOffset > startOffset) endOffset = nextOffset;
  }

  const text = combined.slice(startOffset, endOffset).trim();

  // Each printed page carries its own footnote apparatus, so footnotes must be
  // separated page by page. Splitting the concatenated text once would discard
  // every page of prose after the first footnote block.
  const bodyParts = [];
  const footnotes = [];
  for (const span of spans) {
    const from = Math.max(startOffset, span.start);
    const to = Math.min(endOffset, span.end);
    if (to <= from) continue;
    const pageSlice = combined.slice(from, to);
    const split = splitFootnotes(pageSlice);
    if (split.body) bodyParts.push(split.body);
    for (const note of split.footnotes) {
      footnotes.push({ ...note, page: span.page.page ?? null });
    }
  }

  const pageAt = (offset) => {
    for (const span of spans) {
      if (offset >= span.start && offset <= span.end) return span.page;
    }
    return spans[spans.length - 1]?.page ?? null;
  };

  const firstPage = pageAt(startOffset);
  const lastPage = pageAt(Math.max(startOffset, endOffset - 1));

  return {
    text,
    body: bodyParts.join('\n\n').trim(),
    footnotes,
    pageStart: firstPage?.page ?? entry.page_start,
    pageEnd: lastPage?.page ?? entry.page_end,
    volume: firstPage?.part ?? entry.volume,
  };
}

/** Assemble the canonical raw-text record that every later stage reads from. */
function buildRawTextRecord(pages, entry, context = {}) {
  const sliced = entryText(pages, entry, context);
  const body = sliced.body;
  const footnotes = sliced.footnotes;
  return {
    person_id: entry.person_id,
    entry_number: entry.entry_number,
    start_id: entry.start_id,
    end_id: entry.end_id,
    volume: sliced.volume ?? entry.volume,
    page_start: sliced.pageStart,
    page_end: sliced.pageEnd,
    display_name: entry.display_name,
    text: sliced.text,
    text_body: body,
    footnotes,
    char_len: sliced.text.length,
    body_char_len: body.length,
  };
}

module.exports = {
  ENTRY_RE,
  STRUCTURAL_NAME_RE,
  MAX_ENTRY_NUMBER,
  PERSON_ID_PATTERN,
  personId,
  buildEntries,
  entryText,
  buildRawTextRecord,
  findMarkerOffset,
  findNameOffset,
};
