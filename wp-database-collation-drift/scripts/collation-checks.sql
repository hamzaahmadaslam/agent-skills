-- Read-only: every statement below is a SELECT or a SHOW. Nothing here changes data, settings or tables.
--
-- Character set and collation map for one WordPress site on MySQL 8.x or MariaDB 10.6 and later: server, database and
-- client session defaults, the collation of each table, the text columns that differ from their table or from
-- WordPress's connection collation, columns that cannot store 4-byte characters, index key lengths under utf8mb4,
-- unique keys and foreign keys on text columns, and views.
--
-- Placeholders, filled in by collation-report.sh (or by hand):
--   {prefix}      the site's table prefix, from `wp db prefix`. On a multisite network the main site's prefix
--                 (for example wp_) also matches every subsite's tables (wp_2_...), which is what you want for a
--                 network-wide map; pass a subsite's prefix to narrow it.
--   {wp_collate}  the collation WordPress sets on its own connection ($wpdb->collate), for example
--                 utf8mb4_unicode_520_ci. The report prints it from `wp eval`. See references/wordpress-charset.md.
--
-- The session variables printed by the second block belong to the mysql client that `wp db query` starts, which
-- connects with DB_CHARSET and that character set's default collation; they are not WordPress's session values. The
-- report prints WordPress's own session values separately (references/finding-the-query.md).
--
-- Each block starts with a "-- name:" line and holds one statement. The report script runs them one at a time, so a
-- block that fails (a MySQL-only column on MariaDB, or the reverse) does not stop the others.
-- Output holds names of tables, columns, indexes and collations, sizes and counts: no row contents.
-- Sources: references/*.md (WordPress 7.1.2, MySQL 8.4 Reference Manual, MariaDB documentation, 2026-09-29).

-- name: Server version
SELECT VERSION() AS version, @@version_comment AS version_comment;

-- name: Character set and collation variables (server, database, and this client session; missing names are not listed)
SHOW VARIABLES WHERE Variable_name IN ('character_set_server', 'collation_server', 'character_set_database',
  'collation_database', 'character_set_client', 'character_set_connection', 'character_set_results',
  'collation_connection', 'character_set_collations', 'default_collation_for_utf8mb4', 'innodb_default_row_format',
  'old_mode', 'lock_wait_timeout');

-- name: Database default character set and collation
SELECT SCHEMA_NAME AS database_name,
       DEFAULT_CHARACTER_SET_NAME AS default_charset,
       DEFAULT_COLLATION_NAME AS default_collation
FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME = DATABASE();

-- name: Table collations in this database, with the number of tables using each
SELECT TABLE_COLLATION AS table_collation, COUNT(*) AS tables
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE'
GROUP BY TABLE_COLLATION
ORDER BY tables DESC;

-- name: This site's tables: default collation against WordPress's connection collation, engine, row format, size
SELECT TABLE_NAME AS table_name,
       TABLE_COLLATION AS table_collation,
       SUBSTRING_INDEX(TABLE_COLLATION, '_', 1) AS table_charset,
       IF(TABLE_COLLATION = '{wp_collate}', 'same', 'differs') AS vs_wordpress,
       ENGINE AS engine,
       ROW_FORMAT AS row_format,
       TABLE_ROWS AS approx_rows,
       ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576, 1) AS size_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE'
  AND LEFT(TABLE_NAME, CHAR_LENGTH('{prefix}')) = '{prefix}'
ORDER BY vs_wordpress DESC, TABLE_NAME;

-- name: Text columns whose collation differs from their own table's default (this site's tables)
SELECT c.TABLE_NAME AS table_name,
       c.COLUMN_NAME AS column_name,
       c.COLUMN_TYPE AS column_type,
       c.COLLATION_NAME AS column_collation,
       t.TABLE_COLLATION AS table_collation
FROM information_schema.COLUMNS c
JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
WHERE c.TABLE_SCHEMA = DATABASE()
  AND LEFT(c.TABLE_NAME, CHAR_LENGTH('{prefix}')) = '{prefix}'
  AND c.COLLATION_NAME IS NOT NULL
  AND c.COLLATION_NAME <> t.TABLE_COLLATION
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
LIMIT 200;

-- name: Text columns whose collation differs from WordPress's connection collation, with the indexes they are in
SELECT c.TABLE_NAME AS table_name,
       c.COLUMN_NAME AS column_name,
       c.COLUMN_TYPE AS column_type,
       c.CHARACTER_SET_NAME AS column_charset,
       c.COLLATION_NAME AS column_collation,
       (SELECT GROUP_CONCAT(DISTINCT s.INDEX_NAME ORDER BY s.INDEX_NAME SEPARATOR ', ')
        FROM information_schema.STATISTICS s
        WHERE s.TABLE_SCHEMA = c.TABLE_SCHEMA AND s.TABLE_NAME = c.TABLE_NAME AND s.COLUMN_NAME = c.COLUMN_NAME) AS in_indexes
FROM information_schema.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND LEFT(c.TABLE_NAME, CHAR_LENGTH('{prefix}')) = '{prefix}'
  AND c.COLLATION_NAME IS NOT NULL
  AND c.COLLATION_NAME <> '{wp_collate}'
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
LIMIT 300;

-- name: Text columns that cannot store 4-byte characters such as emoji (character set other than utf8mb4)
SELECT c.TABLE_NAME AS table_name,
       c.COLUMN_NAME AS column_name,
       c.COLUMN_TYPE AS column_type,
       c.CHARACTER_SET_NAME AS column_charset,
       c.COLLATION_NAME AS column_collation
FROM information_schema.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND LEFT(c.TABLE_NAME, CHAR_LENGTH('{prefix}')) = '{prefix}'
  AND c.CHARACTER_SET_NAME IS NOT NULL
  AND c.CHARACTER_SET_NAME <> 'utf8mb4'
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
LIMIT 300;

-- name: Index key parts on text columns, bytes now and as utf8mb4 (InnoDB limit 3072 for DYNAMIC or COMPRESSED, 767 for COMPACT or REDUNDANT; MyISAM 1000)
SELECT s.TABLE_NAME AS table_name,
       s.INDEX_NAME AS index_name,
       t.ENGINE AS engine,
       t.ROW_FORMAT AS row_format,
       s.SEQ_IN_INDEX AS key_part,
       s.COLUMN_NAME AS column_name,
       c.CHARACTER_SET_NAME AS column_charset,
       COALESCE(s.SUB_PART, c.CHARACTER_MAXIMUM_LENGTH) AS indexed_chars,
       COALESCE(s.SUB_PART, c.CHARACTER_MAXIMUM_LENGTH) * cs.MAXLEN AS bytes_now,
       COALESCE(s.SUB_PART, c.CHARACTER_MAXIMUM_LENGTH) * 4 AS bytes_as_utf8mb4
FROM information_schema.STATISTICS s
JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = s.TABLE_SCHEMA AND c.TABLE_NAME = s.TABLE_NAME AND c.COLUMN_NAME = s.COLUMN_NAME
JOIN information_schema.TABLES t
  ON t.TABLE_SCHEMA = s.TABLE_SCHEMA AND t.TABLE_NAME = s.TABLE_NAME
JOIN information_schema.CHARACTER_SETS cs
  ON cs.CHARACTER_SET_NAME = c.CHARACTER_SET_NAME
WHERE s.TABLE_SCHEMA = DATABASE()
  AND LEFT(s.TABLE_NAME, CHAR_LENGTH('{prefix}')) = '{prefix}'
  AND s.INDEX_TYPE <> 'FULLTEXT'
  AND c.CHARACTER_SET_NAME IS NOT NULL
ORDER BY bytes_as_utf8mb4 DESC, s.TABLE_NAME, s.INDEX_NAME, s.SEQ_IN_INDEX
LIMIT 200;

-- name: Unique and primary keys on text columns (a new collation can make two stored values compare equal)
SELECT s.TABLE_NAME AS table_name,
       s.INDEX_NAME AS index_name,
       GROUP_CONCAT(CONCAT(s.COLUMN_NAME, IF(s.SUB_PART IS NULL, '', CONCAT('(', s.SUB_PART, ')')))
                    ORDER BY s.SEQ_IN_INDEX SEPARATOR ', ') AS text_key_columns
FROM information_schema.STATISTICS s
WHERE s.TABLE_SCHEMA = DATABASE()
  AND LEFT(s.TABLE_NAME, CHAR_LENGTH('{prefix}')) = '{prefix}'
  AND s.NON_UNIQUE = 0
  AND EXISTS (SELECT 1 FROM information_schema.COLUMNS c
              WHERE c.TABLE_SCHEMA = s.TABLE_SCHEMA AND c.TABLE_NAME = s.TABLE_NAME
                AND c.COLUMN_NAME = s.COLUMN_NAME AND c.COLLATION_NAME IS NOT NULL)
GROUP BY s.TABLE_NAME, s.INDEX_NAME
ORDER BY s.TABLE_NAME, s.INDEX_NAME;

-- name: Foreign keys on text columns (both sides need the same character set and collation)
SELECT k.TABLE_NAME AS table_name,
       k.COLUMN_NAME AS column_name,
       k.CONSTRAINT_NAME AS constraint_name,
       k.REFERENCED_TABLE_NAME AS referenced_table,
       k.REFERENCED_COLUMN_NAME AS referenced_column,
       c.COLLATION_NAME AS column_collation
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = k.TABLE_SCHEMA AND c.TABLE_NAME = k.TABLE_NAME AND c.COLUMN_NAME = k.COLUMN_NAME
WHERE k.TABLE_SCHEMA = DATABASE()
  AND k.REFERENCED_TABLE_NAME IS NOT NULL
  AND c.COLLATION_NAME IS NOT NULL
ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME;

-- name: Views in this database and the connection collation they were created with
SELECT TABLE_NAME AS view_name,
       CHARACTER_SET_CLIENT AS character_set_client,
       COLLATION_CONNECTION AS collation_connection
FROM information_schema.VIEWS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

-- name: Collations used by this site's columns, with their pad attribute (MySQL 8.x; NO PAD compares trailing spaces)
SELECT DISTINCT c.COLLATION_NAME AS collation_name, co.PAD_ATTRIBUTE AS pad_attribute
FROM information_schema.COLUMNS c
JOIN information_schema.COLLATIONS co ON co.COLLATION_NAME = c.COLLATION_NAME
WHERE c.TABLE_SCHEMA = DATABASE()
  AND LEFT(c.TABLE_NAME, CHAR_LENGTH('{prefix}')) = '{prefix}'
ORDER BY c.COLLATION_NAME;

-- name: Collations used by this site's columns that are aliases on this server (MariaDB 11.4.5 and later)
SELECT DISTINCT c.COLLATION_NAME AS collation_name, co.COMMENT AS comment
FROM information_schema.COLUMNS c
JOIN information_schema.COLLATIONS co ON co.COLLATION_NAME = c.COLLATION_NAME
WHERE c.TABLE_SCHEMA = DATABASE()
  AND LEFT(c.TABLE_NAME, CHAR_LENGTH('{prefix}')) = '{prefix}'
  AND co.COMMENT LIKE 'Alias%'
ORDER BY c.COLLATION_NAME;
