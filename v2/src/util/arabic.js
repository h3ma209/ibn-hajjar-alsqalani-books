'use strict';

const iconv = require('iconv-lite');

/**
 * Shamela stores Arabic as windows-1256 bytes handed to us as binary strings,
 * and separates lines with a bare CR. Newlines are normalised here so no
 * downstream regex has to care.
 */
function decodeArabic(value) {
  if (value == null) return '';
  return iconv
    .decode(Buffer.from(String(value), 'binary'), 'windows-1256')
    .replace(/\r\n?/g, '\n');
}

const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

/** Fold orthographic variants so search and name matching are stable. */
function normalizeArabic(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(DIACRITICS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const INLINE_NOTE_RE = /«\s*\d+\s*»|\[\s*\(\s*\d+\s*\)\s*\]|\(\s*\d+\s*\)/g;
const FOOTNOTE_BLOCK_RE = /_{3,}[\s\S]*$/;

/** Strip editor footnote markers and stray quote glyphs from a name or phrase. */
function stripNoteMarkers(value) {
  return String(value ?? '')
    .replace(INLINE_NOTE_RE, ' ')
    .replace(/[«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split an entry into body prose and the editor's footnote apparatus.
 * Footnote blocks are delimited by long underscore runs in the Shamela text.
 */
function splitFootnotes(rawText) {
  const text = String(rawText ?? '').replace(/\r\n?/g, '\n');
  const parts = text.split(/\n?_{3,}\n?/);
  const body = parts[0] || '';
  const notes = [];
  for (const block of parts.slice(1)) {
    for (const match of block.matchAll(/\(\s*(\d+)\s*\)\s*([^\n]+)/g)) {
      const note = match[2].replace(/\s+/g, ' ').trim();
      if (note) notes.push({ marker: Number(match[1]), text: note });
    }
  }
  return { body: body.trim(), footnotes: notes };
}

/** Collapse an entry to a single line, footnote markers removed. */
function flatten(value) {
  return stripNoteMarkers(String(value ?? '').replace(/\s+/g, ' ')).trim();
}

const PUNCTUATION = /[.,،؛;:!؟?"'`«»‹›()[\]{}\-–—_*/\\|]+/g;

/**
 * Comparison key for checking whether a quoted span occurs in an entry.
 *
 * Punctuation is dropped because a model reproducing a clause verbatim still
 * routinely ends it with a period where the edition has an Arabic comma, or none
 * at all mid-sentence. Treating that as a failed quote would mark correct
 * extractions as unsupported, which is the opposite of what the check is for.
 * Letters and word order are preserved, so an invented clause still fails.
 */
function verificationKey(value) {
  return normalizeArabic(flatten(value).replace(PUNCTUATION, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convert Arabic-Indic digits to ASCII so numeric parsing works uniformly. */
function normalizeDigits(value) {
  return String(value ?? '').replace(/[\u0660-\u0669]/g, (d) =>
    String(d.charCodeAt(0) - 0x0660)
  );
}

const ARABIC_NUMERALS = {
  واحد: 1,
  إحدى: 1,
  احدى: 1,
  اثنتين: 2,
  اثنين: 2,
  ثلاث: 3,
  ثلاثة: 3,
  أربع: 4,
  اربع: 4,
  أربعة: 4,
  خمس: 5,
  خمسة: 5,
  ست: 6,
  ستة: 6,
  سبع: 7,
  سبعة: 7,
  ثمان: 8,
  ثماني: 8,
  ثمانية: 8,
  تسع: 9,
  تسعة: 9,
  عشر: 10,
  عشرة: 10,
  عشرين: 20,
  ثلاثين: 30,
  أربعين: 40,
  اربعين: 40,
  خمسين: 50,
  ستين: 60,
  سبعين: 70,
  ثمانين: 80,
  تسعين: 90,
  مائة: 100,
  مئة: 100,
};

/**
 * Parse a spelled-out Hijri year such as "سبع وخمسين" into 57.
 * Returns null when the phrase is not a recognisable additive numeral.
 */
function parseArabicYear(phrase) {
  const digits = normalizeDigits(phrase).match(/\d{1,4}/);
  if (digits) {
    const value = Number(digits[0]);
    return value > 0 && value <= 1500 ? value : null;
  }
  const words = String(phrase ?? '')
    .replace(DIACRITICS, '')
    .split(/\s*و\s*|\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  let total = 0;
  let matched = 0;
  for (const word of words) {
    const value = ARABIC_NUMERALS[word];
    if (value == null) continue;
    total += value;
    matched += 1;
  }
  if (!matched || total <= 0 || total > 1500) return null;
  return total;
}

module.exports = {
  decodeArabic,
  normalizeArabic,
  normalizeDigits,
  stripNoteMarkers,
  splitFootnotes,
  flatten,
  verificationKey,
  parseArabicYear,
  INLINE_NOTE_RE,
  FOOTNOTE_BLOCK_RE,
};
