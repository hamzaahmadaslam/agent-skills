# Duplicates, near-duplicates and boilerplate

Read this for step 5 of the procedure. Checked on 2026-09-26 against the linked sources.

## Why repeated text matters for retrieval

- A retriever returns the top k chunks. Copies of one passage rank together and fill several of those slots with the
  same text; Carbonell and Goldstein found significant repetition in the top 10 passages for news queries
  ([1998, section 4](https://www.cs.cmu.edu/~jgc/publication/The_Use_MMR_Diversity_Based_LTMIR_1998.pdf)).
- Two versions of one page that differ in a number are worse than copies: the model can receive both and pick either
  ([evidence.md](evidence.md#wrong-or-conflicting-text-in-the-corpus-gets-repeated)).
- How common it is: web-scraped training sets held 3.04% (C4) to 13.63% (RealNews) near-duplicate examples, against
  0.39% in the curated Wiki-40B; most duplicates were automatically generated pages, and many news near-duplicates
  were one article on several sites with different formatting
  ([Lee et al. 2021, section 5](https://arxiv.org/abs/2107.06499)). One 61-word English sentence appeared over
  60,000 times in C4 ([abstract](https://arxiv.org/abs/2107.06499)).

## Definitions

- A w-shingle is a run of w consecutive words; a document is reduced to its set of shingles
  ([Broder 1997, section 2](https://www.cs.princeton.edu/courses/archive/spring13/cos598C/broder97resemblance.pdf)).
- Resemblance r(A, B) is the size of the intersection of the two shingle sets divided by the size of their union
  (the Jaccard coefficient); containment c(A, B) is the intersection divided by the size of A's set, and equals 1 when
  A is a contiguous part of B ([Broder 1997, section 2](https://www.cs.princeton.edu/courses/archive/spring13/cos598C/broder97resemblance.pdf)).
- For web pages, 4-word shingles are "a typical value", and two pages count as near-duplicates when the Jaccard
  coefficient passes a preset threshold, for example 0.9; identical pages are removed first with a fingerprint, and
  near-duplicates are grouped into clusters with union-find
  ([Manning, Raghavan and Schütze 2008, section 19.6](https://nlp.stanford.edu/IR-book/html/htmledition/near-duplicates-and-shingling-1.html)).
- The same section suggests leaving common HTML tags and integers out of shingles, because they occur everywhere
  and say nothing about duplication ([section 19.6](https://nlp.stanford.edu/IR-book/html/htmledition/near-duplicates-and-shingling-1.html)).

## At scale: MinHash

- MinHash estimates the Jaccard coefficient from small signatures instead of comparing whole shingle sets
  ([Broder 1997](https://www.cs.princeton.edu/courses/archive/spring13/cos598C/broder97resemblance.pdf);
  [Manning et al. 2008, section 19.6](https://nlp.stanford.edu/IR-book/html/htmledition/near-duplicates-and-shingling-1.html),
  which uses 200 random permutations).
- Lee et al. used space-separated 5-grams, a signature of 9,000 hashes (20 per band, 450 bands), then checked the
  real Jaccard coefficient (at least 0.8) and the edit similarity (above 0.8) of every candidate pair
  ([Lee et al. 2021, section 4.2 and appendix](https://arxiv.org/abs/2107.06499)).
- `scripts/near-duplicates.mjs` counts shared shingles exactly (a sorted list of shingle hashes) instead of
  estimating them. That fits corpora up to a few hundred thousand chunks on a laptop; above that, use a MinHash-based
  deduplication tool with the parameters above.

## What the helper does

| Section | Method | Default |
| --- | --- | --- |
| Exact duplicates | same text after lower-casing and collapsing spaces | always |
| Near-duplicates | Jaccard of word shingles at or above `--threshold`, clustered with union-find | 4-word shingles, 0.7 |
| Numbers differ | texts equal after CCNet normalization (digits to 0, punctuation and accents removed), listed with their numbers | always |
| Contained excerpts | containment of the shorter chunk at or above `--containment` | 0.9 |
| Boilerplate | lines of 30 characters or more found in `--boilerplate-docs` documents or more | 3 documents |
| Common shingles | shingles in more than `--max-df` chunks are not paired; they point to templated text | 200 chunks |

Why 0.7 and not 0.9 or 0.8: chunks are short. One changed word breaks up to w shingles, so in a 60-word chunk with
4-word shingles two changed words leave 49 of 57 shingles shared, a Jaccard coefficient of 49/65, about 0.75; with
5-word shingles it drops to about 0.70. The published thresholds were set for whole web pages and documents. The
helper prints each cluster's Jaccard range, so raise `--threshold` when clusters look unrelated.

Limits: matching is by words, so paraphrases and translations are not found, and a page that was reworded is not a
near-duplicate even when it says the same thing. `conflict-candidates.mjs` catches reworded pages that disagree.

## Boilerplate

- CCNet removed paragraphs duplicated across the pages of a web snapshot, which made up 70% of the text; the step
  removed boilerplate "such as navigation menus, cookie warnings and contact information". Paragraphs were compared
  after lower-casing, replacing numbers with a placeholder and removing punctuation and accents
  ([Wenzek et al. 2019, section 3.2](https://arxiv.org/abs/1911.00359)). The helper normalizes lines the same way.
- English boilerplate such as cookie warnings on pages in other languages made language identification worse until
  it was removed ([Wenzek et al. 2019, section 4.1](https://arxiv.org/abs/1911.00359)).
- Remove boilerplate at extraction (the HTML-to-text step), not by editing every page.

## Deciding what to keep

For each cluster, name one canonical chunk and write the reason in the fix list:

1. The copy from the source of truth (the page the owner maintains, not a mirror or an export).
2. Otherwise the newest by its modified date (the helper prints dates when the metadata has them).
3. Otherwise the most complete one (the longer chunk in a containment pair).

Then remove the others from the corpus, or keep them out of the index with a filter, and record the old version's
relation in metadata ("replaces" and "is replaced by", [metadata.md](metadata.md)). When members differ in numbers,
treat the cluster as a contradiction first ([contradictions.md](contradictions.md)): deleting the wrong copy is the
fix only after the owner confirms which number is right.
