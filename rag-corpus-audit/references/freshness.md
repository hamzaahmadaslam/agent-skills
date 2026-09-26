# Stale and time-sensitive claims

Read this for step 6 of the procedure. Checked on 2026-09-26 against the linked sources.

## Why it matters

- A RAG model answers from the index it is given: with an index two years out of date it answered 4% to 12% of
  "who holds this office" questions correctly, against 68% to 70% with a matching index
  ([Lewis et al. 2020, section 4.5](https://arxiv.org/abs/2005.11401)).
- Roughly 16.5% of the questions in NQ-Open have answers that depend on when or where they are asked; questions whose
  answers change over time were at least 10% of every dataset SituatedQA examined
  ([Zhang and Choi 2021, abstract and section 3.4](https://arxiv.org/abs/2109.06157)).
- Among those questions, many answers had held for about a year before they changed
  ([Zhang and Choi 2021, section 3.4](https://arxiv.org/abs/2109.06157)). A corpus reviewed once a year is behind for
  a share of its time-dependent facts.
- A document that states "currently" or "the latest" without a date is a claim a reader cannot check; decontextualizing
  a sentence often means adding its time context ([Choi et al. 2021, section 5.2.2](https://arxiv.org/abs/2102.05169)).

## Sort claims by how fast they change

FreshQA groups questions by how often the answer changes
([Vu et al. 2023, figure 1 and section 2](https://arxiv.org/abs/2310.03214)). Use the same groups for claims in the
corpus, because they decide how often a document needs review:

| Group (FreshQA) | Meaning | Corpus examples | Review |
| --- | --- | --- | --- |
| Never-changing | the answer almost never changes | what a term means, how a protocol works | when the product changes |
| Slow-changing | changes over several years | supported platforms, company facts, legal terms | yearly, and on each release |
| Fast-changing | changes within a year or less | prices, offers, versions, limits, staff, dates of events | every release or quarter |
| False-premise | the question assumes something untrue | a feature that was removed, a plan that no longer exists | answer it explicitly in the corpus |

All the models FreshQA tested struggled with fast-changing and false-premise questions
([Vu et al. 2023, section 3](https://arxiv.org/abs/2310.03214)). A corpus can help with false premises by saying
plainly what no longer exists ("The Starter plan was retired on 2025-06-30").

## What the helper finds

`scripts/stale-claims.mjs` measures every date against `--as-of` (default today) and `--max-age-days` (default 365):

| Kind | Pattern | Why it is flagged |
| --- | --- | --- |
| Future claim whose date has passed | "will", "planned", "coming", "expected to" with a past date | the plan either happened or not; the text is wrong both ways |
| Deadline or offer whose date has passed | "until", "valid through", "expires", "ends" followed by a past date | an expired offer or rule still reads as current |
| Old anchored claim | "as of", "currently", "the latest" with a date older than the maximum age | the claim was true on that date |
| Relative time with no date | "currently", "recently", "this year", "now supports" without a date, in an old or undated document | no one can tell when it was true |
| Price or version | currency amounts and version numbers in an old or undated document | fast-changing values |
| Superseded marker | "deprecated", "no longer supported", "replaced by", "legacy" | the page may describe old behaviour, or it may be the notice itself |
| Document dates | no date, older than the maximum age, or later than the as-of date | review scheduling; a future date is a typo or an embargoed page |

It reads dates in ISO form (2025-08-31), "March 3, 2025", "3 March 2025", "March 2025", "Q3 2025", "H1 2025", numeric
dates (an ambiguous day and month count as the wider period), and a year after words such as "in", "since", "until"
or "as of". A document's own date comes from its metadata (modified-type fields first, then created-type fields) or
from a "Last updated: <date>" line. The patterns are English.

## Dates in metadata

- DCMI Metadata Terms define "modified" (date on which the resource was changed), "created", "issued" (date of formal
  issuance) and "valid" (date, often a range, of validity), and recommend ISO 8601 dates; a year and month or a year
  alone is allowed when the full date is unknown
  ([DCMI Metadata Terms](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/)).
- A "valid" or review-by date per document turns freshness from an audit finding into a filter the retriever can
  apply. See [metadata.md](metadata.md).

## Personal data goes stale too

Under the GDPR, personal data must be "accurate and, where necessary, kept up to date", and inaccurate personal data
must be erased or rectified without delay (Article 5(1)(d)); it must also be kept no longer than necessary (Article
5(1)(e)) ([Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj)). Staff directories, customer
case notes and contact pages in a corpus fall under this: see [sensitive-data.md](sensitive-data.md).

## Fixes

1. Check each flagged claim against the source of truth (the pricing system, the release notes, the owner) and
   write what is true today, with an "as of" date where the value changes.
2. Remove expired offers and deadlines, or state that they ended.
3. For superseded pages, keep one current page, and mark or remove the old one
   ([duplicates.md](duplicates.md#deciding-what-to-keep)).
4. Add a modified date to every document and a review-by or valid-until date to fast-changing ones, then re-run the
   helper with the same `--as-of` to confirm the counts fell.
