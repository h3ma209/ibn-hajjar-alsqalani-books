'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeArabic,
  parseArabicYear,
  splitFootnotes,
  stripNoteMarkers,
  normalizeDigits,
} = require('../src/util/arabic');

test('normalizeArabic folds orthographic variants', () => {
  assert.equal(normalizeArabic('إبراهيم'), normalizeArabic('ابراهيم'));
  assert.equal(normalizeArabic('عائشة'), normalizeArabic('عائشه'));
  assert.equal(normalizeArabic('الدّوسيّ'), normalizeArabic('الدوسي'));
  assert.equal(normalizeArabic('  أنس   بن  مالك '), 'انس بن مالك');
});

test('parseArabicYear reads spelled-out Hijri years', () => {
  assert.equal(parseArabicYear('سبع وخمسين'), 57);
  assert.equal(parseArabicYear('ثلاث وسبعين'), 73);
  assert.equal(parseArabicYear('إحدى وأربعين'), 41);
  assert.equal(parseArabicYear('57'), 57);
  assert.equal(parseArabicYear('٥٧'), 57);
});

test('parseArabicYear rejects non-numeric phrases and impossible years', () => {
  assert.equal(parseArabicYear('في خلافة عمر'), null);
  assert.equal(parseArabicYear(''), null);
  assert.equal(parseArabicYear('9999'), null);
});

test('stripNoteMarkers removes editor apparatus but keeps the name', () => {
  assert.equal(stripNoteMarkers('أسيد [ (2) ] من [ (3) ] ذرية'), 'أسيد من ذرية');
  assert.equal(stripNoteMarkers('أبو هريرة «4»'), 'أبو هريرة');
  assert.equal(stripNoteMarkers('بن الخطاب»'), 'بن الخطاب');
});

test('splitFootnotes separates prose from the footnote block', () => {
  const page = 'نص الترجمة هنا.\n__________\n(1) أسد الغابة ت (3079) .\n(2) الاستيعاب ت (1630) .';
  const { body, footnotes } = splitFootnotes(page);
  assert.equal(body, 'نص الترجمة هنا.');
  assert.equal(footnotes.length, 2);
  assert.equal(footnotes[0].marker, 1);
  assert.match(footnotes[0].text, /أسد الغابة/);
});

test('splitFootnotes handles pages with no footnotes', () => {
  const { body, footnotes } = splitFootnotes('ترجمة قصيرة بلا حواشي.');
  assert.equal(body, 'ترجمة قصيرة بلا حواشي.');
  assert.deepEqual(footnotes, []);
});

test('normalizeDigits converts Arabic-Indic numerals', () => {
  assert.equal(normalizeDigits('سنة ٥٧ هجرية'), 'سنة 57 هجرية');
});
