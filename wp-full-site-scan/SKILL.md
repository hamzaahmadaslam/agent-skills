---
name: wp-full-site-scan
description: "Scan a hacked or suspected-hacked WordPress site end to end, from a full file backup and a full database dump, then clean it, put it back online and close the way in. Checks WordPress core and every wordpress.org plugin and theme against their official checksums before any pattern search, scans PHP, JavaScript and the database for injected code, backdoor administrators, forged sessions, malicious cron jobs and self-healing payloads, builds a dated timeline to find the entry point, cleans files and database together on copies, restores with a tested import and a rollback, and reports what was proved apart from what was inferred. Covers redirects, SEO spam shown only to search engines, hidden administrators, web shells, database injections, modified core files, nulled software, vulnerable plugins, checkout skimmers, spam mail, phishing kits and malware that keeps coming back. Use when a site redirects visitors, shows a Google warning, has unknown admins, sends spam or keeps getting reinfected."
license: MIT
compatibility: "Needs the site's complete files (a backup archive, or SSH or SFTP access to copy them) and a complete database dump, a shell with Node.js 20 or later for the helpers, curl to download official checksum files, and a MySQL or MariaDB server that can run as a throwaway copy on another port. WP-CLI and PHP are used where available. Written against WordPress 7.1.2 and WP-CLI 2.12.0."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.0"
  last_verified: "2026-09-28"
---

# Full site scan and recovery for a hacked WordPress site

This skill scans a WordPress site that has been hacked, or might have been, and takes it through to a clean site back
online with the way in closed. It works on copies: the file archive and the database dump are extracted into a
separate workspace, the database is loaded into a throwaway server, and nothing on the live site changes until the
restore step, which the owner approves. The site's own code is never run.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
are sourced in `references/`, next to each fact: developer.wordpress.org (WP-CLI commands, the advanced administration
handbook, the code reference), the wordpress.org checksum APIs, Google Search Central, and the MySQL, MariaDB, PHP,
Apache and nginx documentation.

## When to use

- Visitors are redirected to other sites, all the time or only on mobile, only from a search result, or only once.
- Google shows "This site may be hacked", a browser shows "Deceptive site ahead", or Search Console reports a security
  issue.
- Search results show pages or languages the site never published (Japanese keyword or pharma spam).
- Administrators appear that nobody created, or an account keeps coming back after it is deleted.
- The host suspended the account for malware, or the site sends spam email.
- A WooCommerce checkout behaves differently, or card data may have been taken.
- The site was cleaned before and the malware returned.

Not the right tool for a site that is slow but not compromised (the collection's `wp-slow-query-investigation` and
`wp-autoload-audit` skills), for general hardening of a healthy site, or for a card-data breach investigation, which
belongs to the payment processor's incident process and a qualified forensic investigator.

## What you need

1. **The complete file set**: a full backup archive (`.tar`, `.tar.gz`, `.zip`, `.wpress` or a host export) of the
   whole document root, hidden files included, or SSH or SFTP access to copy it.
2. **A complete database dump**: a `.sql` or `.sql.gz` export of every table, with data.
3. The owner's confirmation that they own or administer the site, and their approval for each step that changes it.

Ask for both inputs before scanning. With only one, scan it, and say in every conclusion which half was not checked:
a clean file scan does not make a clean site, and neither does a clean database.

## Safety rules

1. **Never run the site's code.** Read files as text. Never load the backup in a web server, open a suspect PHP file
   over HTTP, or point a running WordPress at the dump. On a live site, run WP-CLI read commands with the global
   parameters `--skip-plugins --skip-themes`, and remember that must-use plugins still load.
2. **Never edit the originals.** Everything happens on copies in the workspace (`references/01-workspace.md`).
3. **Quarantine, do not delete.** Move removed files into a quarantine folder outside the site tree, with their paths
   preserved. They are evidence, and the way back from a mistake.
4. **Checksums before patterns.** An official checksum gives a yes or no answer. A pattern match is a lead, and most
   leads are innocent: read the matched code before calling it malware.
5. **Clean files and database together.** Payloads in one rebuild the other. Restore both at once, never one side.
6. **Say what was not checked.** Coverage gaps go in the report, in plain words.
7. **Treat the dump as sensitive.** It holds password hashes, customer records and often live API tokens. Keep it and
   the throwaway server's data folder off shared machines, out of chats, tickets and repositories, and delete them when
   the work ends.
8. **One approved step at a time on the live site.** Back up the live site first, state the step, its check and its
   rollback, and wait for the owner's approval of that step.

## Procedure

Run the phases in order. Each reference file ends with what it must produce before the next phase starts.

