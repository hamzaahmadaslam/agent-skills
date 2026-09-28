# Phase 3: scan the database

Read this after the file scan, or alongside it. The goal is a verified list of malicious rows, users, sessions,
scheduled jobs and settings.

The database is where file-only scanners fail. Injected redirects, backdoor administrators, malicious scheduled jobs
and, most important, copies of the malware itself all live here. Every query in this phase is a `SELECT`, run against
the throwaway server from phase 1. Replace `{prefix}` with the table prefix from `wp-config.php` everywhere
([00-intake.md](00-intake.md)).

The full set of queries is in `scripts/database-hunt.sql`; `scripts/database-deep-checks.php` decodes the serialized
values that SQL cannot read well (active plugins, cron hooks, roles, sessions, spam registrations):

```sh
sed 's/{prefix}/Ab3_/g' scripts/database-hunt.sql > WORK/evidence/database-hunt.sql
mysql -h127.0.0.1 -P3307 -uroot --force scan < WORK/evidence/database-hunt.sql > WORK/evidence/database-hunt.txt 2>&1
TABLE_PREFIX=Ab3_ DB_NAME=scan php scripts/database-deep-checks.php > WORK/evidence/database-deep-checks.txt
```

Raise the regular expression limits on the throwaway server first, and keep `--force`
([01-workspace.md](01-workspace.md), "Pitfalls").

## Live site, read-only

When the requester gives SSH access instead of a dump:

