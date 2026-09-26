# Subsite to standalone install

Step-by-step runbook for direction A. Facts behind each step, with sources, are in
[data-model.md](data-model.md), [search-replace.md](search-replace.md) and [wp-cli-commands.md](wp-cli-commands.md).

The worked example is synthetic: a subdirectory network at `https://network.example` with base prefix `wp_`; the
site `https://network.example/blog-a/` has blog_id 3 and moves to `https://blog-a.example.com`, with table prefix
`wp_`. Subdomain and mapped-domain differences are noted where they matter. Replace every example value, including
`wp_`, `3` and `wp_3_` inside SQL, with the values from your inventory.

```bash
NET=/srv/network                      # network install
OLD=https://network.example/blog-a/   # the subsite's URL, as `wp site list --field=url` prints it
NEW=/srv/blog-a                       # new standalone install, not serving traffic yet
BK=/srv/backups/blog-a-20260926       # backup folder outside every web root
```

The network is only read until step 10. Every write lands in the new install's database, which is not live.

## 1. Inventory (read-only)

```bash
mkdir -p "$BK"
bash scripts/inventory.sh --path="$NET" --url="$OLD" > "$BK/inventory-source.txt"
wp --path="$NET" site list --fields=blog_id,url,domain,path,public,archived,deleted
wp --path="$NET" --url="$OLD" user list --role=administrator --fields=ID,user_login
```

