# al-Isabah corpus (v3)

A reproducible JSONL + SQLite corpus extracted from Ibn Hajar al-Asqalani's **الإصابة في تمييز الصحابة**, the standard biographical dictionary of the Companions.

Schema version **3.0.0**. Output lives in `../data/v3/`. The v2 tree under `../data/v2/` is a frozen snapshot and is not overwritten by a normal pipeline run.

This is the third generation of the same project. v1 produced data that looked structured but could not be trusted. v2 fixed identification, kept the source text, and attached provenance to every fact. v3 classifies those facts and sentences so a reader can browse a biography as narrative, as cards, or as labeled original text.

## Lineage

| | v1 | v2 (frozen) | v3 (current) |
|---|---|---|---|
| Entries found | 9,730 | **11,931** | **11,931** (same IDs) |
| Schema | informal | 2.0.0 | **3.0.0** |
| Source text after extraction | discarded | preserved in full | preserved; **seeded** from v2 |
| Fact provenance | none | source, quote, confidence | same + **typed kinds / events / labels** |
| LLM biography pass | none | first pass (cached) | **11,406 / 11,931** on gpt-4o-mini |
| Sentence labels | none | none | **82,820** regex spans (~85% coverage) |
| Events | none | folded into life facts | **10,621** typed `eventFact` rows |
| Search catalog | none | JSONL scan | **SQLite FTS5** |
| Cross-book linking | claimed, did not exist | `person_id` namespaced | **page-map** for every entry; identity-links still empty |
| Tests | none | 77 | **~135** |

v2 remains the audit trail for ingest and the first LLM bio extract. `npm run seed` copies `raw-text`, `placement`, `chapters`, `manifest`, and `llm-facts` from v2 into v3 and **refuses to overwrite** files that already exist.

## Corpus contents

Generated from a Shamela `.bok` whose SHA-256 is recorded in `../data/v2/corpus/manifest.json` and copied into v3, so any run is verifiable against the same source.

- **11,931 biographies**, each with a unique `person_id`
- **1,545 women** (`identity.is_woman`)
- **30 chapters** of Ibn Hajar's own introduction and method
- **97.6% of pages** accounted for by an entry or a chapter
- **7.1M characters** of preserved Arabic entry text
- **14,496 citations** of authorities Ibn Hajar names
- **82,820 sentence labels** and **10,621 events**

By qism, Ibn Hajar's four-way division by how firmly companionship is established:

| Qism | Meaning | Entries |
|---|---|---|
| 1 | Companionship established by report or other evidence | 8,757 |
| 2 | Saw the Prophet, or born in his lifetime | 335 |
| 3 | Mukhadramun: lived through both eras, did not see him | 1,292 |
| 4 | Listed among the Companions **by error or scribal corruption** | 1,547 |

Qism 4 matters when reading this data: those 1,547 entries are largely Ibn Hajar arguing that the person does *not* belong among the Companions. A query that ignores `classification.qism` will treat his refutations as biographies.

Current fill (from `data/v3/reports/quality.json`), after the v2 LLM bio pass plus v3 classify:

| Field | Rate |
|---|---|
| Nasab parsed | 96.1% |
| Any life fact | 96.9% |
| LLM layer on the person | 95.6% |
| Companionship | 36.0% |
| Events | 45.0% |
| Battles | 13.2% |
| Death year | 4.5% |
| Labels on the person | 78.5% |

Evidence check on LLM quotes: **26,259 verified** in the entry text, 5,062 unverified, 47 absent.

## Quick start

```bash
cd code
npm install
npm run pipeline    # seed → build → graph → enrich → link → db → validate → gate
npm test
npm run ui          # http://127.0.0.1:4173
```

`pipeline` needs v2 ingest artifacts (or a fresh `npm run ingest` into v3) and writes under `../data/v3/`. Set `CORPUS_VERSION=v2` only to inspect the frozen tree. The deterministic steps (everything except `extract` / `extract-pass`) run in about a minute once JSONL is on disk; `db` packs SQLite for the UI.

## Pipeline

```
v2 ingest artifacts ──seed──▶  data/v3/corpus/raw-text.jsonl
                               placement.jsonl, chapters.jsonl, llm-facts.jsonl

.bok  ──ingest──▶              same files (only if you re-decode the book)

raw-text + llm-facts ──build──▶  persons.jsonl   schema 3.0.0 records
                                 index.jsonl     lightweight rows
                                 passage-labels  sentence labels
                                 events.jsonl
                                 quality.json

persons + raw-text ──graph──▶    edges.jsonl, citations.jsonl

persons ──enrich──▶              genealogy.jsonl, names.jsonl, facets.json

persons ──link──▶                page-map.jsonl
                                 identity-links.jsonl   (empty without --other)

all of the above ──db──▶         derived/corpus.sqlite   FTS5 catalog for the UI
```

