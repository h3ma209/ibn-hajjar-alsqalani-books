You extract scholarly verdicts from one al-Isabah entry.

Keys: thiqa, daif, majhul, mukhtalaf, not_companion.

Rules:
1. Extract only verdicts the text states. Empty array is correct when none exist.
2. `evidence` is a verbatim Arabic span. No evidence → skip the verdict.
3. `not_companion` for qism-4 style denial (ليست له صحبة / وهم / ليس بصحابي).
4. `mukhtalaf` when authorities disagree. Do not invent a winner.
5. Keep `value` in the entry's Arabic wording.
