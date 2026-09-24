'use strict';

/**
 * Sentence labels. First-match-wins was too greedy (بن / سنة / صلى الله).
 * Score competing cues; stronger, more specific patterns win.
 */

const BATTLE =
  'بدر|أحد|الخندق|الأحزاب|خيبر|تبوك|حنين|الطائف|القادسية|اليرموك|الجمل|صفين|مؤتة|موتة|الحديبية|فتح مكة|يوم الفتح|اليمامة|أجنادين|نهاوند|الردة|بئر معونة|الرجيع|ذات الرقاع|النهروان|كربلاء|الحرة|جلولاء|مرج الصفر|مكة|بواط|الأبواء|العشيرة|سفوان|قينقاع|النضير|قريظة|المريسيع|المصطلق|أوطاس|فحل|المدائن|تستر|يوم الدار|ذات السلاسل|دومة الجندل';

const SCHOLAR =
  'البخاري|مسلم|أبو داود|الترمذي|النسائي|ابن ماجه|أحمد|الحاكم|البغوي|ابن سعد|الواقدي|ابن إسحاق|ابن اسحاق|خليفة|الطبراني|الدارقطني|ابن حبان|ابن حبّان|ابن شاهين|البزار|أبو يعلى|البيهقي|ابن عساكر|الذهبي|ابن الكلبي|ابن قانع|الطبري|أبو نعيم|ابن مندة|ابن منده|ابن عبد البر|ابن الأثير|أبو موسى|الرشاطي|ابن فتحون|الهيثم|الكنى|أسد الغابة|الاستيعاب|التجريد|أبو زرعة|ابن أبي حاتم|ابن معين|يحيى بن معين|أحمد بن حنبل|الشافعي|مالك|النووي|المزي|المزّي|ابن أبي شيبة|الدولابي|ابن السكن|ابن خزيمة|أبو أحمد|وكيع|شعبة|سفيان|الزهري|ابن سيرين|الكلبي|المزيّ|تهذيب|تقريب|الكاشف|الحلية|الطبقات|الاستيعاب|الإصابة';

const NISBA =
  'القرشي|الأنصاري|الأموي|الخزرجي|الأوسي|الدوسي|السلمي|العدوي|الزهري|التميمي|الليثي|الجهني|الغفاري|المزني|الخزاعي|الهذلي|الثقفي|العامري|المخزومي|الأسدي|الحارثي|البكري|الكلبي|الهمداني|الكندي|الأزدي|الطائي|الفهري|الجعفي|الكناني|الهلالي|السهمي|الجمحى|الجمحي|العبسي|الفزاري|الضبي|النهدي|الباقري';

