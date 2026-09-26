# Changes, each with an export, a check and a tested undo

Every step in this file changes the site. Before each one, state the step, its export, its check and its undo, and
wait for the site owner's approval of that step. Try each kind of change on a staging copy first, including its undo
("Test the undo on staging" below), then repeat it on production at a quiet hour. Change one option, or one group
of options with the same owner, at a time, and measure before and after the same way (`measuring.md`).

In the commands, `wp_options` stands for the site's options table (`wp db prefix`, plus `--url=<site>` on
multisite, gives the prefix), and `opt_a`, `opt_b` stand for the option names you are changing.

## Exports

### 1. The whole options table, for disaster recovery

```sh
wp db export /path/outside/webroot/options-full-$(date -u +%Y%m%d-%H%M).sql --tables=wp_options --single-transaction
```

`wp db export` runs `mysqldump`, or `mariadb-dump` when the client is MariaDB's, with the site's credentials and
passes extra flags through ([wp db export](https://developer.wordpress.org/cli/commands/db/export/);
[utils.php L1941-L1943 at v2.12.0](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/utils.php#L1941-L1943)).
This file holds `DROP TABLE` and `CREATE TABLE`: importing it replaces the whole table and rolls back every option
changed since, including the plugins' own saves. Keep it for an emergency; never use it to undo one change on a live
site.

### 2. The rows you will change or delete

```sh
wp db export /path/outside/webroot/rows-$(date -u +%Y%m%d-%H%M).sql --tables=wp_options \
  --where="option_name IN ('opt_a','opt_b')" \
  --no-create-info=true --insert-ignore --skip-extended-insert --skip-add-locks --single-transaction
```

| Flag | Effect | Source |
| --- | --- | --- |
| `--where` | Only the listed rows | [MySQL mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html), [MariaDB mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump) |
| `--no-create-info=true` | No `CREATE TABLE`, and so no `DROP TABLE`, which mysqldump writes only together with `CREATE TABLE` | [mysqldump.cc L2965-L3004 at mysql-8.4.11](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/client/mysqldump.cc#L2965-L3004) |
| `=true` on that flag | WP-CLI reads `--no-<name>` as "`<name>` is false", so this flag needs an explicit value; WP-CLI's own example writes it this way | [Configurator.php L187-L188 at v2.12.0](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Configurator.php#L187-L188), [DB_Command.php L602 at 2.1.3](https://github.com/wp-cli/db-command/blob/v2.1.3/src/DB_Command.php#L602) |
| `--insert-ignore` | `INSERT IGNORE` statements: on import, a row whose name or ID already exists is skipped, so the file can put back deleted rows but never overwrites a newer value | [mysqldump.cc L468-L470](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/client/mysqldump.cc#L468-L470), MariaDB page above |
| `--skip-extended-insert` | One statement per row, easy to count and read | MySQL and MariaDB pages above |
| `--skip-add-locks` | No `LOCK TABLES` around the inserts | [mysqldump.cc L275-L276](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/client/mysqldump.cc#L275-L276), MariaDB page above |
| `--single-transaction` | A consistent read without locking InnoDB tables | MySQL and MariaDB pages above |

Check the file before relying on it (read-only):

```sh
grep -cE '^(DROP|CREATE) TABLE' rows-*.sql      # must print 0
grep -c '^INSERT IGNORE INTO' rows-*.sql         # must equal the number of names
```

The file holds option values, which can include licence keys, API tokens and mail passwords. Write it outside the
web root, keep it out of chats, tickets and repositories, and delete it when the owner's retention period ends.

### 3. The state of those rows (read-only)

Record the autoload values and a fingerprint before the change; the undo is proven when the fingerprint matches
again:

```sh
wp option get-autoload opt_a        # prints the raw column value, for example auto-on
wp db query "SELECT option_id, option_name, autoload, LENGTH(option_value) AS size_bytes, MD5(option_value) AS value_md5 FROM wp_options WHERE option_name IN ('opt_a','opt_b') ORDER BY option_name"
```

([wp option get-autoload](https://developer.wordpress.org/cli/commands/option/get-autoload/);
[Option_Command.php L457-L473 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L457-L473))

## Test the undo on staging, once per kind of change

1. On a staging copy of production, take exports 2 and 3.
2. Make the change exactly as planned for production.
3. Undo it with the steps given for that change below, then clear the cache keys (next section).
4. Run the fingerprint query again. The rows must match step 1: same names, autoload values, sizes and hashes.
5. Load the front page, a post, the admin dashboard and the owner plugin's screens; check the PHP error log.

Only then plan the production change, and say in the report that the undo was tested and how.

## Cache keys after an undo or any SQL change

With a persistent object cache (`wp cache type`), delete the keys that may hold the old state:

```sh
wp cache delete alloptions options
wp cache delete notoptions options
wp cache delete opt_a options
```

Add `--url=<site>` on multisite. "The object was not deleted." only means the key was not there. Why these three:
`object-cache.md`.

## Switch autoload off

- Export: 1, 2 and 3 above.
- Command, through core, which also updates the cache
  ([option.php L482-L502, L548-L551](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L482-L502)):

  ```sh
  wp eval 'var_dump( wp_set_option_autoload( "opt_a", false ) );'     # bool(true) when it changed
  ```

  Several options with one `UPDATE`:
  `wp eval 'print_r( wp_set_options_autoload( array( "opt_a", "opt_b" ), false ) );'`
  ([option.php L525-L529](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L525-L529)).
- Or with WP-CLI: `wp option set-autoload opt_a off` (`no` on WordPress before 6.6, which knows only `yes` and `no`;
  see `version-notes.md`), then `wp cache delete alloptions options` on a site with a persistent cache, because this
  command leaves the value in the cached `alloptions` array
  ([wp option set-autoload](https://developer.wordpress.org/cli/commands/option/set-autoload/);
  [Option_Command.php L501-L547 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L501-L547)).
- Check: `wp option get-autoload opt_a` prints `off`; the loaded total from the SQL report fell by the option's size;
  `wp eval-file scripts/autoload-state.php opt_a` shows it is no longer in the cached `alloptions`; on staging, the
  owner's features work and the error log is clean. Each request that reads the option now does one more cache read
  or query ([option.php L202-L219](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L202-L219)).
- Undo, when the recorded value was `on`, `off`, `yes` or `no`: `wp option set-autoload opt_a <recorded value>`, then
  the cache keys. `set-autoload` accepts only those four values and stops with "Invalid value specified for
  positional arg." for any other
  ([Subcommand.php L327-L346 at v2.12.0](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Dispatcher/Subcommand.php#L327-L346)).
- Undo, when it was `auto`, `auto-on` or `auto-off`: set only that column back, then the cache keys:
  `wp db query "UPDATE wp_options SET autoload = 'auto-on' WHERE option_name = 'opt_a'"`. This touches no value.
  `wp option set-autoload opt_a on` restores the loading but makes the choice explicit, so later saves no longer
  re-decide it (`autoload-values.md`).
- Watch: the owner puts the option back to `on` if it saves it with an explicit `true` and a changed value
  ([option.php L945-L950](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L945-L950)).
  After the change, use the owner's settings screen once on staging and run `get-autoload` again. If it flipped back,
  see "When the owner puts it back" below.

## Delete options that no installed code uses

- Only for names that `find-option-owner.sh` finds in no installed plugin, theme, must-use plugin or core file, and
  that are not core options (`finding-owners.md`).
- Export: 1, 2 and 3.
- Command: `wp option delete opt_a opt_b`. It takes several names and calls `delete_option()` for each, which also
  updates the cache
  ([wp option delete](https://developer.wordpress.org/cli/commands/option/delete/);
  [Option_Command.php L569-L577 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L569-L577);
  [option.php L1201-L1279](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1201-L1279)).
- Check: the rows are gone from the fingerprint query; the loaded total fell; the site checks in the staging test
  pass; the PHP error log stays clean for a day.
- Undo: `wp db import rows-<date>.sql`, then the cache keys. Deleting `notoptions` matters here: since 6.7,
  `delete_option()` records the name there, and until that key goes, `get_option()` keeps answering "does not
  exist" ([option.php L1243-L1250](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1243-L1250)).
  `wp db import` runs the file inside one transaction with key checks off
  ([DB_Command.php L820-L822 at 2.1.3](https://github.com/wp-cli/db-command/blob/v2.1.3/src/DB_Command.php#L820-L822)).
  If the owner has created an option again since the export, `INSERT IGNORE` keeps that newer row and skips the old
  one; the fingerprint then differs for that name, which is expected.
- Many options with one prefix: list them with SQL first, escaping `_` in the pattern
  (`WHERE option_name LIKE 'oldplugin\_%'`), review the list, and pass the exact names. Do not pipe
  `wp option list --search=... --autoload=...` into `wp option delete`: with entity-command 2.8.x that search does
  not limit the `yes` rows (`measuring.md`).

## Transients

- Autoloaded transients (saved without an expiration), no persistent cache: `wp transient delete <name>`, where
  `<name>` is the part after `_transient_`; it calls `delete_transient()`
  ([Transient_Command.php L180-L211 at 2.2.0](https://github.com/wp-cli/cache-command/blob/v2.2.0/src/Transient_Command.php#L180-L211)).
  Transients may disappear at any time by design, so the owner's code rebuilds them
  ([Transients](https://developer.wordpress.org/apis/transients/)); check the pages that use it after the delete.
- Transient rows on a site that now has a persistent cache: `wp option delete _transient_<name>
  _transient_timeout_<name>` (`object-cache.md` explains why `wp transient delete` does not reach them).
- Expired transients: `wp transient delete --expired`
  ([wp transient delete](https://developer.wordpress.org/cli/commands/transient/delete/)). Core saves transients
  that have an expiration without autoload (`autoload-values.md`), so this shrinks the table rather than the loaded
  total.
- Export 2 first in every case; undo with its import and the cache keys. Avoid `wp transient delete --all` on
  production: every transient is rebuilt on the next requests that need it.

## When the owner puts it back

The lasting fix is in the owner's code: save the option with `false`, keep large data out of autoloaded options, or
read it with `wp_prime_option_caches()` on the screens that need it
([New option functions in 6.4](https://make.wordpress.org/core/2023/10/17/new-option-functions-in-6-4/)). Report it
to the plugin or theme author with the option name, its size, where it is read and the line that saves it.

Until then, a must-use plugin can hold the change. It is a change of its own: staging first, its undo is deleting
the file, and it must be listed in the report.

```php
<?php
/**
 * Plugin Name: Autoload audit, options kept out of the autoload set
 * Description: Temporary. Keeps the listed options from autoloading after their owner saves them. Delete this file to undo.
 */

defined( 'ABSPATH' ) || exit;

function autoload_audit_kept_off() {
	return array( 'opt_a', 'opt_b' );
}

// Options saved without an explicit choice: WordPress stores 'auto-off' instead of 'auto'.
add_filter(
	'wp_default_autoload_value',
	static function ( $autoload, $option ) {
		return in_array( $option, autoload_audit_kept_off(), true ) ? false : $autoload;
	},
	10,
	2
);

// Options saved with an explicit true: switch them off again right after the save.
$autoload_audit_switch_off = static function ( $option ) {
	if ( in_array( $option, autoload_audit_kept_off(), true ) ) {
		wp_set_option_autoload( $option, false );
	}
};
add_action( 'added_option', $autoload_audit_switch_off );
add_action( 'updated_option', $autoload_audit_switch_off );
```

The filter works for options saved without an explicit value
([option.php L1322-L1336](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1322-L1336)).
`added_option` and `updated_option` pass the option name first
([option.php L1186, L1030](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1178-L1186)),
and `wp_set_option_autoload()` does nothing but one `SELECT` when the value is already `off`
([option.php L439-L447](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L439-L447)).
Check: save the owner's settings on staging, then `wp option get-autoload opt_a` prints `off`.

## Temporary read logger (staging only)

Shows which kinds of request read each listed option, before you decide to switch it off. It writes to the PHP error
log, so `WP_DEBUG_LOG` or a PHP `error_log` setting must be on for staging.

```php
<?php
/**
 * Plugin Name: Autoload audit, read logger (staging only)
 * Description: Temporary. Logs the first read of each listed option per request. Delete this file to undo.
 */

defined( 'ABSPATH' ) || exit;

foreach ( array( 'opt_a', 'opt_b' ) as $autoload_audit_option ) {
	add_filter(
		"option_{$autoload_audit_option}",
		static function ( $value, $option ) {
			static $seen = array();
			if ( empty( $seen[ $option ] ) ) {
				$seen[ $option ] = true;
				if ( wp_doing_cron() ) {
					$kind = 'cron';
				} elseif ( wp_doing_ajax() ) {
					$kind = 'ajax';
				} elseif ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
					$kind = 'rest';
				} elseif ( is_admin() ) {
					$kind = 'admin';
				} else {
					$kind = 'front';
				}
				$path = isset( $_SERVER['REQUEST_URI'] ) ? strtok( wp_unslash( $_SERVER['REQUEST_URI'] ), '?' ) : 'cli';
				error_log( sprintf( 'autoload-audit read %s %s %s', $option, $kind, $path ) );
			}
			return $value;
		},
		10,
		2
	);
}
```

The path is logged without its query string. Browse the site on staging as a visitor and as an administrator, run
cron once (`wp cron event run --due-now`; it runs the due work, so first make sure the staging copy cannot send
email, deliver webhooks or charge payments), then count the lines per option and kind with `grep 'autoload-audit read'`.
Undo: delete the file, then remove the logged lines if the log is kept.