- The site must have a member with the administrator role who will own the standalone site. Super admins are listed
  in the network option `site_admins` and have no role on the site unless one was given, so they do not come along
  ([`get_super_admins()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/capabilities.php#L1163)).
  If there is no administrator, plan to create one on the new install after step 6.
- The target runs the same WordPress version as the network (`wp --path="$NET" core version`).
- If the new install uses a prefix other than `wp_`, change the target `wp_` in every statement below: table names,
  the roles option and the user meta keys.

## 2. Back up the source and check the backup

```bash
wp --path="$NET" db export "$BK/network-full.sql" --single-transaction
tar -czf "$BK/uploads-site-3.tar.gz" -C "$NET/wp-content/uploads/sites" 3
cp "$NET/wp-config.php" "$BK/"; [ -f "$NET/.htaccess" ] && cp "$NET/.htaccess" "$BK/"
sha256sum "$BK"/* > "$BK/SHA256SUMS"
```

Check: the dump has as many `CREATE TABLE` lines as `wp --path="$NET" db tables --all-tables | wc -l` prints, and
`tar -tzf "$BK/uploads-site-3.tar.gz" | wc -l` is not zero. A restore test is described in
[verification-and-rollback.md](verification-and-rollback.md).

## 3. Build the target install (not live)

```bash
wp core download --path="$NEW" --version="$(wp --path="$NET" core version)" --skip-content
wp config create --path="$NEW" --dbname=blog_a --dbuser=blog_a --dbprefix=wp_ --prompt=dbpass
wp --path="$NEW" db create        # only when the database does not exist yet
```

- The database must be new and empty: mysqldump's default `--opt` writes `DROP TABLE` before each `CREATE TABLE`,
  so the dumps imported in step 5 replace tables with the same names
  ([mariadb-dump `--opt`](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump),
  [wp db import](https://developer.wordpress.org/cli/commands/db/import/)).
- `wp-config.php` must not define `MULTISITE`, `SUBDOMAIN_INSTALL`, `VHOST`, `SUNRISE`, `DOMAIN_CURRENT_SITE`,
  `PATH_CURRENT_SITE`, `SITE_ID_CURRENT_SITE`, `BLOG_ID_CURRENT_SITE`, `NOBLOGREDIRECT`, or a `COOKIE_DOMAIN` that
  names the network. `SUBDOMAIN_INSTALL`, `VHOST` or `SUNRISE` alone is enough to make WordPress run as multisite
  ([`is_multisite()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L1448),
  [wp-config-and-server.md](wp-config-and-server.md)).
- Copy the code the site uses from `$NET/wp-content`: the active theme and its parent, every plugin that is active
  or network-active on the site, and only the must-use plugins and drop-ins it needs
  ([plugins-and-themes.md](plugins-and-themes.md)).
- Do not run `wp core install`: the imported tables replace what the installer would create.

## 4. Export the site from the network (read-only on the source)

```bash
T=$(wp --path="$NET" --url="$OLD" db tables --all-tables-with-prefix --format=csv)
echo "$T" | tr ',' '\n'                        # read it: only wp_3_ tables
wp --path="$NET" db export "$BK/site-3-tables.sql" --tables="$T" --single-transaction

IDS=$(wp --path="$NET" db query "SELECT DISTINCT user_id FROM wp_usermeta WHERE meta_key = 'wp_3_capabilities'" --skip-column-names | paste -s -d, -)
echo "$IDS"                                    # must not be empty
wp --path="$NET" db export "$BK/site-3-users.sql" --tables=wp_users --where="ID IN ($IDS)" --single-transaction
wp --path="$NET" db export "$BK/site-3-usermeta.sql" --tables=wp_usermeta --where="user_id IN ($IDS)" --single-transaction

grep -o 'CREATE TABLE `[^`]*`' "$BK/site-3-tables.sql"     # only wp_3_ names
rsync -a "$NET/wp-content/uploads/sites/3/" "$NEW/wp-content/uploads/"
```

- `--all-tables-with-prefix` selects the tables that start with the site prefix, so on blog_id 3 it returns the
  `wp_3_` tables including plugin tables. Never use it for blog_id 1, whose prefix matches every table; see "The
  main site" below ([`wp_get_table_names()`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/utils-wp.php#L466)).
- `--where` is passed to mysqldump and exports only the matching rows
  ([wp db export](https://developer.wordpress.org/cli/commands/db/export/)).
- Members of a site are the users with the `wp_3_capabilities` meta key
  ([`WP_User_Query`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user-query.php#L599)).
  The user meta dump holds every meta row of those users, including their roles on other sites; step 6 removes
  those.
- Network tables with a `blog_id` column (from the inventory) may hold rows for this site. Export them with
  `--where="blog_id = 3"` only when the plugin that owns them exists on the new install and expects that layout.
- Media keep their `YYYY/MM` folders; attachments store paths relative to the uploads folder, so they resolve
  against the new location ([`_wp_relative_upload_path()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php#L919)).

## 5. WRITE: import into the new database

```bash
wp --path="$NEW" db import "$BK/site-3-tables.sql"
wp --path="$NEW" db import "$BK/site-3-users.sql"
wp --path="$NEW" db import "$BK/site-3-usermeta.sql"
wp --path="$NEW" db query "SHOW TABLES"
```

Verify: every `wp_3_` table plus `wp_users` and `wp_usermeta`; the user count equals the number of IDs in `$IDS`
(`wp --path="$NEW" db query "SELECT COUNT(*) FROM wp_users"`).

## 6. WRITE: rename tables, the roles option and user meta keys

Back up first: `wp --path="$NEW" db export "$BK/target-before-rename.sql"`.

Generate the rename statements with a SELECT, read them, then run them:

```bash
wp --path="$NEW" db query --skip-column-names > "$BK/rename.sql" <<'SQL'
SELECT CONCAT('RENAME TABLE `', table_name, '` TO `wp_', SUBSTRING(table_name, CHAR_LENGTH('wp_3_') + 1), '`;')
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name LIKE 'wp\_3\_%'
ORDER BY table_name;
SQL
cat "$BK/rename.sql"
wp --path="$NEW" db query < "$BK/rename.sql"
wp --path="$NEW" db query "UPDATE wp_options SET option_name = 'wp_user_roles' WHERE option_name = 'wp_3_user_roles'"
```

- The SQL contains backticks. A quoted heredoc (`<<'SQL'`) passes it to the command unexpanded; an unquoted one
  would run the backticks as command substitution
  ([POSIX 2.7.4 Here-Document](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#tag_19_07_04)).
- `\_` matches a literal underscore in `LIKE`; a bare `_` matches any character
  ([MariaDB LIKE](https://mariadb.com/docs/server/reference/sql-functions/string-functions/like)).
- Each generated line renames one table. A single `RENAME TABLE` statement that fails changes nothing, so a failed
  line leaves that table under its old name; read the output and rerun only what is missing
  ([MariaDB RENAME TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/rename-table),
  [MySQL RENAME TABLE](https://dev.mysql.com/doc/refman/8.4/en/rename-table.html)).
- The roles option carries the prefix in its name: `wp_3_user_roles` must become `wp_user_roles` or the site has no
  roles ([`WP_Roles::for_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-roles.php#L342)).
- Then move the user meta keys: [users-and-roles.md](users-and-roles.md), "Direction A".

Verify:

```bash
wp --path="$NEW" db query "SHOW TABLES"                              # no wp_3_ names left
wp --path="$NEW" role list --fields=role,name                         # the site's roles
wp --path="$NEW" user list --fields=ID,user_login,roles               # everyone has the expected role
wp --path="$NEW" option get siteurl                                   # still the old address; fixed in step 7
```

## 7. WRITE: replace URLs and paths

Back up first: `wp --path="$NEW" db export "$BK/target-before-replace.sql"`. Read
[search-replace.md](search-replace.md) before this step.

Find the forms in use (read-only):

```bash
wp --path="$NEW" db search 'uploads/sites/3/' --all-tables-with-prefix --format=csv --fields=table,column | sort | uniq -c
wp --path="$NEW" db search 'network.example/blog-a' --all-tables-with-prefix --format=csv --fields=table,column | sort | uniq -c
wp --path="$NEW" db search 'network.example\/blog-a' --all-tables-with-prefix --format=csv --fields=table,column | sort | uniq -c
```

Dry run every pair, in this order, then run the same commands without `--dry-run`:

```bash
wp --path="$NEW" search-replace '//network.example/blog-a/wp-content/uploads/sites/3/' '//blog-a.example.com/wp-content/uploads/' --all-tables-with-prefix --skip-columns=guid --precise --report-changed-only --dry-run
wp --path="$NEW" search-replace '//network.example/wp-content/uploads/sites/3/' '//blog-a.example.com/wp-content/uploads/' --all-tables-with-prefix --skip-columns=guid --precise --report-changed-only --dry-run
wp --path="$NEW" search-replace '//network.example/blog-a/' '//blog-a.example.com/' --all-tables-with-prefix --skip-columns=guid --precise --report-changed-only --dry-run
wp --path="$NEW" option update home 'https://blog-a.example.com'
wp --path="$NEW" option update siteurl 'https://blog-a.example.com'
```

- Pairs without a scheme cover `http://`, `https://` and protocol-relative links. If the old site ran on `http`,
  finish with `http://blog-a.example.com` to `https://blog-a.example.com`.
- When the search found the JSON-escaped form, repeat the pairs with `\/` (for example
  `'\/\/network.example\/blog-a\/'` to `'\/\/blog-a.example.com\/'`).
- Links to other sites of the network (`//network.example/blog-b/`) stay as they are.
- Subdomain network: the pairs are `//blog-a.network.example/wp-content/uploads/sites/3/` and
  `//blog-a.network.example/`.
- Mapped domain that stays: only the uploads pair changes the path; also replace any network-address forms the
  search found from before the mapping.
- Some plugins store absolute server paths (`/srv/network/wp-content/uploads/sites/3/`). The `uploads/sites/3/`
  search shows them; replace them with their own pair to `/srv/blog-a/wp-content/uploads/`.
- `upload_path` and `upload_url_path` should be empty on the new install, because a value in either overrides
  `wp-content/uploads` ([`_wp_upload_dir()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L2467)).
  Check with `wp option get` and clear a network value with `wp option update upload_path ''`.

Verify: the searches above find matches only in `guid`, and
`wp --path="$NEW" option get home` prints the new address.

## 8. Plugins, theme, configuration

```bash
wp --path="$NEW" plugin list --skip-update-check --fields=name,status,version
wp --path="$NEW" plugin activate some-plugin        # WRITE, one per plugin that was network-active
wp --path="$NEW" theme list --skip-update-check --fields=name,status
wp --path="$NEW" eval 'var_dump( is_multisite() );' # bool(false)
wp --path="$NEW" rewrite flush
wp --path="$NEW" cron event list --fields=hook,next_run_relative
```

- Plugins that were active on the site are listed in the imported `active_plugins` option and count as active once
  their code is present. Network-active plugins were listed in the network option `active_sitewide_plugins`, which
  did not come along
  ([`is_plugin_active()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php#L539)).
  Activating them runs their activation hooks
  ([`activate_plugin()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php#L647)).
- Settings some plugins keep as network options: list the keys with
  `wp --path="$NET" site option list --fields=meta_key`
  ([wp site option list](https://developer.wordpress.org/cli/commands/site/option/list/)) and copy what the site
  needs with `wp option update`, as the plugin documents.
- Apache: use the single-site `.htaccess` block ([wp-config-and-server.md](wp-config-and-server.md)).
- If the new host has a persistent object cache, run `wp --path="$NEW" cache flush` once
  ([wp cache flush](https://developer.wordpress.org/cli/commands/cache/flush/)).
- Give the new site its own cron trigger: each site keeps its events in its own `cron` option and WP-Cron requests
  the current site's `wp-cron.php`
  ([`_get_cron_array()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1261),
  [`spawn_cron()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L961)).

## 9. Verify

Run the "Direction A" checklist in [verification-and-rollback.md](verification-and-rollback.md). Test the site
before DNS changes with a hosts-file entry for `blog-a.example.com` pointing at the new server.

## 10. Cut over

Rehearse steps 2 to 9 first. The production run:

1. Start the content freeze for the subsite; note the time.
2. Repeat steps 2 to 9 with the recorded commands, and verify.
3. Point DNS or the virtual host for `blog-a.example.com` at the new install, with TLS.
4. WRITE, network: add the redirects from [redirects.md](redirects.md), then archive the old site:
   `wp --path="$NET" site archive 3`. Visitors of an archived site get HTTP 410 and editors can no longer change the
   old copy; super admins still can. The check runs on every request, the dashboard included
   ([`ms_site_check()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-load.php#L74),
   [`wp-settings.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-settings.php#L782)).
   Verify with `wp --path="$NET" site list --site__in=3 --fields=blog_id,archived`.
5. Read-only check for edits made after the export:
   `wp --path="$NET" db query "SELECT MAX(post_modified_gmt) FROM wp_3_posts; SELECT MAX(comment_date_gmt) FROM wp_3_comments;"`
   Carry anything newer than the export over by hand.

## 11. After sign-off only (destructive, optional)

1. Take a fresh network backup and check it.
2. WRITE: `wp --path="$NET" site delete 3` drops the site's core tables, deletes the files in its uploads folder and
   removes its members. User accounts stay
   ([`wpmu_delete_blog()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/ms.php#L64),
   [`wp_uninitialize_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L784)).
3. Only tables listed by the `wpmu_drop_tables` filter are dropped; plugin tables that do not hook into it stay
   behind ([`wp_uninitialize_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L832)).
   List them with `wp --path="$NET" db tables 'wp_3_*' --all-tables` and drop them only after a backup of each.
4. Accounts that belonged only to this site stay in `wp_users`. `wp user delete <id> --network` also deletes that
   user's posts on every site they belong to
   ([`wpmu_delete_user()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/ms.php#L145));
   check `wp --path="$NET" site list --site_user=<id>` first.
5. Keep the redirects.

## The main site (blog_id 1)

- Its tables use the base prefix, so `--all-tables-with-prefix` would select the whole network. Build the list by
  hand: `wp --path="$NET" --url=https://network.example/ db tables --scope=blog --format=csv` gives the core tables;
  add the plugin tables the inventory lists as "base prefix, no site number" after reading each name.
- Members have `wp_capabilities`. With target prefix `wp_`, no table or key renames are needed; still remove the
  other sites' user meta keys ([users-and-roles.md](users-and-roles.md)).
- Uploads: `rsync -a --exclude=/sites/ "$NET/wp-content/uploads/" "$NEW/wp-content/uploads/"`; `sites/` holds the
  other sites' files
  ([`_wp_upload_dir()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L2467)).
- If the address changes, a pair such as `//network.example/` also rewrites links to subdirectory sites. Exclude
  them with a regular expression and check each change with `--dry-run --log`:
  `wp search-replace '//network\.example/(?!(?:blog-b|blog-c)/)' '//new.example/' --regex --all-tables-with-prefix --skip-columns=guid --dry-run --log`.
- Subdirectory networks may store `/blog/` at the start of the main site's permalink structure
  ([`options-permalink.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/options-permalink.php#L92)).
  Keep it to keep post URLs, or change it and add redirects.
- `wp site delete` refuses the main site, and core never drops the main site's tables
  ([`Site_Command::delete()`](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Site_Command.php#L349),
  [`wpmu_delete_blog()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/ms.php#L83)),
  so step 11 does not apply; extracting the main site usually goes with taking the whole network apart.

## Legacy networks (`ms_files_rewriting` on)

- Files: `rsync -a "$NET/wp-content/blogs.dir/3/files/" "$NEW/wp-content/uploads/"`.
- URLs: replace `//network.example/blog-a/files/` (subdomain: `//blog-a.network.example/files/`) with
  `//blog-a.example.com/wp-content/uploads/` before the site address pair.
- Options: clear `upload_path` and `upload_url_path` with `wp option update ... ''`; legacy sites were created
  with `upload_path` set to `wp-content/blogs.dir/3/files`
  ([`wp_initialize_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L731)).
  The handbook also lists `fileupload_url` for review
  ([Moving WordPress Multisite](https://developer.wordpress.org/advanced-administration/upgrade/migrating/#moving-wordpress-multisite));
  a search of the WordPress 7.1.2 release finds no code that reads it.
- The legacy files and URLs: [data-model.md](data-model.md), "Uploads". Add a redirect for the old `/files/` URLs
  ([redirects.md](redirects.md)).

## Content-only alternative

`wp export --url="$OLD"` writes WXR files with authors, terms, posts, comments and attachments, but no options and
no media files ([wp export](https://developer.wordpress.org/cli/commands/export/)). `wp import` drives the WordPress
Importer plugin, which must be installed on the new install, and maps authors with `--authors=create` or a mapping
CSV ([wp import](https://developer.wordpress.org/cli/commands/import/)). Use it only when losing settings, widgets,
roles and plugin data is acceptable.