Ingest is the only step that reads the `.bok`. v3 normally **seeds** those artifacts from v2 instead of decoding again. Everything after seed/ingest reads JSONL, so a classifier or prompt bug is re-runnable without the source book.

Optional model steps (money, resumable, checkpointed every 50 persons):

```
extract            leftover biography facts → llm-facts.jsonl  (v2 already did the bulk)
extract-pass       typed leftovers: repair / kinds / spans / verdicts / isnad / hadith
```

### Commands

| Command | What it does |
|---|---|
| `npm run seed` | Copy v2 ingest + llm-facts into `data/v3/` (no overwrite) |
| `npm run ingest` | Decode the `.bok` into preserved artifacts |
| `npm run build` | Assemble person records, labels, events, quality report |
| `npm run extract` | Run LLM biography extraction |
| `npm run extract-pass` | Narrow leftover LLM passes (see below) |
| `npm run graph` | Resolve cross-references into edges and citations |
| `npm run enrich` | Genealogy index, name forms, facets |
| `npm run link` | Page map; identity-links if `--other` is another `persons.jsonl` |
| `npm run db` | Pack JSONL into `data/v3/derived/corpus.sqlite` |
| `npm run validate` | Re-check every artifact against its schema |
| `npm run gate` | Fail if fill rates regressed against the baseline |
| `npm run stats` | Print the current quality report |
| `npm run samples` | Refresh the committed sample records |
| `node src/cli.js get 10680 --text` | One entry, optionally with its source text |
| `node src/cli.js search "أبو هريرة"` | Search by Arabic name, entry number, or a Latin alias |
| `npm run ui` | Local RTL browser at http://127.0.0.1:4173 |

## The data model

A v3 person record is still one printed entry. New required objects are `labels[]` and `features`, and `entry` now carries `kind`, `length_class`, `marker`, and `flags`.

`entry.kind` is one of `biography`, `crossref_stub`, `name_only`, `kunya_redirect`, `qism4_refutation`. Length class is `stub` / `short` / `medium` / `long`. Those are structural, not model guesses.

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

A fabricated supporting quote is detected mechanically and scored down. `reports/quality.json` counts how often it happens.

### Identity

`person_id` looks like `isabah:9767:10680-3881` — book slug, Shamela book id, printed entry number, and the page the entry starts on. IDs are stable across v2 and v3.

Neither half alone works as a key. Printed entry numbers repeat, and a table-of-contents `id` is a *page* number, with up to a dozen biographies sharing one page. Entries where the printed number is reused are flagged `entry.number_is_ambiguous`.

### Genealogy

`identity.nasab` is parsed by an explicit tokenizer. The chain is cut at the first sentence boundary, cross-reference clause, or biographical verb; then every segment must pass validation, and if any fails **the whole chain is rejected** in favour of the table-of-contents name, with `nasab_rejected_reason` recording why. Rejection rate is **3.95%**.

Trailing tribal attributions go in `nisba[]`. A kunya is only accepted from the same clause as the name.

### Classification, labels, events

`classification` still holds qism, letter, section, origin, generation, companionship status. v3 adds:

- `labels[]` — person-level flags (`has_isnad`, `muhajir`, `fought`, `qism4`, …)
- `features` — numeric coverage (`label_coverage`, `n_spans`, …)
- `life.events[]` — typed events with `kind` from `fact.schema.json` (`battle`, `hijra`, `wufd`, `manumission`, …)
- `passage-labels.jsonl` — one row per sentence: `start`, `end`, `label`, `quote`

Sentence labels are scored, not first-match-wins. Competing cues (نسب vs استشهاد vs وفاة vs غزو) share a sentence; the stronger, more specific pattern wins. Bare `بن`, bare `سنة`, and a lone `صلى الله عليه وسلم` do not become نسب / عمر / متن حديث.

Labels the UI understands: نسب، خلاف اسم، إسناد، متن حديث، استشهاد، إحالة، غزو، حادثة، وفاة، ولادة، عمر، ولاية، قرابة، توثيق، جرح، دفاع، كلام ابن حجر، شعر، قرآن، حاشية، عنوان.

### UI

`npm run ui` serves the SQLite catalog at http://127.0.0.1:4173.

- Browse and search (FTS5), letters, qism, authorities
- Person page: **سرد** (default) composes a readable biography from fields + labeled sentences; **بطاقات** shows the structured facts
- **النص الأصلي** has two views: **مفصول** (one sentence per block with a chip) and **متصل** (inline highlights, the previous design)
- الرواية والجرح، الاستشهادات، الروابط (resolved neighborhood)

سرد is composed, not Ibn Hajar's wording. The footer on that view says so.

## LLM extraction

Structural facts are complete without a model. The v2 biography pass already covered **11,406** entries (`gpt-4o-mini`). v3 `build` folds those facts in; `extract` only hits leftovers.

