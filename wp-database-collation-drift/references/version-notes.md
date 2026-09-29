# Versions checked, and what changed by release

Read the site's versions first (the report prints WordPress and the database server) and apply the rows at or below
them. A fix that needs a newer release is an update first, as its own change on staging.

## Versions this skill was checked against (2026-09-29)

| Software | Version checked | Source |
| --- | --- | --- |
| WordPress | 7.1.2 (current release) | [version check API](https://api.wordpress.org/core/version-check/1.7/); [tag 7.1.2](https://github.com/WordPress/wordpress-develop/tree/7.1.2) |
| WP-CLI | 2.12.0, which bundles `db-command` v2.1.3 | [release](https://github.com/wp-cli/wp-cli/releases/tag/v2.12.0); [bundle lock file](https://github.com/wp-cli/wp-cli-bundle/blob/v2.12.0/composer.lock) |
| Query Monitor | 4.0.7 | [plugin directory](https://wordpress.org/plugins/query-monitor/) |
| MySQL | 8.4 Reference Manual; newest 8.4 LTS release 8.4.12 (2026-08-18); source read at the `mysql-8.4.11` tag, the newest on GitHub that day; newest 8.0 release 8.0.46 (2026-04-21) | [8.4 release notes](https://dev.mysql.com/doc/relnotes/mysql/8.4/en/); [8.0 release notes](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/) |
| MariaDB | mariadb.com/docs as of the date; newest releases 10.6.28 (series end of life 2026-07-06), 10.11.19, 11.4.13, 11.8.9, 12.3.3, 13.0.2 | [MariaDB downloads REST API](https://downloads.mariadb.org/rest-api/mariadb/) |
| Database Collation Fix (plugin, described only) | 1.2.11 | [readme](https://plugins.svn.wordpress.org/database-collation-fix/trunk/readme.txt) |

MySQL 9.x was not checked. On it, confirm any fact this skill relies on in its own manual.

The helpers were exercised on 2026-09-29 against a throwaway MariaDB 11.8.6 instance loaded with
`examples/synthetic-tables.sql`: every block of `scripts/collation-checks.sql` ran except the MySQL-only pad attribute
block, which failed as expected, and the statements from `scripts/propose-alters.mjs` (change, then rollback) ran with
`LOCK=SHARED` and with `LOCK=NONE`, restoring the original definitions and row counts. No MySQL server was available
for the same test; the MySQL side rests on the manual.

## WordPress

| Release | Change | Source |
| --- | --- | --- |
| 4.2 | Core moves to `utf8mb4`; index prefixes on long text columns shortened to 191 characters; global tables converted with `maybe_convert_table_to_utf8mb4()` (database version 31351) | [schema.php L45-L53](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L45-L53); [upgrade.php L2607-L2626](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2607-L2626) |
| 4.3 | Site tables converted to `utf8mb4_unicode_ci` by `upgrade_430()` (database version 33055) | [upgrade.php L2010-L2024](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2010-L2024) |
| 4.4 | `options.option_name` becomes `VARCHAR(191)` (database version 34030) | [upgrade.php L2100-L2104](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2100-L2104) |
| 4.6 | `determine_charset()`; `utf8mb4_unicode_520_ci` chosen where the server supports it (`has_cap( 'utf8mb4_520' )`) | [class-wpdb.php L867-L905, L4147-L4177](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L867-L905) |
| 5.1 | `WP_DEBUG_LOG` accepts a file path | [load.php L569-L626](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L569-L626) |
| 5.3 | Site Health shows the database charset and collation | [class-wp-debug-data.php L27, L1719-L1728](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-debug-data.php#L1719-L1728) |
| 6.6 | `has_cap( 'utf8mb4' )` always returns true | [class-wpdb.php L4147-L4175](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L4147-L4175) |

## MySQL

| Release | Change | Source |
| --- | --- | --- |
| 5.7 | utf8mb4 default collation `utf8mb4_general_ci` | [default_collation_for_utf8mb4](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_default_collation_for_utf8mb4) |
| 8.0 | utf8mb4 default collation `utf8mb4_0900_ai_ci`; `default_collation_for_utf8mb4` replicated for mixed 5.7 and 8.0 setups | same |
| 8.0 and 8.4 | `utf8mb3` deprecated but supported for the life of both series; `utf8` a deprecated alias shown as `utf8mb3` | [utf8](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8.html) |

## MariaDB

| Release | Change | Source |
| --- | --- | --- |
| 10.6.1 | `utf8mb3` collations renamed from `utf8_*`; `utf8` an alias for `utf8mb3` by default | [supported collations](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/supported-character-sets-and-collations); [character_set_connection](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#character_set_connection) |
| 10.6 | `ALTER TABLE` atomic for InnoDB and most engines | [ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table) |
| 10.10.1 | UCA 14.0.0 collations (`uca1400`) added | [supported collations](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/supported-character-sets-and-collations) |
| 11.2 | `character_set_collations` variable; most `ALTER TABLE` operations can run as `ALGORITHM=COPY, LOCK=NONE` | [character_set_collations](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#character_set_collations); [ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table) |
| 11.4.5 | UCA 9.0.0 (`_0900_`) collation names added as aliases of `uca1400` collations | [supported collations](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/supported-character-sets-and-collations) |
| 11.5 | `character_set_collations` defaults map utf8mb4 to `utf8mb4_uca1400_ai_ci` | [setting character sets](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations) |
| 11.6 | Server default character set `utf8mb4` (was `latin1`), default collation `utf8mb4_uca1400_ai_ci` | same; [character_set_server](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#character_set_server) |
| 11.8 | First long-term support release with both the 11.5 and 11.6 changes | [setting character sets](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations) |
| 13.1 | `utf8` an alias for `utf8mb4` by default | [character_set_connection](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#character_set_connection) |

## What this means for the investigation

- A site whose database predates WordPress 4.3 had its tables converted to `utf8mb4_unicode_ci` by `upgrade_430()`;
  tables created since WordPress 4.6 with `get_charset_collate()` are `utf8mb4_unicode_520_ci` on current servers.
- A MariaDB server upgraded to 11.5 or later creates new plugin tables in `utf8mb4_uca1400_ai_ci` when the plugin names
  only the character set; expect drift to start at the upgrade date.
- Moving between MySQL 8 and MariaDB, list the collations in use first: `_0900_` names need MariaDB 11.4.5 or later,
  `uca1400` names need MariaDB 10.10 or later and do not exist on MySQL.
- MariaDB 10.6 reached its end of life on 2026-07-06; a server upgrade is the host's change, planned on its own, and
  it moves the defaults above.
