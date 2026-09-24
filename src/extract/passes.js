'use strict';

const { PATHS } = require('../config');
const { makeEvidenceVerifier } = require('./llm-bio');
const { labelPassages } = require('../classify/spans');
const { parseHadithCount } = require('../classify/kinds');

const SKIP_KINDS = new Set(['name_only', 'kunya_redirect']);
const MAX_ITEMS = 16;
const SNIPPET = 1400;
const VERDICT_CUE = /ثقة|ضعيف|مجهول|ليس(?:ت)? (?:له |ب)?صحب|لا يصح|لا يثبت|مختلف فيه/u;

const KIND_NEED = {
  'narration.criticism': (kind) => !kind || kind === 'other',
  'narration.defenses': (kind) => !kind || kind === 'other',
  'narration.praise': (kind) => !kind || kind === 'other',
  'life.events': (kind) => !kind || kind === 'incident',
};

function snippet(text, n = SNIPPET) {
  const body = String(text || '');
  if (body.length <= n) return body;
  const head = Math.floor(n * 0.4);
  const tail = n - head - 20;
  return `${body.slice(0, head)}\n…\n${body.slice(-tail)}`;
}

function walkFacts(person, visit) {
  const arrays = [
    ['life.conversion', person.life?.conversion],
    ['life.companionship', person.life?.companionship],
    ['life.battles', person.life?.battles],
    ['life.offices', person.life?.offices],
    ['life.family', person.life?.family],
    ['life.residences', person.life?.residences],
    ['life.traits', person.life?.traits],
    ['life.events', person.life?.events],
    ['life.wounds', person.life?.wounds],
    ['identity.alternate_names', person.identity?.alternate_names],
    ['identity.name_dispute_notes', person.identity?.name_dispute_notes],
    ['narration.narrated_from', person.narration?.narrated_from],
    ['narration.narrated_to', person.narration?.narrated_to],
    ['narration.praise', person.narration?.praise],
    ['narration.criticism', person.narration?.criticism],
    ['narration.defenses', person.narration?.defenses],
    ['cited_authorities', person.cited_authorities],
    ['cross_references', person.cross_references],
  ];
  for (const [field, items] of arrays) {
    (items || []).forEach((item, index) => {
      if (item && item.value) visit({ field, index, item, path: `${field}.${index}` });
    });
  }
}

function entryKindOf(person) {
  return person.entry?.kind || person.classification?.entry_kind || 'biography';
}

function skipThin(person) {
  return SKIP_KINDS.has(entryKindOf(person));
}

function selectRepair(corpus) {
  const out = [];
  for (const person of corpus.persons) {
    const raw = corpus.rawById.get(person.person_id);
    if (!raw) continue;
    const verify = makeEvidenceVerifier(raw.text_body || '');
    const items = [];
    walkFacts(person, ({ field, index, item, path }) => {
      if (item.source !== 'llm' || !item.evidence) return;
      if (verify(item.evidence) !== 'unverified') return;
      items.push({
        id: items.length,
        path,
        field,
        index,
        value: item.value,
        evidence: item.evidence,
      });
    });
    if (!items.length) continue;
    out.push({
      person_id: person.person_id,
      entry_number: person.entry.number,
      text: raw.text_body || '',
      items: items.slice(0, MAX_ITEMS),
    });
  }
  return out;
}

function selectKinds(corpus) {
  const out = [];
  for (const person of corpus.persons) {
    const raw = corpus.rawById.get(person.person_id);
    if (!raw) continue;
    const items = [];
    walkFacts(person, ({ field, index, item, path }) => {
      const need = KIND_NEED[field];
      if (!need || !need(item.kind)) return;
      items.push({
        id: items.length,
        path,
        field,
        index,
        value: item.value,
        kind: item.kind || null,
      });
    });
    if (!items.length) continue;
    out.push({
      person_id: person.person_id,
      entry_number: person.entry.number,
      snippet: snippet(raw.text_body || ''),
      items: items.slice(0, MAX_ITEMS),
    });
  }
  return out;
}

