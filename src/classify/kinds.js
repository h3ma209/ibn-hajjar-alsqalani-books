'use strict';

const { findAllInText, resolve: resolveVocab } = require('../vocab');

function lengthClass(charLen) {
  if (charLen < 200) return 'stub';
  if (charLen < 800) return 'short';
  if (charLen < 4000) return 'medium';
  return 'long';
}

function entryKind({ qism, charLen, text }) {
  const body = String(text || '');
  const crossref = /يأتي|سيأتي|تقدم|تقدمت|مضى|انظر/u.test(body);
  if (qism === 4) return 'qism4_refutation';
  if (charLen < 150 && !crossref) return 'name_only';
  if (charLen < 400 && crossref && /كنى|الكنى/u.test(body)) return 'kunya_redirect';
  if (charLen < 400 && crossref) return 'crossref_stub';
  return 'biography';
}

function detectFlags(text, footnotes = []) {
  const flags = [];
  if (/ثنا |نا |أخبرنا |حدثنا |عن [^.\n]{2,40} عن /u.test(text)) flags.push('has_isnad');
  if (/اختلف في اسمه|اختلفوا في اسمه|في اسمه أقوال|قيل اسمه/u.test(text)) flags.push('has_name_dispute');
  if (/قلت:/u.test(text)) flags.push('has_ibn_hajar_voice');
  if (/وقال (?:الشاعر|حسان)|من الطويل|من البسيط/u.test(text)) flags.push('has_poetry');
  if (/قال رسول|صلى الل[َّ]?ه عليه/u.test(text)) flags.push('has_hadith_matn');
  if ((footnotes || []).length > 3) flags.push('footnote_heavy');
  return flags;
}

function companionshipStatus(qism) {
  if (qism === 1) return 'established';
  if (qism === 2) return 'vision_or_birth';
  if (qism === 3) return 'mukhadram';
  if (qism === 4) return 'listed_in_error';
  return 'disputed';
}

function generation(qism) {
  if (qism === 1 || qism === 2) return 'sahabi';
  if (qism === 3) return 'mukhadram';
  return 'unknown';
}

function originFrom(text, nisbaKeys) {
  if (nisbaKeys.includes('ansari') || nisbaKeys.includes('khazraji') || nisbaKeys.includes('awsi')) {
    return 'ansari';
  }
  if (/المهاجر|هاجر إلى|من المهاجرين/u.test(text) || nisbaKeys.includes('qurashi')) {
    if (/الأنصار|أنصاري/u.test(text)) return 'ansari';
    if (/هاجر|المهاجر/u.test(text)) return 'muhajir';
  }
  if (/هاجر/u.test(text)) return 'muhajir';
  if (/الأنصار|أنصاري/u.test(text)) return 'ansari';
  return nisbaKeys.length ? 'other' : 'unknown';
}

function freeStatus(text, nisbaKeys) {
  if (nisbaKeys.includes('mawla') || /مولى /u.test(text.slice(0, 400))) return 'mawla';
  return 'unknown';
}

function genderSource({ isWoman, sectionType, text }) {
  if (sectionType === 'women') return 'women_section';
  if (isWoman && /بنت |وهي |أمها /u.test(text.slice(0, 250))) return 'grammar';
  if (isWoman) return 'name';
  return 'explicit';
}

function kindConversion(value) {
  if (/حبش/u.test(value)) return 'hijra_habasha';
  if (/هاجر|هجرته|المدينة/u.test(value)) return 'hijra_madinah';
  if (/بيع/u.test(value)) return 'bayah';
  if (/أسلم|إسلام|أسلمت/u.test(value)) return 'islam';
  return 'first_arrival';
}

function kindCompanionship(value) {
  if (/خدم/u.test(value)) return 'served';
  if (/بعثه/u.test(value)) return 'sent_by';
  if (/كتب|كتب إليه/u.test(value)) return 'wrote_to';
  if (/صلى مع/u.test(value)) return 'prayed_with';
  if (/سمع/u.test(value)) return 'heard';
  if (/رأى|رؤية|رآه/u.test(value)) return 'saw';
  if (/صحب|صحبة/u.test(value)) return 'accompanied';
  return 'claimed_only';
}

function kindTrait(value) {
  if (/طويلا|قصيرا|آدم|أبيض|أشقر|أسمر|جسيما|نحيفا|يخضب/u.test(value)) return 'physical';
  if (/أعبد|يصوم|يصلي|زاهدا|تسبيح/u.test(value)) return 'worship';
  if (/شجاع|فاضل|كريم|جواد/u.test(value)) return 'character';
  return 'occupation';
}

function kindCriticism(value) {
  if (/ليست له صحبة|ليس (?:من )?الصحابة|لا صحبة/u.test(value)) return 'companionship_denied';
  if (/تصحيف|غلط/u.test(value)) return 'scribal_error';
  if (/منقطع|مرسل|إسناد/u.test(value)) return 'isnad_defect';
  if (/ضعيف|لا يثبت|لا يصح/u.test(value)) return 'adala';
  if (/اسمه|وهم في اسم/u.test(value)) return 'identity';
  return 'other';
}

function kindAlternateName(value) {
  if (/جاهلي|عبد شمس|عبد العزى/u.test(value)) return 'jahili';
  if (/سماه رسول|فسمّاه|فسمي/u.test(value)) return 'prophetic_rename';
  if (/يكنى|كنيته|أبو /u.test(value)) return 'kunya';
  return 'ism';
}

function addKind(fact, kind) {
  if (!fact) return fact;
  return { ...fact, kind: fact.kind || kind || null, key: fact.key ?? null };
}

function nisbaKeysFrom(nisba = [], text = '') {
  const keys = new Set();
  for (const item of nisba) {
    const key = resolveVocab('tribes', item);
    if (key) keys.add(key);
  }
  for (const key of findAllInText('tribes', String(text).slice(0, 500))) keys.add(key);
  return [...keys];
}

function parseHadithCount(fact) {
  if (!fact) return null;
  const raw = String(fact.value || '');
  const digits = raw.match(/(\d{1,5})/);
  const arabic = raw.match(/(ألف|مائة|مئة|ألفان)/u);
  return {
    value: raw,
    count: digits ? Number(digits[1]) : null,
    uncertain: Boolean(arabic) || /نحو|أكثر من|كسر/u.test(raw),
    source: fact.source,
    evidence: fact.evidence ?? null,
    confidence: fact.confidence,
  };
}

function deathCauseKey(death) {
  const blob = [death?.cause, ...(death?.notes || []).map((n) => n.value)].filter(Boolean).join(' ');
  if (!blob) return null;
  return resolveVocab('death-causes', blob);
}

function officeRoleKey(office) {
  return resolveVocab('offices', [office.role, office.value].filter(Boolean).join(' '));
}

module.exports = {
  lengthClass,
  entryKind,
  detectFlags,
  companionshipStatus,
  generation,
  originFrom,
  freeStatus,
  genderSource,
  kindConversion,
  kindCompanionship,
  kindTrait,
  kindCriticism,
  kindAlternateName,
  addKind,
  nisbaKeysFrom,
  parseHadithCount,
  deathCauseKey,
  officeRoleKey,
};
