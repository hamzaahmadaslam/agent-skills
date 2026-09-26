# Metadata for filtering and citations

Read this for step 2 (inventory) and when writing fixes. Checked on 2026-09-26 against the linked sources.

## Why each chunk needs metadata

- Access: OWASP recommends permission-aware vector stores with strict partitioning between groups of users, and
  tagging and classifying data in the knowledge base to control access levels
  ([OWASP LLM08:2025, mitigations 1 and 3](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/)).
  A filter can only use a field that exists on every chunk.
- Provenance: OWASP recommends tracking data origins and transformations and versioning datasets to detect
  manipulation ([OWASP LLM04:2025](https://genai.owasp.org/llmrisk/llm042025-data-and-model-poisoning/)); NIST suggests
  verifying that retrieval-augmented generation data is grounded (MS-2.5-005) and testing data flows from original
  sources through their transformations (MP-2.1-002) ([NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)).
- Citations: a citation points at a passage and its title ("Document [1](Title: ...)" in ALCE), and even strong models
  left half of their ELI5 answers without full citation support
  ([Gao et al. 2023](https://arxiv.org/abs/2305.14627)). Without a source and a stable ID per chunk, nobody can check
  an answer.
- Erasure: people can ask for their personal data to be erased (GDPR Article 17,
  [Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj)). Finding every chunk and vector that came
  from one document needs the source on every chunk.
- Freshness: dates turn staleness into a filter and a review schedule ([freshness.md](freshness.md)).

## A minimal field set

Names follow DCMI Metadata Terms where one exists
([DCMI Metadata Terms, 2020-01-20](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/)); the definitions
in quotes are DCMI's. Use whatever field names the pipeline already has, as long as the role is covered.

| Role | DCMI term | Definition | Why the audit checks it |
| --- | --- | --- | --- |
| Chunk ID | identifier | "An unambiguous reference to the resource within a given context." | update and delete one chunk; cite it; must be unique and stable across re-indexing |
| Source | source | "A related resource from which the described resource is derived." | citations, erasure requests, re-extraction |
| Title | title | "A name given to the resource." | context for the chunk ([chunk-quality.md](chunk-quality.md)), citations |
| Heading path | none | the headings above the chunk | context for the chunk |
| Modified | modified | "Date on which the resource was changed." | freshness filters and reviews |
| Created or issued | created, issued | "Date of creation of the resource." / "Date of formal issuance of the resource." | age of the claim |
| Valid until, review by | valid | "Date (often a range) of validity of a resource." | expiry of offers, policies and prices |
| Language | language | "A language of the resource."; DCMI recommends a BCP 47 tag | filters; choice of embedding model |
| Audience or access | audience, accessRights | "A class of agents for whom the resource is intended or useful." / "Information about who access the resource or an indication of its security status." | permission filters; tenants |
| Version or product | isVersionOf | "A related resource of which the described resource is a version, edition, or adaptation." | answers for the right version |
| Supersedes | replaces, isReplacedBy | "A related resource that is supplanted, displaced, or superseded by the described resource." and the inverse | keeping old versions out |
| License | license | "A legal document giving official permission to do something with the resource." | whether the text may be reused |
| Owner | none | the person or team who keeps it correct | who fixes findings |

- Dates: DCMI recommends ISO 8601 (for example 2026-09-26), and allows year and month or year alone when the full
  date is unknown ([DCMI Metadata Terms, "date"](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/)).
- Language tags: BCP 47 tags such as "en", "en-GB" or "ur-PK"
  ([RFC 5646](https://www.rfc-editor.org/rfc/rfc5646.html)).

## What the helper checks

`scripts/corpus-inventory.mjs` reads Markdown front matter, HTML `<title>`, `lang` and `<meta>` tags, and every field of
JSONL chunks (a nested "metadata" object is flattened), then reports per role how many files and chunks have it, which
field names filled it, duplicate and missing chunk IDs, language values that are not shaped like BCP 47 tags, and the
date range with undated, old and future-dated documents. It maps common field names to roles (for example `updated`,
`lastmod` and `last_modified` to modified); `scripts/corpus.mjs` lists them in `META_ROLES`.

Metadata in the source files is only half the answer: check that the pipeline copies it onto every chunk, by reading
a stored chunk or the pipeline code.

## Fixes

1. Add the fields the owner's use needs, in this order: source and chunk ID (without them nothing else can be fixed
   reliably), access for any corpus with more than one audience, modified date, title and heading path, then the
   rest.
2. Make chunk IDs stable: derive them from the source and position or a content hash, not from the order of a run.
3. Copy document metadata onto every chunk at indexing time, and filter on it in retrieval (access first).
4. Re-run `corpus-inventory.mjs` on the new export: every role in use should read "N/N".