```bash
cp .env.example .env       # add OPENAI_API_KEY
npm run extract -- --dry-run                 # cost estimate, no requests
npm run extract -- --stratified 200          # pilot
npm run extract -- --resume                  # leftover bios
npm run extract-pass -- --kind kinds --dry-run
```

Any OpenAI-compatible endpoint works. Cache is content-addressed (model + prompt version + entry text). Progress is append-only. `--max-cost` is a hard stop. Checkpoints flush every 50 fetched persons.

`extract-pass` is for **narrow leftovers** after the bio pass: evidence repair, kind assignment, span labels, companionship verdicts, isnads, hadith counts. Those JSONL files exist in `data/v3/corpus/` where a pass was started. Remaining model spend on leftover passes was **not** completed; the UI re-labels sentences with the regex scorer so the reader is not stuck on stale or missing LLM spans.

Without an LLM, `build --no-llm` uses the regex layer only (`source: "regex"`, confidence 0.30). That is a floor.

## Cross-reference graph

`edges.jsonl` holds **5,547** relations. **1,196** resolve to a specific entry, **1,229** are flagged `ambiguous` with candidates listed, **3,122** stay unresolved. Unresolved is a reported outcome, never a silent drop. In-book resolution is 24%; narrator-name resolution is 18% — most transmitters are Successors with no entry here.

| Phrasing | Type | Resolvable |
|---|---|---|
| `يأتي في الّذي بعده` | `see_adjacent` | yes, exactly |
| `تقدم نسبه في ترجمة أبيه` | `see_relation` | yes, via the parsed lineage |
| `تقدم في الأسماء`, `يأتي في الكنى` | `see_section` | narrows to a section |
| `يأتي في القسم الأخير` | `see_qism` | narrows to a qism |
| `تقدم في الجيم` | `see_letter` | narrows to a letter block |
| `روى عنه ابن عمر` | `narrated_to` | by name match |

`citations.jsonl` holds 14,496 mentions of authorities, kept out of the person graph. The most-cited are Ibn Manda (1,697), Ibn Sa'd (1,123), and al-Bukhari (1,070).

`link` writes a **page-map** row for every person (print volume/page → `person_id`). `identity-links.jsonl` stays empty until you pass `--other` another book's `persons.jsonl`. `person_id` is already namespaced (`isabah:9767:...`) so a future Tahdhib corpus can join here.

## Quality gate

`reports/quality.json` records per-field fill rates, genealogy rejections, evidence verification, and LLM coverage. `npm run gate` compares against `reports-baseline/quality.json` and fails on any field losing more than two points. v2's last report is kept as `reports-baseline/quality.v2.json`.

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
  classify/    sentence labels, events, kinds
  extract/     LLM client, bio extract, regex fallback, merge
  graph/       cross-references, genealogy, identity stubs
  schema/      ajv validation
  report/      fill rates and the regression gate
  pipeline/    seed, ingest, build, extract, extract-pass, graph, enrich, link, db
  ui/          catalog (SQLite) + public RTL app
  cli.js
schema/        JSON Schema (draft 2020-12) for every artifact
prompts/       versioned extraction prompts
vocab/         battles, places, authorities, events, labels, …
tests/         unit + golden tests, including a stub LLM provider
samples/       committed example records
```

Pipeline output: `../data/v3/corpus/`, `../data/v3/reports/`, `../data/v3/derived/`. Read `samples/` for record shape without generating anything.

## Honest status

- **Done and verified:** entry identification (v2), text preservation, structural placement, genealogy parsing, schemas, quality gate, cross-reference resolution, LLM biography extract at corpus scale, v3 classify (kinds, regex spans, events), SQLite catalog, UI with سرد / بطاقات and two raw-text views.
- **Started, not finished:** `extract-pass` leftovers (kinds / repair JSONL exist; span-apply, verdicts, isnad, hadith were not run to completion). The UI does not wait on those files.
- **Stub only:** cross-book identity linking. Page-map is populated (11,931). `identity-links` is 0 until a second `persons.jsonl` is passed to `link`.
- **Known limitations:** 2.4% of pages belong to neither an entry nor a chapter. One entry carries a typo'd number in the print (`111936`) and is anchored by name. Family relations from the regex layer are still noisier than LLM ones. Sentence labels are keyword-scored, not a close reading — they will mis-tag mixed sentences. سرد is a composition from fields and those labels, not a substitute for النص الأصلي.

## Source

The Shamela `.bok` for al-Isabah, book id 9767, lives in `../data/source/isabah/`. Text is `windows-1256` and must be decoded before anything else touches it; lines are separated by bare carriage returns. The file's SHA-256 is in `data/v2/corpus/manifest.json` (and the seeded v3 copy).

Secrets (`.env`, API keys) stay in `code/` and must never be committed.