function selectSpans(corpus) {
  const out = [];
  for (const person of corpus.persons) {
    if (skipThin(person)) continue;
    const raw = corpus.rawById.get(person.person_id);
    if (!raw) continue;
    const unlabeled = labelPassages(person.person_id, raw.text_body || '').filter(
      (span) => span.label === 'unlabeled' && span.quote.length >= 12
    );
    if (!unlabeled.length) continue;
    out.push({
      person_id: person.person_id,
      entry_number: person.entry.number,
      items: unlabeled.slice(0, MAX_ITEMS).map((span, i) => ({
        i,
        start: span.start,
        end: span.end,
        quote: span.quote.slice(0, 240),
      })),
    });
  }
  return out;
}

function selectVerdicts(corpus) {
  const out = [];
  for (const person of corpus.persons) {
    const raw = corpus.rawById.get(person.person_id);
    if (!raw) continue;
    const text = raw.text_body || '';
    const qism4 = person.classification?.qism === 4;
    const hasCrit = (person.narration?.criticism || []).length > 0;
    if (!qism4 && !hasCrit && !VERDICT_CUE.test(text)) continue;
    out.push({
      person_id: person.person_id,
      entry_number: person.entry.number,
      qism: person.classification?.qism ?? null,
      snippet: snippet(text, 2200),
    });
  }
  return out;
}

function selectIsnads(corpus) {
  const out = [];
  for (const person of corpus.persons) {
    if (skipThin(person)) continue;
    const raw = corpus.rawById.get(person.person_id);
    if (!raw) continue;
    const flags = person.entry?.flags || [];
    const sentences = labelPassages(person.person_id, raw.text_body || '').filter(
      (span) => span.label === 'isnad' || /ثنا |نا |أخبرنا |حدثنا |عن .{2,40} عن /u.test(span.quote)
    );
    if (!flags.includes('has_isnad') && !sentences.length) continue;
    if (!sentences.length) continue;
    out.push({
      person_id: person.person_id,
      entry_number: person.entry.number,
      display_name: person.identity?.display_name || raw.display_name,
      items: sentences.slice(0, 8).map((span) => span.quote.slice(0, 280)),
    });
  }
  return out;
}

function selectHadith(corpus) {
  const out = [];
  for (const person of corpus.persons) {
    const hc = person.narration?.hadith_count;
    if (!hc || hc.count != null) continue;
    const parsed = parseHadithCount(hc);
    if (parsed?.count != null) continue;
    const raw = corpus.rawById.get(person.person_id);
    if (!raw) continue;
    out.push({
      person_id: person.person_id,
      entry_number: person.entry.number,
      value: hc.value,
      snippet: snippet(raw.text_body || '', 800),
    });
  }
  return out;
}

function lines(rows) {
  return rows.join('\n');
}

