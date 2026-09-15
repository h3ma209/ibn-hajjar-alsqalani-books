/**
 * Ibn Hajar al-Isabah book structure layer:
 * - TOC placement (letter, qism, kunya/women/names)
 * - Non-entry chapters (front matter)
 * - Cross-reference edges
 * - Page coverage audit
 */

const ENTRY_RE = /^(\d+)\s*[-–—]\s*(.+?)\s*$/;

const QISM_RE =
  /القسم\s+(الأول|الثاني|الثالث|الرابع)|(^[١1]\s*[-–—.]?\s*القسم\s*الأول)|(^[٢2]\s*[-–—.]?\s*القسم\s*الثاني)|(^[٣3]\s*[-–—.,]?\s*القسم\s*الثالث)|(^[٤4]\s*[-–—.]?\s*القسم\s*الرابع)/;

const QISM_NUM = {
  الأول: 1,
  الثاني: 2,
  الثالث: 3,
  الرابع: 4,
};

const QISM_LABEL = {
  1: 'الأول — ثابتة الصحبة / جاءت روايته بما يدل على صحبته',
  2: 'الثاني — من له رؤية / وُلد في العهد',
  3: 'الثالث — أدرك ولم يَرَ / مخضرمون ونحوهم',
  4: 'الرابع — ذُكر غلطاً أو تصحيفاً',
};

function parseQism(title) {
  const t = String(title || '');
  if (/القسم\s+الأول|1\s*[-–—.]\s*القسم\s*الأول/.test(t) || /^القسم الأول/.test(t))
    return 1;
  if (/القسم\s+الثاني|2\s*[-–—.]\s*القسم\s*الثاني/.test(t)) return 2;
  if (/القسم\s+الثالث|3\s*[-–—.,]?\s*القسم\s*الثالث|لقسم الثالث/.test(t)) return 3;
  if (/القسم\s+الرابع|4\s*[-–—.]\s*القسم\s*الرابع/.test(t)) return 4;
  const m = t.match(/القسم\s+(الأول|الثاني|الثالث|الرابع)/);
  if (m) return QISM_NUM[m[1]] || null;
  return null;
}

function detectSectionType(titles) {
  const blob = titles.join(' | ');
  if (/باب الكنى|الكنى/.test(blob) && !/النساء/.test(blob)) return 'kunya';
  if (/النساء|من النساء/.test(blob)) return 'women';
  if (/حرف |باب الهمزة|باب الألف/.test(blob)) return 'names';
  if (/مقدمة|من هو الصحابي|منهج|تعريف الصحابي|عدالة|طبقات الصحابة/.test(blob))
    return 'intro';
  return 'other';
}

function detectLetter(titles) {
  for (const t of [...titles].reverse()) {
    const m = t.match(
      /حرف\s+([^\s،,]{1,40})|باب\s+(الهمزة|الألف|الياء|الواو)[^\n]{0,40}/
    );
    if (m) return (m[0] || '').replace(/\s+/g, ' ').trim();
  }
  return null;
}

function detectVolume(titles) {
  for (const t of [...titles].reverse()) {
    const m = t.match(/المجلد\s+([^\s]+)/);
    if (m) return `المجلد ${m[1]}`;
  }
  return null;
}

/**
 * For each page-id, compute active structural context by scanning TOC in order.
 * Returns Map<pageId, placement>
 */
function buildPlacementIndex(toc) {
  const sorted = [...toc].sort((a, b) => a.id - b.id || a.lvl - b.lvl);
  let volume = null;
  let sectionType = 'other';
  let letter = null;
  let qism = null;
  let qismTitle = null;
  let bab = null;
  const stack = []; // recent titles by level

  /** @type {Map<number, object>} */
  const byId = new Map();
  /** snapshots at each toc node for chapter detection */
  const nodes = [];

  for (const t of sorted) {
    // maintain simple level stack of titles
    while (stack.length && stack[stack.length - 1].lvl >= t.lvl) stack.pop();
    stack.push({ lvl: t.lvl, tit: t.tit, id: t.id });

    const titles = stack.map((s) => s.tit);
    const st = detectSectionType(titles);
    if (st !== 'other') sectionType = st;

    const vol = detectVolume(titles);
    if (vol) volume = vol;

    const lettr = detectLetter([t.tit]);
    if (lettr && /حرف |باب (الهمزة|الألف)/.test(lettr)) {
      letter = lettr;
      bab = null; // reset sub-bab when letter changes
    }

    const q = parseQism(t.tit);
    if (q) {
      qism = q;
      qismTitle = t.tit.replace(/\s+/g, ' ').trim();
    }

    if (
      t.lvl >= 3 &&
      (/بعدها/.test(t.tit) || /^باب (الهمزة|الألف|الباء|التاء)/.test(t.tit)) &&
      !/القسم|المجلد|الكنى|النساء/.test(t.tit)
    ) {
      bab = t.tit.replace(/\s+/g, ' ').trim();
    }

    const placement = {
      volume,
      section_type: sectionType,
      letter,
      qism,
      qism_label: qism ? QISM_LABEL[qism] : null,
      qism_title: qismTitle,
      bab,
      toc_path: titles.slice(-6),
    };
    byId.set(t.id, placement);
    nodes.push({ ...t, placement: { ...placement } });
  }

  return { byId, nodes, sorted };
}

