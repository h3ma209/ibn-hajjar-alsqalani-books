/**
 * Centralized companion record schema for al-Isabah extractions.
 * @see SCHEMA_SECTIONS for top-level keys on every entry.
 */

const SCHEMA_VERSION = '1.0.0';

const SCHEMA_SECTIONS = [
  'categorization_and_identity',
  'biographical_details',
  'physical_and_personal_traits',
  'hadith_criticism_and_evaluation',
  'status_as_top_narrator',
  'narrator_network',
  'defense_against_objections',
];

function pick(arr) {
  if (Array.isArray(arr)) return arr.filter(Boolean);
  if (arr == null || arr === '') return [];
  return [arr];
}

function buildNasab(parsed) {
  return {
    ism: parsed.ism || null,
    father: parsed.father || null,
    grandfather: parsed.grandfather || null,
    great_grandfather: parsed.great_grandfather || null,
    chain: pick(parsed.nasab),
    nisba: parsed.nisba || null,
    full_name: parsed.full_name || null,
    name_source: parsed.name_source || null,
  };
}

/**
 * Map raw bio + placement + crossRefs into polished schema.
 */
function buildCompanionRecord({
  person,
  parsed,
  bio = {},
  crossRefs = [],
  placement = {},
  ruling = {},
}) {
  const qism = placement.qism ?? ruling.ibn_hajar_grade ?? null;

  const categorization_and_identity = {
    ibn_hajar_category: qism,
    category_label: placement.qism_title || null,
    category_meaning: placement.qism_label || ruling.grade_meaning || null,
    section_type: placement.section_type || null,
    in_kunya_section: placement.section_type === 'kunya',
    in_women_section: placement.section_type === 'women',
    placement: {
      volume_toc: placement.volume || null,
      volume_print: person.volume || null,
      letter: placement.letter || null,
      bab: placement.bab || null,
      toc_path: pick(placement.toc_path),
      page_start: person.page_start ?? null,
      page_end: person.page_end ?? null,
    },
    names: {
      display: person.name,
      kunya: bio.kunya || null,
      kunya_reason: bio.kunya_reason || null,
      jahili_name: bio.jahili_name || null,
      islamic_name: bio.islamic_name || null,
      alternate_names: pick(bio.alternate_names),
      name_dispute_notes: pick(bio.name_dispute_notes),
    },
    nasab: buildNasab(parsed),
    summary: bio.summary || null,
  };

  const biographical_details = {
    timeline: pick([
      ...pick(bio.conversion_or_arrival),
      ...pick(bio.battles_and_travel),
    ]),
    conversion_and_arrival: pick(bio.conversion_or_arrival),
    companionship_with_prophet: pick(bio.companionship),
    governance_and_offices: pick(bio.offices),
    battles_and_travel: pick(bio.battles_and_travel),
    suffah: pick(bio.suffah),
    family: pick(bio.family),
    death: {
      notes: pick(bio.death?.notes),
      year_hints: pick(bio.death?.year_hints),
    },
    highlights: pick(bio.highlights),
  };

  const physical_and_personal_traits = {
    appearance: pick(bio.physical_description),
    demeanor: pick(bio.demeanor),
    devotion_and_worship: pick(bio.devotion_and_worship),
    poverty_and_lifestyle: pick(bio.poverty_and_lifestyle),
  };

  const hadith_criticism_and_evaluation = {
    objections: pick(bio.hadith_criticism?.objections),
    evaluations: pick(bio.hadith_criticism?.evaluations),
    ibn_hajar_notes: pick(bio.hadith_criticism?.ibn_hajar_notes),
    source_refs: pick(bio.source_refs),
  };

  const status_as_top_narrator = {
    is_prolific_narrator: Boolean(bio.hadith?.noted_as_prolific),
    estimated_hadith_count: bio.hadith?.estimated_count_text || null,
    students_count: bio.hadith?.students_count_text || null,
    virtues_and_praise: pick(bio.virtues_and_status),
    memory_and_preservation: pick(bio.memory_techniques),
    comparisons_with_others: pick(bio.narrator_comparisons),
  };

  const narrator_network = {
    narrated_from: pick(bio.hadith?.narrated_from),
    narrated_to: pick(bio.hadith?.narrated_to_notable),
    cross_references: pick(crossRefs),
  };

  const defense_against_objections = {
    objections_raised: pick(bio.defense?.objections),
    defenses_and_responses: pick(bio.defense?.responses),
    supporters: pick(bio.defense?.supporters),
  };

  return {
    schema_version: SCHEMA_VERSION,
    id: {
      number: person.number,
      shamela_start_id: person.start_id,
      shamela_end_id: person.end_id,
    },
    categorization_and_identity,
    biographical_details,
    physical_and_personal_traits,
    hadith_criticism_and_evaluation,
    status_as_top_narrator,
    narrator_network,
    defense_against_objections,
  };
}

module.exports = {
  SCHEMA_VERSION,
  SCHEMA_SECTIONS,
  buildCompanionRecord,
  buildNasab,
};
