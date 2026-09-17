'use strict';

const { ENTRY_RE } = require('../bok/entries');

/**
 * Non-biographical TOC nodes: Ibn Hajar's introduction, the editors' apparatus,
 * and the structural headings. These carry the book's own methodology, which is
 * needed context when interpreting any single entry.
 */

const CHAPTER_TEXT_LIMIT = 40000;

function classifyChapter(title) {
  const text = String(title ?? '');
  if (/من هو الصحابي|تعريف الصحابي|الصحابي لغة/.test(text)) return 'definition';
  if (/عدالة|فضل الصحابة|عقيدة/.test(text)) return 'virtue_adala';
  if (/منهج|ترتيب الإصابة|ميزات القسم|وصف نسخ/.test(text)) return 'method';
  if (/طبقات|عدد الصحابة|المكثرين/.test(text)) return 'taxonomy';
  if (/مقدمة/.test(text)) return 'preface';
  if (/قسم/.test(text)) return 'qism_heading';
  if (/^(?:تتمة\s+)?حرف\s|^باب\s/.test(text)) return 'letter_heading';
  if (/الكنى|النساء/.test(text)) return 'block_heading';
  if (/المجلد/.test(text)) return 'volume_heading';
  return 'other';
}

const TEXT_BEARING_KINDS = new Set([
  'preface',
  'definition',
  'method',
  'virtue_adala',
  'taxonomy',
]);

/**
 * Extract chapter records. Only prose chapters carry text; structural headings
 * are kept as navigation markers so the shape of the book stays inspectable.
 */
function extractChapters({ toc, pages, entryStartIds }) {
  const entrySet = new Set(entryStartIds);
  const sorted = [...toc].sort((a, b) => a.id - b.id);
  const chapters = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const node = sorted[i];
    if (entrySet.has(node.id)) continue;
    if (ENTRY_RE.test(node.title)) continue;

    const kind = classifyChapter(node.title);
    const keep = node.lvl <= 2 || kind !== 'other';
    if (!keep) continue;

    let endId = pages.length ? pages[pages.length - 1].id : node.id;
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].lvl <= node.lvl) {
        endId = sorted[j].id - 1;
        break;
      }
    }
    if (endId < node.id) endId = node.id;

    let text = '';
    let truncated = false;
    if (TEXT_BEARING_KINDS.has(kind)) {
      const chunks = [];
      let size = 0;
      for (const page of pages) {
        if (page.id < node.id) continue;
        if (page.id > endId) break;
        chunks.push(page.text);
        size += page.text.length;
        if (size > CHAPTER_TEXT_LIMIT) {
          truncated = true;
          break;
        }
      }
      text = chunks.join('\n\n').trim();
    }

    chapters.push({
      chapter_id: `${node.id}`,
      title: node.title,
      lvl: node.lvl,
      kind,
      start_id: node.id,
      end_id: endId,
      text,
      text_truncated: truncated,
      char_len: text.length,
    });
  }

  return chapters;
}

/**
 * Page coverage audit: how much of the book is claimed by an entry or a chapter.
 * Uncovered pages are usually front matter, indices, or gaps worth inspecting.
 */
function auditCoverage({ pages, entries, chapters }) {
  const covered = new Set();
  for (const entry of entries) {
    for (let id = entry.start_id; id <= entry.end_id; id += 1) covered.add(id);
  }
  for (const chapter of chapters) {
    if (!TEXT_BEARING_KINDS.has(chapter.kind)) continue;
    for (let id = chapter.start_id; id <= chapter.end_id; id += 1) covered.add(id);
  }

  const uncovered = pages.map((p) => p.id).filter((id) => !covered.has(id));
  return {
    total_pages: pages.length,
    covered_pages: pages.length - uncovered.length,
    coverage_ratio: pages.length
      ? Number((1 - uncovered.length / pages.length).toFixed(4))
      : 0,
    uncovered_count: uncovered.length,
    uncovered_sample: uncovered.slice(0, 40),
  };
}

module.exports = { classifyChapter, extractChapters, auditCoverage, TEXT_BEARING_KINDS };
