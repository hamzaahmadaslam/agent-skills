# Search and replace

How `wp search-replace` behaves, which tables it touches on a network, and how to build replacement pairs that do
not damage other sites. Checked against WP-CLI 2.12.0, which bundles search-replace-command 2.1.8 and
db-command 2.1.3, on 2026-09-26. Command reference:
[wp search-replace](https://developer.wordpress.org/cli/commands/search-replace/).

## What the command does

- It searches every row of a set of tables, handles PHP serialized data, and does not change primary key values.
  Source: [command documentation](https://developer.wordpress.org/cli/commands/search-replace/)
- For each column it first looks for a value that looks serialized (`REGEXP '^[aiO]:[1-9]'`). If there is none it
  runs one SQL `REPLACE()`; otherwise, and always with `--precise`, it works row by row in PHP: unserialize, replace
  inside every string, serialize again.
  Source: [`Search_Replace_Command.php`](https://github.com/wp-cli/search-replace-command/blob/v2.1.8/src/Search_Replace_Command.php#L391)
- That check only recognises serialized arrays, integers and objects. WordPress stores an already serialized string
  by serializing it again, as a string that starts with `s:`
  ([`maybe_serialize()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L628)).
  In a column that holds only such values, SQL mode would replace text without fixing the stored length and break
  them. `--precise` forces PHP mode for every column; use it for plugin tables and whenever time allows.
- Objects inside serialized values are only changed when their class is loaded. Otherwise the value is left as it
  was and WP-CLI warns `Skipping an uninitialized class "...", replacements might not be complete.` Run
  replacements with the site's plugins loaded (no `--skip-plugins`) and read every warning.
  Source: [`SearchReplacer.php`](https://github.com/wp-cli/search-replace-command/blob/v2.1.8/src/WP_CLI/SearchReplacer.php#L122)
- It never changes the `user_pass` column.
  Source: [`Search_Replace_Command.php`](https://github.com/wp-cli/search-replace-command/blob/v2.1.8/src/Search_Replace_Command.php#L322)
- It skips tables without a primary key and reports them as skipped. Plugin tables without one need their own
  update.
  Source: [`Search_Replace_Command.php`](https://github.com/wp-cli/search-replace-command/blob/v2.1.8/src/Search_Replace_Command.php#L367)
- Matching is case-sensitive: SQL mode counts with `LIKE BINARY`, PHP mode uses `str_replace()`. `wp db search` is
  case-insensitive by default, so it can show variants that a replacement did not touch.
  Sources: [`Search_Replace_Command.php`](https://github.com/wp-cli/search-replace-command/blob/v2.1.8/src/Search_Replace_Command.php#L518),
  [wp db search](https://developer.wordpress.org/cli/commands/db/search/)
- `--dry-run` runs everything and reports counts without saving. `--log` prints each change with context and works
  together with `--dry-run`. `--report-changed-only` hides tables and columns with no change. `--export=<file>`
  writes the transformed tables as SQL instead of changing the database and cannot be combined with `--dry-run`.
  `--regex` uses PCRE and is documented as 15 to 20 times slower.
  Sources: [command documentation](https://developer.wordpress.org/cli/commands/search-replace/),
  [`Search_Replace_Command.php`](https://github.com/wp-cli/search-replace-command/blob/v2.1.8/src/Search_Replace_Command.php#L239)

## Which tables it touches

- The documentation says the default is the tables registered to `$wpdb`, "the tables for the current site" on
  multisite. The code resolves that default with the scope `all`, which on multisite is the current site's core
  tables plus every shared table: `users`, `usermeta`, `blogs`, `blogmeta`, `signups`, `site`, `sitemeta`,
  `registration_log`. So `wp search-replace OLD NEW --url=<subsite>` also rewrites those network tables; a pair that
  matches a domain can change `wp_blogs.domain` and move other sites.
  Sources: [`wp_get_table_names()`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/utils-wp.php#L477),
  [`wpdb::tables()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L1122).
  The `wp db tables` documentation shows `--scope=blog` as the way to list one site's tables "without shared
  tables like 'wp_users'" ([wp db tables](https://developer.wordpress.org/cli/commands/db/tables/)).
- `--all-tables-with-prefix` selects `SHOW TABLES LIKE '<site prefix>%'`. On blog_id 3 that is exactly the `wp_3_`
  tables, plugin tables included, and no shared table. On blog_id 1 the prefix is `wp_` and it selects every table
  of the network.
  Source: [`wp_get_table_names()`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/utils-wp.php#L466)
- Table arguments with `*` or `?` are matched against the resolved list. With the default scope, `'wp_3_*'` finds
  only the registered core tables; with `--all-tables` it finds plugin tables too.
  Source: [`wp_get_table_names()`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/utils-wp.php#L512)
- `--network` selects the shared tables plus the registered tables of every site, archived and deleted sites
  included.
  Source: [`wp_get_table_names()`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/utils-wp.php#L480)
- `--all-tables` selects every table in the database and overrides the other flags.
  Source: [command documentation](https://developer.wordpress.org/cli/commands/search-replace/)
- `wp db search` resolves tables the same way, so it previews exactly what a replacement with the same flags would
  read.
  Source: [`DB_Command::search()`](https://github.com/wp-cli/db-command/blob/v2.1.3/src/DB_Command.php#L1489)

Use:

| Where                                 | Table selection                                              |
| ------------------------------------- | ------------------------------------------------------------ |
| A subsite with blog_id greater than 1 | `--url=<subsite> --all-tables-with-prefix`                   |
| A standalone install or staging copy  | `--all-tables-with-prefix` (its prefix covers its tables)    |
| The main site (blog_id 1)             | An explicit list of tables, read before use                  |
| The whole network (not this skill)    | `--network`, with `wp_blogs` and `wp_site` handled on purpose |

Check the selection first: `wp db tables` takes the same flags.

## Building the pairs

1. Find the forms in use, read-only:
   `wp db search 'network.example/blog-a' --all-tables-with-prefix --format=csv --fields=table,column | sort | uniq -c`.
   Look for the full URL, the host alone, `http` and `https`, protocol-relative `//host`, and the JSON-escaped form.
2. Order: most specific first. The uploads URL with `sites/N/` goes before the site URL; otherwise the site pair
   rewrites media URLs to a path without the change from `sites/N/`.
3. End path-based pairs with `/`. `//network.example/blog-a` also matches `//network.example/blog-ab/`, a different
   site. Because `home` and `siteurl` have no trailing slash, set them with `wp option update` after the pairs.
4. Leave the scheme out (`//host/path/`) to cover `http://`, `https://` and protocol-relative links in one pair.
   Change the scheme afterwards with its own pair if the new site uses `https` only.
5. JSON-escaped slashes: PHP's `json_encode()` writes `/` as `\/` unless `JSON_UNESCAPED_SLASHES` is set
   ([PHP JSON constants](https://www.php.net/manual/en/json.constants.php)). Core block attributes are encoded
   with `JSON_UNESCAPED_SLASHES`
   ([`serialize_block_attributes()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/blocks.php#L1705)),
   so escaped URLs come from plugins and themes that store JSON. Replace them with a second pair written with `\/`.
6. A pair whose new string contains the old one (`/uploads/` to `/uploads/sites/7/`) doubles when run twice. Use
   `--regex` with a negative lookahead (`uploads/(?!sites/7/)`), or run it once and check afterwards that
   `wp db search 'uploads/sites/7/sites/'` finds nothing.
7. Never change `guid`: pass `--skip-columns=guid`. The handbook says the column must never change, because feed
   readers use it to recognise posts they have shown
   ([Important GUID Note](https://developer.wordpress.org/advanced-administration/upgrade/migrating/#important-guid-note)).
   Attachments do not depend on it for their URL ([data-model.md](data-model.md)).
8. The handbook warns that a network stores URLs in many tables and that each field must be understood before it
   is replaced ([Additional items of note](https://developer.wordpress.org/advanced-administration/upgrade/migrating/#additional-items-of-note)).

## Running one pair

1. Back up the database the command will change: `wp db export <file>`.
2. `--dry-run --report-changed-only`: read the count for each table and column. A count in a table you did not
   expect means the selection or the pair is wrong.
3. When a count surprises you: `--dry-run --log` to see each change.
4. Run the same command without `--dry-run`. The count matches the dry run.
5. Verify with `wp db search` for the old string: what remains is in `guid`, or is a variant that needs its own
   pair.

Example for a subsite with blog_id 3:

```bash
wp --url=https://network.example/blog-a/ search-replace '//network.example/blog-a/' '//blog-a.example.com/' --all-tables-with-prefix --skip-columns=guid --precise --report-changed-only --dry-run
```
