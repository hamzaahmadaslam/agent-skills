# Phase 0: intake

Read this before anything else. The goal is to collect the two required inputs, and enough context to scan with a
direction instead of guessing. Do not skip to scanning: ten minutes here saves hours later.

## 1. Required inputs: ask for both

### Input A: the complete file set

Acceptable forms, best first:

- SSH or SFTP access to the live document root. It lets you read file timestamps and server logs, and copy the files
  off the server for the scan (the "Live site, read-only" notes in [02-file-scan.md](02-file-scan.md) and
  [03-database-scan.md](03-database-scan.md)).
- A full backup archive: `.tar`, `.tar.gz`, `.zip`, `.wpress`, or the host's own backup export.
- A backup downloaded from the hosting control panel.

Ask explicitly for the whole document root, hidden files included: `.htaccess`, `.user.ini`, `php.ini`,
`wp-config.php`, and everything in `wp-content`.

Some managed hosts serve WordPress core, and some themes and plugins, from a shared read-only location. On
WordPress.com, core files and the platform's own themes and plugins are symbolic links that the site cannot access or
edit ([Symlinked files and folders](https://developer.wordpress.com/docs/guides/symlinked-files-folders/)). Those files
are missing from the backup, or appear as symbolic links. That is normal. Record it: you cannot checksum what is not
there, and the site could not have modified it either.

### Input B: the complete database dump

- A `.sql` or `.sql.gz` export of the entire database, every table, with data.
- From `wp db export` over SSH ([wp db export](https://developer.wordpress.org/cli/commands/db/export/)), a phpMyAdmin
  export, or the host's backup panel.

Watch for dumps that are not complete: exports limited to a few tables, or "structure only" exports with no rows.
Phase 1 checks this ([01-workspace.md](01-workspace.md), "Verify the dump is complete").

### If an input is missing

Ask once more, and explain what cannot be concluded without it. If it is still unavailable, continue with what you
have and record the gap:

- **Files only:** the file scan can be completed, but database-borne malware was not checked: injected snippets,
  redirect settings, backdoor users, forged sessions, malicious scheduled jobs, and payloads stored in options that
  rebuild deleted files. A clean file scan does not mean the site is clean.
- **Database only:** the database scan can be completed, but file-borne malware was not checked: web shells, injected
  theme files, malicious drop-ins and must-use plugins.

Name the missing half in every conclusion you write. Never present half a scan as a full one.

## 2. Context questions

Ask these. The answers direct the whole scan, and [symptom-map.md](symptom-map.md) turns the symptom into the places
to look first.

**The symptom**

- What exactly is wrong? Visitors redirected to ad sites, spam pages in Google, the site down, a host suspension
  notice, a blocklist warning, spam email sent from the site.
- When was it first noticed?
- Who can reproduce it, and how? On mobile or desktop? From a Google search result, or by typing the address? Logged
  in or logged out?
- Does it still happen right now?

**The environment**

- The exact domain, and any staging or alternative domains.
- The host, and whether the site sits behind a CDN or web application firewall (Cloudflare, Sucuri and the like).
- Is the site live, offline or suspended?

**Access and people**

- Who has administrator access? Which agencies or contractors?
- Has anyone shared a password recently, or lost a laptop?
- Is a security plugin installed (Wordfence, Sucuri, Solid Security or another), and do its logs exist?
- Is an activity log plugin installed? Its logs are often the only record of who did what.

**History**

- When did the site last work normally?
- Any recent plugin or theme install, migration or host change?
- Any other sites on the same hosting account, or managed by the same agency? Infections spread across both.

**Authorization**

- Confirm that the requester owns or administers the site. Only scan and clean sites the requester owns or
  administers.

## 3. Record the scope before scanning

Write this block at the top of your working notes and keep it up to date. The values below are examples; replace
every one.

```text
SITE:            example.com
DOCUMENT ROOT:   /home/<account>/public_html   (or htdocs)
FILES PROVIDED:  <archive name> (<size>)
DB PROVIDED:     <dump name> (<size>)
TABLE PREFIX:    <from $table_prefix in wp-config.php; never assume wp_>
WP VERSION:      <from $wp_version in wp-includes/version.php>
HOST:            <host and control panel>
CDN/WAF:         <none, or which>
SYMPTOM:         <one sentence, with the date it was first seen>
NOT PROVIDED:    <for example: server access logs>
AUTHORIZED BY:   <name>, <date>
```

### The table prefix and the `{prefix}` placeholder

The table prefix is the value WordPress puts in front of every table name, set by `$table_prefix` in `wp-config.php`.
The default is `wp_`, and only numbers, letters and underscores are allowed
([wp-config.php, $table_prefix](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/)). Many
sites use a custom prefix, often in mixed case, such as `Ab3_`. Read it from the file as text:

```sh
grep -n 'table_prefix' WORK/site/wp-config.php
```

Every query in this skill writes the prefix as `{prefix}`, the same placeholder the collection's other skills use.
Replace it everywhere, in the queries here and in `scripts/database-hunt.sql`, before running anything. The prefix is
also part of two key names inside the data: the usermeta key `{prefix}capabilities` and the option
`{prefix}user_roles`, so a query on `Ab3_usermeta` looks for `meta_key = 'Ab3_capabilities'`
([class-wp-user.php L488](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user.php#L488),
[class-wp-roles.php L342](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-roles.php#L342)).
On a network (multisite), both keys carry each site's own prefix (same lines); scan one site at a time.

## 4. Set expectations with the requester

Tell them, in plain words, before you start:

- You will work on copies. The live site will not be touched during the scan.
- A clean result on one half (files or database) is not a clean result overall.
- If the site is serving malware now, taking it offline limits the damage to visitors and to the domain's reputation,
  but it also stops you from reproducing the symptom. Agree which matters more before acting.
- Cleaning does not close the way in. Phase 4 ([04-timeline-entry-point.md](04-timeline-entry-point.md)) finds it, and
  phase 7 ([07-hardening.md](07-hardening.md)) closes it.
- The database dump holds password hashes, customer data and often live API tokens. It will be kept off shared
  machines and deleted, with every working copy, when the work ends.

## Output of this phase

- Both inputs in hand, or a written note of which one is missing and what that leaves unchecked.
- The scope block above, filled in.
- A one-sentence statement of the symptom you are trying to explain.

Next: [01-workspace.md](01-workspace.md).
