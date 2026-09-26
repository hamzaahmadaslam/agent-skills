# Standalone install to subsite

Step-by-step runbook for direction B. Facts behind each step, with sources, are in [data-model.md](data-model.md),
[users-and-roles.md](users-and-roles.md), [search-replace.md](search-replace.md) and
[wp-cli-commands.md](wp-cli-commands.md).

The worked example is synthetic: the standalone site `https://shop.example.org` (table prefix `wp_`) joins the
network at `https://network.example` (base prefix `wp_`) and receives blog_id 7. The main case keeps its own domain
through core domain mapping; the variant where it moves to `https://network.example/shop/` is noted where it
differs. Replace every example value, including `wp_`, `7` and `wp_7_` inside SQL, with your own.

```bash
SRC=/srv/shop                     # standalone install, only read until cut-over
STAGE=/srv/shop-stage             # staging copy of the standalone: its files and its own database
NET=/srv/network                  # network install
FINAL=https://shop.example.org    # the subsite's address after the move
BK=/srv/backups/shop-20260926     # backup folder outside every web root
```

All bulk SQL runs in the staging copy. The network receives only WP-CLI writes (the new site, accounts, roles) and
one import of prepared tables that belong to the new site.

## 1. Inventory and compatibility (read-only)

```bash
mkdir -p "$BK"
bash scripts/inventory.sh --path="$SRC" > "$BK/inventory-standalone.txt"
bash scripts/inventory.sh --path="$NET" --url=https://network.example/ > "$BK/inventory-network.txt"
wp --path="$SRC" core version --extra
wp --path="$NET" core version --extra
bash scripts/user-conflicts.sh --standalone-path="$SRC" --network-path="$NET" > "$BK/user-conflicts.txt"
wp --path="$SRC" eval 'require_once ABSPATH . "wp-admin/includes/plugin.php"; foreach ( get_plugins() as $f => $d ) { if ( $d["Network"] ) { echo $f, PHP_EOL; } }'
```

- The network's WordPress version and database revision are the same as the standalone site's or newer. If the
  standalone site is newer, update the network first, as a separate change.
