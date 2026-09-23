'use strict';

const { flatten, normalizeArabic } = require('../util/arabic');
const { vocab, findAllInText, resolve: resolveVocab, term } = require('../vocab');

const FITNA_KEYS = new Set(['al_jamal', 'siffin', 'nahrawan', 'karbala', 'al_harra']);
const CONQUEST_KEYS = new Set(['fath_makkah', 'fath_dimashq', 'fath_misr', 'fath_al_sham']);

const INCIDENT_RES = [
  { kind: 'wound', re: /جرح|جريح|أصيب بسهم|رمي يوم/u },
  { kind: 'captivity', re: /أسر|سبي|أسيرا/u },
  { kind: 'martyrdom', re: /استشهد/u },
  { kind: 'wufd', re: /وفد على|وفادته|في وفد/u },
  { kind: 'sariyya', re: /سري[ةه]/u },
  { kind: 'hijra', re: /هاجر إلى|هجرته إلى|قدم مهاجرا/u },
  { kind: 'treaty', re: /صلح الحديبية|عقد الصلح|هادن/u },
  { kind: 'bayah', re: /بايع|بيعة الرضوان/u },
  { kind: 'siege', re: /حاصر|حصار/u },
  { kind: 'marriage', re: /تزوج|زوّجه|زوجه النبي/u },
  { kind: 'manumission', re: /أعتق|عتقه/u },
  { kind: 'dream', re: /رأى في المنام|في النوم/u },
  { kind: 'quran', re: /جمع القرآن|قرأ على|أقرأ/u },
  { kind: 'letter_from_prophet', re: /كتب إليه النبي|كتاب رسول/u },
  { kind: 'meeting', re: /لقي النبي|وفد على النبي|قدم على النبي/u },
];

function battleKind(key) {
  if (FITNA_KEYS.has(key)) return 'fitna';
  if (key === 'riddah') return 'ridda';
  if (CONQUEST_KEYS.has(key)) return 'conquest';
  if (key === 'hudaybiya') return 'treaty';
  return 'battle';
}

function extractBattleEvents(text, source, confidence) {
  const flat = flatten(text);
  const events = [];
  const dictionary = vocab('battles');
  for (const key of findAllInText('battles', flat)) {
    const item = dictionary.byKey.get(key);
    if (!item) continue;
    if (!/شهد|غزا|حضر|قاتل|يوم|كان في|قدم.*عام|استشهد/u.test(flat)) continue;
    const evidence = flat.includes(item.label_ar)
      ? item.label_ar
      : (item.aliases || []).find((a) => normalizeArabic(flat).includes(normalizeArabic(a))) || item.label_ar;
    events.push({
      value: item.label_ar,
      kind: battleKind(key),
      key,
      year_hijri: item.year_hijri ?? null,
      place: null,
      place_key: null,
      source,
      evidence: String(evidence).slice(0, 200),
      confidence,
    });
  }
  return events;
}

function extractIncidentEvents(text, source, confidence) {
  const flat = flatten(text);
  const events = [];
  const seen = new Set();

  for (const { kind, re } of INCIDENT_RES) {
    const match = flat.match(re);
    if (!match) continue;
    const vocabKey = resolveVocab('events', match[0]);
    const key = `${kind}|${vocabKey || match[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      value: match[0],
      kind,
      key: vocabKey || null,
      year_hijri: null,
      place: null,
      place_key: resolveVocab('places', match[0]) || null,
      source,
      evidence: match[0].slice(0, 200),
      confidence,
    });
  }

  for (const key of findAllInText('events', flat)) {
    const item = term('events', key);
    if (!item || seen.has(`v|${key}`)) continue;
    seen.add(`v|${key}`);
    events.push({
      value: item.label_ar,
      kind: item.kind || 'incident',
      key,
      year_hijri: null,
      place: null,
      place_key: null,
      source,
      evidence: item.label_ar,
      confidence,
    });
  }

  return events;
}

function extractEvents(text, { source = 'regex', confidence = 0.3 } = {}) {
  const battles = extractBattleEvents(text, source, confidence);
  const incidents = extractIncidentEvents(text, source, confidence);
  const seen = new Set();
  const out = [];
  for (const event of [...battles, ...incidents]) {
    const id = `${event.kind}|${event.key || event.value}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(event);
  }
  return out;
}

function extractWounds(text, source, confidence) {
  const match = flatten(text).match(/جرح|أصيب|رمي يوم/u);
  if (!match) return [];
  return [{ value: match[0], kind: 'wound', key: null, source, evidence: match[0], confidence }];
}

function extractAges(text, source, confidence) {
  const flat = flatten(text);
  const out = [];
  const death = flat.match(/(?:مات|توفي)[^.]{0,40}?(?:وهو ابن|وعمره|عن)\s+([^\s.،]{2,40})\s+سنة/u);
  if (death) {
    out.push({
      value: death[0].slice(0, 120),
      kind: 'at_death',
      years: null,
      source,
      evidence: death[0].slice(0, 200),
      confidence,
    });
  }
  const islam = flat.match(/أسلم[^.]{0,30}?(?:وهو ابن|وعمره)\s+([^\s.،]{2,30})\s+سنة/u);
  if (islam) {
    out.push({
      value: islam[0].slice(0, 120),
      kind: 'at_islam',
      years: null,
      source,
      evidence: islam[0].slice(0, 200),
      confidence,
    });
  }
  return out;
}

module.exports = { extractEvents, extractWounds, extractAges, battleKind };
