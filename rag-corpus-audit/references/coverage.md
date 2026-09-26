# Coverage against real questions

Read this for step 8 of the procedure. Checked on 2026-09-26 against the linked sources.

## Why real questions

- When no retrieved document held the answer, the models in RGB declined to answer at most 45% of the time in
  English; the rest of the time they answered from documents that did not contain the answer
  ([Chen et al. 2023, negative rejection results](https://arxiv.org/abs/2309.01431)). A gap in the corpus shows up
  as a confident wrong answer, not as "I don't know".
- The questions have to come from users (site search logs, support tickets, chat transcripts, sales emails), not
  from the documents: a question list written from the corpus only finds what the corpus already covers.

## Build the question set

1. Export questions from the sources the owner names, with how often each was asked. Remove personal data before the
   file leaves its system (names, emails, order numbers, account details): the GDPR asks for data "limited to what
   is necessary" for the purpose ([Regulation (EU) 2016/679, Article 5(1)(c)](https://eur-lex.europa.eu/eli/reg/2016/679/oj)).
   Run `sensitive-scan.mjs` on the exported file too.
2. Merge repeats and near-repeats; keep the count. The helper merges questions that differ only in case, spacing and
   final punctuation.
3. Keep the long tail: sort by count, take the most frequent questions and a random sample of the rest, and write
   down the sampling in the report.
4. Drop questions the assistant should not answer at all (out of scope); note them, since they belong to the
   assistant's instructions, not the corpus.

## Judge each question

For each question, look at the passages a retriever returns and give one verdict:

| Verdict | Meaning | Goes to |
| --- | --- | --- |
| Answered | a passage states the full answer and it is current | nothing |
| Partly | the answer is incomplete or needs a second passage that does not come up | fix list: extend or merge |
| Not in corpus | no passage holds the answer | fix list: write it, or mark out of scope |
| Conflicting | passages disagree | [contradictions.md](contradictions.md) |
| Stale | the passage was true once | [freshness.md](freshness.md) |

Use more than one retriever when you judge. BEIR's evaluation pools were built mostly from lexical retrievers, so
passages found only by dense retrievers were often never judged and counted as wrong: in TREC-COVID, 6.4% of BM25's
top 10 had not been judged against 31.8% for the dense TAS-B model, and judging those holes raised ANCE's nDCG@10
from 0.654 to 0.735 ([Thakur et al. 2021, section 6](https://arxiv.org/abs/2104.08663)). Declare a gap only after the
production retriever (or a dense retriever) and the lexical pass both fail to find the answer, and after a keyword
search for the answer itself.

Metrics, when the owner wants numbers beyond the verdict counts:

- Coverage: the share of asks (weighted by count) whose verdict is Answered, and the share Answered or Partly.
- Retrieval quality on judged questions: BEIR reports nDCG@10, with Recall@100 alongside, to compare across tasks
  ([Thakur et al. 2021, sections 3.3 and 5](https://arxiv.org/abs/2104.08663)).
- Answer checks after the fix: RAGAS measures faithfulness (answer claims supported by the context), answer relevance
  and context relevance without reference answers ([Es et al. 2023, section 3](https://arxiv.org/abs/2309.15217)).
  These score the whole system, not the corpus alone.

## Vocabulary gaps

- Lexical retrieval such as BM25 can only find documents that contain the query's words (the "lexical gap"), yet
  BM25 remained a strong baseline for zero-shot retrieval across the BEIR tasks
  ([Thakur et al. 2021, section 1](https://arxiv.org/abs/2104.08663)).
- Dense retrievers match related wording that BM25 misses, such as "body of water" to "sea"
  ([Karpukhin et al. 2020, section 5.3 and appendix](https://arxiv.org/abs/2004.04906)).
- Adding likely query words to documents helps lexical retrieval: docT5query, which expands each document with
  generated queries, beat BM25 on 11 of the 18 BEIR datasets ([Thakur et al. 2021, section 5](https://arxiv.org/abs/2104.08663)).
- So the words users use that the corpus never uses ("cancel" when the pages say "end your plan", "Android" when
  they say "phones") are findings on their own: add the users' words to the right page, even when a dense retriever
  would find it.

## What the helper does

`scripts/question-coverage.mjs` indexes every chunk with BM25 (k1 = 1.2, b = 0.75; Robertson and Zaragoza give
0.5 < b < 0.8 and 1.2 < k1 < 2 as reasonable in many circumstances,
[2009, section 3.5](https://www.staff.city.ac.uk/~sbrp622/papers/foundations_bm25_review.pdf)), with the document
title added to each chunk as DPR did ([Karpukhin et al. 2020, section 4.1](https://arxiv.org/abs/2004.04906)). For
each question it lists the top passages, the question words each passage contains, and the question words missing
from the whole corpus. Groups:

| Group | Rule | Next step |
| --- | --- | --- |
| No shared words | no chunk contains any question word | likely a gap: confirm with the production retriever |
| Weak match | the best passages contain less than 60% of the question words | read; likely a gap or a vocabulary mismatch |
| Candidates | a passage contains most question words | read; the words can match without answering (the Linux question in the example matches a page about working offline) |

English stop words and plural endings are handled; other languages need their own pass. The JSON output has an empty
`verdict` for every question for the reader to fill in.
