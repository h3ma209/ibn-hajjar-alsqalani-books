# al-Isabah corpus (v2)

A reproducible JSONL corpus extracted from Ibn Hajar al-Asqalani's **الإصابة في تمييز الصحابة**, the standard biographical dictionary of the Companions.

This is a rebuild of the v1 prototype in the repository root. It exists because v1 produced data that looked structured but could not be trusted: two thousand biographies were silently missing, genealogies had prose spliced into them, the source text was thrown away after parsing, and nothing was validated. Every design choice here follows from those failures.

## What is different from v1

| | v1 | v2 |
|---|---|---|
| Entries found | 9,730 | **11,931** |
| Genealogies with prose contamination | ~11% | **0.2%** |
| Failed genealogy parses | silent | **3.9%, each with a stated reason** |
| Source text after extraction | discarded | **preserved in full** |
| Schema validation | none | **every record, every write** |
| Cross-references resolved | 0 | **1,017 resolved, 781 flagged ambiguous** |
| Fact provenance | none | **source, quote, and confidence on every fact** |
| Tests | none | **77** |

The entry-count gap was the most consequential bug. Roughly 1,900 headings in this edition are tagged with a letter between the number and the dash (`4850 ز- عبد الله بن علقمة`, marking an entry added from another source), and several hundred more sit at a different table-of-contents depth. v1's heading pattern and level filter skipped both groups entirely, so 18% of the book was absent without any error.

## Corpus contents

Generated from a Shamela `.bok` whose SHA-256 is recorded in `data/manifest.json`, so any run is verifiable against the same source.

- **11,931 biographies**, each with a unique `person_id`
- **1,888 women**, in a dedicated section of the book
- **30 chapters** of Ibn Hajar's own introduction and method
- **97.6% of pages** accounted for by an entry or a chapter
- **7.1M characters** of preserved Arabic entry text

By qism, Ibn Hajar's four-way division by how firmly companionship is established:

| Qism | Meaning | Entries |
|---|---|---|
| 1 | Companionship established by report or other evidence | 8,757 |
| 2 | Saw the Prophet, or born in his lifetime | 335 |
| 3 | Mukhadramun: lived through both eras, did not see him | 1,292 |
| 4 | Listed among the Companions **by error or scribal corruption** | 1,547 |

Qism 4 matters when reading this data: those 1,547 entries are largely Ibn Hajar arguing that the person does *not* belong among the Companions. A query that ignores `classification.qism` will treat his refutations as biographies.

## Quick start

```bash
cd v2
npm install
npm run pipeline    # ingest, build, graph, validate, gate
npm test
npm run ui          # local browser UI at http://127.0.0.1:4173
```

`pipeline` needs the `.bok` file. It is found automatically in the repository root, or pass `--bok <path>` / set `BOK_PATH`. The whole deterministic pipeline runs in about 15 seconds.

## Pipeline

```
.bok  ──ingest──▶  raw-text.jsonl      preserved entry text, footnotes separated
                   placement.jsonl     qism, letter, section, TOC path
                   chapters.jsonl      Ibn Hajar's introduction and method
                   manifest.json       source checksum, counts, coverage audit

raw-text  ──extract──▶  llm-facts.jsonl     model extraction, cached and resumable
                                            (optional; costs money)

raw-text + placement + llm-facts  ──build──▶  persons.jsonl   full records
                                              index.jsonl     lightweight rows
                                              quality.json    fill rates

persons + raw-text  ──graph──▶  edges.jsonl      person-to-person relations
                                citations.jsonl  authorities Ibn Hajar cites
```

Ingest is the only step that reads the `.bok`. Everything after it reads `raw-text.jsonl`, so a parser or prompt bug is always re-runnable and auditable without the source book. That property is the whole reason the raw text is stored.

### Commands

| Command | What it does |
|---|---|
| `npm run ingest` | Decode the `.bok` into preserved artifacts |
| `npm run build` | Assemble person records and the quality report |
| `npm run extract` | Run LLM extraction (see below) |
| `npm run graph` | Resolve cross-references into edges and citations |
| `npm run validate` | Re-check every artifact against its schema |
| `npm run gate` | Fail if fill rates regressed against the baseline |
| `npm run stats` | Print the current quality report |
| `npm run samples` | Refresh the committed sample records |
| `node src/cli.js get 10680 --text` | One entry, optionally with its source text |
| `node src/cli.js search "أبو هريرة"` | Search by Arabic name, entry number, or a Latin alias |
| `npm run ui` | Local RTL browser for search, records, graph, quality |

