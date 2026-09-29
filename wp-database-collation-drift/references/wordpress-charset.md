# How WordPress picks its character set and collation

Read this for steps 3 and 5 of the procedure. All links point at the WordPress 7.1.2 tag of wordpress-develop, checked
on 2026-09-29.

## The constants

- `wp-config-sample.php` ships with `define( 'DB_CHARSET', 'utf8mb4' );` and `define( 'DB_COLLATE', '' );`
  ([wp-config-sample.php L34-L38](https://github.com/WordPress/wordpress-develop/blob/7.1.2/wp-config-sample.php#L34-L38)).
- Site Health (Tools > Site Health > Info) shows `DB_CHARSET`, `DB_COLLATE` (or "Empty value" and "Undefined") and,
  under Database, the charset and collation WordPress chose: `$wpdb->charset` and `$wpdb->collate`
  ([class-wp-debug-data.php L1546-L1552, L1637-L1645, L1719-L1728](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-debug-data.php#L1719-L1728)).

## The connection

1. After connecting, `wpdb` calls `init_charset()` once, then `set_charset()` on every connection
   ([class-wpdb.php L2033-L2040](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L2033-L2040)).
2. `init_charset()` takes `DB_CHARSET` and `DB_COLLATE`. On multisite it starts from `utf8` and `DB_COLLATE`, or
   `utf8_general_ci` when `DB_COLLATE` is empty or undefined; `DB_CHARSET` then overrides the character set. It hands
   both to `determine_charset()` and stores the result in `$wpdb->charset` and `$wpdb->collate`
   ([class-wpdb.php L840-L863](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L840-L863)).
3. `determine_charset()` ([class-wpdb.php L881-L905](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L881-L905)):
   - `utf8` becomes `utf8mb4`;
   - for `utf8mb4`, an empty collation or `utf8_general_ci` becomes `utf8mb4_unicode_ci`, and any other `utf8_`
     collation gets its prefix changed to `utf8mb4_`;
   - `utf8mb4_unicode_ci` becomes `utf8mb4_unicode_520_ci` when `has_cap( 'utf8mb4_520' )` is true, which it is for a
     server version of 5.6 or later ([class-wpdb.php L4176-L4177](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L4176-L4177)).
     MariaDB 10.x and 11.x report versions above 5.6, so the check passes there too.
   - A `DB_COLLATE` such as `utf8mb4_general_ci` or `utf8mb4_0900_ai_ci` is kept as it is.
4. `set_charset()` runs `mysqli_set_charset()` and then `SET NAMES <charset> COLLATE <collation>`
   ([class-wpdb.php L916-L938](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L916-L938)).
   That sets the client, connection and results character sets and `collation_connection` for the session
   ([connection character sets](https://dev.mysql.com/doc/refman/8.4/en/charset-connection.html)).

Result for the sample configuration (`utf8mb4`, empty `DB_COLLATE`) on current MySQL and MariaDB: the connection
collation is `utf8mb4_unicode_520_ci`. That is the `COERCIBLE` collation in most WordPress 1267 messages.

## Tables WordPress creates

- `get_charset_collate()` returns `DEFAULT CHARACTER SET <charset> COLLATE <collation>` from the same two values
  ([class-wpdb.php L4110-L4121](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L4110-L4121)).
  Core appends it to each of its `CREATE TABLE` statements ([schema.php L36-L64](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L36-L64)).
  A plugin that appends it to its `CREATE TABLE` gets the same collation as core; a plugin that writes its own
  `DEFAULT CHARSET=...` without `COLLATE`, or no character set at all, gets the server's defaults
  ([how-mixes-arise.md](how-mixes-arise.md)).
- Core indexes on long text columns use a 191-character prefix, because 767 bytes hold 191 four-byte characters
  ([schema.php L45-L53](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L45-L53)).
- `dbDelta()` compares existing tables through `DESCRIBE` and `SHOW INDEX`, and alters columns whose type differs
  ([upgrade.php L3027, L3237](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L3027)).
  `DESCRIBE` output has no collation, so a plugin's `dbDelta()` run on activation or update does not bring an existing
  table's collation into line.

## The utf8mb4 upgrade routines

- `maybe_convert_table_to_utf8mb4( $table )` reads `SHOW FULL COLUMNS`; if any column has a character set other than
  `utf8` or `utf8mb4` it returns false and changes nothing; if the table is already `utf8mb4` it returns true;
  otherwise it runs `ALTER TABLE $table CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  ([upgrade.php L2796-L2827](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2796-L2827)).
- It runs from `upgrade_430()` for sites upgrading from a database version below 33055 whose `$wpdb->charset` is
  `utf8mb4` ([upgrade.php L2010-L2024](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2010-L2024)),
  from `upgrade_network()` for the global tables ([upgrade.php L2608-L2655](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2608-L2655)),
  and from `pre_schema_upgrade()` for `termmeta` ([upgrade.php L3788-L3794](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L3788-L3794)).
- Before those conversions, core shortened its own indexes to 191 characters
  ([upgrade.php L3776-L3786](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L3776-L3786)),
  and `upgrade_440()` changed `option_name` to `VARCHAR(191)`
  ([upgrade.php L2100-L2104](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2100-L2104)).

Two consequences for an old site:

- Core tables converted by these routines are `utf8mb4_unicode_ci`, while tables created since WordPress 4.6 with
  `get_charset_collate()` are `utf8mb4_unicode_520_ci` on current servers. Both are Unicode and both are columns, so a join between them
  raises 1267 ([reading-the-error.md](reading-the-error.md)).
- A table that held a `latin1` or other non-UTF-8 column was skipped and is still in its old character set.

## What WordPress checks on writes

- `get_table_charset()` reads `SHOW FULL COLUMNS` and takes the character set from each column's collation name; a
  table mixing `utf8` and `utf8mb4` is treated as `utf8`, and other mixes as `ascii`
  ([class-wpdb.php L3276-L3363](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L3276-L3363)).
  So a single `utf8mb3` column makes WordPress strip four-byte characters from queries on the whole table.
- `check_safe_collation()` skips the extra checks when every column uses one of `utf8_bin`, `utf8_general_ci`,
  `utf8mb3_bin`, `utf8mb3_general_ci`, `utf8mb4_bin` or `utf8mb4_general_ci`
  ([class-wpdb.php L3554-L3610](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L3554-L3610)).
  With any other collation, a read query that is not all ASCII goes through the same invalid-text check as a write.
  That is expected behaviour and not a reason to change a collation.

## Changing DB_COLLATE

Changing `DB_COLLATE` changes the collation of every WordPress connection and every table created afterwards; it
converts no existing table. It moves the `COERCIBLE` side of every comparison and can start new errors against columns
that matched before. Treat it as a change with its own backup (a copy of `wp-config.php`), check and undo, after the
tables agree, and only when the owner wants a different collation for the whole site.
