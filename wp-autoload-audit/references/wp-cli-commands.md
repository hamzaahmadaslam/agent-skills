# WP-CLI commands for options, with their limits

Read this before running any command in this skill. Versions checked on 2026-09-26:

- WP-CLI 2.12.0 (2025-05-07) is the current stable release. Its bundle pins entity-command 2.8.4 (the `option`
  commands), cache-command 2.2.0 (`cache` and `transient`) and db-command 2.1.3 (`db`)
  ([wp-cli-bundle composer.lock at v2.12.0](https://github.com/wp-cli/wp-cli-bundle/blob/v2.12.0/composer.lock);
  [releases](https://github.com/wp-cli/wp-cli/releases/tag/v2.12.0)).
- The command packages have 3.0 releases (entity-command 3.0.2, cache-command 3.0.0, db-command 3.0.1, August 2026)
  that the nightly build already bundles
  ([wp-cli-bundle composer.lock on main](https://github.com/wp-cli/wp-cli-bundle/blob/main/composer.lock);
  [entity-command v3.0.2](https://github.com/wp-cli/entity-command/releases/tag/v3.0.2)). WP-CLI's own help calls the
  nightly build fit for development and staging, not production
  ([wp cli update](https://developer.wordpress.org/cli/commands/cli/update/)). Where the versions differ, the tables
  in this skill say so.
- `wp cli version` prints the WP-CLI version on the server; `wp cli info` prints more
  ([wp cli version](https://developer.wordpress.org/cli/commands/cli/version/)).

## Read-only commands

| Command | What it prints | Notes |
| --- | --- | --- |
| `wp option list --fields=option_name,autoload,size_bytes --format=csv` | Every non-transient option with its raw autoload value and `LENGTH(option_value)` | Add `--transients` for transients only; one call never shows both ([wp option list](https://developer.wordpress.org/cli/commands/option/list/)) |
| `wp option list --autoload=on --format=total_bytes` | Not the loaded total: counts `on` and `yes` only, and in 2.8.x the filter lacks parentheses | Do not use it for the audit; `measuring.md` |
| `wp option get <name>` | The value | Values can hold secrets; do not print them into reports ([wp option get](https://developer.wordpress.org/cli/commands/option/get/)) |
| `wp option get-autoload <name>` | The raw autoload value (`auto-on`, `yes` and so on) | Errors when the option does not exist ([wp option get-autoload](https://developer.wordpress.org/cli/commands/option/get-autoload/)) |
| `wp db query "<SELECT ...>"` | Rows from SQL | Loads `wp-config.php` only, not WordPress or plugins; ignores `--url`, so use the site's table prefix ([wp db query](https://developer.wordpress.org/cli/commands/db/query/); [DB_Command.php L26, L478-L490 at 2.1.3](https://github.com/wp-cli/db-command/blob/v2.1.3/src/DB_Command.php#L478-L490)) |
| `wp db prefix` | The table prefix of the current site (per site with `--url`) | [wp db prefix](https://developer.wordpress.org/cli/commands/db/prefix/) |
| `wp cache type` | The object cache implementation | [wp cache type](https://developer.wordpress.org/cli/commands/cache/type/) |
| `wp cache get alloptions options` | The cached `alloptions` array | Prints every autoloaded value, secrets included; prefer the state helper, which prints names and sizes only ([wp cache get](https://developer.wordpress.org/cli/commands/cache/get/)) |
| `wp transient type` | Whether transients go to the database or the object cache | [wp transient type](https://developer.wordpress.org/cli/commands/transient/type/) |
| `wp transient list` | Transients stored in the table | With a persistent cache it warns that it shows only those in the database ([Transient_Command.php L297-L301 at 2.2.0](https://github.com/wp-cli/cache-command/blob/v2.2.0/src/Transient_Command.php#L297-L301)) |
| `wp plugin list --fields=name,status,version --skip-update-check` | Plugins and their status; `--status=must-use` and `--status=dropin` for the others | [wp plugin list](https://developer.wordpress.org/cli/commands/plugin/list/) |
| `wp theme list --fields=name,status --skip-update-check` | Themes | [wp theme list](https://developer.wordpress.org/cli/commands/theme/list/) |
| `wp site list --field=url` | The sites of a multisite network | [wp site list](https://developer.wordpress.org/cli/commands/site/list/) |
| `wp eval-file <file> [<arg>...]` | Runs a PHP file inside WordPress; extra arguments arrive in `$args` | Read-only only if the file is; `scripts/autoload-state.php` is ([wp eval-file](https://developer.wordpress.org/cli/commands/eval-file/)) |
| `wp core version --extra` | WordPress version and database revision | [wp core version](https://developer.wordpress.org/cli/commands/core/version/) |

Never run `wp config list` during an audit: it prints the database password and the salts
([wp config list](https://developer.wordpress.org/cli/commands/config/list/)).

## Commands that change the site

Each one needs the export, check and undo in `changes-and-rollback.md`, and the owner's approval.

| Command | What it does | Notes |
| --- | --- | --- |
| `wp option set-autoload <name> <on\|off\|yes\|no>` | Writes that value into the column with SQL | Accepts only those four values; leaves the value in the cached `alloptions` array, so delete that key after switching off on a cached site ([wp option set-autoload](https://developer.wordpress.org/cli/commands/option/set-autoload/); [Option_Command.php L476-L547 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L476-L547)) |
| `wp eval 'wp_set_option_autoload( "<name>", false );'` | Core's own function; writes `off` and updates the cache | [wp eval](https://developer.wordpress.org/cli/commands/eval/); `autoload-values.md` |
| `wp option update <name> <value> --autoload=<on\|off\|yes\|no>` | Calls `update_option()` | The autoload value changes only when the value changes; with an unchanged value and `--autoload` it ends with "Could not update option" ([Option_Command.php L414-L439 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L414-L439)) |
| `wp option add <name> <value> [--autoload=...]` | Calls `add_option()` with `'yes'` or `'no'` | Always an explicit choice, never `auto` (`autoload-values.md`) |
| `wp option delete <name>...` | Calls `delete_option()` for each name | [wp option delete](https://developer.wordpress.org/cli/commands/option/delete/) |
| `wp transient delete <name>`, `--expired`, `--all` | `delete_transient()` for one name; SQL deletes for `--expired` and `--all` | Only table rows for `--expired` and `--all`; with a persistent cache `<name>` reaches only the cache ([Transient_Command.php L180-L211, L611-L684 at 2.2.0](https://github.com/wp-cli/cache-command/blob/v2.2.0/src/Transient_Command.php#L611-L684)) |
| `wp cache delete <key> <group>` | Deletes one cache key | Fails harmlessly when the key is missing ([wp cache delete](https://developer.wordpress.org/cli/commands/cache/delete/)) |
| `wp cache flush` | Empties the whole object cache | Not for this work on production (`object-cache.md`) ([wp cache flush](https://developer.wordpress.org/cli/commands/cache/flush/)) |
| `wp db export <file> ...` | Writes a dump; extra flags go to `mysqldump` or `mariadb-dump` | Reads only, but writes a file full of site data ([wp db export](https://developer.wordpress.org/cli/commands/db/export/)) |
| `wp db import <file>` | Runs the SQL in a file | [wp db import](https://developer.wordpress.org/cli/commands/db/import/) |

## Global flags that matter here

- `--path=<dir>`: the WordPress root; `--url=<site>`: which site of a multisite network the command works on
  ([wp option set-autoload](https://developer.wordpress.org/cli/commands/option/set-autoload/), global parameters).
- `--skip-plugins` and `--skip-themes` keep site code from loading. Use them for SQL-only work; do not use them for
  the state helper, which has to see the filters plugins add.
- WP-CLI reads `--no-<name>` as "`<name>` is false"; a flag passed through to `mysqldump` that starts with `no-`
  needs an explicit `=true` ([Configurator.php L187-L188 at v2.12.0](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Configurator.php#L187-L188)).

## WP-CLI packages that are not bundled

`wp doctor` (doctor-command 3.0.0) has an `autoload-options-size` check that relies on
`wp option list --autoload=on`, so it undercounts on WordPress 6.6 and later (`measuring.md`)
([doctor-command](https://github.com/wp-cli/doctor-command)). Installing a package changes the WP-CLI setup on that
server, not the site; ask before doing it.
