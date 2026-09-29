# Reading the error

Read this for step 1 of the procedure. MySQL facts come from the MySQL 8.4 Reference Manual and the `mysql-8.4.11`
source tag, MariaDB facts from mariadb.com/docs, WordPress facts from the 7.1.2 tag; all checked on 2026-09-29.

## The error family

| Code | Symbol | Message pattern | What it tells you | Source |
| --- | --- | --- | --- | --- |
| 1267 | `ER_CANT_AGGREGATE_2COLLATIONS` | `Illegal mix of collations (%s,%s) and (%s,%s) for operation '%s'` | Two operands, each with its collation and its derivation, and the operation that combined them | [MySQL 8.4 server error reference](https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html) |
| 1270 | `ER_CANT_AGGREGATE_3COLLATIONS` | `Illegal mix of collations (%s,%s), (%s,%s), (%s,%s) for operation '%s'` | The same with three operands (for example a function with three string arguments) | same |
| 1271 | `ER_CANT_AGGREGATE_NCOLLATIONS` | `Illegal mix of collations for operation '%s'` | More operands; the collations are not listed, so read the query | same |
| 1253 | `ER_COLLATION_CHARSET_MISMATCH` | `COLLATION '%s' is not valid for CHARACTER SET '%s'` | A `COLLATE` clause names a collation of another character set, often a fix written for the wrong side | same |
| 1273 | `ER_UNKNOWN_COLLATION` | `Unknown collation: '%s'` | The server does not have that collation name, usually after an import from another server type or version | same |
| 1115 | `ER_UNKNOWN_CHARACTER_SET` | `Unknown character set: '%s'` | The same for a character set name | same |
| 1071 | `ER_TOO_LONG_KEY` | `Specified key was too long; max key length is %d bytes` | A conversion to a wider character set made an index key too long | same |
| 1366 | `ER_TRUNCATED_WRONG_VALUE_FOR_FIELD` | `Incorrect %s value: '%s' for column '%s' at row %ld` | A value holds characters the column's character set cannot store | same |
| 1118 | `ER_TOO_BIG_ROWSIZE` | `Row size too large. The maximum row size for the used table type, not counting BLOBs, is %ld. ...` | A conversion to a wider character set made the row definition too large | same |
| 3780 | `ER_FK_INCOMPATIBLE_COLUMNS` | `Referencing column '%s' and referenced column '%s' in foreign key constraint '%s' are incompatible.` | The two sides of a foreign key no longer match | same |

WordPress writes the server's message into its log line (see [finding-the-query.md](finding-the-query.md)), so the
code number is usually missing from `debug.log`; match on the message text.

## The two labels in brackets

