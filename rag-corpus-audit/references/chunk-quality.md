# Chunk quality

Read this for step 4 of the procedure. Checked on 2026-09-26 against the linked sources. Audit the chunks the
retriever will see: export them from the pipeline (JSONL) when you can, because the helpers' own splitting only
imitates common chunkers.

## A chunk has to make sense on its own

- Dense X Retrieval defines its retrieval unit, the proposition, as atomic, self-contained text that includes "all
  the necessary context from the text (e.g. coreference) to interpret its meaning"
  ([Chen et al. 2023, section 2](https://arxiv.org/abs/2312.06648)). Sentences as units fall short because they are
  often not self-contained, for example "the tower" standing for the Leaning Tower of Pisa
  ([section 1](https://arxiv.org/abs/2312.06648)).
- Decontextualization rewrites a sentence so it can be understood out of context while keeping its meaning
  ([Choi et al. 2021, abstract](https://arxiv.org/abs/2102.05169)). The edits it needs, from a manual analysis of 200
  examples ([Table 1, section 3.2](https://arxiv.org/abs/2102.05169)):

  | Edit | What it fixes | Share of examples |
  | --- | --- | --- |
  | Pronoun or noun phrase swap | "It", "the copper statue" replaced by the name | 40.5% |
  | Bridging | a missing modifier added to a noun ("in the Ultimate Fighting Championship") | 13% |
  | Name completion | acronyms and partial names expanded | 11.5% |
  | Addition | helpful background added | 10% |
  | Global scoping | a phrase that scopes the whole sentence ("at the 2018 Cannes Film Festival") | 7% |
  | Discourse marker removal | "For instance," and similar openings | 3.5% |

- Annotators and the model both tended to miss generic phrases that needed a name, phrases that needed bridging, and
  missing time context ([Choi et al. 2021, section 5.2.2](https://arxiv.org/abs/2102.05169)). A chunk that says
  "currently" needs its date as much as a chunk that says "it" needs its subject.

`scripts/chunk-lint.mjs` flags the patterns behind these edits: chunks (other than a document's first) that open with a
pronoun, demonstrative or discourse marker; references outside the chunk ("as shown above", "the following steps",
"repeat step 2"); chunks that end on a colon; chunks that start partway through a numbered list (at item 2 or later);
and chunks cut in the middle of a sentence. They are candidates. Read them, or give them to chunk-standalone (below).

## The subject belongs in every chunk

- Dense Passage Retrieval prepended the Wikipedia article title to every 100-word passage, with a separator token
  ([Karpukhin et al. 2020, section 4.1](https://arxiv.org/abs/2004.04906)); the decontextualization retrieval
  experiment did the same ([Choi et al. 2021, section 6.2](https://arxiv.org/abs/2102.05169)).
- `chunk-lint.mjs` reports how many chunks contain no word of their document's title. If the pipeline adds the title
  or heading path to each chunk before embedding, that number does not matter; if it does not, those chunks cannot
  match a question that names the subject. Check the pipeline code or a stored chunk, not the source file.

## Size

- The original RAG and DPR indexes used disjoint 100-word passages; DPR found overlapping passages no better in its
  setup ([Karpukhin et al. 2020, section 4.1](https://arxiv.org/abs/2004.04906);
  [Lewis et al. 2020, section 3](https://arxiv.org/abs/2005.11401)). No source gives one size for every corpus, so
  the audit looks for outliers instead of a target.
- Too large: set `--max-tokens` to the embedding model's input limit from its model card, and find out what the
  pipeline does with longer input (some pipelines cut it, some reject it). Everything past the cut is not searchable.
- Too small: heading-only chunks and fragments under `--min-tokens` hold no answer and still take a retrieval slot.

## Tables

- A GitHub Flavored Markdown table is a header row, a delimiter row of hyphens, and zero or more data rows; the header
  must have as many cells as the delimiter row or there is no table, and the table ends at the first empty line or
  the start of another block ([GFM spec 0.29-gfm, section 4.10](https://github.github.com/gfm/#tables-extension-)).
- A chunk holding data rows without the header row has lost its column names ("| Pro | $12 |" means nothing on its
  own). A chunk that ends right after the header row has lost its rows. `chunk-lint.mjs` flags both.
- DPR's preprocessing removed tables, infoboxes and lists before chunking
  ([Karpukhin et al. 2020, section 4.1](https://arxiv.org/abs/2004.04906)). Check that your extraction kept the
  tables you need: search the export for a value you know is in a table.
- Answers found in tables were more often time-dependent in SituatedQA's analysis of Natural Questions
  ([Zhang and Choi 2021, section 3.4](https://arxiv.org/abs/2109.06157)), so tables also get a freshness check.

## Code

- In CommonMark, a fenced code block closes only at a fence of the same character with at least as many backticks or
  tildes; if none comes, the block runs to the end of the document
  ([CommonMark 0.31.2, section 4.5](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)). A chunk cut inside a
  code block renders the rest as code, and the next chunk starts with code and no language or context.
- `chunk-lint.mjs` carries the fence state from one chunk to the next in the same document and flags chunks that end
  inside a code block, start inside one, or are the middle of one.

## Boilerplate

Menus, footers, cookie notices and contact blocks repeated on every page are covered in
[duplicates.md](duplicates.md#boilerplate).

## Optional: chunk-standalone

[chunk-standalone](https://github.com/hamzaahmadaslam/chunk-standalone) (MIT, by the same author) judges whether each
chunk can be understood without the text before it, whether it points outside itself, and whether it should be kept,
merged with a neighbour or split. It asks TypeSafe's Jev model narrow yes/no and multiple-choice questions, decides in
code with a `--threshold` (default 0.8), and puts unclear chunks in a review list
([README](https://github.com/hamzaahmadaslam/chunk-standalone#readme)). It reads Markdown, text and JSONL (the same
`text`, `page_content`, `content` and `source` fields as these helpers).

It is optional: the audit does not need it. When the owner wants it:

- It sends chunk text, and the start and end of neighbouring chunks, to `api.typesafe.ai` with the owner's
  `TYPESAFE_API_KEY`; `--dry-run` sends nothing and prints the requests and a token estimate
  ([README, "What leaves your machine"](https://github.com/hamzaahmadaslam/chunk-standalone#what-leaves-your-machine)).
- Run `sensitive-scan.mjs` first and leave out every chunk with a secret or personal data finding, then get the
  owner's approval for sending the rest.
- Treat its "fix" verdicts as suggestions and read its review list, as its README says.

## Fixes for chunk findings

These are the usual options; pick per finding and write the choice in the fix list.

| Finding | Fix in the source | Fix in the pipeline |
| --- | --- | --- |
| Opening points back, outside reference | Name the subject; replace "as shown above" with the fact | Merge with the previous chunk; add title and heading path to each chunk |
| No title word in the chunk | Name the product or topic in the section's first sentence | Prepend the title and heading path at indexing time |
| Heading-only or tiny chunk | Give the heading a sentence of content | Merge headings into the following chunk |
| Too large | Split the section by subtopic | Lower the chunk size; split at headings first |
| Table without header or rows | Keep tables short; one table per section | Keep a table in one chunk, or repeat the header row in each piece |
| Code block split | Keep examples short | Never cut inside a fence; treat a code block as one unit |
| Ends on a colon, cut sentence, mid-list | Keep the lead-in sentence with its list | Split at block boundaries, not at a token count |
