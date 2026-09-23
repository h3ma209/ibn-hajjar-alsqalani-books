'use strict';

const RULES = [
  { label: 'heading', re: /^\d+\s*[^\d\s\-–—]{0,6}\s*[-–—]/u },
  { label: 'ibn_hajar_voice', re: /^قلت:/u },
  { label: 'nasab', re: /بن |بنت |ابن /u },
  { label: 'name_dispute', re: /اختلف في اسمه|اختلفوا في اسمه|قيل اسمه|يقال اسمه/u },
  { label: 'crossref', re: /يأتي|سيأتي|تقدم|تقدمت|مضى|انظر/u },
  { label: 'citation', re: /ذكره |أخرجه |رواه |قاله |قال ابن /u },
  { label: 'isnad', re: /ثنا |نا |أخبرنا |حدثنا |عن [^.]{2,30} عن /u },
  { label: 'hadith_matn', re: /قال رسول|صلى الل[َّ]?ه عليه/u },
  { label: 'battle', re: /شهد |غزا |بدر|أحد|الخندق|خيبر|تبوك|حنين|القادسية|اليرموك|الجمل|صفين/u },
  { label: 'event', re: /أسر|سبي|استشهد|وفد |سرية|هاجر|بايع|جرح/u },
  { label: 'death', re: /مات|توفي|استشهد|وفاته|قتل /u },
  { label: 'birth', re: /ولد|مولده/u },
  { label: 'age', re: /وهو ابن|وعمره|سنة/u },
  { label: 'office', re: /استعمله|ولاه|أمّره|أمير|قاض/u },
  { label: 'family', re: /أمه |أخوه |ابنه |زوجته |زوجها /u },
  { label: 'praise', re: /ثقة|فاضل|من خيار|جليل/u },
  { label: 'criticism', re: /لا يصح|لا يثبت|وهم|تصحيف|ضعيف|غلط/u },
  { label: 'defense', re: /والصواب|والصحيح|فالجواب|قلت:/u },
  { label: 'poetry', re: /وقال الشاعر|من الطويل|من البسيط/u },
  { label: 'quran', re: /القرآن|أقرأ/u },
];

function splitSentences(text) {
  const source = String(text || '');
  const spans = [];
  const re = /[^\n.؟!]+(?:[.؟!]+|\n+|$)/gu;
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

function labelSentence(quote) {
  const text = quote.trim();
  if (text.length < 3) return 'boilerplate';
  for (const { label, re } of RULES) {
    if (re.test(text)) return label;
  }
  return 'unlabeled';
}

function labelPassages(personId, text, { source = 'regex', confidence = 0.3 } = {}) {
  return splitSentences(text).map((span) => ({
    person_id: personId,
    start: span.start,
    end: span.end,
    label: labelSentence(span.quote),
    source,
    confidence: labelSentence(span.quote) === 'unlabeled' ? 0.1 : confidence,
    quote: span.quote.slice(0, 400),
  }));
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

module.exports = { splitSentences, labelSentence, labelPassages, coverageFrom };