| Phase | File | Produces |
| --- | --- | --- |
| 0 | `references/00-intake.md` | Both inputs, the scope block, the symptom in one sentence |
| 1 | `references/01-workspace.md` | A working copy, a throwaway database, an inventory and file counts |
| 2 | `references/02-file-scan.md` | Verified file findings: confirmed, suspicious, verified clean |
| 3 | `references/03-database-scan.md` | Verified database findings: rows, users, sessions, cron, settings |
| 4 | `references/04-timeline-entry-point.md` | A dated timeline, the entry point at a stated confidence, the blast radius |
| 5 | `references/05-cleanup.md` | A clean file set and a clean dump, verified, with a change list |
| 6 | `references/06-restore.md` | The site back online, checked logged out, on mobile and from search |
| 7 | `references/07-hardening.md` | The way in closed, in priority order |
| 8 | `references/08-report-template.md` | The report handed to the owner |

Start from the symptom: `references/symptom-map.md` says where each kind of hack hides and which steps settle it.
Before writing any script or query, read `references/traps.md`.

### Checksums first (read-only)

```sh
curl -fsS -o WORK/evidence/core-checksums.json \
  "https://api.wordpress.org/core/checksums/1.0/?version=<version>&locale=<locale>"
node scripts/verify-core-checksums.mjs WORK/site WORK/evidence/core-checksums.json

node scripts/list-plugin-versions.mjs WORK/site/wp-content/plugins --themes WORK/site/wp-content/themes
# run each curl line it prints, then:
node scripts/verify-plugin-checksums.mjs WORK/site/wp-content/plugins WORK/evidence/checksums
```

The helpers compare offline. Downloading the checksum files is a separate, visible step the agent runs with curl, so
no helper makes a network request.

### Patterns, hosts and the database (read-only)

```sh
node scripts/scan-php.mjs WORK/site
node scripts/scan-js.mjs WORK/site/wp-content
node scripts/external-hosts.mjs WORK/site/wp-content
```

Then the SELECT queries in `scripts/database-hunt.sql` and `scripts/database-deep-checks.php` against the throwaway
database, with the table prefix read from `wp-config.php`.

### Before declaring the copy clean (read-only)

```sh
bash scripts/verify-clean.sh WORK/clean/site "MARKER_ONE" "MARKER_TWO"
```

It greps the cleaned copy for every marker found during the scan and for known web shell names, lists any PHP left in
uploads, and prints the database count queries to run. Every count must be zero, and the administrator list must hold
only people the owner names.

## Judgment rules

- **Most heuristic hits are innocent.** Webpack loaders, form plugins that redirect after a submit, and vendor
  libraries all match malware patterns. Record why each hit was cleared.
- **Malware hides in two places at once.** A payload kept in database options rebuilds deleted files, and files
  rewrite database rows. Search the options table for rows whose names are random hex strings as well as for any
  prefix the malware uses.
- **No malware found is a finding.** Then look outward: tag manager containers, third-party scripts, embeds on expired
  domains, lookalike domains and the reporter's own browser. Record what was ruled out and how.
- **Label inference.** "This account is malicious" and "this address belongs to the attacker" need evidence. State the
  entry point as confirmed, most likely or unknown, and say what evidence would settle it.
- **Correct mistakes in the report itself.** A superseded finding left standing sends people to fix the wrong thing.

## Reference files

| File | Read it when |
| --- | --- |
| `references/symptom-map.md` | First: which kind of hack the symptom points to, and where to look |
| `references/00-intake.md` | Collecting the inputs, context questions, the scope block |
| `references/01-workspace.md` | Extracting safely, the throwaway database, checking the inputs are complete |
| `references/02-file-scan.md` | Checksums, drop-ins and must-use plugins, uploads, patterns, configuration files |
| `references/03-database-scan.md` | Settings, users, sessions, options, cron, content, plugin code stores |
| `references/04-timeline-entry-point.md` | Dated sources, entry-point candidates, blast radius, confidence levels |
| `references/05-cleanup.md` | Quarantine, stripping injected blocks, replacing from official releases, database cleanup, secrets |
| `references/06-restore.md` | Preparing the dump for the target server, maintenance, restore, checks, rollback |
| `references/07-hardening.md` | Closing the way in, in priority order |
| `references/08-report-template.md` | The owner's report |
| `references/known-malware-patterns.md` | Families, markers and behavior seen in investigations; things that look malicious and are not |
| `references/traps.md` | Before writing any script or query: the failures that waste hours |

## Report format

End every engagement with the report in `references/08-report-template.md`, filled in from command output, file
contents and query results, never from memory. It opens with four lines: whether malware was found, what caused the
reported symptom, the most serious security problem, and what the owner must do first. It always keeps its "What was
checked" and "Not checked" sections, because those are what make the findings trustworthy.