const PASSES = {
  repair: {
    name: 'repair',
    outPath: PATHS.llmRepair,
    promptFile: 'repair-evidence.v1.md',
    schemaFile: 'llm-repair.schema.json',
    maxTokens: 700,
    select: selectRepair,
    buildUser(target) {
      return lines([
        `Entry ${target.entry_number}`,
        'Facts needing a verbatim evidence span:',
        JSON.stringify(target.items.map(({ id, value, evidence }) => ({ id, value, evidence }))),
        '',
        'Entry text:',
        '---',
        target.text.slice(0, 7000),
        '---',
      ]);
    },
    validate(data) {
      if (!data || !Array.isArray(data.repairs)) return 'repairs must be an array';
      return null;
    },
    toRecord(data, target) {
      const byId = new Map((data.repairs || []).map((row) => [row.id, row]));
      return {
        repairs: target.items.map((item) => ({
          path: item.path,
          field: item.field,
          index: item.index,
          value: item.value,
          evidence: byId.has(item.id) ? byId.get(item.id).evidence ?? null : null,
        })),
      };
    },
  },

  kinds: {
    name: 'kinds',
    outPath: PATHS.llmKinds,
    promptFile: 'kind-assign.v1.md',
    schemaFile: 'llm-kind-assign.schema.json',
    maxTokens: 500,
    select: selectKinds,
    buildUser(target) {
      return lines([
        `Entry ${target.entry_number}`,
        JSON.stringify(target.items.map(({ id, field, value }) => ({ id, field, value }))),
        '',
        snippet(target.snippet, 900),
      ]);
    },
    validate(data) {
      if (!data || !Array.isArray(data.assignments)) return 'assignments must be an array';
      return null;
    },
    toRecord(data, target) {
      const byId = new Map((data.assignments || []).map((row) => [row.id, row]));
      return {
        assignments: target.items.map((item) => ({
          path: item.path,
          field: item.field,
          index: item.index,
          value: item.value,
          kind: byId.get(item.id)?.kind || item.kind || 'other',
        })),
      };
    },
  },

  spans: {
    name: 'spans',
    outPath: PATHS.llmSpans,
    promptFile: 'span-label.v1.md',
    schemaFile: 'llm-span-label.schema.json',
    maxTokens: 500,
    select: selectSpans,
    buildUser(target) {
      return lines([
        `Entry ${target.entry_number}`,
        JSON.stringify(target.items.map(({ i, quote }) => ({ i, quote }))),
      ]);
    },
    validate(data) {
      if (!data || !Array.isArray(data.labels)) return 'labels must be an array';
      return null;
    },
    toRecord(data, target) {
      const byI = new Map((data.labels || []).map((row) => [row.i, row.label]));
      return {
        labels: target.items.map((item) => ({
          start: item.start,
          end: item.end,
          quote: item.quote,
          label: byI.get(item.i) || 'unlabeled',
        })),
      };
    },
  },

  verdicts: {
    name: 'verdicts',
    outPath: PATHS.llmVerdicts,
    promptFile: 'verdicts.v1.md',
    schemaFile: 'llm-verdicts.schema.json',
    maxTokens: 500,
    select: selectVerdicts,
    buildUser(target) {
      return lines([
        `Entry ${target.entry_number}`,
        `Qism: ${target.qism ?? 'unknown'}`,
        '',
        target.snippet,
      ]);
    },
    validate(data) {
      if (!data || !Array.isArray(data.verdicts)) return 'verdicts must be an array';
      return null;
    },
    toRecord(data) {
      return {
        verdicts: (data.verdicts || [])
          .filter((row) => row && row.key && row.evidence)
          .map((row) => ({
            key: row.key,
            value: row.value,
            evidence: row.evidence,
          })),
      };
    },
  },

  isnad: {
    name: 'isnad',
    outPath: PATHS.llmIsnads,
    promptFile: 'isnad.v1.md',
    schemaFile: 'llm-isnad.schema.json',
    maxTokens: 600,
    select: selectIsnads,
    buildUser(target) {
      return lines([
        `Entry ${target.entry_number}`,
        `Subject: ${target.display_name}`,
        '',
        ...target.items.map((quote, i) => `[${i}] ${quote}`),
      ]);
    },
    validate(data) {
      if (!data || !Array.isArray(data.isnads)) return 'isnads must be an array';
      return null;
    },
    toRecord(data) {
      return {
        isnads: (data.isnads || [])
          .filter((row) => Array.isArray(row.names) && row.names.filter(Boolean).length >= 2)
          .map((row) => ({
            names: row.names.map((n) => String(n).trim()).filter(Boolean),
            subject_index: Number.isInteger(row.subject_index) ? row.subject_index : null,
            evidence: row.evidence || null,
          })),
      };
    },
  },

  hadith: {
    name: 'hadith',
    outPath: PATHS.llmHadith,
    promptFile: 'hadith-count.v1.md',
    schemaFile: 'llm-hadith.schema.json',
    maxTokens: 200,
    select: selectHadith,
    buildUser(target) {
      return lines([
        `Entry ${target.entry_number}`,
        `Phrase: ${target.value}`,
        '',
        target.snippet,
      ]);
    },
    validate(data) {
      if (!data || typeof data !== 'object') return 'expected object';
      if (data.count != null && !Number.isInteger(data.count)) return 'count must be int or null';
      return null;
    },
    toRecord(data, target) {
      return {
        value: target.value,
        count: data.count ?? null,
        uncertain: Boolean(data.uncertain),
        evidence: data.evidence ?? null,
      };
    },
  },
};

module.exports = {
  PASSES,
  SKIP_KINDS,
  walkFacts,
  selectRepair,
  selectKinds,
  selectSpans,
  selectVerdicts,
  selectIsnads,
  selectHadith,
};
