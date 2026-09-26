# Backups, verification and rollback

Checklists for both directions. Every check is read-only. Paths and addresses follow the examples in
[extract-subsite.md](extract-subsite.md) and [import-standalone.md](import-standalone.md).

## Backups

- `wp db export` runs `mysqldump` with the credentials from `wp-config.php`, exports every table in the database
  unless `--tables` is given, and passes other flags through to `mysqldump`.
  Source: [wp db export](https://developer.wordpress.org/cli/commands/db/export/)
- `--single-transaction` dumps InnoDB tables in a consistent state without locking them, which suits a live site;
  other engines are not covered by it. mysqldump's default `--opt` adds `DROP TABLE` before each `CREATE TABLE`,
  so importing a dump replaces tables of the same name.
  Sources: [MariaDB mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump),
  [MySQL mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)
- `wp db import` runs whatever SQL the file contains and does not create the database.
  Source: [wp db import](https://developer.wordpress.org/cli/commands/db/import/)

What to back up:

| Direction | Before the first write |
| --------- | ---------------------- |
| A | Network database; the site's uploads folder; network `wp-config.php` and `.htaccess` |
| B | Network database, `wp-config.php` and `.htaccess`; standalone database and its whole install folder |
| Both | Before each later WRITE step: the database that step changes (the step names the file) |

Check every backup:

```bash
sha256sum "$BK"/* > "$BK/SHA256SUMS"
grep -c '^CREATE TABLE' "$BK/network-full.sql"          # equals: wp --path=/srv/network db tables --all-tables | wc -l
tar -tzf "$BK/uploads-site-3.tar.gz" | wc -l             # not zero
```

A restore test is the only proof that a dump loads. With a MySQL account that may create databases, never with the
name of a live database:

```bash
mysql -e 'CREATE DATABASE restore_check_20260926'
mysql restore_check_20260926 < "$BK/network-full.sql"
mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'restore_check_20260926'"
mysql -e 'DROP DATABASE restore_check_20260926'
```

Backups hold password hashes and personal data: keep them outside every web root with owner-only permissions
(`chmod 600`), and delete them when the owner's retention period ends.

## Direction A checklist (new standalone install)

Take the row counts right after the URL replacement (extract runbook step 7), before plugins are activated.

| Check | Command | Expected |
| ----- | ------- | -------- |
| Not multisite | `wp --path="$NEW" eval 'var_dump( is_multisite() );'` | `bool(false)` |
| Row counts | `bash scripts/table-counts.sh --path="$NET" --prefix=wp_3_ > src.txt`, `bash scripts/table-counts.sh --path="$NEW" --prefix=wp_ > dst.txt`, `diff src.txt dst.txt` | Only the extra `users` and `usermeta` lines |
| Address | `wp --path="$NEW" option get home` and `siteurl` | `https://blog-a.example.com` |
| Leftovers | `wp --path="$NEW" db search 'network.example/blog-a' --all-tables-with-prefix --format=csv --fields=table,column \| sort \| uniq -c` | Only `wp_posts,guid` |
| Old media path | same with `'uploads/sites/3/'` | Only `wp_posts,guid` |
| Uploads location | `wp --path="$NEW" eval '$u = wp_get_upload_dir(); echo $u["basedir"], PHP_EOL, $u["baseurl"], PHP_EOL;'` | `/srv/blog-a/wp-content/uploads`, `https://blog-a.example.com/wp-content/uploads` |
| Files | `find` file counts in `$NET/wp-content/uploads/sites/3` and `$NEW/wp-content/uploads` | Equal |
| Members | `wp --path="$NEW" user list --format=count` | The source's `wp user list --url="$OLD" --format=count` |
| Owner | `wp --path="$NEW" user list --role=administrator --field=user_login` | At least one |
| No role-less users | `wp --path="$NEW" user list --role=none --format=count` | `0` |
| Roles | `wp --path="$NEW" role list --fields=role` | Same as `wp --path="$NET" --url="$OLD" role list --fields=role` |
| Plugins | `wp --path="$NEW" plugin list --status=active --skip-update-check --field=name` | The source's `active` plus `active-network` plugins that were moved |
| Theme | `wp --path="$NEW" option get stylesheet` and `template` | Same as the source |
| Permalinks | `wp --path="$NEW" option get permalink_structure` | Same as the source |
| Scheduled events | `wp --path="$NEW" cron event list --format=count` | Close to the source's count; a cron trigger exists |

Then, through a hosts-file entry before DNS changes, by a person: home page, a post, a page, a category, search,
a media file, the feed, and logging in as the owner.

Sample media URLs:

```bash
for id in $(wp --path="$NEW" post list --post_type=attachment --posts_per_page=5 --field=ID); do
  url=$(wp --path="$NEW" eval "echo wp_get_attachment_url( $id );")
  curl -s -o /dev/null -w "%{http_code} $url\n" "$url"
done
```

## Direction B checklist (network)

| Check | Command | Expected |
| ----- | ------- | -------- |
| Site row | `wp --path="$NET" site list --site__in=7 --fields=blog_id,domain,path,url,archived,public` | Final domain and path; archived until cut-over |
| Row counts | `diff "$BK/counts-stage-7.txt" "$BK/counts-net-7.txt"` | No output, or only tables a network plugin created with the site |
| Address | `wp --path="$NET" --url="$FINAL" option get home` and `siteurl` | The final address |
| Old media paths | `wp --path="$NET" --url="$FINAL" db search 'wp-content/uploads/(?!sites/7/)' --regex --all-tables-with-prefix --format=csv --fields=table,column \| sort \| uniq -c` | Only `wp_7_posts,guid`, plus links to other sites that you have read |
| Old domain (address moved) | `wp --path="$NET" --url="$FINAL" db search 'shop.example.org' --all-tables-with-prefix --format=csv --fields=table,column \| sort \| uniq -c` | Only `wp_7_posts,guid` |
| Uploads | `wp --path="$NET" --url="$FINAL" eval '$u = wp_get_upload_dir(); echo $u["basedir"], PHP_EOL;'` and `find ... \| wc -l` | `.../uploads/sites/7`; same file count as the standalone |
| Roles | `wp --path="$NET" --url="$FINAL" role list --fields=role` | The standalone site's roles |
| Members | `wp --path="$NET" --url="$FINAL" user list --fields=ID,user_login,roles` | Every mapped user with the intended role |
| Authors exist | SQL below | `0` |
| Authors are members | SQL below | No rows, or only ones you chose |
| Plugins | `wp --path="$NET" --url="$FINAL" plugin list --status=active --skip-update-check` | The standalone site's active plugins |
| Nothing network-activated by accident | `wp --path="$NET" site option get active_sitewide_plugins --format=json` | Same as before the move |
| Visibility | `wp --path="$NET" site list --site__in=7 --field=public` and `wp --path="$NET" --url="$FINAL" option get blog_public` | Equal |
| Rest of the network | `wp --path="$NET" site list --format=count`; `SELECT COUNT(*) FROM wp_users` | Before + 1; before + accounts created |

```sql
-- authors that do not exist
SELECT COUNT(*) FROM wp_7_posts p LEFT JOIN wp_users u ON u.ID = p.post_author
WHERE p.post_author <> 0 AND u.ID IS NULL;

-- authors that are not members of the site
SELECT DISTINCT p.post_author FROM wp_7_posts p
LEFT JOIN wp_usermeta m ON m.user_id = p.post_author AND m.meta_key = 'wp_7_capabilities'
WHERE p.post_author <> 0 AND m.user_id IS NULL;
```

Then the same manual front-end tests as direction A, through a hosts-file entry, plus the network's main site home
page.

## Rollback

Every rollback step is a write: back up the current state first (`wp db export`), then act, then verify.

### Before cut-over

- Direction A: the network was only read. Discard the new install and its database. Nothing else to undo.
- Direction B, targeted (preferred):
  1. `wp --path="$NET" site delete 7` drops the site's tables, deletes its uploads folder and removes its members
     ([`wp_uninitialize_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L784)).
  2. For each account created for the move (from the mapping file): `wp --path="$NET" site list --site_user=<id>`
     must list no site; then `wp --path="$NET" user delete <id> --network`.
  3. Remove theme and plugin folders that were added only for this site.
  4. Verify: site count, `SELECT COUNT(*) FROM wp_users` and `active_sitewide_plugins` equal the numbers from before
     the move.
- Direction B, full restore of `network-full.sql`: only when nothing else changed on the network since the backup.
  It rolls back every site, including edits made by other site owners in the meantime.

### After cut-over

- Direction A: remove the redirects on the network, point DNS back if it moved, run
  `wp --path="$NET" site unarchive 3`, and carry back by hand whatever was published on the standalone install since
  cut-over.
- Direction B: point DNS back to the untouched standalone server, or remove the redirect virtual host; run
  `wp --path="$NET" site archive 7`; carry back content created on the subsite since cut-over.
- Rollback stays cheap only while the old copy is unchanged. Keep it read-only until the owner signs off, and record
  the sign-off date in the report.
