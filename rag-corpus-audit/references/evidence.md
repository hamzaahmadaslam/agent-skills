# What research says about corpus problems

Checked on 2026-09-26 against the linked papers and pages. Use these facts for the "why it matters" part of a
finding. The studies measured particular models and datasets: treat their numbers as evidence of the direction and
size of an effect, not as a forecast for your system.

## The model answers from what the index holds

- The original RAG model retrieved from 21 million disjoint 100-word chunks of a December 2018 Wikipedia dump
  ([Lewis et al. 2020, section 3](https://arxiv.org/abs/2005.11401)).
- Swapping the index changed the answers. For 82 world leaders who changed between 2016 and 2018, RAG answered "Who
  is {position}?" correctly 70% of the time with the 2016 index for 2016 leaders and 68% with the 2018 index for
  2018 leaders, but only 12% and 4% with the mismatched index
  ([Lewis et al. 2020, section 4.5, "Index hot-swapping"](https://arxiv.org/abs/2005.11401)). An outdated corpus
  gives outdated answers, and correcting the corpus corrects them without retraining.
- The authors describe the retrieval memory as human-readable and human-writable: the model's knowledge can be
  updated by editing the document index ([Lewis et al. 2020, section 5](https://arxiv.org/abs/2005.11401)).

## Wrong or conflicting text in the corpus gets repeated

- Across six models and 1,294 questions, models adopted incorrect retrieved content over their own correct prior
  answer more than 60% of the time; the further the wrong value was from the truth, the less often it was adopted
  ([Wu et al. 2024](https://arxiv.org/abs/2404.10198)). A plausible wrong number (a price, a limit, a dose) is the
  dangerous kind.
- In the RGB benchmark, models given documents with factual errors rarely detected or corrected them, and "often
  trust false information that is retrieved" even when they knew the answer
  ([Chen et al. 2023, counterfactual robustness results](https://arxiv.org/abs/2309.01431)).
- Models accept conflicting evidence when it is coherent and convincing, and show confirmation bias when the
  evidence mixes supporting and conflicting facts ([Xie et al. 2023](https://arxiv.org/abs/2305.13300)).
- Retrieved documents conflict with each other through misinformation, or because updated and outdated versions of
  the same fact are retrieved together ([Xu et al. 2024, section 3.1](https://arxiv.org/abs/2403.08319)).

## Gaps produce confident answers, not refusals

- When none of the retrieved documents held the answer, the best rejection rate in RGB was 45% in English and 43.33%
  in Chinese: most of the time the models answered anyway
  ([Chen et al. 2023, negative rejection results](https://arxiv.org/abs/2309.01431)).
- RGB's "noisy documents" are relevant to the question but hold no answer, such as reports about the 2021 prize for a
  question about 2022 ([Chen et al. 2023, introduction](https://arxiv.org/abs/2309.01431)). An old version of a page
  is this kind of noise.

## Repetition and irrelevant text crowd the context

- Adding irrelevant sentences to arithmetic word problems "dramatically" lowered accuracy; no more than 18% of the
  problems the models could solve were solved consistently across all types of added text
  ([Shi et al. 2023, section 1](https://arxiv.org/abs/2302.00093)).
- RAGAS scores context relevance: retrieved context should hold as little irrelevant information as possible, and
  the score penalizes redundant information ([Es et al. 2023, section 3](https://arxiv.org/abs/2309.15217)).
- In the top 10 passages retrieved for news queries, Carbonell and Goldstein found significant repetition, often
  duplicate or near-duplicate sentences; their MMR ranking reduces it at query time
  ([Carbonell and Goldstein 1998, section 4](https://www.cs.cmu.edu/~jgc/publication/The_Use_MMR_Diversity_Based_LTMIR_1998.pdf)).

## Chunks that cannot stand alone retrieve worse

- Indexing by propositions (units written to be self-contained, with references such as "the tower" resolved)
  raised Recall@20 over passages by 10.1 points on average for unsupervised dense retrievers and 2.7 points for
  supervised ones ([Chen et al. 2023, section 1](https://arxiv.org/abs/2312.06648)).
- About 30% of sampled Wikipedia sentences could be understood out of context without edits; over 60% needed edits
  such as replacing a pronoun and could be fixed that way ([Choi et al. 2021, section 4](https://arxiv.org/abs/2102.05169)).
- Decontextualized sentences used as retrieval units came close to the recall of 100-word windows at about a tenth
  of the compute cost ([Choi et al. 2021, section 6.2](https://arxiv.org/abs/2102.05169)).

## The corpus is an attack surface

- Injecting five crafted texts per target question into a knowledge database of millions of texts made the model
  give the attacker's answer 90% of the time ([Zou et al. 2024, abstract](https://arxiv.org/abs/2402.07867)); on NQ
  it was 97% with 2,681,468 clean texts in the database ([Zou et al. 2024, section 1](https://arxiv.org/abs/2402.07867)).
- Instructions placed in data that is likely to be retrieved can take over an LLM-integrated application (indirect
  prompt injection); the authors hid such prompts in HTML comments
  ([Greshake et al. 2023](https://arxiv.org/abs/2302.12173)).
- OWASP describes an attacker modifying a document in a repository used by a RAG application so that its
  instructions alter the output ([OWASP LLM01:2025, scenario 4](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)).
- One invisible character, homoglyph, reordering or deletion can significantly reduce the performance of NLP
  models, three can break most of them, and the same tricks prevent proper search-engine indexing
  ([Boucher et al. 2021](https://arxiv.org/abs/2106.09898)).

## Vectors carry the text too

- An iterative method recovered 92% of 32-token inputs exactly from their embeddings, and recovered full names from
  clinical notes ([Morris et al. 2023](https://arxiv.org/abs/2310.06816)). Deleting a document's text but keeping its
  vectors does not remove the data.
- OWASP lists embedding inversion among vector and embedding weaknesses
  ([OWASP LLM08:2025](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/)).

## Citations need something to point at

- On ELI5, even the best models tested lacked complete citation support 50% of the time; ALCE gives each passage to
  the model as "Document [n](Title: ...)" ([Gao et al. 2023, abstract and section 4](https://arxiv.org/abs/2305.14627)).
- NIST suggests reviewing and verifying sources and citations in generative AI outputs (MS-2.5-003) and verifying
  that retrieval-augmented generation data is grounded (MS-2.5-005)
  ([NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)).
