# Phase 1: build a safe workspace

Read this after intake. The goal is a working copy of the files, a throwaway database holding the dump, and an
inventory of what you received. Nothing here touches the live site, and nothing here runs the site's code.

## 1. Folder layout

Create this structure outside the site tree:

```text
WORK/
  original/      the archive and the .sql exactly as received; never edited
  site/          extracted files; this is what you scan and clean
  db/            working copies of the dump, and the throwaway server's data folder
  quarantine/    every file you remove, with its path preserved
  evidence/      logs, query output, checksum files, notes, screenshots
  clean/         the finished cleaned file set and cleaned dump
```

Keep `quarantine/` outside `site/`, so a cleaned archive can never carry malware back to the server. Make the files in
`original/` read-only (`chmod a-w WORK/original/*`, or `attrib +r` on Windows) so no tool writes into them.

## 2. Extract the archive without running anything

Extraction is safe; executing is not. Never open extracted PHP in a browser, and never run it.

```sh
tar -xf backup.tar -C WORK/site
```

On Windows with Git Bash, add `--force-local`. GNU tar treats an archive name with a colon in it as a file on a remote
machine, the part before the colon being the host name, so `C:/backups/backup.tar` fails as a remote host called `C`;
`--force-local` makes it a local file
([tar(1)](https://man7.org/linux/man-pages/man1/tar.1.html)):

```sh
tar --force-local -xf "C:/backups/backup.tar" -C "C:/WORK/site"
```

For a `.zip`, use `unzip -q backup.zip -d WORK/site`. For a `.wpress` archive (All-in-One WP Migration), ask for a
normal archive, or use the third-party `wpress-extract` command-line tool
([wpress-extract on npm](https://www.npmjs.com/package/wpress-extract)); installing it is a change to your machine, so
ask first.

### Check that the extraction is complete

List the archive first and compare the counts:

```sh
tar --force-local -tvf backup.tar > WORK/evidence/archive-listing.txt
grep -c '^-' WORK/evidence/archive-listing.txt        # regular files in the archive
find WORK/site -type f | wc -l                        # files on disk
```

If the second number is lower, something removed files during extraction. The usual cause is antivirus software
quarantining a web shell as it was written. That is worth knowing, not worth panic: note which files disappeared,
because they are almost certainly malicious.

Symbolic link errors during extraction are normal for managed hosts and on Windows. Record them.

### Do not run WP-CLI inside the copy

WP-CLI reads `wp-cli.local.yml` and `wp-cli.yml` from the current directory and its parents, and a `require:` line in
those files loads a PHP file before the command runs
([WP-CLI config](https://make.wordpress.org/cli/handbook/references/config/)). Every command that loads WordPress, and
the `wp db` commands, also run the code in `wp-config.php`
([Runner.php L1301-L1374 at v2.12.0](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1301-L1374)).
Look for these files in the copy and read them as evidence:

```sh
find WORK -name 'wp-cli*.yml'
```

The only WP-CLI command this skill runs on the copy is `wp core verify-checksums`, from a directory outside `WORK/`,
because it runs before WordPress loads and reads `wp-includes/version.php` as text (phase 2, step 1).

## 3. Inventory what you received

```sh
cd WORK/site
grep -nE 'table_prefix|define[(]' wp-config.php | grep -viE 'PASSWORD|_KEY|_SALT'   # constants, without secrets
grep -nE 'wp_version =|wp_local_package' wp-includes/version.php
ls -la                        # root files: note anything that is not WordPress core
ls -la wp-content             # drop-ins live here
ls -la wp-content/mu-plugins  # these run on every request and cannot be disabled from the dashboard
ls wp-content/plugins
ls wp-content/themes
```

The second `grep` in the first line keeps database passwords, keys and salts out of your notes. `$wp_local_package`,
when present, is the locale of the release, which the core checksum download needs; WP-CLI reads the same two values
([Checksum_Core_Command.php L244-L270 at v2.3.7](https://github.com/wp-cli/checksum-command/blob/v2.3.7/src/Checksum_Core_Command.php#L244-L270)).

Write down the WordPress version, the table prefix, any caching or security plugin, and every root-level file that is
not part of WordPress. A stock root holds `index.php`, `license.txt`, `readme.html`, `wp-activate.php`,
`wp-blog-header.php`, `wp-comments-post.php`, `wp-config-sample.php`, `wp-cron.php`, `wp-links-opml.php`,
`wp-load.php`, `wp-login.php`, `wp-mail.php`, `wp-settings.php`, `wp-signup.php`, `wp-trackback.php` and `xmlrpc.php`
(the root entries of the core checksum list,
[api.wordpress.org/core/checksums/1.0/](https://api.wordpress.org/core/checksums/1.0/?version=6.8.2&locale=en_US)),
plus `wp-admin/`, `wp-includes/`, `wp-content/`, `wp-config.php` and usually `.htaccess`. Anything extra deserves a
look. In one investigation, a root file with a harmless-looking name turned out to be a renamed copy of
`wp-login.php`, serving the login and registration forms at an address that protections keyed to `wp-login.php` did
not cover.

## 4. Load the database into a throwaway server

Never import the dump into a database server that holds anything you care about, and never point a running WordPress
at it.

### Preferred: a temporary server on its own port and data folder

This leaves any local development stack untouched.

```sh
MYSQLD=/path/to/mysqld
DATA=WORK/db/throwaway
rm -rf "$DATA" && mkdir -p "$DATA"
"$MYSQLD" --no-defaults --initialize-insecure --datadir="$DATA" --console
"$MYSQLD" --no-defaults --datadir="$DATA" --port=3307 --bind-address=127.0.0.1 --mysqlx=OFF --skip-log-bin \
  --max_allowed_packet=1G --console &
mysqladmin -h127.0.0.1 -P3307 -uroot --wait=40 ping
```

| Option | Why | Source |
| --- | --- | --- |
| `--no-defaults` | Reads no option files, so the settings of any installed server do not apply. Options of this kind must come before all others | [Option file options](https://dev.mysql.com/doc/refman/8.4/en/option-file-options.html) |
| `--initialize-insecure` | Creates the data folder with a `root` account that has no password; acceptable only because the server listens on 127.0.0.1 and is deleted afterwards. The data folder must be new or empty | [Initializing the data directory](https://dev.mysql.com/doc/refman/8.4/en/data-directory-initialization.html) |
| `--console` | On Windows, prints startup messages to the console | same |
| `--mysqlx=OFF` | Turns off X Plugin, which otherwise listens on port 33060 and can clash with an installed server | [X Plugin options](https://dev.mysql.com/doc/refman/8.4/en/x-plugin-options-system-variables.html) |
| `--skip-log-bin` | Binary logging is on by default in MySQL 8.4; a throwaway copy does not need it | [Binary log options](https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html) |
| `--max_allowed_packet=1G` | Large option rows and extended inserts need a large packet; 1 GB is the maximum | [mysql client options](https://dev.mysql.com/doc/refman/8.4/en/mysql-command-options.html) |

Connect with `-h127.0.0.1 -P3307 -uroot`. When you are finished, shut the server down and delete its data folder: it
holds a full copy of the site's personal data.

```sh
mysqladmin -h127.0.0.1 -P3307 -uroot shutdown
rm -rf WORK/db/throwaway
```

### Fix the dump before importing

Work on a copy in `WORK/db/`, never on the file in `original/`.

**MariaDB dumps into MySQL.** Since the releases of May 17, 2024 (10.5.25, 10.6.18, 10.11.8, 11.0.6, 11.1.5, 11.2.4 and
11.4.2), `mariadb-dump` writes `/*!999999\- enable the sandbox mode */` as the first line; older MariaDB clients and
every MySQL client reject it
([MariaDB dump file compatibility change](https://mariadb.org/mariadb-dump-file-compatibility-change/)). Recent
MariaDB versions also default to `utf8mb4_uca1400_ai_ci` and the other UCA 14.0.0 collations
([Setting character sets and collations](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations)),
which MySQL does not have (none appear in its
[Unicode character sets](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-sets.html)). Remove the line and map
the collations:

```sh
sed '1{/enable the sandbox mode/d}' WORK/original/site.sql \
  | sed 's/utf8mb3_uca1400_ai_ci/utf8mb3_unicode_ci/g; s/utf8mb4_uca1400_ai_ci/utf8mb4_unicode_ci/g' \
  > WORK/db/import.sql
```

`scripts/fix-export.mjs` makes the same kind of changes (`--strip-mariadb-sandbox`, `--collation-downgrade`) and never
touches row data; phase 6 uses it to prepare the cleaned dump for the target server.

**Old MySQL 5.x dumps into MySQL 8.** The default SQL mode of MySQL 8.4 includes strict mode and `NO_ZERO_DATE`, which
together reject `'0000-00-00'` dates ([Server SQL modes](https://dev.mysql.com/doc/refman/8.4/en/sql-mode.html)). Most
dumps set a relaxed `SQL_MODE` in their header. If the import still complains about zero dates, import with a relaxed
mode for that session.

Then import:

```sh
mysql -h127.0.0.1 -P3307 -uroot -e "CREATE DATABASE scan DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -h127.0.0.1 -P3307 -uroot --default-character-set=utf8mb4 --max_allowed_packet=1G scan \
  < WORK/db/import.sql 2> WORK/evidence/import-errors.txt
wc -l WORK/evidence/import-errors.txt
```

### Verify the dump is complete

Do this before trusting any "clean" result. Replace `{prefix}` as described in [00-intake.md](00-intake.md).

```sql
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'scan';
SELECT (SELECT COUNT(*) FROM {prefix}posts)   AS posts,
       (SELECT COUNT(*) FROM {prefix}options) AS options,
       (SELECT COUNT(*) FROM {prefix}users)   AS users;
```

Zero rows in `options` or `users` means you were given a partial export. Go back and ask for a full one.

## 5. Pitfalls that will otherwise waste your time

- **MySQL 8 stops long regular expression matches** with error 3699, "Timeout exceeded in regular expression match"
  ([server error reference](https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html)). The limits are
  `regexp_time_limit` (default 32, counted in steps of the match engine) and `regexp_stack_limit` (default 8,000,000
  bytes); both are global only, and both accept up to 2,147,483,647
  ([server system variables](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_regexp_time_limit)).
  Raise them once on the throwaway server, never on a live one:

  ```sql
  SET GLOBAL regexp_time_limit = 2000000000;
  SET GLOBAL regexp_stack_limit = 64000000;
  ```

- **The `mysql` client stops at the first error** in a file unless you pass `--force`, "Continue even if an SQL error
  occurs" ([mysql client options](https://dev.mysql.com/doc/refman/8.4/en/mysql-command-options.html)). Run query
  files with `--force` so one failing query (a plugin table that does not exist, say) does not skip everything after
  it.
- **MySQL on Windows lowercases table names.** `lower_case_table_names` defaults to 1 on Windows, which stores table
  names in lowercase; it can only be set when the data folder is initialized, and even the value 2 stores InnoDB table
  names in lowercase
  ([identifier case sensitivity](https://dev.mysql.com/doc/refman/8.4/en/identifier-case-sensitivity.html),
  [lower_case_table_names](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_lower_case_table_names)).
  A prefix like `Ab3_` becomes `ab3_`, and a dump exported from this server breaks the site on Linux, where the
  default is 0 and names are case-sensitive. It matters when you export the cleaned database in phase 5:
  [06-restore.md](06-restore.md) fixes it with `scripts/fix-export.mjs`.
- **Tools and backslashes.** Scripts and queries typed through an agent's tool calls can lose backslashes.
  [traps.md](traps.md) lists this and the other traps; read it before writing any script or query.

## Output of this phase

- `WORK/site/` extracted, with a file count that matches the archive listing, or a list of the files that went
  missing.
- The dump imported, with the table, post, option and user counts recorded.
- The scope block updated with the WordPress version, the table prefix, and anything odd in the root.

Next: [02-file-scan.md](02-file-scan.md).
