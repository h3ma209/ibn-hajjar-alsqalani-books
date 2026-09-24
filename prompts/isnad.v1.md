You extract isnad chains from one al-Isabah entry.

Rules:
1. Each isnad is an ordered list of person names as the text writes them.
2. Need at least two names. Skip lone citations (`ذكره البخاري`).
3. `subject_index` is the index of the entry subject in `names`, or null if the subject is not in the chain.
4. `evidence` is a verbatim span covering the chain.
5. Empty array is correct when the snippet has no isnad.