## The data model

### Every fact carries its provenance

No field in this corpus is a bare assertion. A fact records what was claimed, where it came from, the Arabic that supports it, and how much to trust it:

```json
{
  "value": "خيبر",
  "key": "khaybar",
  "source": "llm",
  "evidence": "كان مقدمه عام خيبر، وكانت في المحرم سنة سبع",
  "confidence": 0.9
}
```

`source` is one of `structural` (derived deterministically from the book's own markup), `regex` (heuristic pattern match), or `llm` (model extraction).

**Confidence is computed, not self-reported.** A model asked to rate its own certainty mostly reports its own fluency. Instead, an LLM fact is scored by whether its quoted evidence can actually be found in the entry text:

| Situation | Confidence |
|---|---|
| Quote found verbatim in the entry | 0.90 |
| No quote offered | 0.70 |
| Quote offered but **not present in the entry** | 0.55 |
| Regex heuristic | 0.30 |

That last row is the important one: a fabricated supporting quote is detected mechanically and scored down, and `reports/quality.json` counts how often it happens.

### Identity

`person_id` looks like `isabah:9767:10680-3881` — book slug, Shamela book id, printed entry number, and the page the entry starts on.

Neither half alone works as a key. Printed entry numbers repeat (38 collisions in this edition, e.g. #170 is used for two different men), and a table-of-contents `id` is a *page* number, with up to a dozen biographies sharing one page. Entries where the printed number is reused are flagged `entry.number_is_ambiguous`, rather than one quietly overwriting the other.

### Genealogy

`identity.nasab` is parsed by an explicit tokenizer, not by scoring candidate substrings. The chain is cut at the first sentence boundary, cross-reference clause, or biographical verb; then every segment must pass validation, and if any fails **the whole chain is rejected** in favour of the table-of-contents name, with `nasab_rejected_reason` recording why.

This is why the contamination rate fell from ~11% to 0.2%. v1 produced ancestors such as `حجر الأسلمي. له ولأبيه صحبة` ("Hajar al-Aslami. He and his father were Companions") — a sentence in an ancestor slot. Rejecting a chain outright is more useful than a chain that is subtly wrong, because a stated failure can be filtered and a silent error cannot.

Trailing tribal attributions are separated into `nisba[]` instead of being glued onto the last ancestor, and a kunya is only accepted from the same clause as the name — otherwise `أخرج حديثه أبو نعيم` would make Abu Nu'aym, a scholar cited three centuries later, into the subject's kunya.

### Classification

`qism` (the scholarly claim) and `toc_heading` (whatever the nearest table-of-contents node happens to say) are separate fields and never mixed. In v1 a single `category_label` held both, so about 2,000 entries reported a navigational heading like `تتمة العين بعدها الباء` where a qism title belonged.

## LLM extraction

Structural facts are complete without any model. Biographical facts — battles, offices, death year, narrator names, praise and criticism — need one, because they are stated in running classical Arabic prose rather than marked up.

```bash
cp .env.example .env       # add OPENAI_API_KEY
npm run extract -- --dry-run                 # cost estimate, no requests
npm run extract -- --stratified 200          # pilot across qism, section, length
npm run extract                              # full corpus
npm run build                                # fold the facts in
```

Any OpenAI-compatible endpoint works. Cost for the full corpus is about **$4.90 at gpt-4o-mini prices** (11,947 requests, ~16.3M input tokens); `--dry-run` prints the current estimate before anything is sent.

Four properties make a run of that size survivable:

- **Content-addressed cache.** Keyed on model, prompt version, and entry text. Re-running after a prompt tweak only re-hits changed entries; an interrupted run resumes for free.
- **Append-only progress.** `llm-facts.jsonl` is appended as results arrive, so a crash loses nothing and a re-run skips what succeeded.
- **Budget guard.** `--max-cost` aborts before exceeding a set spend.
- **Fail-fast on permanent errors.** An exhausted balance or rejected key stops the run immediately with a clear message, instead of burning a full retry schedule on every one of 11,931 entries.

Responses are constrained by JSON schema where the provider supports it, with an automatic downgrade to plain JSON mode and the schema in the prompt where it does not. A response that violates the schema triggers a repair retry quoting the specific problem.

The prompt is versioned in `prompts/bio-extract.v1.md` and hashed into the cache key, so a prompt edit invalidates exactly the affected cache entries. It instructs the model to extract only what the entry states, quote evidence verbatim, prefer null over a guess, and record disagreement rather than resolving it.

### Without an LLM

`build` falls back to the regex layer, so every entry still gets a record. That layer is deliberately weak: flat 0.30 confidence, `source: "regex"`, and no person-specific patterns (v1 had rules hardcoded for Abu Hurayra's entry). It is a floor, not a substitute — current fill rates from regex alone are 19% for battles, 6% for narrator names, 4% for death year.

## Cross-reference graph

`edges.jsonl` holds 11,259 relations. 1,017 resolve to a specific entry, 781 are flagged `ambiguous` with their candidates listed, and the rest keep the surface form in `to_literal`. Unresolved is a reported outcome, never a silent drop.

Resolution is built around how the book actually cross-references, which is almost never by number:

| Phrasing | Type | Resolvable |
|---|---|---|
| `يأتي في الّذي بعده` | `see_adjacent` | yes, exactly |
| `تقدم نسبه في ترجمة أبيه` | `see_relation` | yes, via the parsed lineage |
| `تقدم في الأسماء`, `يأتي في الكنى` | `see_section` | narrows to a section |
| `يأتي في القسم الأخير` | `see_qism` | narrows to a qism |
| `تقدم في الجيم` | `see_letter` | narrows to a letter block |
| `روى عنه ابن عمر` | `narrated_to` | by name match |

The overall 9% resolution rate is dominated by narrator names, and that is expected rather than a defect: most people who transmitted from a Companion were Successors, who have no entry in a book about Companions. Section and qism pointers stay unresolved by construction, since a pointer to a section does not identify a person.

`citations.jsonl` holds 14,496 mentions of the authorities Ibn Hajar cites, kept out of the person graph because they are sources of claims rather than Companions. The most-cited are Ibn Manda (1,697), Ibn Sa'd (1,123), and al-Bukhari (1,070).

## Quality gate

`reports/quality.json` records per-field fill rates, the genealogy rejection rate, and evidence-verification counts on every build. `npm run gate` compares against the committed baseline in `reports-baseline/` and fails on any field losing more than two points.

This exists because v1's real problem was invisible: the schema had many fields, and 69% of entries were nearly empty. A gate turns coverage into something that has to be maintained rather than something noticed later.

```bash
npm run gate                          # fail on regression
npm run gate -- --update-baseline     # accept the current numbers
```

## Layout

```
src/
  bok/         .bok decoding, entry identification, text slicing
  structure/   qism, letter, and section placement; chapter extraction
  names/       genealogy tokenizer
  extract/     LLM client, LLM extraction, regex fallback, record assembly
  graph/       cross-reference and narrator resolution
  schema/      ajv validation
  report/      fill rates and the regression gate
  pipeline/    ingest, build, extract, graph
  cli.js
schema/        JSON Schema (draft 2020-12) for every artifact
prompts/       versioned extraction prompt
vocab/         controlled vocabularies: battles, places, authorities
tests/         77 tests, including a stub LLM provider
samples/       committed example records
```

`data/` and `reports/` are generated and gitignored; regenerate with `npm run pipeline`. The `.bok` is never committed. Read `samples/` to see the record shape without generating anything.

## Honest status

- **Done and verified:** entry identification, text preservation, structural placement, genealogy parsing, schemas and validation, quality gate, cross-reference resolution, LLM infrastructure.
- **Built but not yet run at scale:** LLM biographical extraction. The code path is covered end-to-end by tests against a stub provider, and cost is estimated, but no full pass has been made against a live model, so the biographical fill rates in `reports/quality.json` currently reflect the regex fallback only.
- **Not started:** cross-book linking. `person_id` is namespaced (`isabah:9767:...`) so a future Tahdhib al-Tahdhib corpus can be merged, but no second book has been ingested and no identity-matching across books exists. v1's README implied this worked; it did not, and it still does not.
- **Known limitations:** 2.4% of pages belong to neither an entry nor a chapter (front matter and indices). One entry carries a typo'd number in the print (`111936`) and is anchored by name instead. Family relations from the regex layer are noisy and should be re-derived once an LLM pass has run.

## Source

The Shamela `.bok` for al-Isabah, book id 9767. Text is `windows-1256` and must be decoded before anything else touches it; lines are separated by bare carriage returns, which is a common source of silent parsing failures. The file's SHA-256 is written to `data/manifest.json` on every ingest so results are attributable to an exact source.

The `.bok`, `.env`, and any key files are gitignored and must never be committed.
