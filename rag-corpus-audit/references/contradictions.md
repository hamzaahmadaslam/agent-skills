# Contradictions between documents

Read this for step 7 of the procedure. Checked on 2026-09-26 against the linked sources.

## What counts

- Inter-context conflict is conflict among pieces of contextual knowledge, such as retrieved documents; its causes
  are misinformation and outdated information, where updated and outdated versions of a fact are retrieved together
  ([Xu et al. 2024, sections 1 and 3.1](https://arxiv.org/abs/2403.08319)).
- OWASP lists "data federation knowledge conflict errors", which occur "when data from multiple sources contradict
  each other", among the risks of vector and embedding stores
  ([OWASP LLM08:2025](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/)).
- Two statements can both be true in different scopes: about 16.5% of NQ-Open questions have answers that depend on
  when or where they are asked ([Zhang and Choi 2021](https://arxiv.org/abs/2109.06157)). A price for one region, a
  limit for one plan, a step for one product version are scope differences, not contradictions, as long as the text
  says which scope it covers.

## Why it matters

- Models adopt a wrong retrieved value over their own correct answer more than 60% of the time, and subtle
  deviations more often than blatant ones ([Wu et al. 2024](https://arxiv.org/abs/2404.10198)). A conflict between
  "$10" and "$12" is more dangerous than one between "$10" and "$10,000".
- With both supporting and conflicting evidence in context, models show confirmation bias toward what they already
  believe ([Xie et al. 2023](https://arxiv.org/abs/2305.13300)): which version wins can change from one question to
  the next.

## Where contradictions come from in a corpus

| Source | How it shows | Found by |
| --- | --- | --- |
| Old and new versions of a page both indexed | near-duplicates whose numbers differ | `near-duplicates.mjs` ("numbers differ") |
| A fact copied into several pages and changed in one | same sentence, different value | `conflict-candidates.mjs` |
| FAQ, marketing and support pages written at different times | same topic, different wording and value | `conflict-candidates.mjs`, `question-coverage.mjs` top passages |
| Deprecated feature pages next to their replacement | "deprecated", "replaced by" | `stale-claims.mjs` superseded markers |
| Region, plan or version differences without a stated scope | different values, no scope in the text | reading, with the owner |
| Translations updated at different times | same page in two languages, different values | reading; the helpers compare English only |

## Procedure

1. Collect candidates: every near-duplicate cluster with "numbers differ", every pair from
   `conflict-candidates.mjs`, every question whose top passages disagree (from the coverage step), and every page
   with a superseded marker.
2. For each candidate, read both passages in their documents and classify it:
   - **Contradiction**: same scope, different claim. One is wrong.
   - **Scope difference**: both true for different plans, regions, versions, dates or audiences, and the text does
     not say so.
   - **Not a conflict**: the helper matched unrelated sentences.
3. For contradictions, ask the owner which is right, name the source of truth (the pricing system, the policy, the
   release notes), and record it in the fix list. Do not decide from the documents' dates alone: the newer page can
   be the wrong one.
4. Prioritize by how often users ask about the topic (the question log) and by harm: money, security, legal and
   safety facts first.

## Fixes

- Contradiction: correct or delete the wrong passage in the source, then re-index. If an old version must stay (an
  archive, a legal record), keep it out of the index or behind a filter, and mark it with "replaces" and "is replaced
  by" ([metadata.md](metadata.md)).
- Scope difference: state the scope in the text itself ("On the Business plan, ..."; "From version 5, ...") so each
  chunk carries it (global scoping in [chunk-quality.md](chunk-quality.md)), and add the scope as metadata (plan,
  region, product version, valid dates) so the retriever can filter.
- A fact repeated in many pages: keep it in one page and link to it from the others, so the next change happens once.

## What the helper does and does not do

`scripts/conflict-candidates.mjs` pairs sentences from different documents whose content words overlap (Jaccard of at
least `--min-overlap`, default 0.5) and that differ in one of three ways: a quantity of the same kind (money in the
same currency, durations converted to one unit, sizes, percentages, counts of the same noun, years), a negation, or
an opposite word (required and optional, free and paid, enabled and disabled, always and never, among others). Table
rows are read with their header. It does not understand meaning: it misses conflicts worded differently ("two weeks"
against "fourteen days" is caught only when both use digits), and it pairs sentences that differ only in scope. A
person reads every pair.
