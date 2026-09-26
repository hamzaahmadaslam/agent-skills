---
name: wp-multisite-migration
description: Runbook for moving one site out of a WordPress multisite network into a standalone install, or importing a standalone WordPress site into a network as a subsite. Covers finding the blog_id and its wp_N_ tables, network users and wp_N_capabilities keys, uploads/sites/N paths, domain mapping (core since 4.5, or sunrise.php), serialized-safe WP-CLI search-replace, network-activated plugins and themes, multisite constants in wp-config.php, redirects, verification and rollback. Use when splitting a subsite off a network, consolidating standalone sites into a multisite, or checking a half-finished move. Read-only by default; every write step has a backup before it and a check after it.
license: MIT
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.0"
  last_verified: "2026-09-26"
---

# WordPress multisite migration

This skill moves one site between a WordPress multisite network and a standalone install, in either direction,
with WP-CLI and SQL. It works on copies, leaves the source untouched until cut-over, and runs every write the same
way: back up, preview, run, verify.

It does not cover moving a whole network to a new host (a normal files, database and search-replace move),
switching a network between subdomain and subdirectory mode, or merging two networks.

Facts were checked against WordPress 7.1.2 and WP-CLI 2.12.0 on 2026-09-26. Each fact has its source URL in
`references/`.

## When to use

- A subsite needs its own install: a new owner, a new host, or plugins the network cannot run.
- A standalone site should join an existing network.
- A move was started and needs checking: leftover URLs, missing roles, broken media, wrong redirects.

## Safety rules

1. Start read-only. Run `scripts/inventory.sh` on every install involved and read the output before planning.
2. Every write step has four parts: a backup, a dry run or SELECT preview, the run, and a verification. Small
   changes get the same treatment.
3. Transform copies, never the source. Until cut-over the network (extraction) or the standalone site (import) is
   only read.
4. Rehearse the whole run on staging copies. Keep every command and its output, then repeat the same commands for
   the production run.
5. Steps marked WRITE change data. Show the operator the exact command and the dry-run result, and wait for a
   clear yes before running it.
6. Give `wp search-replace` its tables explicitly: `--all-tables-with-prefix` on a subsite whose blog_id is not 1,
   or a list of tables. With `--url` alone it also changes the shared network tables (`wp_users`, `wp_blogs`,
   `wp_sitemeta` and the rest). Always `--dry-run` first and always `--skip-columns=guid`.
7. Never delete the old site, drop tables or delete users before the owner signs off. Archive the old site
   instead; `wp site unarchive` reverses it.
8. Keep backups outside the web root. Reports never contain database passwords, password hashes or user emails.

## Terms

| Term           | Meaning                                                                                       | Example        |
| -------------- | --------------------------------------------------------------------------------------------- | -------------- |
| blog_id, N     | The site's ID in `wp_blogs`                                                                   | `3`            |
| base prefix    | `$table_prefix` in the network's `wp-config.php`                                              | `wp_`          |
| site prefix    | base prefix + N + `_`; blog_id 1 uses the base prefix alone                                   | `wp_3_`        |
| network tables | `users`, `usermeta`, `blogs`, `blogmeta`, `site`, `sitemeta`, `signups`, `registration_log`   | `wp_users`     |
| site tables    | site prefix + `posts`, `postmeta`, `comments`, `commentmeta`, `terms`, `termmeta`, `term_taxonomy`, `term_relationships`, `options`, `links`, plus plugin tables with the same prefix | `wp_3_options` |

Details and sources: [references/data-model.md](references/data-model.md).

## Step 1: inventory (read-only)

```bash
bash scripts/inventory.sh --path=/srv/network --url=https://network.example/blog-a/   # a subsite
bash scripts/inventory.sh --path=/srv/shop                                             # a standalone site
```

Record in the notes: blog_id, base and site prefix, main site or not, subdomain or subdirectory network, WordPress
and PHP versions, site tables and sizes, tables with a `blog_id` column, members and administrators, active,
network-active and must-use plugins, drop-ins, theme (`stylesheet`, `template`), uploads `basedir` and `baseurl`,
`ms_files_rewriting`, domain mapping method, scheduled cron events.

Stop and adjust the plan when:

- the blog_id is 1: follow the main site section of [extract-subsite.md](references/extract-subsite.md);
- `ms_files_rewriting` is on: the site uses the legacy `blogs.dir` layout (same file, legacy section);
- `SUNRISE` is defined or `wp-content/sunrise.php` exists: a plugin maps domains
  ([domain-mapping.md](references/domain-mapping.md));
- the standalone site runs a newer WordPress than the network: update the network first, as its own change;
- a plugin the site needs has `Network: true` in its header: activating it on one site activates it on every site
  ([plugins-and-themes.md](references/plugins-and-themes.md)).

