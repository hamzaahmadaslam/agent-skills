# Choosing the narrowest fix

Read this for step 5 of the procedure. MySQL facts come from the MySQL 8.4 Reference Manual, MariaDB facts from
mariadb.com/docs, WordPress from the 7.1.2 tag; checked on 2026-09-29. Every option below except the first changes
the database and follows [changes-and-rollback.md](changes-and-rollback.md).

## Pick the target collation first

The target is the collation the other side of the error already uses, which in almost every WordPress case is
WordPress's connection collation, `$wpdb->collate` (the report prints it). Converging on it fixes both kinds of
error: `IMPLICIT` against `IMPLICIT` with a core table, and `IMPLICIT` against a `COERCIBLE` literal. Choose another
target only when the owner decides to move the whole site, which also means changing `DB_COLLATE`
([wordpress-charset.md](wordpress-charset.md#changing-db_collate)).

## The options, narrowest first

| Option | Changes | When it fits | Limits |
| --- | --- | --- | --- |
| 1. A `COLLATE` clause in the plugin's query | Code only, by the plugin's developer | One query, a plugin you can change or report to, a table you cannot touch | An explicit collation must belong to the operand's character set or the query fails with 1253 ([error reference](https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html)); the columns still differ, and comparing string columns of different character sets precludes index use in a join ([how MySQL uses indexes](https://dev.mysql.com/doc/refman/8.4/en/mysql-indexes.html)), so compare `EXPLAIN` before and after |
| 2. `MODIFY COLUMN` on the columns in the error | Those columns | One or a few columns in the query; the rest of the table is not involved | Restate the whole column definition, or attributes such as `NOT NULL` and `DEFAULT` are lost ([column conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-conversion.html)); rebuilds the table on MySQL |
| 3. The table default plus `MODIFY COLUMN` on every text column of one table | One table | The table's own queries mix its columns with core tables in several places, or future columns should match | Same as 2 |
| 4. `ALTER TABLE ... CONVERT TO CHARACTER SET ... COLLATE ...` | One table | A small plugin table whose text column types can grow | Changes data types: a `TEXT` column can become `MEDIUMTEXT` and a `VARCHAR` can become `MEDIUMTEXT` when converted to a wider character set; without `COLLATE` it uses the character set's default collation ([ALTER TABLE, changing the character set](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html)) |
| 5. Every table in the database | Everything | Only as an owner decision after options 1 to 4, for example before a server move | Rebuilds every table, the longest write block, the largest backup, and it changes tables that were never part of the error |

`scripts/propose-alters.mjs` prints options 2 and 3 with explicit `CHARACTER SET` and `COLLATE`, the full column
definitions taken from the table's own `CREATE TABLE`, and the rollback. It never proposes option 4 or 5.

A note on option 1: a clause such as `WHERE t.col = p.post_name COLLATE utf8mb4_unicode_520_ci` gives the right side
`EXPLICIT` precedence ([collation coercibility](https://dev.mysql.com/doc/refman/8.4/en/charset-collation-coercibility.html)).
It is the developer's fix to make in the plugin, not a file this skill edits.

## Before any conversion: what can break

### Characters the new character set cannot store

- `utf8mb3` to `utf8mb4` loses nothing: Basic Multilingual Plane characters have the same encoding in both
  ([3-byte and 4-byte conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-conversion.html)).
- Any conversion to a character set that lacks some stored characters can lose data
  ([column character set](https://dev.mysql.com/doc/refman/8.4/en/charset-column.html)). Never propose `utf8mb4` to
  `utf8mb3` or `latin1`; the helper refuses it.

### Data stored under the wrong label

If a column declared `latin1` holds UTF-8 bytes, `CONVERT TO` and `MODIFY` convert those bytes as if they were
latin1, which the manual warns is not what you want. Its method for such a column is two steps through a binary type,
which performs no conversion
([ALTER TABLE, changing the character set](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html);
[column conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-conversion.html)):

```sql
ALTER TABLE t1 CHANGE c1 c1 BLOB;
ALTER TABLE t1 CHANGE c1 c1 TEXT CHARACTER SET utf8mb4;
```

Deciding which label is true needs a look at stored values on staging with the owner, which this skill does not do
from query output. When in doubt, stop and report it as a separate repair.

### Index key length

- InnoDB allows 3072 bytes per index key prefix with the `DYNAMIC` or `COMPRESSED` row format and 767 bytes with
  `REDUNDANT` or `COMPACT`; the limits for key prefixes also apply to full-column keys
  ([InnoDB limits](https://dev.mysql.com/doc/refman/8.4/en/innodb-limits.html)). MyISAM keys are at most 1000 bytes
  ([MyISAM](https://dev.mysql.com/doc/refman/8.4/en/myisam-storage-engine.html)).
- A `utf8mb4` character can take 4 bytes, so 767 bytes hold 191 characters and 3072 bytes hold 768
  ([3-byte and 4-byte conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-conversion.html)). This is
  where WordPress's 191-character prefixes come from ([schema.php L45-L53](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L45-L53)).
- The default row format is `DYNAMIC` on MySQL 8.4 and on MariaDB
  ([MySQL row formats](https://dev.mysql.com/doc/refman/8.4/en/innodb-row-format.html);
  [MariaDB InnoDB variables](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-system-variables)),
  so the 767-byte limit bites on older tables created as `COMPACT` and on MyISAM tables. The report's index block
  shows each key part's bytes now and as `utf8mb4`, next to the table's engine and row format.
- Over the limit, the `ALTER` fails with 1071 and changes nothing. The two narrow answers: re-create the key with a
  shorter prefix in the same `ALTER`, as core did with `DROP INDEX meta_key, ADD INDEX meta_key(meta_key(191))`
  ([upgrade.php L3776-L3786](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L3776-L3786)),
  or change the table's row format first (a rebuild of its own). A prefix index narrows the rows and the rest are
  still read, and it cannot supply the sort order beyond the prefix
  ([column indexes](https://dev.mysql.com/doc/refman/8.4/en/column-indexes.html);
  [ORDER BY optimization](https://dev.mysql.com/doc/refman/8.4/en/order-by-optimization.html)); say so in the proposal.

### Unique keys

A new collation can make two stored values compare equal: case, accents, the UCA version and the pad attribute all
change what counts as the same string ([collation names](https://dev.mysql.com/doc/refman/8.4/en/charset-collation-names.html);
[MySQL Unicode sets](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-sets.html);
[CHAR and VARCHAR](https://dev.mysql.com/doc/refman/8.4/en/char.html)). Then the `ALTER` fails on the duplicate. Before
converting a column in a `UNIQUE` or `PRIMARY KEY`, count the groups that would collide under the target collation
(read-only; it reads the whole table, so on staging or a replica). `COLLATE` works in `GROUP BY`
([using COLLATE](https://dev.mysql.com/doc/refman/8.4/en/charset-collate.html)):

```sql
SELECT COUNT(*) AS groups_that_would_collide
FROM (SELECT 1 FROM wp_example_lookup
      WHERE post_name IS NOT NULL
      GROUP BY CONVERT(LEFT(post_name, 191) USING utf8mb4) COLLATE utf8mb4_unicode_520_ci
      HAVING COUNT(*) > 1) AS d;
```

A non-zero count is an owner decision about which rows are the same thing; this skill does not merge or delete rows.
Shortening the prefix of a unique key is also the owner's decision, because it changes what counts as a duplicate.

### Foreign keys

For character string columns in a foreign key, the character set and collation must be the same on both sides
([foreign keys](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)). WordPress core tables have
none; some plugins add them. Change both sides in the same window, staging first. The report's foreign key block
lists them.

### Row size and short text types

- The row size limit is 65,535 bytes, not counting BLOB and TEXT contents; widening many `VARCHAR` columns to
  `utf8mb4` can reach it and fail with 1118 ([column count and row size](https://dev.mysql.com/doc/refman/8.4/en/column-count-limit.html)).
- A `TINYTEXT` holds 255 bytes: 85 three-byte or 63 four-byte characters. Converting one to `utf8mb4` may need a
  longer type ([3-byte and 4-byte conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-conversion.html)).

## What each option costs in time

On MySQL, a character set or collation change copies the table: reads continue, writes wait until the copy
finishes, and reads also wait for a moment at the end
([ALTER TABLE](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html);
[column conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-conversion.html)). On MariaDB 11.2 and later,
`ALGORITHM=COPY, LOCK=NONE` lets writes continue
([MariaDB ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table)).
Time the same statement on a staging copy of the same size and server version; that is the write pause to plan for
on production, or longer under load. A small plugin table takes seconds; a large `postmeta` or order table needs a
quiet hour and the owner's agreement to the pause, or a different approach decided with the host
([mysql-mariadb-differences.md](mysql-mariadb-differences.md#alter-table-time-locks-and-online-options)).
