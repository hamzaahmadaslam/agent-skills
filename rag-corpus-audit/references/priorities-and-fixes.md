# Priorities and the fix list

Read this for steps 9 to 11 of the procedure. The priority levels are this skill's method, built on the evidence in
[evidence.md](evidence.md); adjust them with the owner when their risks differ.

## Priority levels

| Priority | Meaning | Findings that belong here |
| --- | --- | --- |
| P0: block indexing | must be fixed or excluded before the corpus is indexed or re-indexed | secrets; special-category personal data; personal data with no reason to be retrievable; hidden text or instructions aimed at a model; content that one audience must not see in a store shared with them |
| P1: wrong answers | the assistant will state something false | contradictions and expired or superseded claims on topics users ask about; gaps for frequent questions (models answer anyway); money, security, legal and safety facts that are stale anywhere |
| P2: weaker answers | the right text exists but is hard to retrieve or read | chunks that cannot stand alone; split tables and code; oversize chunks cut by the embedding model; duplicates and near-duplicates; boilerplate; vocabulary gaps; missing title or heading context |
| P3: upkeep | makes the next audit and future fixes possible | missing dates, owners and review-by dates; missing language or version metadata; tiny chunks; undated relative claims on rarely asked topics |

Missing source or chunk IDs move to P1 when the owner must be able to erase or correct content on request, and
missing access metadata moves to P0 in a store that serves more than one audience.

Within a level, order by reach, then effort:

1. Asks: the question-log count for the topic (a contradiction on the most asked question comes first).
2. Spread: how many chunks or documents share the problem (one pipeline change can fix hundreds of chunks).
3. Effort: a pipeline setting before a page-by-page rewrite, when both fix the same finding.

## The fix list

Each item names one change, where it is made, who makes it, how to check it, and how to undo it:

```text
F<n>  P<level>  <finding in one line>
      Evidence: <file:line or chunk ID, helper and count; question and asks; never a secret or personal value>
      Change:   <what to change> in <source document | extraction | chunking | metadata | index | access rules>
      Owner:    <content owner | pipeline engineer | security | privacy lead>
      Check:    <which helper to re-run and the expected result, or which question to ask the assistant>
      Undo:     <how to restore the previous state: the corpus snapshot and index version to go back to>
```

Typical changes by finding:

| Finding | Change |
| --- | --- |
| Secret | rotate it; remove it from the source; re-export; re-index; purge old vectors, caches and backups |
| Personal data | remove or mask in the source; or restrict with access metadata and a permission filter |
| Hidden text or instructions | strip comments, hidden elements and invisible characters at extraction; remove the text in the source; validate new uploads |
| Contradiction | correct the wrong passage after the owner names the source of truth; delete or filter the old version |
| Scope difference | state the scope in the text and in metadata (plan, region, version, dates) |
| Stale claim | update it with an "as of" date; remove expired offers; add review-by dates |
| Gap | write the missing content from the source of truth; or mark the topic out of scope in the assistant's instructions |
| Vocabulary gap | add the users' words to the page that answers the question |
| Chunk problems | fix in the chunker when many chunks share the problem; fix the text when a few do ([chunk-quality.md](chunk-quality.md#fixes-for-chunk-findings)) |
| Duplicates | keep one canonical chunk; remove or filter the rest; record supersession in metadata |
| Boilerplate | remove at extraction |
| Missing metadata | add fields in the source or the pipeline; copy them onto every chunk |

## Applying fixes safely

The audit itself changes nothing. When the owner applies the fix list:

1. Snapshot first: keep a copy of the corpus export and note the current index version, so every change can be
   undone by re-indexing the snapshot.
2. Fix P0 items before any re-index. A secret or personal value that is removed from the source but still in the
   index is still retrievable; delete its vectors too, and check caches and backups.
3. Change one thing at a time where the effect is uncertain (chunk size, the chunker, extraction rules), re-run the
   helpers, and compare the counts with the audit's numbers.
4. Re-run the question set against the fixed index and compare verdicts: the share of asks answered should rise and
   the conflicting and stale verdicts should fall.
5. Record in the report what changed, the new counts, and which items are still open.