## Step 2: back up and check the backups

```bash
BK=/srv/backups/blog-a-$(date +%Y%m%d-%H%M); mkdir -p "$BK"
wp --path=/srv/network db export "$BK/network-full.sql" --single-transaction
tar -czf "$BK/network-files.tar.gz" -C /srv/network wp-config.php wp-content
sha256sum "$BK"/* > "$BK/SHA256SUMS"
grep -c '^CREATE TABLE' "$BK/network-full.sql"        # compare with the table count below
wp --path=/srv/network db tables --all-tables | wc -l
```

Back up both installs for an import. A restore test into a scratch database is the only proof that a dump works;
[verification-and-rollback.md](references/verification-and-rollback.md) has the steps.

## Direction A: subsite to standalone

Full runbook: [references/extract-subsite.md](references/extract-subsite.md). Users:
[references/users-and-roles.md](references/users-and-roles.md).

1. Build the target: the network's WordPress version, an empty database, `wp-config.php` with the new
   `$table_prefix` and no multisite constants, the theme and plugin code the site uses. Do not run the installer.
2. Export from the network. These commands only read the source:
   ```bash
   T=$(wp --path=/srv/network --url=https://network.example/blog-a/ db tables --all-tables-with-prefix --format=csv)
   wp --path=/srv/network db export "$BK/site-3-tables.sql" --tables="$T" --single-transaction
   ```
   Then export the members' rows of `wp_users` and `wp_usermeta` with `--where`, and copy
   `wp-content/uploads/sites/3/` into the target's `wp-content/uploads/`. Never use `--all-tables-with-prefix`
   for blog_id 1: its prefix matches every table in the network.
3. WRITE, target database: import the dumps.
4. WRITE, target database: rename `wp_3_*` tables to `wp_*`, the option `wp_3_user_roles` to `wp_user_roles`, and
   the user meta keys `wp_3_*` to `wp_*`. Generate the statements with a SELECT, read them, then run them.
5. WRITE, target database: search-replace the uploads URL first, then the site URL, dry run first; then set
   `home` and `siteurl` with `wp option update`.
6. Activate the plugins that were network-active, check the theme, and confirm
   `wp eval 'var_dump( is_multisite() );'` prints `bool(false)`.
7. Verify with the checklist, then cut over: content freeze, final export, DNS, redirects on the network, and
   `wp site archive 3` on the network.
8. After sign-off only: optional cleanup of the old site, with a fresh backup first.

## Direction B: standalone to subsite

Full runbook: [references/import-standalone.md](references/import-standalone.md). Users:
[references/users-and-roles.md](references/users-and-roles.md).

1. Inventory both installs, and compare users with
   `bash scripts/user-conflicts.sh --standalone-path=/srv/shop --network-path=/srv/network` (read-only).
2. Back up both installs. Make a staging copy of the standalone site: its files and a separate database.
3. WRITE, network: create the empty site and archive it until cut-over:
   ```bash
   N=$(wp --path=/srv/network site create --slug=shop --title="Shop" --porcelain)
   wp --path=/srv/network site archive "$N"
   ```
   Without `--email`, WP-CLI makes the first super admin the site's administrator and creates no account. Map the
   final domain now if the site keeps its own domain. Read the new site's uploads `baseurl` and `basedir` with
   `wp eval` and `wp_get_upload_dir()`.
4. WRITE, network users: map each standalone user to an existing network account by email, or create the account.
   Multisite accepts only logins of lowercase letters and digits, four characters or more. Record old and new IDs.
5. WRITE, staging copy: remap author and user IDs, search-replace URLs and the uploads path (`uploads/` to
   `uploads/sites/N/`), rename the tables to the site prefix and `wp_user_roles` to `wp_N_user_roles`, export only
   the site tables, and check that every `CREATE TABLE` in the dump names a site table.
6. WRITE, network: back up the new site's default tables, import the dump, flush the object cache, set roles with
   `wp user set-role`, copy uploads into `uploads/sites/N/`, enable the theme for the site, flush rewrite rules.
7. Verify, then cut over: DNS, `wp site unarchive N`, redirects for old URLs. Keep the standalone site read-only
   and intact until sign-off.

The WordPress export and import route (WXR) moves posts, pages, comments, terms and media but no options, widgets,
plugin settings or roles. Use it only when that loss is acceptable; see the import runbook.

## Search and replace rules

Read [references/search-replace.md](references/search-replace.md) before the first replacement.

- WP-CLI's `search-replace` unserializes PHP serialized values, replaces inside them and serializes them again. It
  never changes `user_pass` and skips tables without a primary key. Its fast SQL mode can miss serialized strings;
  `--precise` processes every column in PHP and is the safer choice for the real run.
