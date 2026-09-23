'use strict';

const { REGEX_CONFIDENCE } = require('../extract/regex-bio');
const {
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
} = require('./kinds');
const { extractEvents, extractWounds, extractAges } = require('./events');
const { labelPassages, coverageFrom } = require('./spans');

function buildLabels({ person, flags, origin, nisbaKeys }) {
  const labels = [];
  const push = (key, source = 'structural', confidence = 1) => {
    if (!key || labels.some((row) => row.key === key)) return;
    labels.push({ key, source, confidence });
  };

  if (person.entry.marker === 'ز') push('added_zay');
  if (person.classification.qism === 4) push('qism4');
  if (person.identity.is_woman) push('woman');
  if (flags.includes('has_name_dispute')) push('name_disputed', 'regex', 0.3);
  if (flags.includes('has_isnad')) push('has_isnad', 'regex', 0.3);
  if (person.narration.is_prolific) push('mukthir', 'regex', 0.3);
  if (origin === 'muhajir') push('muhajir');
  if (origin === 'ansari') push('ansari');
  if (nisbaKeys.includes('qurashi')) push('qurashi');
  if (nisbaKeys.includes('mawla')) push('mawla');
  if ((person.life.battles || []).some((b) => b.key === 'badr')) push('badi', 'regex', 0.3);
  if ((person.life.events || []).some((e) => e.kind === 'martyrdom')) push('shahid', 'regex', 0.3);
  if ((person.life.offices || []).some((o) => o.role_key === 'qadi')) push('qadi', 'regex', 0.3);
  if ((person.life.events || []).some((e) => ['battle', 'fitna', 'ridda', 'conquest'].includes(e.kind))) {
    push('fought', 'regex', 0.3);
  }
  return labels;
}

function buildFeatures(person, coverage) {
  const events = person.life.events || [];
  const battles = person.life.battles || [];
  return {
    n_events: events.length,
    n_battles: battles.length,
    n_isnads: (person.entry.flags || []).includes('has_isnad') ? 1 : 0,
    n_citations: 0,
    n_family: (person.life.family || []).length,
    n_offices: (person.life.offices || []).length,
    n_unlabeled_sents: coverage.n_unlabeled_sents,
    fought: events.some((e) => ['battle', 'fitna', 'ridda', 'conquest', 'sariyya'].includes(e.kind)),
    wounded: events.some((e) => e.kind === 'wound') || (person.life.wounds || []).length > 0,
    shahid: events.some((e) => e.kind === 'martyrdom'),
    captive: events.some((e) => e.kind === 'captivity'),
    muhajir: person.classification.origin === 'muhajir',
    ansari: person.classification.origin === 'ansari',
    has_death_year: person.life.death?.year_hijri != null,
    has_isnad: (person.entry.flags || []).includes('has_isnad'),
    name_disputed: person.identity.ism_status === 'disputed',
    label_coverage: coverage.label_coverage,
  };
}

/**
 * Attach v3 classification: kinds, events, spans, labels, features.
 * Mutates and returns the person record plus side artifacts.
 */
function juice(person, { raw, entryMarker = null, text = '' } = {}) {
  const body = raw?.text_body || text || '';
  const charLen = person.entry.char_len || body.length;
  const source = person.extraction.layers.includes('llm') ? 'llm' : 'regex';
  const confidence = source === 'llm' ? 0.7 : REGEX_CONFIDENCE;

  const kind = entryKind({ qism: person.classification.qism, charLen, text: body });
  const flags = detectFlags(body, raw?.footnotes);
  const nisbaKeys = nisbaKeysFrom(person.identity.nasab.nisba, body);
  const origin = originFrom(body, nisbaKeys);
  const spans = labelPassages(person.person_id, body, { source: 'regex', confidence: 0.3 });
  const coverage = coverageFrom(spans, body);
  const events = extractEvents(body, { source, confidence });

  person.entry.marker = entryMarker ?? person.entry.marker ?? null;
  person.entry.length_class = lengthClass(charLen);
  person.entry.kind = kind;
  person.entry.flags = flags;
  person.entry.footnotes = raw?.footnotes || person.entry.footnotes || [];

  person.identity.laqab = person.identity.laqab ?? null;
  person.identity.ism_status = flags.includes('has_name_dispute') ? 'disputed' : 'agreed';
  person.identity.alternate_names = (person.identity.alternate_names || []).map((fact) =>
    addKind(fact, kindAlternateName(fact.value))
  );
  person.identity.name_dispute_notes = (person.identity.name_dispute_notes || []).map((fact) =>
    addKind(fact, 'dispute')
  );

  person.classification.entry_kind = kind;
  person.classification.companionship_status = companionshipStatus(person.classification.qism);
  person.classification.generation = generation(person.classification.qism);
  person.classification.origin = origin;
  person.classification.status = freeStatus(body, nisbaKeys);
  person.classification.tribe_keys = nisbaKeys.filter((k) => k !== 'mawla');
  person.classification.nisba_keys = nisbaKeys;
  person.classification.gender_source = genderSource({
    isWoman: person.identity.is_woman,
    sectionType: person.classification.section_type,
    text: body,
  });

  person.life.conversion = (person.life.conversion || []).map((fact) => addKind(fact, kindConversion(fact.value)));
  person.life.companionship = (person.life.companionship || []).map((fact) =>
    addKind(fact, kindCompanionship(fact.value))
  );
  person.life.traits = (person.life.traits || []).map((fact) => addKind(fact, kindTrait(fact.value)));
  person.life.events = events;
  person.life.wounds = extractWounds(body, source, confidence);
  person.life.ages = extractAges(body, source, confidence);
  person.life.possessions = person.life.possessions || [];
  if (person.life.summary) person.life.summary = addKind(person.life.summary, null);

  if (person.life.death) {
    person.life.death.cause_key = deathCauseKey(person.life.death);
    person.life.death.age_years = person.life.death.age_years ?? null;
  }
  if (person.life.birth) {
    person.life.birth.cause_key = person.life.birth.cause_key ?? null;
    person.life.birth.age_years = person.life.birth.age_years ?? null;
  }
  person.life.offices = (person.life.offices || []).map((office) => ({
    ...office,
    role_key: office.role_key || officeRoleKey(office),
  }));

  person.narration.hadith_count = parseHadithCount(person.narration.hadith_count);
  person.narration.praise = (person.narration.praise || []).map((fact) => addKind(fact, 'adala'));
  person.narration.criticism = (person.narration.criticism || []).map((fact) =>
    addKind(fact, kindCriticism(fact.value))
  );
  person.narration.defenses = (person.narration.defenses || []).map((fact) => addKind(fact, 'other'));
  person.narration.verdict_keys = person.narration.verdict_keys || [];

  person.labels = buildLabels({ person, flags, origin, nisbaKeys });
  person.features = buildFeatures(person, coverage);

  return { person, spans, coverage };
}

module.exports = { juice, buildLabels, buildFeatures };
