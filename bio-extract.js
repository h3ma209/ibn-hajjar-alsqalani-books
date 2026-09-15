/**
 * Heuristic biography field extraction from الإصابة entry text.
 * Best-effort Arabic regexes — works well on long entries (e.g. أبو هريرة).
 */

function cleanSnippet(s, max = 240) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/«\s*\d+\s*»|\(\s*\d+\s*\)|\[\s*\(\d+\)\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x).replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function splitNameList(chunk, limit = 25) {
  if (!chunk) return [];
  return uniq(
    String(chunk)
      .replace(/،/g, ',')
      .split(/[,،]|\s+و(?=[\u0600-\u06FF])/)
      .map((s) =>
        cleanSnippet(s, 80)
          .replace(/^(?:ومن\s+)?الصحابة\s+/u, '')
          .replace(/^ولده\s+/u, '')
          .trim()
      )
      .filter(
        (s) =>
          s.length >= 2 &&
          s.length <= 60 &&
          !/^(?:بمهملات|من|عن|في|ثم|قال|آخرون|كثيرون)$/.test(s)
      )
  ).slice(0, limit);
}

function stripFootnoteBlocks(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\n?_{3,}[\s\S]*?(?=\n\n[^\n(]|\n(?=[^\n_(])|$)/g, '\n')
    .replace(/_{3,}[\s\S]*$/g, '')
    .trim();
}

function extractFootnoteRefs(text) {
  const block = String(text).match(/_{3,}([\s\S]{0,2500})/);
  if (!block) return [];
  const refs = [];
  const re = /\(\d+\)\s*([^\n(]+)/g;
  let m;
  while ((m = re.exec(block[1]))) {
    const ref = cleanSnippet(m[1], 160);
    if (ref) refs.push(ref);
  }
  return uniq(refs).slice(0, 30);
}

function collectMatches(text, re, mapFn, limit = 12) {
  const out = [];
  for (const m of String(text).matchAll(re)) {
    out.push(mapFn(m));
    if (out.length >= limit) break;
  }
  return uniq(out.filter(Boolean));
}

/**
 * @param {string} text raw entry text
 * @param {{ name?: string, full_name?: string, ism?: string, nisba?: string }} nameInfo
 */
function parseBiography(text, nameInfo = {}) {
  const raw = String(text || '');
  const clean = stripFootnoteBlocks(raw);
  const flat = clean.replace(/\n+/g, ' ').replace(/\s+/g, ' ');

  const bio = {
    summary: null,
    alternate_names: [],
    jahili_name: null,
    islamic_name: null,
    kunya: nameInfo.ism && /^أبو |^أم /.test(nameInfo.ism) ? nameInfo.ism : null,
    kunya_reason: null,
    tribe_nisba: nameInfo.nisba || null,
    conversion_or_arrival: [],
    companionship: [],
    virtues_and_status: [],
    hadith: {
      noted_as_prolific: false,
      estimated_count_text: null,
      students_count_text: null,
      narrated_from: [],
      narrated_to_notable: [],
    },
    offices: [],
    battles_and_travel: [],
    death: {
      notes: [],
      year_hints: [],
    },
    physical_description: [],
    family: [],
    highlights: [],
    source_refs: extractFootnoteRefs(raw),
  };

  // --- alternate / jahili / islamic names ---
  bio.jahili_name =
    cleanSnippet(
      (flat.match(
        /(?:كان اسم(?:ي|ه)?(?:\s+في الجاهلية)?|اسمه في الجاهلية)\s+([^،.]{3,60})/
      ) || [])[1]
    ) || null;

  const renamed = collectMatches(
    flat,
    /فسم(?:اني|ّاه|اه)\s+(?:رسول\s+اللَّه\s+صلى\s+اللَّه\s+عليه\s+وسلّم\s+)?([^،.]{3,40})/g,
    (m) => cleanSnippet(m[1], 40)
  );
  if (renamed[0] && !/صلى اللَّه/.test(renamed[0])) bio.islamic_name = renamed[0];
  // Explicit: سمّي بعبد اللَّه…
  const namedAbd = flat.match(/سمّ?ي\s+(?:ب)?(عبد\s+[^،.]{2,40})/);
  if (namedAbd) {
    bio.islamic_name = bio.islamic_name || cleanSnippet(namedAbd[1], 40);
  }

  bio.alternate_names = uniq([
    ...collectMatches(
      flat,
      /ويقال\s*[:：]?\s*([^،.]{3,50})/g,
      (m) => cleanSnippet(m[1], 50),
      15
    ),
    ...collectMatches(
      flat,
      /كان اسم أبي هريرة\s+([^،.]{3,50})/g,
      (m) => cleanSnippet(m[1], 50),
      10
    ),
    ...collectMatches(
      flat,
      /فقيل\s*[:：]?\s*([^،.]{3,50})/g,
      (m) => cleanSnippet(m[1], 50),
      8
    ),
  ]).filter((n) => n && n.length < 45);

  const kunyaWhy = flat.match(
    /كنيت\s+(?:بأبي|أبا)\s+([^\s،.]{2,30})[^.،]{0,20}(?:,|،)?\s*(?:قال\s*[:：])?\s*([^.]{10,160})/
  );
  if (kunyaWhy) {
    bio.kunya = bio.kunya || `أبو ${cleanSnippet(kunyaWhy[1], 30)}`;
    bio.kunya_reason = cleanSnippet(kunyaWhy[2], 180);
  } else {
    const k2 = flat.match(/لأني\s+([^.]{10,160}هر[^\s.]{0,20}[^.]{0,80})/);
    if (k2) bio.kunya_reason = cleanSnippet(k2[0], 180);
  }

  // --- arrival / Islam ---
  bio.conversion_or_arrival = uniq([
    ...collectMatches(
      flat,
      /((?:كان )?مقدمه[^.]{5,80})/g,
      (m) => cleanSnippet(m[1], 100),
      5
    ),
    ...collectMatches(
      flat,
      /((?:قدم(?:ت|نا)?\s+(?:المدينة|مهاجرا)|أسلم(?:ت)?\s+(?:قبل|بعد|يوم|عام)|فلما أسلم|إسلامه\s+بين)[^.]{0,100})/g,
      (m) => cleanSnippet(m[1], 100),
      8
    ),
    ...collectMatches(
      flat,
      /((?:سكن الصّفة|سكن الصفة)[^.]{0,60})/g,
      (m) => cleanSnippet(m[1], 80),
      3
    ),
  ]).filter((s) => !/\bأسلم بن\b/.test(s));

  // --- companionship ---
  bio.companionship = uniq([
    ...collectMatches(
      flat,
      /((?:صحب|أقمت معه|ألزمنا|ألزمه|كنت امرأ مسكينا أصحب)[^.]{5,140})/g,
      (m) => cleanSnippet(m[1], 140),
      10
    ),
  ]);

  // --- virtues ---
  bio.virtues_and_status = uniq([
    ...collectMatches(
      flat,
      /((?:أحفظ|أكثر الصحابة|أحرص|خير مني|أعلم بما يحدث|من علامات النبوة)[^.]{0,120})/g,
      (m) => cleanSnippet(m[1], 140),
      12
    ),
  ]);

  // --- hadith ---
  if (/أكثر الصحابة حديثا|أحفظ.*الحديث|يكثر الحديث/.test(flat)) {
    bio.hadith.noted_as_prolific = true;
  }
  const countHit = flat.match(
    /احتوى من حديث أبي هريرة على\s+([^.]{5,80})|من حديثه\s+([^.]{5,60}حديث)/
  );
  if (countHit) {
    bio.hadith.estimated_count_text = cleanSnippet(countHit[1] || countHit[2], 100);
  }
  const studCount = flat.match(/روى عنه نحو\s+([^.]{3,60})/);
  if (studCount) bio.hadith.students_count_text = cleanSnippet(studCount[0], 80);

  const fromHit = flat.match(
    /وحدث أبو هريرة أيضا عن\s+([^.]{10,300})|حدث عن\s+([^.]{10,200})/
  );
  if (fromHit) {
    bio.hadith.narrated_from = splitNameList(fromHit[1] || fromHit[2], 20);
  }

  const toHit = flat.match(
    /روى عنه\s+([^.]{10,500}?)(?:\.|قال البخاري|ومن كبار)/
  );
  if (toHit) {
    bio.hadith.narrated_to_notable = splitNameList(toHit[1], 30).filter(
      (n) =>
        !/^(?:بمهملات|من الصحابة|ومن الصحابة|آخرون|كثيرون)$/.test(n) &&
        !/^من\s/.test(n)
    );
  }

  // --- offices ---
  bio.offices = uniq([
    ...collectMatches(
      flat,
      /((?:استعمل|ولّاه|ولاه|أمّره|أمره)\s+[^.]{5,120})/g,
      (m) => cleanSnippet(m[1], 120),
      8
    ),
  ]);

  // --- battles / travel ---
  bio.battles_and_travel = uniq([
    ...collectMatches(
      flat,
      /((?:شهد|غزا|حجّ|حج |بعثني|خيبر|تبوك|اليرموك)[^.]{0,100})/g,
      (m) => cleanSnippet(m[1], 100),
      12
    ),
  ]).filter((s) => s.length > 4 && !/^خيبر قدم/.test(s) || /خيبر|غزا|شهد|حج|بعث/.test(s));

  // --- death ---
  bio.death.notes = uniq([
    ...collectMatches(
      flat,
      /((?:حضره الموت|لما حضرته الوفاة|شكواه الّذي مات|إذا مت|لا تضربوا عليّ)[^.]{5,160})/g,
      (m) => cleanSnippet(m[1], 160),
      8
    ),
  ]);
  bio.death.year_hints = uniq([
    ...collectMatches(
      flat,
      /((?:سنة\s+(?:ستين|سبع|ثمان|[\d٠-٩]{1,4})[^.]{0,40})|(?:لا تدركني سنة\s+[^\s،.]{2,20}))/g,
      (m) => cleanSnippet(m[1], 80),
      8
    ),
  ]);

  // --- physical ---
  bio.physical_description = uniq([
    ...collectMatches(
      flat,
      /((?:آدم|أبيض|بعيد ما بين المنكبين|ذو ضفيرتين|يخضب|لين|مخشوشن)[^.]{0,100})/g,
      (m) => cleanSnippet(m[1], 120),
      8
    ),
  ]);

  // --- family ---
  bio.family = uniq([
    ...collectMatches(
      flat,
      /((?:روى عنه ولده|أمه|أم أبي هريرة|زوّجنيها|وامرأته)[^.]{5,120})/g,
      (m) => cleanSnippet(m[1], 120),
      8
    ),
  ]);

  // --- summary: first substantive sentence after nasab/header ---
  const sumMatch =
    flat.match(
      /((?:هكذا سماه|كان وسيطا|اختلف في اسمه)[^.]{15,280}\.)/
    ) ||
    flat.match(
      /((?:صحابي مشهور|أدرك النبي|قدم المدينة|كان مقدمه)[^.]{15,220}\.)/
    );
  bio.summary = sumMatch
    ? cleanSnippet(sumMatch[1], 280)
    : cleanSnippet(
        flat.replace(/^\d+\s*[-–—]\s*[^.]{0,180}\.\s*/, '').slice(0, 280),
        280
      );

  // --- highlights (compact facts) ---
  const highlights = [];
  if (bio.kunya && bio.kunya_reason) {
    highlights.push(`الكنية: ${bio.kunya} — ${bio.kunya_reason}`);
  }
  if (bio.jahili_name) highlights.push(`اسمه في الجاهلية: ${bio.jahili_name}`);
  if (bio.islamic_name) highlights.push(`اسمه في الإسلام (رواية): ${bio.islamic_name}`);
  for (const x of bio.conversion_or_arrival.slice(0, 2)) highlights.push(x);
  if (bio.hadith.noted_as_prolific) {
    highlights.push(
      bio.hadith.estimated_count_text
        ? `من المكثرين؛ ${bio.hadith.estimated_count_text}`
        : 'من أكثر الصحابة حديثا'
    );
  }
  if (bio.hadith.students_count_text) highlights.push(bio.hadith.students_count_text);
  for (const x of bio.offices.slice(0, 2)) highlights.push(x);
  for (const x of bio.death.notes.slice(0, 2)) highlights.push(x);
  bio.highlights = uniq(highlights).slice(0, 12);

  // Drop empty-ish arrays for cleaner JSON? Keep structure for schema stability.
  return bio;
}

module.exports = {
  parseBiography,
  stripFootnoteBlocks,
  extractFootnoteRefs,
};