- Every plugin and theme the standalone site uses exists on the network, ideally at the same version, or you have
  the network administrator's agreement to install it. Plugins and themes are installed once for the whole network
  ([Multisite Network Administration](https://developer.wordpress.org/advanced-administration/multisite/administration/#plugins)).
- The last command lists plugins with `Network: true` in their header. Activating one of those on one site activates
  it for the whole network
  ([`activate_plugin()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php#L647),
  [plugins-and-themes.md](plugins-and-themes.md)).
- `upload_path` and `upload_url_path` on the standalone site should be empty and `UPLOADS` undefined; otherwise its
  files are not in `wp-content/uploads` and the paths below change
  ([`_wp_upload_dir()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L2467)).
- Decide the final address: its own domain (`shop.example.org`, mapped) or an address inside the network.

## 2. Back up both installs and check the backups

```bash
wp --path="$NET" db export "$BK/network-full.sql" --single-transaction
cp "$NET/wp-config.php" "$BK/network-wp-config.php"; [ -f "$NET/.htaccess" ] && cp "$NET/.htaccess" "$BK/network.htaccess"
wp --path="$SRC" db export "$BK/standalone-full.sql" --single-transaction
tar -czf "$BK/standalone-files.tar.gz" -C "$SRC" .
sha256sum "$BK"/* > "$BK/SHA256SUMS"
```

Check each dump's `CREATE TABLE` count against `wp db tables --all-tables | wc -l` on the same install; a restore test
is in [verification-and-rollback.md](verification-and-rollback.md).

## 3. Staging copy of the standalone site

```bash
rsync -a "$SRC/" "$STAGE/"
wp --path="$STAGE" config set DB_NAME shop_stage          # a new, empty database; never the live one
wp --path="$STAGE" config set DISABLE_WP_CRON true --raw  # the copy must not run scheduled tasks
wp --path="$STAGE" config get DB_NAME                     # must print shop_stage: stop here if it does not
wp --path="$STAGE" db create
wp --path="$STAGE" db import "$BK/standalone-full.sql"
bash scripts/table-counts.sh --path="$SRC" --prefix=wp_ > "$BK/counts-src.txt"
bash scripts/table-counts.sh --path="$STAGE" --prefix=wp_ > "$BK/counts-stage.txt"
diff "$BK/counts-src.txt" "$BK/counts-stage.txt"          # no output
```

Run `db create` and `db import` only after `config get DB_NAME` printed the new name: the dump drops and recreates
every table it holds, so an import into the live database would replace the live site's tables. The staging copy
is not served to visitors, and `DISABLE_WP_CRON` stops it from running scheduled tasks
([wp-config.php, Disable Cron](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/#disable-cron-and-cron-timeout)).
A difference in the `diff` means the live site changed after the dump; in the production run, take the dump after
the content freeze starts.

## 4. WRITE, network: create the empty site

```bash
N=$(wp --path="$NET" site create --slug=shop --title="Shop" --porcelain)
echo "$N"                                                   # 7 in this example
wp --path="$NET" site archive "$N"                          # visitors get 410 until cut-over
wp --path="$NET" site list --site__in="$N" --fields=blog_id,url,domain,path,archived
```

- Without `--email`, WP-CLI uses the first super admin as the site's administrator and creates no account. With an
  email that has no account, it creates one and sends the new-user notification to that address and to the admin
  ([`Site_Command::create()`](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Site_Command.php#L433)).
  Independently, core emails the network admin about every new site when the network option
  `registrationnotification` is `yes`
  ([`newblog_notify_siteadmin()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php#L1482));
  check with `wp --path="$NET" site option get registrationnotification`.
- On a subdirectory network the slug cannot be `page`, `comments`, `blog`, `files`, `feed`, `wp-admin`,
  `wp-content`, `wp-includes`, `wp-json` or `embed`
  ([`get_subdirectory_reserved_names()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php#L2764)),
  and should not match a page slug of the main site, whose page would become unreachable
  ([Permalinks in Subdirectory Installs](https://developer.wordpress.org/advanced-administration/multisite/administration/#permalinks-in-subdirectory-installs)).
- Creating the site deletes any existing `wp_7_capabilities` rows, so roles are assigned only after this step
  ([`wp_initialize_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L749)).
- An archived site answers visitors with HTTP 410; WP-CLI still works on it
  ([`ms_site_check()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-load.php#L122),
  [WP-CLI `Runner.php`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1544)).
- Keeping its own domain: set the Site Address (URL) to `https://shop.example.org` on Network Admin > Sites > Edit
  ([Domain Mapping](https://developer.wordpress.org/advanced-administration/multisite/domain-mapping/#update-wordpress)).
  WP-CLI has no subcommand that changes a site's domain
  ([`Site_Command.php`](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Site_Command.php)); the same change
  from the command line (WRITE):
  ```bash
  wp --path="$NET" eval 'var_dump( update_blog_details( 7, array( "domain" => "shop.example.org", "path" => "/" ) ) );'
  wp --path="$NET" --url="$FINAL" option update home 'https://shop.example.org'
  wp --path="$NET" --url="$FINAL" option update siteurl 'https://shop.example.org'
  ```
  DNS still points at the old server; that changes at cut-over ([domain-mapping.md](domain-mapping.md)).
- Read where the site's media will live (read-only):
  ```bash
  wp --path="$NET" --url="$FINAL" eval '$u = wp_get_upload_dir(); echo $u["baseurl"], PHP_EOL, $u["basedir"], PHP_EOL;'
  ```
  Expected: `https://shop.example.org/wp-content/uploads/sites/7` and `/srv/network/wp-content/uploads/sites/7`.
  Legacy networks with `ms_files_rewriting` on give `.../files` and `wp-content/blogs.dir/7/files` instead
  ([`_wp_upload_dir()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L2467)).
  `wp_get_upload_dir()` does not create the folder
  ([`wp_get_upload_dir()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L2355)).

## 5. WRITE, network: accounts

Follow [users-and-roles.md](users-and-roles.md), direction B, steps 1 and 2: reuse network accounts with the same
email, create the others with `--role=subscriber` on the new site, and write `$BK/user-map.csv` (`old_id,new_id`)
and `$BK/users-created.txt` (the new ID of each account you created, one per line; a rollback deletes only these).

## 6. WRITE, staging copy: prepare the site's tables

Back up first: `wp --path="$STAGE" db export "$BK/stage-before-transform.sql"`.

a. Renumber user references: [users-and-roles.md](users-and-roles.md), direction B, step 3.

b. Replace the uploads path and, if it changes, the address. Find the forms in use first (read-only):

```bash
wp --path="$STAGE" db search 'wp-content/uploads/' --all-tables-with-prefix --format=csv --fields=table,column | sort | uniq -c
wp --path="$STAGE" db search 'wp-content\/uploads\/' --all-tables-with-prefix --format=csv --fields=table,column | sort | uniq -c
```

Keeping the domain, only the path changes. The new path contains the old one, so a second run would double it; use
a regular expression that skips values already done ([search-replace.md](search-replace.md)), dry run, then run:

```bash
wp --path="$STAGE" search-replace '//shop\.example\.org/wp-content/uploads/(?!sites/7/)' '//shop.example.org/wp-content/uploads/sites/7/' --regex --all-tables-with-prefix --skip-columns=guid --report-changed-only --dry-run
```

For the JSON-escaped form (PHP's `json_encode()` writes `/` as `\/` by default,
[PHP JSON constants](https://www.php.net/manual/en/json.constants.php)) use plain mode, run it once, and compare the
count with the dry run: `'\/\/shop.example.org\/wp-content\/uploads\/'` to
`'\/\/shop.example.org\/wp-content\/uploads\/sites\/7\/'`.
Root-relative links (`src="/wp-content/uploads/...`), if the search shows them, need
`'(=")/wp-content/uploads/(?!sites/7/)'` to `'$1/wp-content/uploads/sites/7/'` with `--regex`; check each change
with `--log`.

Moving to `https://network.example/shop/`, the new strings do not contain the old ones, so plain mode is safe. In
this order:

```bash
wp --path="$STAGE" search-replace '//shop.example.org/wp-content/uploads/' '//network.example/shop/wp-content/uploads/sites/7/' --all-tables-with-prefix --skip-columns=guid --precise --report-changed-only --dry-run
wp --path="$STAGE" search-replace '//shop.example.org/' '//network.example/shop/' --all-tables-with-prefix --skip-columns=guid --precise --report-changed-only --dry-run
wp --path="$STAGE" option update home 'https://network.example/shop'
wp --path="$STAGE" option update siteurl 'https://network.example/shop'
```

Verify: `wp --path="$STAGE" db search 'uploads/sites/7/sites/'` finds nothing, and a search for the old form finds
only `guid` values.

c. Rename the tables to the site prefix. Generate, read, run:

```bash
wp --path="$STAGE" db query --skip-column-names > "$BK/rename-7.sql" <<'SQL'
SELECT CONCAT('RENAME TABLE `', table_name, '` TO `wp_7_', SUBSTRING(table_name, CHAR_LENGTH('wp_') + 1), '`;')
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name LIKE 'wp\_%'
  AND table_name NOT IN ('wp_users', 'wp_usermeta')
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
SQL
cat "$BK/rename-7.sql"
wp --path="$STAGE" db query < "$BK/rename-7.sql"
wp --path="$STAGE" db query "UPDATE wp_7_options SET option_name = 'wp_7_user_roles' WHERE option_name = 'wp_user_roles'"
```

The site's role definitions are read from the option `{site prefix}user_roles`, hence the second statement
([`WP_Roles::for_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-roles.php#L342)).
If the standalone prefix differs from the network's base prefix, the new names are base prefix + `7_` + the part
after the old prefix, and the roles option becomes `{base prefix}7_user_roles`. After this step WordPress on the
staging copy no longer loads (its prefix points at renamed tables); `wp db export`, `import` and `query` still work
because they load only `wp-config.php`
([`DB_Command.php`](https://github.com/wp-cli/db-command/blob/v2.1.3/src/DB_Command.php#L26)).

d. Export only the site tables and check the dump:

```bash
T=$(wp --path="$STAGE" db query "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'wp\_7\_%' ORDER BY table_name" --skip-column-names | paste -s -d, -)
wp --path="$STAGE" db export "$BK/site-7-ready.sql" --tables="$T"
grep -o 'CREATE TABLE `[^`]*`' "$BK/site-7-ready.sql" | grep -v '`wp_7_'          # must print nothing
grep -o 'DROP TABLE IF EXISTS `[^`]*`' "$BK/site-7-ready.sql" | grep -v '`wp_7_'  # must print nothing
bash scripts/table-counts.sh --path="$STAGE" --prefix=wp_7_ > "$BK/counts-stage-7.txt"
```

The two `grep` checks are the guard against dropping a network table on import. Do not continue if either prints a
line.

## 7. WRITE, network: import the site's tables

```bash
wp --path="$NET" db export "$BK/net-site-7-default.sql" --tables="$(wp --path="$NET" --url="$FINAL" db tables --all-tables-with-prefix --format=csv)"
wp --path="$NET" db import "$BK/site-7-ready.sql"
bash scripts/table-counts.sh --path="$NET" --prefix=wp_7_ > "$BK/counts-net-7.txt"
diff "$BK/counts-stage-7.txt" "$BK/counts-net-7.txt"
wp --path="$NET" cache flush
wp --path="$NET" --url="$FINAL" option get home
wp --path="$NET" --url="$FINAL" role list --fields=role
```

- The import replaces the default tables that `site create` made: each table in the dump is preceded by
  `DROP TABLE IF EXISTS`
  ([mariadb-dump `--opt`](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)).
  A `wp_7_` table that a network-active plugin created with the site and the standalone site did not have stays;
  the `diff` shows it.
- With a persistent object cache, `wp cache flush` usually flushes every site of the network
  ([wp cache flush](https://developer.wordpress.org/cli/commands/cache/flush/)). Run it in a quiet period; it is
  needed so no cached options of the empty site survive.

## 8. WRITE, network: roles, media, theme, plugins

```bash
# roles: users-and-roles.md, direction B, step 4 (wp user set-role for each mapped user)
rsync -a "$SRC/wp-content/uploads/" "$NET/wp-content/uploads/sites/7/"
find "$SRC/wp-content/uploads" -type f | wc -l
find "$NET/wp-content/uploads/sites/7" -type f | wc -l
wp --path="$NET" --url="$FINAL" theme enable shop-child          # and its parent theme
wp --path="$NET" --url="$FINAL" plugin list --status=active --skip-update-check
wp --path="$NET" --url="$FINAL" rewrite flush
wp --path="$NET" site list --site__in=7 --field=public
wp --path="$NET" --url="$FINAL" option get blog_public
```

- Give the copied files the same owner and permissions as the other sites' folders.
- Theme and plugin folders that the network lacks go into `$NET/wp-content/themes` and `$NET/wp-content/plugins`.
  `wp theme enable` without `--network` allows the theme on this site only
  ([wp theme enable](https://developer.wordpress.org/cli/commands/theme/enable/)); the imported `stylesheet` and
  `template` options already select it
  ([`get_stylesheet()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/theme.php#L181)).
- The imported `active_plugins` option activates the site's plugins as soon as their code exists
  ([`is_plugin_active()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php#L539)).
  A plugin that is also network-active loads once
  ([`wp_get_active_and_valid_plugins()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L1013)).
  Do not run `wp plugin activate` for a `Network: true` plugin on this site.
- `wp rewrite flush --hard` works only on single-site installs; on the network use `wp rewrite flush`
  ([wp rewrite flush](https://developer.wordpress.org/cli/commands/rewrite/flush/)).
- If `public` and `blog_public` differ, align them with `wp site public 7` or `wp site private 7`; a change of the
  `public` flag updates the option through a core hook
  ([`ms-default-filters.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-filters.php#L55)).
- The site's scheduled events need a cron trigger that reaches this site: each site keeps its own `cron` option
  ([`_get_cron_array()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1261)).

## 9. Verify

Run the "Direction B" checklist in [verification-and-rollback.md](verification-and-rollback.md). Test the mapped
domain before the DNS change with a hosts-file entry pointing `shop.example.org` at the network server.

## 10. Cut over

Rehearse steps 2 to 9 on a staging copy of the network first. The production run:

1. Start the content freeze on the standalone site; note the time.
2. Repeat steps 2 to 9 with the recorded commands, and verify.
3. Keeping the domain: point DNS for `shop.example.org` at the network server, with a TLS certificate for it. If
   logging in to the mapped site fails, see the `COOKIE_DOMAIN` note in [domain-mapping.md](domain-mapping.md).
4. WRITE: `wp --path="$NET" site unarchive 7`.
5. Add the redirects from [redirects.md](redirects.md): old media paths to `uploads/sites/7/` when the domain stays;
   the whole old domain to the new address when it moves.
6. Keep the standalone install and its database unchanged until sign-off.

## Content-only alternative (WXR)

The handbook's route for bringing sites into a network is WordPress export and import: export a WXR file, create
the site, import it with author mapping and attachment download, then copy themes and plugins and redo settings by
hand ([Migrate WordPress sites into WordPress Multisite](https://developer.wordpress.org/advanced-administration/multisite/sites-multisite/)).
Its limits, from the same page: widget configuration and site or plugin settings are not exported, and imported
users get no roles or other details. WP-CLI's `wp export` writes WXR files without options and without the media
files, and `wp import` drives the WordPress Importer plugin, which must be installed
([wp export](https://developer.wordpress.org/cli/commands/export/),
[wp import](https://developer.wordpress.org/cli/commands/import/)). The old site must stay reachable while the
importer fetches attachments. Choose this route only for content-only sites.
