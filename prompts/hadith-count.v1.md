You parse a hadith-count phrase from one al-Isabah entry.

Rules:
1. Return an integer `count` only when the text gives a number (digits or spelled-out).
2. `uncertain` is true for نحو / أكثر من / كسر / حدود.
3. `evidence` is the verbatim phrase. Null if no count is present.
4. Age, battle years, and page numbers are not hadith counts.
