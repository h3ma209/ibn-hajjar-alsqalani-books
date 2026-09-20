'use strict';

/**
 * Structural placement of an entry inside al-Isabah: which volume, letter block,
 * kunya/women/names section, and which of Ibn Hajar's four qism it falls under.
 *
 * The qism is the scholarly claim (how firmly companionship is established) and
 * is kept strictly separate from `toc_heading`, which is only whatever the
 * nearest table-of-contents node happens to say.
 */

const QISM_WORD = {
  الأول: 1,
  الاول: 1,
  الثاني: 2,
  الثالث: 3,
  الرابع: 4,
};

const QISM_LABEL = {
  1: 'الأول — من ثبتت صحبته برواية أو غيرها',
  2: 'الثاني — من له رؤية أو وُلد في العهد النبوي',
  3: 'الثالث — المخضرمون: أدركوا الجاهلية والإسلام ولم يَروا النبي',
  4: 'الرابع — من ذُكر في الصحابة غلطاً أو تصحيفاً',
};

const SECTION_TYPES = ['names', 'kunya', 'women', 'intro', 'other'];

/** Recognise a qism heading anywhere in a TOC title. */
function parseQism(title) {
  const text = String(title ?? '');
  if (!/قسم/.test(text)) return null;
  const match = text.match(/(?:ال)?قسم\s+(الأول|الاول|الثاني|الثالث|الرابع)/);
  if (match) return QISM_WORD[match[1]] ?? null;
  const numeric = text.match(/(?:^|\s)([1-4])\s*[-–—.,]?\s*(?:ال)?قسم/);
  if (numeric) return Number(numeric[1]);
  return null;
}

/**
 * Which macro-block the entry sits in. Order matters: the women's section is
 * nested inside kunya headings in places, so women wins when both appear.
 */
function detectSectionType(titles) {
  const blob = titles.join(' | ');
  if (/النساء/.test(blob)) return 'women';
  if (/الكنى/.test(blob)) return 'kunya';
  if (/حرف\s|باب\s+(?:الهمزة|الألف)/.test(blob)) return 'names';
  if (/مقدمة|من هو الصحابي|تعريف الصحابي|منهج|عدالة|طبقات الصحابة/.test(blob)) return 'intro';
  return 'other';
}

function detectLetter(title) {
  const match = String(title ?? '').match(/^(?:تتمة\s+)?(حرف\s+[^\s،,]+(?:\s+المهملة|\s+المعجمة)?)/);
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

function detectVolume(title) {
  const match = String(title ?? '').match(/المجلد\s+(\S+)/);
  return match ? `المجلد ${match[1]}` : null;
}

function detectBab(title) {
  const text = String(title ?? '');
  if (/المجلد|قسم|الكنى|النساء/.test(text)) return null;
  if (/بعدها/.test(text) || /^باب\s/.test(text)) return text.replace(/\s+/g, ' ').trim();
  return null;
}

/**
 * Walk the TOC in document order, carrying forward the active structural
 * context, and snapshot it at every node. A person entry inherits the snapshot
 * of the nearest preceding node.
 */
function buildPlacementIndex(toc) {
  const sorted = [...toc].sort((a, b) => a.id - b.id || a.lvl - b.lvl);

  let volume = null;
  let letter = null;
  let qism = null;
  let qismHeading = null;
  let bab = null;
  let sectionType = 'other';
  const stack = [];

  const nodes = [];
  const byId = new Map();

  for (const node of sorted) {
    while (stack.length && stack[stack.length - 1].lvl >= node.lvl) stack.pop();
    stack.push({ lvl: node.lvl, title: node.title });
    const titles = stack.map((s) => s.title);

    const detectedSection = detectSectionType(titles);
    if (detectedSection !== 'other') sectionType = detectedSection;

    const detectedVolume = detectVolume(node.title);
    if (detectedVolume) volume = detectedVolume;

    const detectedLetter = detectLetter(node.title);
    if (detectedLetter) {
      letter = detectedLetter;
      bab = null;
    }

    const detectedQism = parseQism(node.title);
    if (detectedQism) {
      qism = detectedQism;
      qismHeading = node.title;
    }

    const detectedBab = detectBab(node.title);
    if (detectedBab) bab = detectedBab;

    const placement = {
      volume_toc: volume,
      letter,
      bab,
      section_type: sectionType,
      qism,
      qism_label: qism ? QISM_LABEL[qism] : null,
      qism_heading: qismHeading,
      toc_heading: node.title,
      toc_path: titles.slice(-6),
    };

    byId.set(node.id, placement);
    nodes.push({ id: node.id, lvl: node.lvl, title: node.title, placement });
  }

  return { byId, nodes };
}

const EMPTY_PLACEMENT = {
  volume_toc: null,
  letter: null,
  bab: null,
  section_type: 'other',
  qism: null,
  qism_label: null,
  qism_heading: null,
  toc_heading: null,
  toc_path: [],
};

/** Resolve placement for an entry by its own TOC id, falling back to the nearest earlier node. */
function placementFor(index, startId) {
  const exact = index.byId.get(startId);
  if (exact) return exact;
  let best = EMPTY_PLACEMENT;
  for (const node of index.nodes) {
    if (node.id > startId) break;
    best = node.placement;
  }
  return best;
}

module.exports = {
  QISM_LABEL,
  SECTION_TYPES,
  EMPTY_PLACEMENT,
  parseQism,
  detectSectionType,
  detectLetter,
  buildPlacementIndex,
  placementFor,
};
