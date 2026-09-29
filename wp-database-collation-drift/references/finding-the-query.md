# Finding the query and the code that ran it

Read this for step 2 of the procedure. WordPress links point at the 7.1.2 tag, WP-CLI at `db-command` v2.1.3 (the
version bundled with WP-CLI 2.12.0); checked on 2026-09-29.

## debug.log

- When a query fails, `wpdb::query()` reads the server's message and calls `print_error()`
  ([class-wpdb.php L2290-L2305](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L2290-L2305)).
- `print_error()` always passes one line to PHP's `error_log()`, unless errors are suppressed, in this form:
  `WordPress database error <message> for query <SQL> made by <caller list>`
  ([class-wpdb.php L1799-L1823](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L1799-L1823)).
  The caller list is the function stack from `wp_debug_backtrace_summary()`, so the line names the plugin or theme
  function that built the query.
- Where the line goes: with `WP_DEBUG` and `WP_DEBUG_LOG` true, to `wp-content/debug.log`; with `WP_DEBUG_LOG` set to a
  path, to that file ([load.php L569-L626](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L569-L626)).
  Without either, it goes wherever PHP's own `error_log` setting points; ask the host where that is.
- Search the log for `Illegal mix of collations`, `Unknown collation`, `COLLATION '`, `Incorrect string value` and
  `contains invalid data`. Group the hits by query shape and caller; count them and note the first and last time.

Log lines hold the full SQL, including search terms, names and email addresses that visitors typed. Read the log
where it is, copy only the query shapes and callers into the report, and keep copies out of chats and tickets.

## Query Monitor

- With Query Monitor active, a query that produces an error appears in the Query Errors panel with the full error
  message, the query and its caller; the Queries panel shows the caller, the full call stack and the component
  (core, a plugin or a theme) of every query
  ([database queries](https://querymonitor.com/wordpress-debugging/database-queries/)). Version checked: 4.0.7
  ([plugin directory](https://wordpress.org/plugins/query-monitor/)).
- Reproduce the failing request on staging with the same kind of input: non-ASCII characters of the kind in the error
  ([reading-the-error.md](reading-the-error.md#why-the-error-comes-and-goes)).
- Installing Query Monitor on production is a change and needs approval.

## SAVEQUERIES

With `SAVEQUERIES` defined and true, `wpdb` stores each query with its time, call stack and start time in
`$wpdb->queries` ([class-wpdb.php L2348-L2404](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L2348-L2404)).
It records queries, not errors; errors go to the global `$EZSQL_ERROR` array that `print_error()` fills
([class-wpdb.php L1799-L1808](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L1799-L1808)).
Use it on staging only; defining a constant in `wp-config.php` is a change.

## Reproducing a query outside the page

Run the failing `SELECT` on staging the way WordPress runs it, or the result can differ:

- WordPress's connection: `SET NAMES <charset> COLLATE <collation>` with `$wpdb->charset` and `$wpdb->collate`
  ([class-wpdb.php L916-L938](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L916-L938)).
  Literals in its queries carry that collation ([collation coercibility](https://dev.mysql.com/doc/refman/8.4/en/charset-collation-coercibility.html)).
- `wp db query` starts the `mysql` client with `--default-character-set` set to `DB_CHARSET` when it is defined
  ([DB_Command.php L1796-L1806](https://github.com/wp-cli/db-command/blob/v2.1.3/src/DB_Command.php#L1796-L1806)). The
  server then sets `collation_connection` to that character set's default collation
  ([connection character sets](https://dev.mysql.com/doc/refman/8.4/en/charset-connection.html)), which on MySQL 8.4 is
  `utf8mb4_0900_ai_ci` for `utf8mb4` ([server character set](https://dev.mysql.com/doc/refman/8.4/en/charset-server.html)),
  not the `utf8mb4_unicode_520_ci` WordPress usually sets.
- To match WordPress in a `wp db query` session, start the statement text with the same `SET NAMES`, for example
  `SET NAMES utf8mb4 COLLATE utf8mb4_unicode_520_ci; SELECT ...`, using the values the report prints. A
  `SELECT` is safe to repeat; never repeat an `INSERT`, `UPDATE` or `DELETE` from the log to test it.
- `wp eval` runs PHP with WordPress loaded, so `$wpdb->get_results( '<SELECT>' )` uses WordPress's own connection;
  `$wpdb->last_error` then holds the message.

## Naming the code

- The caller list in the log line, or the caller and component in Query Monitor, names the function. Find it in the
  plugin or theme and read how it builds the SQL: a join between its own table and a core table, a `LIKE` on its own
  column, or a hard-coded `COLLATE`.
- For queries seen only in the server's logs, search the code for a distinctive fragment of the statement, such as
  the plugin's table name without the prefix.
- Record per query: the shape (literal values masked), the operation, the two collations and derivations, the tables
  and columns involved, the caller and the component.