- Build pairs from the real data: find the forms in use with `wp db search` first.
- Replace the most specific string first: the uploads URL with `sites/N/`, then the site URL.
- End path pairs with a slash: `//network.example/blog-a/` does not match `/blog-ab/`, while
  `//network.example/blog-a` does.
- Values written by PHP's `json_encode()` without flags store `/` as `\/`; search for that form too.
- A replacement whose new string contains the old one (`uploads/` to `uploads/sites/7/`) doubles if run twice. Run
  it once, or use `--regex` with a lookahead, and check for `sites/7/sites/7/` afterwards.

## Domain mapping

Since WordPress 4.5 a subsite can use any domain through its Site Address (URL) in Network Admin, stored in
`wp_blogs` and the site's `home` and `siteurl` options. Older networks may use a plugin loaded through
`wp-content/sunrise.php` and the `SUNRISE` constant, with its own mapping table. Moving a mapped domain means DNS,
TLS and cookie settings on the receiving server. Details: [references/domain-mapping.md](references/domain-mapping.md).

## Redirects

Old URLs get server-level 301 redirects placed before the WordPress rules, with the uploads path rule first. An
archived site answers 410, not a redirect, so the redirect has to run before WordPress. Keep redirects for at least
a year. Apache and nginx rules for every case: [references/redirects.md](references/redirects.md).

## Verify, cut over, roll back

[references/verification-and-rollback.md](references/verification-and-rollback.md) has the checklists. The
minimum:

- `scripts/table-counts.sh` on source and target, then `diff`: identical row counts for every site table.
- `wp option get home` and `siteurl` show the new address; `wp db search` finds the old address only in `guid`.
- Users: the expected members, at least one administrator who can log in, and roles that exist.
- Uploads: file counts match and sample media URLs return HTTP 200.
- Plugins, theme, permalinks and cron events match the inventory.
- The rest of the network is unchanged: site count, main site home page, network table row counts other than the
  expected new users and the new `wp_blogs` row.

Rollback before cut-over is discarding the copy. After cut-over it is DNS or redirects back, `wp site unarchive` or
`wp site archive`, and carrying back anything written in between. Restoring a full network dump rolls back every
site on the network, so it is the last resort.

## Reference files

| File                                                                          | Read when                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------- |
| [data-model.md](references/data-model.md)                                     | Before planning: tables, prefixes, users, uploads  |
| [extract-subsite.md](references/extract-subsite.md)                           | Direction A, step by step                          |
| [import-standalone.md](references/import-standalone.md)                       | Direction B, step by step                          |
| [users-and-roles.md](references/users-and-roles.md)                           | Moving users, capability keys, ID remapping        |
| [search-replace.md](references/search-replace.md)                             | Before any replacement                             |
| [domain-mapping.md](references/domain-mapping.md)                             | The site has or gets its own domain                |
| [plugins-and-themes.md](references/plugins-and-themes.md)                     | Activations, drop-ins, must-use plugins            |
| [wp-config-and-server.md](references/wp-config-and-server.md)                 | Multisite constants, `.htaccess`, nginx            |
| [redirects.md](references/redirects.md)                                       | Cut-over                                           |
| [verification-and-rollback.md](references/verification-and-rollback.md)      | Backups, checklists, rollback                      |
| [wp-cli-commands.md](references/wp-cli-commands.md)                           | Exact behaviour of each WP-CLI command used        |
| [sources.md](references/sources.md)                                           | Re-verifying the skill                             |

Scripts (read-only, WP-CLI read commands and SELECT queries only):

| Script                       | Output                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- |
| `scripts/inventory.sh`       | Everything Step 1 needs for one site                                    |
| `scripts/table-counts.sh`    | Exact row counts per table for a prefix, sorted for `diff`              |
| `scripts/user-conflicts.sh`  | Standalone users that exist on the network, clash, or break login rules |

## Report format

Report back in this shape, with numbers from command output, never estimates:

```markdown
## Multisite migration: <site address> (<subsite to standalone | standalone to subsite>)

**Status:** planned | rehearsed | migrated, waiting for sign-off | done | rolled back

### Facts
- Source and target: paths, addresses, WordPress versions
- blog_id, base prefix, site prefix, target prefix
- Tables moved (count), rows per table: identical | differences listed below
- Users moved (count), administrators, accounts created or mapped (counts only)
- Uploads: source and target folders, file counts
- Domain mapping method; plugins and theme activated

### Backups
- File, size, SHA-256, restore test: yes | no

### Steps run
1. Command, WRITE or read-only, result

### Verification
| Check | Expected | Found | Pass |

### Open items
- Manual follow-ups: DNS, TLS, redirects, Search Console, users to contact

### Rollback for this run
- The exact commands, in order
```