- Prefer exporting the database and scanning a copy: `wp db export <file outside the web root> --skip-plugins
  --skip-themes`, then copy the file to your workstation and load it into a throwaway server
  ([wp db export](https://developer.wordpress.org/cli/commands/db/export/)). The regular expression limits above are
  global server settings, which you should not change on a live server.
- `wp db` commands run the code in `wp-config.php`
  ([Runner.php L1301-L1374 at v2.12.0](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1301-L1374)),
  and every other command also loads must-use plugins and the `db.php` and `object-cache.php` drop-ins, even with
  `--skip-plugins --skip-themes` ([02-file-scan.md](02-file-scan.md), "Live site, read-only"). Run WP-CLI from a
  directory outside the document root, read commands only, with both skip flags on every command.
- Useful read commands:
  - `wp user list --role=administrator --fields=ID,user_login,user_email,user_registered`
    ([wp user list](https://developer.wordpress.org/cli/commands/user/list/))
  - `wp user session list <user>`: login time, expiry, IP and user agent; the token column is a hash
    ([wp user session list](https://developer.wordpress.org/cli/commands/user/session/list/))
  - `wp user application-password list <user>`
    ([wp user application-password list](https://developer.wordpress.org/cli/commands/user/application-password/list/))
  - `wp cron event list --fields=hook,next_run_gmt,recurrence`
    ([wp cron event list](https://developer.wordpress.org/cli/commands/cron/event/list/))
- Malware that loads on every request can hide users and rows from WordPress functions. Where WP-CLI and SQL on the
  exported copy disagree, trust the SQL.

## Step 1: core settings

```sql
SELECT option_name, option_value FROM {prefix}options
WHERE option_name IN ('siteurl', 'home', 'users_can_register', 'default_role', 'admin_email',
                      'template', 'stylesheet', 'blog_public');
```

- `siteurl` or `home` pointing anywhere but the real domain redirects every visitor.
- WordPress installs with `users_can_register` set to 0 and `default_role` set to `subscriber`
  ([schema.php L416, L466](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L416)).
  `users_can_register = 1` with `default_role = administrator` is a standing backdoor. Even with `subscriber`, open
  registration invites mass bot sign-ups.
- An `admin_email` nobody recognizes means password resets and security notices go to someone else.
- `template` and `stylesheet` name the active parent and child theme, which phase 2, step 3 reads closely.

## Step 2: users, roles and sessions

```sql
SELECT u.ID, u.user_login, u.user_email, u.user_registered
FROM {prefix}users u
JOIN {prefix}usermeta m ON m.user_id = u.ID AND m.meta_key = '{prefix}capabilities'
WHERE m.meta_value LIKE '%administrator%'
ORDER BY u.user_registered DESC;
```

Check:

- **Administrators the owner does not recognize.** Backdoor accounts imitate plausible names: `backup_` or `adm_`
  followed by six hex characters, or a support account on a lookalike email domain, such as a support address on a
  domain one letter away from the host's own. Ask the owner about every administrator, by name.
- **Registration dates.** Sort newest first and ask about each recent one. `user_registered` is stored in UTC
  ([user.php L2206, L2422](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/user.php#L2422)).
- **The role definitions themselves**, in the option `{prefix}user_roles`. A fresh install gives `subscriber` only
  `read` and `level_0`
  ([schema.php L831-L834](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L831-L834)).
  Confirm it still has only those, and that no other role grants administrative capabilities.
- **Application passwords**, in the usermeta key `_application_passwords`
  ([class-wp-application-passwords.php L24](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-application-passwords.php#L24)):
  API logins that survive a password change.
- **Session tokens**, in the usermeta key `session_tokens`
  ([class-wp-user-meta-session-tokens.php L27](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user-meta-session-tokens.php#L27)).
  Each session is stored under the SHA-256 hash of its token, with `expiration`, `login` (a Unix time), and `ip` and
  `ua` only when the request that created it had an address and a `User-Agent` header
  ([class-wp-session-tokens.php L70-L71, L118-L143](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-session-tokens.php#L118-L143)).
  `database-deep-checks.php` decodes them and flags the red flags seen in investigations: identical session sets
  across different users, sessions with no user agent at all, and user agents that belong to bots and services
  (uptime monitors, `facebookexternalhit`, the site's own loopback requests). Those are signs of a session created
  without anyone signing in. The login form fires the `wp_login` action, which is what login logs usually record
  ([user.php L41, L138](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/user.php#L138)); code
  running on the site that calls `wp_set_auth_cookie()` directly creates a session without that action
  ([pluggable.php L1071-L1154](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/pluggable.php#L1071-L1154)),
  which is why the login log can show nothing. Phase 4 covers what this says about the way in.
- **Bulk spam accounts.** Count users and look at display names. Scam sign-ups carry the scam message as the display
  name, and exist so that the site emails the message to the address they entered.

## Step 3: options, the malware's favorite hiding place

Four separate searches. Do all four.

**a. Prefixed option families.** Malware often keeps its rows under one prefix, for example `sc_`
([known-malware-patterns.md](known-malware-patterns.md)). Look for any shared prefix that no installed plugin
explains:

```sql
SELECT option_name, autoload, LENGTH(option_value) AS bytes FROM {prefix}options
WHERE LEFT(option_name, 3) = 'sc_' ORDER BY bytes DESC;
```

**b. Options named as random strings.** This layer is the easiest to miss, and the one that rebuilds everything else:

```sql
SELECT option_name, autoload, LENGTH(option_value) AS bytes FROM {prefix}options
WHERE option_name REGEXP '^[0-9a-fA-F]{6,32}$' ORDER BY bytes DESC;
```

No legitimate option is named as a bare hex string. In one investigation these rows, outside the malware's visible
naming pattern, held an encoded payload that included a gzip of the malware's complete source and a version marker
with the loader's file name spelled backwards. Deleting only the prefixed rows would have left a working rebuild kit.

**c. Large or encoded values.** Sort options by size and read anything unexplained. Test the big ones: base64-decode
them, and check whether the result starts with the gzip magic bytes `1f 8b`
([RFC 1952, section 2.3.1](https://www.rfc-editor.org/rfc/rfc1952#section-2.3.1)) or with `<?php`. Before decoding,
a base64 value that starts with `H4sI` is gzip data, and one that starts with `PD9waHA` is `<?php`.

```sql
SELECT option_name, autoload, LENGTH(option_value) AS bytes FROM {prefix}options
ORDER BY LENGTH(option_value) DESC LIMIT 30;
```

**d. Script and redirect code in any setting:**

```sql
SELECT option_name, autoload, LENGTH(option_value) AS bytes, LEFT(option_value, 300) AS preview
FROM {prefix}options
WHERE option_value REGEXP '<script|location[.](href|replace|assign)|window[.]location|atob[(]|fromCharCode|eval[(]|document[.]write|_0x[0-9a-f]{4}'
  AND option_name NOT LIKE '%transient%'
ORDER BY bytes DESC LIMIT 100;
```

The patterns use `[.]` and `[(]` instead of backslash escapes on purpose ([traps.md](traps.md)). Expect legitimate
hits: analytics snippets, chat widgets, accessibility tools, theme options. Name the plugin each one belongs to.

## Step 4: scheduled jobs

Read the `cron` option, unserialize it, and list every hook name; `database-deep-checks.php` does this with its event
count and next run. Legitimate hooks are named after their plugin. Hooks such as `sc_cron_fetch`, or a random string
of about 20 lowercase letters and digits, are how malware rebuilds itself on a schedule.

Confirm before deleting anything: search the code for the hook name. If nothing registers it, it is orphaned at best
and malicious at worst.

```sh
grep -rlF '<hook name>' WORK/site/wp-content
```

## Step 5: active plugins against the files on disk

Read `active_plugins` (the deep-checks helper lists it) and compare it with the plugin folders. A plugin active in the
database but absent from disk was either removed already or lives somewhere unexpected; a suspicious folder that is
active is a priority. Duplicates in the list mean the option was edited by something other than WordPress.

## Step 6: content, meta, widgets and comments

```sql
SELECT ID, post_type, post_status, post_modified, post_title FROM {prefix}posts
WHERE post_content REGEXP '<script[^>]*src=|atob[(]|fromCharCode|eval[(]|document[.]write|window[.]location|_0x[0-9a-f]{4}'
ORDER BY post_modified DESC LIMIT 100;
```

Repeat for `{prefix}postmeta` (page-builder data lives here), for options with `option_name LIKE 'widget%'`, for
comments and for term meta; `database-hunt.sql` has each. Page builders store HTML JSON-escaped, so a script tag reads
`src=\"https:\/\/host\/x.js\"`: your pattern must tolerate the backslashes. So must any `grep` you run on the `.sql`
file itself, because a dump escapes its quotes the same way.

Also look for spam content: hidden links, injected `display:none` blocks, and pages of keywords in languages the site
does not use.

## Step 7: every external script host the database references

Extract the hosts from `<script src=...>` across posts, postmeta and options, and count them (`database-hunt.sql` has
the query; `REGEXP_SUBSTR` needs MySQL 8 or a recent MariaDB). Then classify each one: the site's own domain, a known
vendor, or unexplained. An embed whose domain expired and was registered again by someone else is a classic cause of
ad redirects, and it looks completely normal in the page source.

## Step 8: plugin stores that run code

These are where an attacker with administrator access plants a redirect without touching a file. Check each one the
site has:

- **WPCode (formerly Insert Headers and Footers).** Snippets are posts of type `wpcode`
  ([post-type.php](https://plugins.svn.wordpress.org/insert-headers-and-footers/tags/2.3.9/includes/post-type.php)),
  and a copy of every active snippet is cached in the option `wpcode_snippets`
  ([class-wpcode-snippet-cache.php L18](https://plugins.svn.wordpress.org/insert-headers-and-footers/tags/2.3.9/includes/class-wpcode-snippet-cache.php)).
  Auto-inserted snippets are loaded from that cache when it is in use
  ([class-wpcode-auto-insert-type.php L255-L265](https://plugins.svn.wordpress.org/insert-headers-and-footers/tags/2.3.9/includes/auto-insert/class-wpcode-auto-insert-type.php)),
  so the cache is what runs. Compare the two: a snippet in the cache but not in the visible list, or different from
  it, is an injection.
- **Legacy header and footer options.** Insert Headers and Footers 1.6.0 kept its code in the options
  `ihaf_insert_header`, `ihaf_insert_body` and `ihaf_insert_footer`
  ([ihaf.php at 1.6.0](https://plugins.svn.wordpress.org/insert-headers-and-footers/tags/1.6.0/ihaf.php)), and the
  current version still deletes `ihaf_` options on uninstall
  ([uninstall.php L49-L50 at 2.3.9](https://plugins.svn.wordpress.org/insert-headers-and-footers/tags/2.3.9/uninstall.php)),
  so older sites may still have them. Read them.
- **Head, Footer and Post Injections** keeps its code in the option `hefo`, and per post in the post meta
  `hefo_before` and `hefo_after`. When the setting `enable_php` in that option is on, it runs the injected text as
  PHP with `eval()`; activating the plugin over existing settings switches it on
  ([plugin.php L53-L69, L355-L363 at 3.3.6](https://plugins.svn.wordpress.org/header-footer/tags/3.3.6/plugin.php)).
  Check whether it is on.
- **Elementor Pro Custom Code** adds HTML, JavaScript and CSS to pages
  ([Add custom code](https://elementor.com/help/custom-code-pro/)). Sites checked while this playbook was written
  stored it as posts of type `elementor_snippet` with the code in the post meta `_elementor_code`; confirm on the site
  with `SELECT post_type, COUNT(*) FROM {prefix}posts GROUP BY post_type`.
- **Tag manager plugins:** some keep their code in their own table, not in options.
- **Custom CSS and JavaScript plugins:** often a table listing external URLs injected into pages.
- **Popup plugins:** popup settings can carry a redirect or custom JavaScript.
- **Redirection plugins.** The Redirection plugin keeps its rules in `{prefix}redirection_items`, with the source in
  `url`, the target in `action_data` and the condition in `match_type`
  ([class-latest.php L223-L243 at 5.10.1](https://plugins.svn.wordpress.org/redirection/tags/5.10.1/includes/database/schema/class-latest.php)).
  Conditions include referrer, user agent, cookie, login state, IP, server, language and custom filters
  ([matches/](https://plugins.svn.wordpress.org/redirection/tags/5.10.1/matches/)). List every rule whose target is
  off-site and every rule that matches on anything other than the URL: conditional rules are how a redirect hides
  from the owner.

  ```sql
  SELECT id, url, match_type, action_type, action_code, action_data, status, last_count
  FROM {prefix}redirection_items
  WHERE action_data LIKE 'http%' OR match_type <> 'url'
  ORDER BY id DESC;
  ```

- **404 redirect plugins:** the destination is a setting.
- **Theme options** (`*_redux` options, theme mods) often include a custom JavaScript field.

## Step 9: security and activity logs inside the database

If Wordfence, an activity log or a similar plugin is installed, its tables are the best record you will get of who
did what. Note which exist and their date range here; read them properly in phase 4.

## Step 10: follow the malware's own manifests

Advanced malware keeps a list of the files it maintains, with paths and hashes, so it can repair itself. If step 3
found such an option, extract every path from it and check each one on disk (phase 2, step 12). It is a complete list
of the infection, written by the infection.

## Working with serialized data

WordPress stores arrays as PHP serialized strings with byte-length prefixes. Editing them with search and replace
corrupts them. The rules:

- To read, unserialize in PHP or a parser; do not read them by eye. `database-deep-checks.php` unserializes with
  `allowed_classes` set to false, so no class code runs.
- To change, use WP-CLI, whose `wp search-replace` handles serialized data
  ([wp search-replace](https://developer.wordpress.org/cli/commands/search-replace/)), or unserialize and serialize
  again in code. Changes belong to phase 5 ([05-cleanup.md](05-cleanup.md)).
- Never run a raw SQL string replacement across serialized columns.

## Output of this phase

- Malicious option rows, with their sizes.
- Malicious cron hooks.
- Backdoor users, application passwords and forged sessions.
- Injected code in content, settings or plugin code stores.
- Everything verified clean, with counts: administrators the owner confirmed, options reviewed, hosts classified.

Next: [04-timeline-entry-point.md](04-timeline-entry-point.md).
