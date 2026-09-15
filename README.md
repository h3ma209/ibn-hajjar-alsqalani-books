# sahihh-tree-db

Structured JSON extraction from **al-Isābah fī Tamyīz al-Ṣaḥābah** (Ibn Ḥajar) Shamela `.bok` database.

Source: ~9,730 companion entries. No raw biography text in exports — structured fields only.

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
