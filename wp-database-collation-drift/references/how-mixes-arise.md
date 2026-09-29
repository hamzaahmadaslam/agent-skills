# How a site ends up with mixed collations

Read this for step 4 of the procedure, to explain the drift in the report and to prevent it coming back. MySQL facts
come from the MySQL 8.4 Reference Manual, MariaDB facts from mariadb.com/docs, WordPress from the 7.1.2 tag; checked
on 2026-09-29.

## How the server fills in a missing collation

The same rules apply at each level ([database](https://dev.mysql.com/doc/refman/8.4/en/charset-database.html),
[table](https://dev.mysql.com/doc/refman/8.4/en/charset-table.html),
[column](https://dev.mysql.com/doc/refman/8.4/en/charset-column.html)):

| The statement names | The object gets |
| --- | --- |
| a character set and a collation | both, as named |
| a character set only | that character set and its default collation |
| a collation only | that collation and its character set |
| neither | the level above: server for a database, database for a table, table for a column |

The server character set and collation are used only as defaults for `CREATE DATABASE`
([server character set](https://dev.mysql.com/doc/refman/8.4/en/charset-server.html)). Changing a default later
changes no existing table; only new objects pick it up.

## The defaults that differ between servers

| Server | utf8mb4 default collation | Server default character set and collation | Source |
| --- | --- | --- | --- |
| MySQL 8.0 and 8.4 | `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_0900_ai_ci` | [server character set](https://dev.mysql.com/doc/refman/8.4/en/charset-server.html); [default_collation_for_utf8mb4](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_default_collation_for_utf8mb4) |
| MySQL 5.7 | `utf8mb4_general_ci` | not checked for this skill | [default_collation_for_utf8mb4](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_default_collation_for_utf8mb4) |
| MariaDB up to 11.4 | `utf8mb4_general_ci` (compiled-in default; `character_set_collations` empty) | `latin1`, `latin1_swedish_ci` | [character_set_collations](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#character_set_collations); [setting character sets](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations) |
| MariaDB 11.5 | `utf8mb4_uca1400_ai_ci` (through `character_set_collations`) | `latin1`, `latin1_swedish_ci` | same |
| MariaDB 11.6 and later | `utf8mb4_uca1400_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | same |

- MariaDB's documentation notes that distributions can ship other defaults (it names Debian as an example); read the
  server's own values from the report rather than assuming the table above
  ([setting character sets](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations)).
- MariaDB 11.8 is the first long-term support release with both MariaDB changes, so a server upgraded from 10.6 or
  11.4 to 11.8 gets both at once (same page).
- On MariaDB, a `CREATE TABLE` that names a character set without `COLLATE` takes the collation from
  `character_set_collations`, not from the database. From 11.5 its default maps `utf8mb3`, `ucs2`, `utf8mb4`, `utf16`
  and `utf32` to their `uca1400_ai_ci` collations, so a plugin table declared `DEFAULT CHARSET=utf8mb3` becomes
  `utf8mb3_uca1400_ai_ci` ([character_set_collations](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#character_set_collations)). The documentation's example: in a database whose default is
  `utf8mb4_general_ci`, a table created with `DEFAULT CHARACTER SET utf8mb4` on 11.5 or later is
  `utf8mb4_uca1400_ai_ci` (same page).

## The common causes on WordPress sites

1. **A plugin table created without WordPress's collation.** A plugin that appends `$wpdb->get_charset_collate()` gets
   WordPress's collation ([wordpress-charset.md](wordpress-charset.md#tables-wordpress-creates)). One that writes
   `DEFAULT CHARSET=utf8mb4` alone gets the character set's default collation on that server (`utf8mb4_0900_ai_ci` on
   MySQL 8, `utf8mb4_uca1400_ai_ci` on MariaDB 11.5 and later); one that writes nothing gets the database default.
   Its joins with core tables then raise 1267 with two `IMPLICIT` operands.
2. **A site whose database predates WordPress 4.3.** The upgrade routines converted core tables to
   `utf8mb4_unicode_ci`, while tables created since WordPress 4.6 got `utf8mb4_unicode_520_ci`, and tables with a non-UTF-8 column were left alone
   ([wordpress-charset.md](wordpress-charset.md#the-utf8mb4-upgrade-routines)).
3. **A table created on another server, then imported.** The object definitions in a mysqldump file name their
   character sets (the manual's downgrade advice is to edit those names in the dump
   ([3-byte and 4-byte conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-conversion.html))), so an
   import keeps the source server's choices; tables created on the new server afterwards get the new server's
   defaults. Open the dump's `CREATE TABLE` lines to see which collations it names. A dump from MySQL 8 that names `utf8mb4_0900_ai_ci` fails on MariaDB before 11.4.5 with
   1273 ([mysql-mariadb-differences.md](mysql-mariadb-differences.md)).
4. **A server upgrade that changed the defaults.** Tables created before the upgrade keep their collation; tables
   created after it (a new plugin, a plugin that re-creates its table on update) get the new default. MariaDB's
   documentation describes this build-up across versions and the 1267 error it causes
   ([setting character sets](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations)).
5. **Replication between versions.** MySQL replicates `default_collation_for_utf8mb4` from source to replica so a
   replica applies the source's default ([default_collation_for_utf8mb4](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_default_collation_for_utf8mb4)).
   MariaDB documents that replication from 11.8 to 10.6 fails unless the newer server is set to the old defaults,
   because `utf8mb4_uca1400_ai_ci` does not exist on 10.6
   ([setting character sets](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations)).
   The MySQL manual also warns that differences in table definitions between source and replica, such as `utf8mb3`
   on one and `utf8mb4` on the other, are risky ([3-byte and 4-byte conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-conversion.html)).
6. **A hand-written `COLLATE` in plugin code.** A query that forces a collation which does not match the columns
   raises 1253 when the character set differs, or 1267 with an `EXPLICIT` operand
   ([reading-the-error.md](reading-the-error.md)).

## Why the usual plugin fix is broad

The Database Collation Fix plugin (1.2.11 on 2026-09-29) converts tables and columns that use
`utf8mb4_unicode_520_ci` or `utf8_unicode_520_ci` to `utf8mb4_unicode_ci`, or to `DB_COLLATE` when set, and keeps
doing so once a day while it is active ([readme](https://plugins.svn.wordpress.org/database-collation-fix/trunk/readme.txt)).
That rebuilds every such table, including ones that were never part of the error, and leaves WordPress's connection
on `utf8mb4_unicode_520_ci` unless `DB_COLLATE` changes too. This skill changes only the tables and columns named by
the error and the map, one approved step at a time ([fixes.md](fixes.md)).

## Keeping it from coming back

- Ask plugin developers to create tables with `$wpdb->get_charset_collate()` (the table in
  [wordpress-charset.md](wordpress-charset.md#tables-wordpress-creates)); name the table and the line in the request.
- Re-run the report after installing or updating a plugin that creates tables, and after any database server upgrade.
- Before moving a site to another server, compare the collations the site uses with those the new server has
  (`SHOW COLLATION LIKE 'utf8mb4%'` on the target is read-only).