Each operand in a 1267 or 1270 message carries a collation and a derivation name. The names come from
`DTCollation::derivation_name()` ([sql/item.h L231-L250](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/item.h#L231-L250)),
and their numbers from the `Derivation` enum ([sql/field.h L179-L187](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/field.h#L179-L187)).
The manual gives the meaning of each number ([collation coercibility](https://dev.mysql.com/doc/refman/8.4/en/charset-collation-coercibility.html)):

| Name in the error | Coercibility | Where it comes from |
| --- | --- | --- |
| `EXPLICIT` | 0 | an explicit `COLLATE` clause |
| `NONE` | 1 | the concatenation of two strings with different collations |
| `IMPLICIT` | 2 | a column, a stored routine parameter or a local variable |
| `SYSCONST` | 3 | a system constant such as the result of `USER()` or `VERSION()` |
| `COERCIBLE` | 4 | a literal, whose collation is the connection's `collation_connection` |
| `NUMERIC` | 5 | a numeric or temporal value |
| `IGNORABLE` | 6 | `NULL` or an expression derived from it |

The server uses the collation with the lowest number. When both sides have the same number, it is an error if both
are Unicode or both are not; when one side is Unicode and the other is not, the Unicode side wins and the other side is
converted. For the same character set, a `_bin` collation wins over a `_ci` or `_cs` one
([collation coercibility](https://dev.mysql.com/doc/refman/8.4/en/charset-collation-coercibility.html)).

So the pair tells you where to look:

- `(A,IMPLICIT) and (B,IMPLICIT)`: two columns with different collations meet, usually in a join or a subquery
  between a core table and a plugin table, or between two plugin tables. Both columns are candidates; the fix changes
  one of them, or the query.
- `(A,IMPLICIT) and (B,COERCIBLE)`: a column meets a literal. B is the connection collation that WordPress set (see
  [wordpress-charset.md](wordpress-charset.md)). The column's collation wins by the rule above, and the error means the
  literal could not be converted to it. The column A is the candidate.
- `(A,EXPLICIT) and (B,EXPLICIT)`: two `COLLATE` clauses disagree; the manual lists this case as an error
  ([collation coercibility](https://dev.mysql.com/doc/refman/8.4/en/charset-collation-coercibility.html)). Look at the code
  that added them.

## Why the error comes and goes

A string literal has a repertoire of `ASCII` when all its characters are in U+0000 to U+007F, and `UNICODE`
otherwise. An `ASCII` literal can be converted without loss to any character set that is a superset of ASCII, so the
server can resolve mixes with it that would otherwise raise the error
([character set repertoire](https://dev.mysql.com/doc/refman/8.4/en/charset-repertoire.html)).

This is why a query that has run for months fails only when a visitor or editor types an accented letter, a CJK
character or an emoji. Two public reports show the pattern:

- A WooCommerce product search logged `Illegal mix of collations (latin1_swedish_ci,IMPLICIT) and
  (utf8mb4_unicode_520_ci,COERCIBLE) for operation 'like'` when the search term held full-width and Japanese
  characters: a latin1 column against a utf8mb4 literal
  ([support thread](https://wordpress.org/support/topic/db-error-illegal-mix-of-collations/)).
- An activity log plugin logged `Illegal mix of collations (utf8mb3_general_ci,IMPLICIT) and
  (utf8mb4_unicode_520_ci,COERCIBLE)` when a file name held emoji: a utf8mb3 column, which stores Basic Multilingual
  Plane characters only, against a utf8mb4 literal
  ([issue 203](https://github.com/elementor/activity-log/issues/203);
  [utf8mb3](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8mb3.html)).

Reproduce with a value of the same kind, never with an ASCII test string, or the query will pass.

## The operation name

The last part names what combined the operands, from the function's name in the server source: `'='` for a
comparison or join condition, `'like'` for a `LIKE` search, `'case'` for a `CASE` expression
([sql/item_cmpfunc.h L1064, L2060, L2410](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/item_cmpfunc.h#L1064)),
`'concat'` for `CONCAT()` ([character set repertoire](https://dev.mysql.com/doc/refman/8.4/en/charset-repertoire.html)),
and `'UNION'` for two `SELECT` lists whose matching columns differ
([sql/item.cc L10700](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/item.cc#L10700)). It tells you which
part of the query to read: for `'='` the `WHERE`, `ON` or subquery condition that compares a column; for `'like'` a
search.

## WordPress messages that point to the same cause

WordPress checks some writes itself before they reach the server, so a character set problem can also show as one of
these messages in place of a server error:

- `WordPress database error: Could not perform query because it contains invalid data.` `wpdb::query()` strips
  characters the target table cannot store from a query that is not all ASCII; if anything was stripped, it refuses
  the query ([class-wpdb.php L2242-L2260](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L2242-L2260)).
- `WordPress database error: Processing the value for the following field failed: %s. The supplied value may be too
  long or contains invalid data.` from `insert()`, `update()` and `replace()` when a value holds characters the column
  cannot store or is too long ([class-wpdb.php L2812-L2856](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L2812-L2856)).
  The validation that decides this treats `utf8mb4` as the only UTF-8 set that holds four-byte sequences
  ([class-wpdb.php L3676-L3699](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L3676-L3699)).
- Emoji saved as HTML entities in post titles, content or excerpts: `wp_insert_post()` encodes emoji with
  `wp_encode_emoji()` when those columns are `utf8` or `utf8mb3`
  ([post.php L4936-L4946](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php#L4936-L4946)).

All three mean a column that is not `utf8mb4` received a four-byte character. The column is the candidate for the
change, not the query.
