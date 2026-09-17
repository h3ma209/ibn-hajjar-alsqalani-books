'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  extractTextRefs,
  buildResolver,
  refsToEdges,
  extractCitations,
} = require('../src/graph/crossrefs');

function firstRef(text) {
  return extractTextRefs(text)[0];
}

test('section pointers are typed, including the names section', () => {
  assert.deepEqual(
    { kind: firstRef('تقدم في الأسماء.').kind, section: firstRef('تقدم في الأسماء.').section },
    { kind: 'see_section', section: 'names' }
  );
  assert.equal(firstRef('يأتي في الكنى.').section, 'kunya');
  assert.equal(firstRef('يأتي في النساء.').section, 'women');
});

test('qism pointers accept bare ordinals and "the last qism"', () => {
  assert.equal(firstRef('تقدم في القسم الأول.').qism, 1);
  assert.equal(firstRef('تقدم في الأول.').qism, 1);
  assert.equal(firstRef('يأتي في الثالث.').qism, 3);
  assert.equal(firstRef('يأتي في القسم الأخير.').qism, 4);
});

test('letter pointers work with or without the word حرف', () => {
  assert.equal(firstRef('تقدم في حرف الجيم.').letter, 'حرف الجيم');
  assert.equal(firstRef('تقدم في الجيم.').letter, 'حرف الجيم');
  assert.equal(firstRef('تقدم في الحاء المهملة.').letter, 'حرف الحاء');
});

test('relational and adjacent pointers are distinguished', () => {
  const relation = firstRef('تقدم نسبه في ترجمة أبيه.');
  assert.equal(relation.kind, 'see_relation');
  assert.equal(relation.relation, 'father');

  const next = firstRef('يأتي في الّذي بعده.');
  assert.equal(next.kind, 'see_adjacent');
  assert.equal(next.offset, 1);

  const prev = firstRef('تقدم في الّذي قبله.');
  assert.equal(prev.offset, -1);
});

test('reference direction follows the pointing verb', () => {
  assert.equal(firstRef('يأتي في الكنى.').direction, 'forward');
  assert.equal(firstRef('تقدم في الأسماء.').direction, 'backward');
});

test('a pointer to the entry itself is not a reference', () => {
  assert.deepEqual(extractTextRefs('تقدم في ترجمته.'), []);
});

const indexRows = [
  {
    person_id: 'isabah:9767:1-10',
    entry_number: 1,
    display_name_norm: 'اول',
    full_name_norm: 'اول بن فلان',
    section_type: 'names',
    letter: 'حرف الألف',
    qism: 1,
  },
  {
    person_id: 'isabah:9767:2-10',
    entry_number: 2,
    display_name_norm: 'الخطاب',
    full_name_norm: 'الخطاب بن نفيل',
    section_type: 'names',
    letter: 'حرف الألف',
    qism: 1,
  },
  {
    person_id: 'isabah:9767:3-11',
    entry_number: 3,
    display_name_norm: 'ثالث',
    full_name_norm: 'ثالث',
    section_type: 'kunya',
    letter: 'حرف الباء',
    qism: 2,
  },
];

test('adjacent pointers resolve exactly, using document order', () => {
  const resolver = buildResolver(indexRows);
  const person = { person_id: 'isabah:9767:2-10', identity: { nasab: {} } };
  const [edge] = refsToEdges(person, extractTextRefs('يأتي في الّذي بعده.'), resolver);
  assert.equal(edge.resolved, true);
  assert.equal(edge.to_person_id, 'isabah:9767:3-11');
});

test('a father pointer resolves through the parsed lineage', () => {
  const resolver = buildResolver(indexRows);
  const person = {
    person_id: 'isabah:9767:1-10',
    identity: { nasab: { father: 'الخطاب' } },
  };
  const [edge] = refsToEdges(person, extractTextRefs('تقدم نسبه في ترجمة أبيه.'), resolver);
  assert.equal(edge.type, 'see_relation');
  assert.equal(edge.relation, 'father');
  assert.equal(edge.to_person_id, 'isabah:9767:2-10');
});

test('a section pointer stays unresolved but keeps a usable typed target', () => {
  const resolver = buildResolver(indexRows);
  const person = { person_id: 'isabah:9767:1-10', identity: { nasab: {} } };
  const [edge] = refsToEdges(person, extractTextRefs('يأتي في الكنى.'), resolver);
  assert.equal(edge.resolved, false);
  assert.equal(edge.target_section, 'kunya');
  assert.ok(edge.to_literal, 'an unresolved target must retain its literal');
});

test('a repeated entry number resolves to ambiguous rather than picking one', () => {
  const resolver = buildResolver([
    ...indexRows,
    {
      person_id: 'isabah:9767:1-99',
      entry_number: 1,
      display_name_norm: 'مكرر',
      full_name_norm: 'مكرر',
      section_type: 'names',
      letter: 'حرف الألف',
      qism: 1,
    },
  ]);
  const result = resolver.resolveNumber(1);
  assert.equal(result.resolved, false);
  assert.equal(result.ambiguous, true);
  assert.equal(result.candidates.length, 2);
});

test('cited authorities are captured with the verb that invoked them', () => {
  const citations = extractCitations(
    'isabah:9767:1-10',
    'ذكره ابن مندة، وأخرج البخاري حديثه، وقال ابن عبد البر: له صحبة.'
  );
  const keys = citations.map((c) => c.authority_key);
  assert.ok(keys.includes('ibn_manda'));
  assert.ok(keys.includes('al_bukhari'));
  assert.ok(keys.includes('ibn_abd_al_barr'));
  assert.ok(citations.every((c) => c.person_id === 'isabah:9767:1-10'));
});