const RE = {
  heading: /^\d+\s*[^\d\n]{0,12}\s*[-–—:]/u,
  voice: /^قلت[:：]/u,
  voiceMid: /(?:^|[.]\s+)قلت[:：]/u,
  dispute: /اختلف(?:وا)? في اسمه|قيل اسمه|يقال اسمه|في اسمه أقوال|سُمّي|يسمّى|ويقال اسمه|مختلف في اسمه|اختلفوا في اسمه|على أكثر من \S+ قولا/u,
  crossref: /يأتي في|سيأتي في|تقدم في|تقدمت في|مضى في|انظر[:：]?\s|ترجمه في|في الكنى|في النساء|كما سيأتي في ترجمت/u,
  isnad: /ثنا |أخبرنا |حدثنا |أنبأنا |نا [أاإ]|(?:عن [^.\n]{2,36} ){2}عن /u,
  matn: /قال رسول الل|قال النبي|سمعت رسول|عن النبي صل|فيما رواه عن النبي|رفعه[:：]/u,
  death: /(?:^|[.،:]\s*|ثم |و)(?:مات |توفي|توفّي)|وفاته|مقتله|قُتل |قتل يوم|قتل في|لما قتل|قتل أبي|استشهد|مات سنة|مات في|حضره الموت|حضرته الوفاة|لما مات|بعد موته/u,
  birth: /ولد |مولده|وُلد|ولدت |ولدته |ولد سنة/u,
  age: /وهو ابن \S.{0,20}سن|وعمره|أتت عليه|عاش \S.{0,12}سن|مات وهو ابن|ثمانيا? و\S+ سن|ابن ثلاثين سنة|زدت على الثلاثين/u,
  office: /استعمله|ولاه |ولّاه|أمّره|أمّر |أمير |قاض|عامل على|استعمل على|ولي |بعثه (?:النبي|أبو بكر|عمر|عثمان)|على البحرين|على اليمن|على مكة|على الكوفة|على البصرة|على الشام|على المدينة|على مصر/u,
  family: /أمه |أبوه |أخوه |أخته |ابنه |ابنته |زوجته |زوجها |عمه |خالُ|خاله |بنوه |بناته |ولد له|أعقب|له عقب|وامرأته |تزوّجها|تزوجها |ابن أخي|ابن أخيه|أبو المترجم/u,
  praise: /ثقة|ثبت |فاضل|من خيار|جليل|صدوق|حافظ |من كبار|له صحبة|أثبتت صحبته|من الصحابة|أحفظ|ألزمنا|أكثر الصحابة/u,
  criticism: /لا يصح|لا يثبت|ليس بصحابي|ليست له صحبة|وهم |تصحيف|ضعيف|غلط|لا يعرف|مجهول|ليست له رواية|خطأ|وهل منه/u,
  defense: /والصواب|والصحيح|فالجواب|وهذا وهم|يردّ عليه|والمعتمد/u,
  poetry: /وقال الشاعر|من الطويل|من البسيط|من الوافر|من الكامل|من الرجز|من المنسرح|قال حسّان|أنشد|\[(?:الطويل|البسيط|الوافر|الكامل|الرجز|المنسرح)\]/u,
  quran: /قوله تعالى|قال تعالى|الآية|﴿|القرآن|أقرأ/u,
  footnote: /^\[\s*\(\s*\d+\s*\)\s*\]/u,
  citationVerb: /ذكره |أخرجه |رواه |أسنده |أورده |قاله |حكاه |ونقل |في الصحيح|في السنن|في المسند|من طريق/u,
  narration: /(?:^|[.]\s+)روى عنه |(?:^|[.]\s+)روى عن |يروي عن/u,
  scholar: new RegExp(SCHOLAR, 'u'),
  battleName: new RegExp(BATTLE, 'u'),
  battleAct: new RegExp(`(?:شهد|غزا|غزوة|حضر يوم|وقعة|شهد معه|غزا معه)\\s*.{0,24}(?:${BATTLE})`, 'u'),
  battleDay: new RegExp(`(?:غزوة|يوم|وقعة|فتح)\\s*(?:${BATTLE})`, 'u'),
  event: /أسر|سُبي|سبي |وفد على|وفادته|في وفد|سري[ةه]|هاجر إلى|هجرته|بايع|بيعة |جرح |جريح|أعتق|تزوج|زوّجه|زوجه النبي|حاصر|صلح الحديبية|أسلم أيام|أسلم يوم|أسلم قبل|قدم مهاجرا|سكن |نزل |استوطن|كان مقدمه|قدم المدينة|أسلم |صحب النبي|صحبته /u,
  lifeVerb: /شهد|غزا|مات|توفي|أسلم|هاجر|روى|ذكره|أخرجه|قتل|ولاه|بايع|استشهد|وفد|سكن|نزل/u,
  nisba: new RegExp(NISBA, 'u'),
};

