# MySQL and MariaDB differences that matter here

Read this for steps 3 and 6 of the procedure, and before any import between server types. MySQL facts come from the
MySQL 8.4 Reference Manual, MariaDB facts from mariadb.com/docs; checked on 2026-09-29.

## Collation names that exist on one server only

| Name or family | MySQL 8.0 / 8.4 | MariaDB | Source |
| --- | --- | --- | --- |
| `utf8mb4_0900_ai_ci` and the other `_0900_` (UCA 9.0.0) collations | Yes; `utf8mb4_0900_ai_ci` is the utf8mb4 default | From 11.4.5 only, as aliases of the `uca1400_nopad` collations (for example `utf8mb4_0900_ai_ci` is an alias for `utf8mb4_uca1400_nopad_ai_ci`), added to make replication from MySQL 8.0 easier | [MySQL Unicode sets](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-sets.html); [MariaDB supported collations](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/supported-character-sets-and-collations) |
| `utf8mb4_uca1400_*` (UCA 14.0.0) | Not in the MySQL 8.4 manual, which lists collations based on UCA 4.0.0, 5.2.0 and 9.0.0 | From 10.10.1; `utf8mb4_uca1400_ai_ci` is the utf8mb4 default from 11.5 | same |
| `utf8mb4_unicode_ci`, `utf8mb4_unicode_520_ci`, `utf8mb4_general_ci`, `utf8mb4_bin` | Yes | Yes | same |

Check the target server before an import or a conversion: `SHOW COLLATION LIKE 'utf8mb4%';` is read-only and lists
what that server has. On MariaDB 11.4.5 and later, `information_schema.COLLATIONS` has a `COMMENT` column that marks the
aliases ([MariaDB supported collations](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/supported-character-sets-and-collations));
the last block of `scripts/collation-checks.sql` reads it.

## Importing a MySQL 8 dump into MariaDB

- A MySQL 8 dump names `utf8mb4_0900_ai_ci` wherever a table used the MySQL default. MariaDB before 11.4.5 does not
  know the name and stops the import with 1273 `Unknown collation`
  ([error reference](https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html)).
- MariaDB 11.4.5 and later accept the name as an alias of `utf8mb4_uca1400_nopad_ai_ci`. The table then has a NO PAD
  collation, which differs from `utf8mb4_unicode_520_ci` (PAD SPACE) in trailing-space handling, and still differs
  from WordPress's connection collation.
- The choice of collation for the imported tables is the owner's. The narrow options, each tested on staging: edit
  the collation names in a copy of the dump to the collation WordPress uses before importing (the MySQL manual
  describes editing names in a dump when moving to an older server,
  [3-byte and 4-byte conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-conversion.html)), or import
  on MariaDB 11.4.5 or later and converge the tables afterwards with this skill's procedure. Never edit the only copy
  of a dump.

## Pad attributes

- UCA 9.0.0 and later collations in MySQL are NO PAD: trailing spaces count, so `'a'` and `'a '` differ. Older ones
  are PAD SPACE. `information_schema.COLLATIONS.PAD_ATTRIBUTE` shows it on MySQL
  ([MySQL Unicode sets](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-sets.html)).
- Where trailing spaces are ignored in comparison, a unique index rejects values that differ only in trailing spaces
  as duplicates ([CHAR and VARCHAR](https://dev.mysql.com/doc/refman/8.4/en/char.html)). Moving a unique column from a
  NO PAD collation to a PAD SPACE one can therefore fail on data the old collation accepted; the collision check in
  [fixes.md](fixes.md#unique-keys) finds it first.
- MariaDB names its NO PAD collations with `nopad` (for example `utf8mb4_uca1400_nopad_ai_ci`)
  ([MariaDB supported collations](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/supported-character-sets-and-collations)).

## utf8, utf8mb3 and utf8mb4

- MySQL 8.4: `utf8` is a deprecated alias for `utf8mb3`; `SHOW` statements and `information_schema` print `utf8mb3`.
  `utf8mb3` is deprecated, supported through the 8.0 and 8.4 series, and expected to be removed in a later major
  release ([utf8](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8.html)). It stores Basic Multilingual
  Plane characters only, at most three bytes each ([utf8mb3](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8mb3.html)).
- MariaDB: from 10.6, `utf8` is by default an alias for `utf8mb3`; from 13.1 it is by default an alias for `utf8mb4`,
  and the `UTF8_IS_UTF8MB3` flag of `old_mode` restores the old meaning
  ([character_set_connection](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#character_set_connection)).
  Before 10.6.1 the `utf8mb3` collations were named `utf8_*`
  ([MariaDB supported collations](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/supported-character-sets-and-collations)).
- In proposals, always write `utf8mb4` or `utf8mb3` in full, never `utf8`.

## ALTER TABLE: time, locks and online options

| Topic | MySQL 8.4 | MariaDB | Source |
| --- | --- | --- | --- |
| Changing a column's or table's character set or collation | Must use `ALGORITHM=COPY` | Depends on the operation; ask for the algorithm you want and the server raises an error if it cannot | [MySQL column conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-conversion.html); [MariaDB ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table) |
| `CONVERT TO CHARACTER SET` | Rebuilds the table when the encoding changes; concurrent DML not permitted | Rebuilds the table | [MySQL online DDL operations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html); [MariaDB setting character sets](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations) |
| Writes during a table copy | Blocked: a copy always has at least the restrictions of `LOCK=SHARED`, reads allowed except at the final swap | From 11.2, most operations can run as `ALGORITHM=COPY, LOCK=NONE`, which allows concurrent DML; `LOCK=NONE` raises an error when not permitted | [MySQL ALTER TABLE](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html); [MariaDB ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table) |
| Default `lock_wait_timeout` (metadata locks) | 31536000 seconds (one year) | 86400 seconds (one day) | [MySQL variables](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_lock_wait_timeout); [MariaDB variables](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#lock_wait_timeout) |
| Per-statement lock wait | `SET SESSION lock_wait_timeout = n` | The same, or `ALTER TABLE tbl WAIT n ...` | [MariaDB WAIT and NOWAIT](https://mariadb.com/docs/server/reference/sql-statements/transactions/wait-and-nowait) |
| A crash during `ALTER TABLE` | InnoDB DDL is atomic: committed or rolled back as a whole | Atomic for InnoDB and most engines (MDEV-25180) | [MySQL atomic DDL](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html); [MariaDB ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table) |
| Default InnoDB row format | `DYNAMIC` (`innodb_default_row_format`) | `dynamic` | [MySQL row formats](https://dev.mysql.com/doc/refman/8.4/en/innodb-row-format.html); [MariaDB InnoDB variables](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-system-variables) |

A tool outside the server, such as Percona's pt-online-schema-change, copies the table while writes continue by
using triggers on the original table ([pt-online-schema-change](https://docs.percona.com/percona-toolkit/pt-online-schema-change.html)).
It has its own requirements and risks and is the host's or the owner's choice, outside this skill.