/** Resolve placement for a person start_id (use nearest toc id <= start) */
function placementForId(index, startId) {
  if (index.byId.has(startId)) return index.byId.get(startId);
  // walk back
  let best = null;
  for (const n of index.nodes) {
    if (n.id > startId) break;
    best = n.placement;
  }
  return best;
}

/**
 * Chapters = TOC nodes that are NOT numbered person entries, spanning until next same-or-higher level.
 */
function extractChapters(toc, pages, personStartIds) {
  const personSet = new Set(personStartIds);
  const sorted = [...toc].sort((a, b) => a.id - b.id);
  const chapters = [];

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (ENTRY_RE.test(t.tit)) continue;
    if (personSet.has(t.id)) continue;
    const kind = classifyChapter(t.tit);
    const keep =
      t.lvl <= 2 ||
      ['preface', 'definition', 'method', 'virtue_adala', 'taxonomy', 'block_heading'].includes(
        kind
      ) ||
      /مقدمة|صحابي|منهج|عدالة|طبقات|تعريف|ميزات/.test(t.tit);
    if (!keep) continue;

    let endId = pages[pages.length - 1]?.id ?? t.id;
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].lvl <= t.lvl) {
        endId = sorted[j].id - 1;
        break;
      }
    }
    if (endId < t.id) endId = t.id;

    const wantText = [
      'preface',
      'definition',
      'method',
      'virtue_adala',
      'taxonomy',
    ].includes(kind);
    let text = '';
    if (wantText) {
      const chunks = [];
      let size = 0;
      for (const p of pages) {
        if (p.id < t.id) continue;
        if (p.id > endId) break;
        chunks.push(p.nass);
        size += p.nass.length;
        if (size > 20000) break;
      }
      text = chunks.join('\n\n').trim();
    }

    chapters.push({
      id: t.id,
      title: t.tit,
      lvl: t.lvl,
      end_id: endId,
      kind,
      text,
      text_truncated: text.length >= 20000,
    });
  }

  return chapters;
}

function classifyChapter(title) {
  const t = title;
  if (/من هو الصحابي|تعريف الصحابي|الصحابي لغة/.test(t)) return 'definition';
  if (/عدالة|فضل الصحابة|عقيدة/.test(t)) return 'virtue_adala';
  if (/منهج|ترتيب الإصابة|القسم الأول:|ميزات القسم/.test(t)) return 'method';
  if (/طبقات|عدد الصحابة|المكثرين/.test(t)) return 'taxonomy';
  if (/مقدمة/.test(t)) return 'preface';
  if (/القسم/.test(t)) return 'qism_heading';
  if (/حرف |باب /.test(t)) return 'letter_heading';
  if (/الكنى|النساء/.test(t)) return 'block_heading';
  if (/المجلد/.test(t)) return 'volume_heading';
  return 'other';
}

/**
 * Parse cross-references from entry text.
 */
