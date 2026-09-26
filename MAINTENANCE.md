# Maintenance

The skills describe tools, platforms and defaults that change: coding-standard releases, hosting documentation,
WordPress and WooCommerce versions. This file says how they are kept correct.

## Quarterly review

Every skill is reviewed once a quarter, in the first week of January, April, July and October. A review of one
skill:

1. Open `SKILL.md` and note `metadata.last_verified` and `metadata.version`.
2. Open every source URL in the skill's `references/` files and check that the fact beside it still holds. Where a
   page shows a "Last updated" date later than `last_verified`, read the whole page again, not only the fact.
3. Check the release pages of every tool the skill names for versions newer than the ones in `references/`, and
   read their release notes for renamed checks, changed defaults and new requirements.
4. Fix what changed: the fact, its source URL, and the step in `SKILL.md` that depends on it. If a source moved,
   link the new page after reading it; never keep a fact whose source is gone.
5. Run the skill's helper scripts on their example input, where the skill has one, and check the output still
   matches what `SKILL.md` describes. The helpers are read-only.
6. Bump the metadata (next section) and describe the changes in the commit message.

If a skill cannot be fully re-checked in a quarter, leave `last_verified` as it is. A date that is old but honest is
better than a date on facts nobody checked.

## Bumping `last_verified` and `version`

`metadata.last_verified` is the date (`YYYY-MM-DD`, in quotes) on which every fact in that skill's `references/`
was checked against its source. Change it only after a full review of that skill, never for a partial fix such as
one repaired link.

`metadata.version` follows semantic versioning:

| Change                                                                     | Bump  |
| -------------------------------------------------------------------------- | ----- |
| A corrected fact, a moved source URL, wording                              | patch |
| A new check, reference file or helper script; a newer tool version covered | minor |
| A changed procedure, report format or safety rule                          | major |

A full review with no changes still updates `last_verified` and leaves `version` alone.

## What to re-verify per skill

Each skill's `references/` files list their sources inline; those are the pages to re-open. The facts that go stale
first:

| Skill                             | Re-check first                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wp-vip-code-review`              | VIP Coding Standards releases, minimum versions and both `ruleset.xml` files (types and severities); the VIP documentation pages on PHPCS, the Code Analysis Bot, caching, files, queries, cron and redirects |
| `wp-multisite-migration`          | WP-CLI command options, multisite table layout, domain mapping behaviour                                                                                                                                      |
| `woo-hpos-live-migration`         | WooCommerce HPOS settings, sync behaviour and CLI commands in the current WooCommerce release                                                                                                                 |
| `woo-checkout-performance-audit`  | WooCommerce session, cart fragment and Action Scheduler defaults                                                                                                                                              |
| `wp-cwv-field-triage`             | Core Web Vitals thresholds, CrUX API and INP attribution fields                                                                                                                                               |
| `wp-slow-query-investigation`     | MySQL and MariaDB `EXPLAIN` output, Query Monitor panels, WordPress core indexes                                                                                                                              |
| `wp-cron-action-scheduler-health` | WP-Cron constants, Action Scheduler tables and WP-CLI commands                                                                                                                                                |
| `wp-autoload-audit`               | Autoload values and thresholds in the current WordPress release                                                                                                                                               |
| `agent-tool-call-audit`           | The MCP specification's tool annotations and the transcript formats covered                                                                                                                                   |
| `rag-corpus-audit`                | The chunking and retrieval guidance cited in its references                                                                                                                                                   |

## The link check

`.github/workflows/links.yml` runs [lychee](https://github.com/lycheeverse/lychee) through
[lychee-action](https://github.com/lycheeverse/lychee-action):

- **When:** at 06:00 UTC on the first day of every month, on every pull request, and on demand (Actions tab,
  "Links" workflow, "Run workflow").
- **What:** every Markdown file in the repository. It requests each external URL and checks that each relative link
  points to a file that exists. Links inside code blocks are skipped, so example commands and placeholder URLs are
  not checked.
- **Pass or fail:** a link passes on a 2xx status, or on 429 (rate limited), after up to three retries ten seconds
  apart. Any other status, a timeout or a missing file fails the run, and the job summary lists each broken link
  with the file it is in.
- **Secrets:** none. The workflow has read-only permission to the repository contents, and the action uses the
  workflow's built-in token only for requests to GitHub.
- **Pinned versions:** `actions/checkout@v7` and `lycheeverse/lychee-action@v2` (major versions). Move to a new
  major version only after reading its release notes.

When the check fails:

1. Open the failed run and read the job summary.
2. For each broken link, find where the page went (the vendor's own search or sitemap), read the new page, and
   confirm the fact the link supports. Update the URL, and the fact too if it changed.
3. If the fact no longer holds and no source supports it, remove it from the skill and adjust `SKILL.md`.
4. A host that blocks automated requests but works in a browser can be excluded with a narrow regular expression in
   a `.lycheeignore` file at the repository root. Keep that list short and review it every quarter.

## The script check

`.github/workflows/scripts.yml` checks the helper scripts in every skill's `scripts/` folder:

- **When:** on every pull request, on every push to `main`, and on demand (Actions tab, "Scripts" workflow, "Run
  workflow").
- **What:** `node --check` on each `.mjs` file with Node.js 20 (the oldest version the helpers support), `bash -n`
  and `shellcheck -S warning` on each `.sh` file, and `php -l` on each `.php` file. None of them runs a helper. It
  also runs `tool-call-table.mjs` on `agent-tool-call-audit/examples/repo-session.jsonl` and compares the output
  with `examples/repo-session-table.txt`, which `references/severity-and-report.md` presents as that output.
- **Pass or fail:** any syntax error, ShellCheck warning or difference in the example output fails the run.
- **Secrets:** none. The workflow has read-only permission to the repository contents.
- **Pinned versions:** `actions/checkout@v7` and `actions/setup-node@v7` (major versions). PHP and ShellCheck are the
  ones on the `ubuntu-latest` runner image.

When a script change alters the example output on purpose, regenerate `examples/repo-session-table.txt` with the
command in `references/severity-and-report.md`, and check that the worked example report there still matches it, in
the same commit.

## Adding a skill

1. Create `<name>/SKILL.md`. The folder name and the `name` field match: lowercase letters, digits and single
   hyphens, no hyphen at the start or end, 64 characters at most
   ([specification](https://agentskills.io/specification)).
2. Front matter: `name`, a `description` that says what the skill does and when to use it (1,024 characters at
   most), `license: MIT`, `compatibility` for the tools and versions the skill needs (500 characters at most), and
   `metadata` with `author`, `version` and `last_verified`.
3. Keep `SKILL.md` under 500 lines. Detailed, sourced facts go in `references/`, one topic per file, each fact with
   its source URL beside it. Primary sources only: vendor documentation, source code, release notes, specifications.
4. Helper scripts go in `scripts/`, are read-only, and say so in a comment at the top.
5. Add the skill to the table in [README.md](README.md) and to the table above.
