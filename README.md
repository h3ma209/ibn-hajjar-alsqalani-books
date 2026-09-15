# sahihh-tree-db

A structured biographical database for Islamic hadith scholarship — turning classical Arabic reference works into searchable, machine-readable JSON.

## About

Classical rijāl and ṣaḥāba works (Ibn Ḥajar, al-Bukhārī, Ibn Saʿd, al-Dhahabī, etc.) hold the identity, reliability, and relationships of thousands of narrators. Today that knowledge lives in scanned PDFs and Shamela databases: rich text, but hard to query, link, or build on.

**sahihh-tree-db** extracts that text into a consistent schema — names, nasab, Ibn Ḥajar's categories, biographical facts, hadith criticism, and narrator networks — so you can search persons, export full records, and eventually connect them across books into one graph.

### Current scope

The first source is **al-Isābah fī Tamyīz al-Ṣaḥābah** by Ibn Ḥajar al-ʿAsqalānī (~9,730 companions), parsed from a Shamela `.bok` file. Each entry is split into seven sections (identity, biography, traits, criticism, narrator status, network, defenses) instead of dumping raw Arabic prose.

### Planned direction

- **Tahdhib al-Tahdhib** — narrators beyond the ṣaḥāba (tabiʿīn, scholars, grades)
- **Cross-book entity linking** — one person ID across Isābah, Tahdhib, Tabaqāt, etc.
- **Isnād / narrator tree** — who narrated from whom, built on structured `narrator_network` fields

### What this is not

- Not a PDF OCR project — source text comes from clean Shamela Jet databases
- Not a full translation or tafsīr of the books — structured extraction only
- Not limited to ṣaḥāba long-term — Isābah is phase one

## Setup

```bash
npm install
```

Place the Shamela book file in this folder:

```
الإصابة في تمييز الصحابة.bok
```

## Commands

```bash
# Search by Arabic or Latin name
node extract-persons.js search "abu huraira"
node extract-persons.js search "أنس بن مالك"

# Full entry by number
node extract-persons.js get 10680 --out abu-huraira.json

# Export all companions (large ~33MB)
node extract-persons.js export --all --out all-persons.json

# Light index only (no bio parsing)
node extract-persons.js export --all --index-only --out persons-index.json

# Book structure (chapters, qism labels, coverage)
node extract-persons.js structure --out book-structure.json

# Person index
node extract-persons.js list --out persons-index.json
```

### npm shortcuts

```bash
npm run search -- "عبد الله بن عمر"
npm run get -- 4852 --out abdullah-ibn-umar.json
npm run abu-huraira
npm run structure
```

## Output shape

Each person is one JSON object with these sections:

| Section | Contents |
|---|---|
| `categorization_and_identity` | Ibn Ḥajar qism, TOC placement, names, nasab |
| `biographical_details` | Timeline, companionship, offices, family, death |
| `physical_and_personal_traits` | Appearance, devotion, lifestyle |
| `hadith_criticism_and_evaluation` | Objections, evaluations, Ibn Ḥajar notes |
| `status_as_top_narrator` | Prolific flag, hadith counts, praise |
| `narrator_network` | Narrated from / to, cross-references |
| `defense_against_objections` | Objections and responses |

Wrapper files also include `source`, `schema.version`, and (for single lookups) `layers` with book-wide context.

## Example exports

| File | Entry |
|---|---|
| `abu-huraira.json` | #10680 |
| `anas-bin-malik.json` | #277 |
| `abdullah-ibn-umar.json` | #4852 |
| `all-persons.json` | All 9,730 companions |

## Project files

| File | Role |
|---|---|
| `extract-persons.js` | CLI: search, get, list, export |
| `bio-extract.js` | Regex bio parsing from entry text |
| `companion-schema.js` | Maps parsed data → JSON schema |
| `book-structure.js` | TOC placement, chapters, cross-refs |

## Notes

- **Latin search** works for common names (`abu huraira`, `umar`, `ali`). Full phrases like `abdullah ibn umar` may need Arabic.
- **Imam Mālik** and other tabiʿīn are not in this book — it covers ṣaḥāba only.
- **Next planned source:** Tahdhib al-Tahdhib (narrators beyond companions).

## Requirements

- Node.js 18+
- Windows-1256 Arabic text from Shamela `.bok` (via `mdb-reader`)