function parseCrossRefs(text, selfNumber) {
  const flat = String(text || '')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ');
  const edges = [];

  const patterns = [
    {
      type: 'will_come',
      re: /يأتي في القسم\s+(الأول|الثاني|الثالث|الرابع)([^.]{0,80})/g,
    },
    {
      type: 'already_in',
      re: /تقدم في القسم\s+(الأول|الثاني|الثالث|الرابع)([^.]{0,80})/g,
    },
    {
      type: 'will_repeat',
      re: /سيعاد في القسم\s+(الأول|الثاني|الثالث|الرابع)([^.]{0,60})/g,
    },
    {
      type: 'see_kunya',
      re: /(?:يأتي|سيأتي|تقدم)\s+في الكنى([^.]{0,60})/g,
    },
    {
      type: 'see_women',
      re: /(?:يأتي|سيأتي|تقدم)\s+في النساء([^.]{0,60})|في حرف\s+[^\s]+\s+من النساء([^.]{0,40})/g,
    },
    {
      type: 'see_letter',
      re: /(?:يأتي|سيأتي|تقدم)\s+في حرف\s+([^\s،.]{1,30})([^.]{0,40})/g,
    },
    {
      type: 'forward_entry',
      re: /يأتي(?:\s+في ترجمة)?\s+(?:رقم\s*)?(\d{1,5})(?!\d)/g,
    },
    {
      type: 'back_entry',
      re: /تقدم(?:\s+في ترجمة)?\s+(?:رقم\s*)?(\d{1,5})(?!\d)/g,
    },
    {
      type: 'authority',
      re: /(?:ذكره|قاله|أخرج|روى)\s+(ابن\s+مندة|أبو\s+نعيم|ابن\s+عبد\s+البر|ابن\s+الأثير|البخاري|مسلم|الترمذي|الحاكم|البغوي|ابن\s+سعد|الواقدي|ابن\s+إسحاق|خليفة)([^.]{0,50})/g,
    },
  ];

  for (const { type, re } of patterns) {
    for (const m of flat.matchAll(re)) {
      const qismWord = m[1];
      const qism =
        QISM_NUM[qismWord] ||
        (qismWord && /^\d+$/.test(qismWord) ? Number(qismWord) : null);
      const targetNumber =
        type === 'forward_entry' || type === 'back_entry'
          ? Number(m[1])
          : null;
      edges.push({
        type,
        from_number: selfNumber ?? null,
        target_qism: Number.isFinite(qism) ? qism : null,
        target_number: Number.isFinite(targetNumber) ? targetNumber : null,
        snippet: m[0].slice(0, 120),
      });
    }
  }

  // Dedup by type+snippet
  const seen = new Set();
  return edges.filter((e) => {
    const k = `${e.type}|${e.target_qism}|${e.target_number}|${e.snippet}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function auditPageCoverage(pages, persons, chapters) {
  const covered = new Set();
  for (const p of persons) {
    for (let id = p.start_id; id <= p.end_id; id++) covered.add(id);
  }
  // chapters lightly — don't mark huge spans as fully "owned" if truncated
  for (const c of chapters) {
    if (c.kind === 'preface' || c.kind === 'definition' || c.kind === 'method') {
      for (let id = c.id; id <= Math.min(c.end_id, c.id + 50); id++) covered.add(id);
    }
  }
  const pageIds = pages.map((p) => p.id);
  const missing = pageIds.filter((id) => !covered.has(id));
  return {
    total_pages: pageIds.length,
    covered_pages: pageIds.length - missing.length,
    coverage_ratio: pageIds.length
      ? +(1 - missing.length / pageIds.length).toFixed(4)
      : 0,
    uncovered_sample: missing.slice(0, 30),
    uncovered_count: missing.length,
  };
}

function buildBookLayers(toc, pages, persons) {
  const placementIndex = buildPlacementIndex(toc);
  const personStartIds = persons.map((p) => p.start_id);

  for (const p of persons) {
    p.placement = placementForId(placementIndex, p.start_id) || {
      volume: null,
      section_type: 'other',
      letter: null,
      qism: null,
      qism_label: null,
      qism_title: null,
      bab: null,
      toc_path: [],
    };
  }

  const chapters = extractChapters(toc, pages, personStartIds).filter((c) =>
    ['preface', 'definition', 'method', 'virtue_adala', 'taxonomy', 'block_heading'].includes(
      c.kind
    ) || (c.lvl <= 2 && c.text.length > 100)
  );

  const coverage = auditPageCoverage(pages, persons, chapters);

  return {
    placementIndex,
    chapters,
    coverage,
    qism_labels: QISM_LABEL,
  };
}

module.exports = {
  buildPlacementIndex,
  placementForId,
  extractChapters,
  parseCrossRefs,
  auditPageCoverage,
  buildBookLayers,
  parseQism,
  QISM_LABEL,
};