function scoreLabel(text) {
  const hits = [];
  const add = (label, score) => hits.push({ label, score });

  if (RE.heading.test(text) && text.length < 90) add('heading', 9);
  if (RE.voice.test(text) || RE.voiceMid.test(text)) add('ibn_hajar_voice', 10);
  if (RE.dispute.test(text)) add('name_dispute', 9);
  if (RE.crossref.test(text) && text.length < 220) add('crossref', 8);
  if (RE.isnad.test(text)) add('isnad', 9);
  if (RE.matn.test(text)) add('hadith_matn', 9);
  if (RE.death.test(text)) add('death', 9);
  if (RE.birth.test(text)) add('birth', 9);
  if (RE.age.test(text)) add('age', 9);
  if (RE.office.test(text)) add('office', 8);
  if (RE.family.test(text)) add('family', 7);
  if (RE.praise.test(text) && !RE.criticism.test(text)) add('praise', 6);
  if (RE.criticism.test(text)) add('criticism', 8);
  if (RE.defense.test(text) && !RE.voice.test(text)) add('defense', 7);
  if (RE.poetry.test(text) && !RE.lifeVerb.test(text) && !RE.event.test(text) && !RE.battleAct.test(text)) {
    add('poetry', 9);
  }
  if (RE.quran.test(text)) add('quran', 9);
  if (RE.footnote.test(text) || (text.length < 10 && /^\s*[«»\[\]()\d]+\s*$/u.test(text))) {
    add('editor_footnote', 6);
  }
  if ((RE.citationVerb.test(text) || RE.scholar.test(text) || RE.narration.test(text))
    && !RE.voice.test(text) && !RE.matn.test(text)) {
    add('citation', 7);
  }
  if (RE.battleAct.test(text)) add('battle', 8);
  else if (RE.battleDay.test(text) && !RE.death.test(text) && !RE.scholar.test(text)) add('battle', 8);
  if (RE.event.test(text) && !RE.death.test(text)) add('event', 7);

  const reportCue = RE.lifeVerb.test(text) || RE.citationVerb.test(text)
    || RE.scholar.test(text) || RE.isnad.test(text) || RE.narration.test(text)
    || RE.family.test(text);
  const nasabHits = (text.match(/بن |بنت |ابن /gu) || []).length;
  if (nasabHits >= 2 && !reportCue) add('nasab', 8);
  else if (nasabHits >= 1 && text.length < 140 && !reportCue && RE.nisba.test(text)) {
    add('nasab', 6);
  }

  if (!hits.length) return { label: text.length < 3 ? 'boilerplate' : 'unlabeled', score: 0 };
  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return hits[0];
}

function labelSentence(quote) {
  return scoreLabel(String(quote || '').trim()).label;
}

function splitSentences(text) {
  const source = String(text || '');
  const spans = [];
  const re = /[^\n.؟!]+(?:[.؟!]+(?:\s*\[\s*\(\s*\d+\s*\)\s*\])?|\n+|$)/gu;
  for (const match of source.matchAll(re)) {
    const quote = match[0];
    const trimmed = quote.trim();
    if (!trimmed) continue;
    const pad = quote.indexOf(trimmed);
    spans.push({
      start: match.index + pad,
      end: match.index + pad + trimmed.length,
      quote: trimmed,
    });
  }
  return spans;
}

function labelPassages(personId, text, { source = 'regex', confidence = 0.3 } = {}) {
  return splitSentences(text).map((span) => {
    const scored = scoreLabel(span.quote);
    return {
      person_id: personId,
      start: span.start,
      end: span.end,
      label: scored.label,
      source,
      confidence: scored.label === 'unlabeled' ? 0.1 : Math.min(0.95, confidence + scored.score / 30),
      quote: span.quote.slice(0, 400),
    };
  });
}

function coverageFrom(spans, text) {
  const total = String(text || '').length || 1;
  let labeled = 0;
  let unlabeledSents = 0;
  for (const span of spans) {
    const len = Math.max(0, span.end - span.start);
    if (span.label === 'unlabeled') unlabeledSents += 1;
    else labeled += len;
  }
  return {
    label_coverage: Number(Math.min(1, labeled / total).toFixed(4)),
    n_unlabeled_sents: unlabeledSents,
    n_spans: spans.length,
  };
}

module.exports = { splitSentences, labelSentence, labelPassages, coverageFrom, scoreLabel, RE };
