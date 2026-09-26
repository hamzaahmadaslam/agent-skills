<?php
/**
 * Read-only helper for `wp eval-file`. Shows the execution plan of one SELECT statement, read from a file, on the
 * site's own database connection.
 *
 * It refuses anything but a single SELECT (or WITH ... SELECT): no INSERT, UPDATE, DELETE, REPLACE, INTO, locking
 * reads, executable comments or functions with side effects (SLEEP, GET_LOCK, LOAD_FILE and similar). By default it
 * runs plain EXPLAIN, which does not execute the statement. With the extra argument `analyze` it measures the SELECT
 * (MySQL 8.0.18+ EXPLAIN ANALYZE, MariaDB ANALYZE): that executes the SELECT, as expensive as the slow request itself,
 * so use it on a staging copy or a replica only. In analyze mode it also refuses functions it does not recognize,
 * because a stored function could write data.
 *
 * Usage (from the WordPress root, or with --path=...):
 *   wp eval-file explain-select.php query.sql              # plan only (read-only, safe on production)
 *   wp eval-file explain-select.php query.sql json         # plan in JSON format
 *   wp eval-file explain-select.php query.sql analyze      # measured plan; staging or replica only
 * The file holds one SELECT, for example copied from Query Monitor. {prefix} and {base_prefix} in it are replaced
 * with this site's table prefixes. To stop a measurement, run KILL QUERY <connection id> from another session; the
 * helper prints the id before it starts.
 *
 * Sources: references/explain.md (MySQL 8.4 manual, MariaDB documentation, checked 2026-09-26).
 */

if ( ! function_exists( 'sqi_explain_mask' ) ) {
	/**
	 * Replaces string literals, quoted identifiers and comments with placeholders, reading the statement character by
	 * character so that quotes inside comments and comment markers inside strings are handled. Returns array( masked
	 * text, true when a quote or comment is left open ).
	 *
	 * @param string $sql The statement.
	 * @return array
	 */
	function sqi_explain_mask( $sql ) {
		$out  = '';
		$len  = strlen( $sql );
		$open = false;
		$i    = 0;
		while ( $i < $len ) {
			$c    = $sql[ $i ];
			$next = $i + 1 < $len ? $sql[ $i + 1 ] : '';
			if ( "'" === $c || '"' === $c || '`' === $c ) {
				$quote  = $c;
				$closed = false;
				++$i;
				while ( $i < $len ) {
					if ( '\\' === $sql[ $i ] && '`' !== $quote ) {
						$i += 2;
						continue;
					}
					if ( $sql[ $i ] === $quote ) {
						if ( $i + 1 < $len && $sql[ $i + 1 ] === $quote ) {
							$i += 2;
							continue;
						}
						$closed = true;
						break;
					}
					++$i;
				}
				$open = $open || ! $closed;
				++$i;
				$out .= '`' === $quote ? ' `x` ' : " '' ";
				continue;
			}
			if ( '/' === $c && '*' === $next ) {
				$end  = strpos( $sql, '*/', $i + 2 );
				$open = $open || false === $end;
				$i    = false === $end ? $len : $end + 2;
				$out .= ' ';
				continue;
			}
			if ( '#' === $c || ( '-' === $c && '-' === $next && ( $i + 2 >= $len || ctype_space( $sql[ $i + 2 ] ) ) ) ) {
				$end = strpos( $sql, "\n", $i );
				$i   = false === $end ? $len : $end;
				continue;
			}
			$out .= $c;
			++$i;
		}
		return array( $out, $open );
	}
}

if ( ! function_exists( 'sqi_explain_check' ) ) {
	/**
	 * Checks that $sql is one read-only SELECT. Returns array( 'ok' => bool, 'errors' => string[], 'sql' => string ).
	 *
	 * @param string $sql     The statement.
	 * @param bool   $analyze Whether the statement will be executed (EXPLAIN ANALYZE or ANALYZE).
	 * @return array
	 */
	function sqi_explain_check( $sql, $analyze ) {
		$errors = array();
		$sql    = trim( (string) $sql );
		$sql    = preg_replace( '/;\s*$/', '', $sql );

		if ( '' === $sql ) {
			return array( 'ok' => false, 'errors' => array( 'The file is empty.' ), 'sql' => '' );
		}
		if ( preg_match( '#/\*[!M]#', $sql ) ) {
			$errors[] = 'Executable comments (/*! ... */ or /*M! ... */) are not allowed.';
		}

		// Mask string literals, quoted identifiers and comments so keywords inside them do not count.
		list( $masked, $open ) = sqi_explain_mask( $sql );
		if ( $open ) {
			$errors[] = 'A quote or a comment is not closed.';
		}
		$upper = strtoupper( $masked );

		if ( ! preg_match( '/^\s*\(*\s*(SELECT|WITH)\b/', $upper ) ) {
			$errors[] = 'Only a SELECT statement (or WITH ... SELECT) is accepted.';
		}
		if ( false !== strpos( $masked, ';' ) ) {
			$errors[] = 'Only one statement is accepted (remove the semicolons between statements).';
		}
		$forbidden = array(
			'/\bINSERT\b(?!\s*\()/'           => 'INSERT',
			'/\bREPLACE\b(?!\s*\()/'          => 'REPLACE',
			'/\bUPDATE\b/'                    => 'UPDATE (including FOR UPDATE)',
			'/\bDELETE\b/'                    => 'DELETE',
			'/\bINTO\b/'                      => 'INTO (OUTFILE, DUMPFILE or variables)',
			'/\bFOR\s+SHARE\b/'               => 'FOR SHARE',
			'/\bLOCK\b/'                      => 'LOCK (LOCK IN SHARE MODE)',
			'/\bHANDLER\b/'                   => 'HANDLER',
			'/\bNEXT\s+VALUE\s+FOR\b/'        => 'NEXT VALUE FOR',
		);
		foreach ( $forbidden as $pattern => $label ) {
			if ( preg_match( $pattern, $upper ) ) {
				$errors[] = 'Not allowed in a read-only check: ' . $label . '.';
			}
		}
		$side_effects = array( 'SLEEP', 'BENCHMARK', 'GET_LOCK', 'RELEASE_LOCK', 'RELEASE_ALL_LOCKS', 'IS_USED_LOCK', 'LOAD_FILE', 'NEXTVAL', 'SETVAL', 'LASTVAL', 'MASTER_POS_WAIT', 'SOURCE_POS_WAIT', 'MASTER_GTID_WAIT', 'WAIT_FOR_EXECUTED_GTID_SET', 'WAIT_UNTIL_SQL_THREAD_AFTER_GTIDS', 'SYS_EXEC', 'SYS_EVAL' );
		preg_match_all( '/\b([A-Z_][A-Z0-9_]*)\s*\(/', $upper, $calls );
		$names = array_unique( $calls[1] );
		foreach ( array_intersect( $names, $side_effects ) as $name ) {
			$errors[] = 'Function with side effects not allowed: ' . $name . '().';
		}

		if ( $analyze ) {
			$known   = array( 'SELECT', 'WITH', 'FROM', 'JOIN', 'WHERE', 'ON', 'USING', 'IN', 'EXISTS', 'AS', 'AND', 'OR', 'NOT', 'XOR', 'UNION', 'ALL', 'ANY', 'SOME', 'VALUES', 'ROW', 'OVER', 'PARTITION', 'INDEX', 'KEY', 'DISTINCT', 'OF', 'BY', 'LIKE', 'REGEXP', 'RLIKE', 'BETWEEN', 'IS', 'THEN', 'ELSE', 'WHEN', 'IF', 'IFNULL', 'NULLIF', 'COALESCE', 'GREATEST', 'LEAST', 'ISNULL', 'COUNT', 'SUM', 'MIN', 'MAX', 'AVG', 'STD', 'STDDEV', 'VARIANCE', 'BIT_AND', 'BIT_OR', 'BIT_XOR', 'GROUP_CONCAT', 'ANY_VALUE', 'CAST', 'CONVERT', 'BINARY', 'CHAR', 'VARCHAR', 'DECIMAL', 'NUMERIC', 'SIGNED', 'UNSIGNED', 'DATETIME', 'DATE', 'TIME', 'TIMESTAMP', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'MICROSECOND', 'WEEK', 'QUARTER', 'DAYOFMONTH', 'DAYOFWEEK', 'DAYOFYEAR', 'WEEKDAY', 'YEARWEEK', 'DAYNAME', 'MONTHNAME', 'LAST_DAY', 'NOW', 'CURDATE', 'CURTIME', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP', 'SYSDATE', 'UNIX_TIMESTAMP', 'FROM_UNIXTIME', 'DATE_FORMAT', 'DATE_ADD', 'DATE_SUB', 'ADDDATE', 'SUBDATE', 'DATEDIFF', 'TIMEDIFF', 'TIMESTAMPDIFF', 'TIMESTAMPADD', 'STR_TO_DATE', 'TO_DAYS', 'TO_SECONDS', 'TIME_TO_SEC', 'SEC_TO_TIME', 'EXTRACT', 'CONVERT_TZ', 'INTERVAL', 'CONCAT', 'CONCAT_WS', 'SUBSTRING', 'SUBSTR', 'SUBSTRING_INDEX', 'MID', 'LEFT', 'RIGHT', 'LENGTH', 'CHAR_LENGTH', 'CHARACTER_LENGTH', 'OCTET_LENGTH', 'BIT_LENGTH', 'LOWER', 'LCASE', 'UPPER', 'UCASE', 'TRIM', 'LTRIM', 'RTRIM', 'LPAD', 'RPAD', 'REPLACE', 'INSERT', 'REVERSE', 'REPEAT', 'SPACE', 'INSTR', 'LOCATE', 'POSITION', 'FIELD', 'FIND_IN_SET', 'ELT', 'MAKE_SET', 'STRCMP', 'SOUNDEX', 'QUOTE', 'FORMAT', 'ASCII', 'ORD', 'HEX', 'UNHEX', 'MD5', 'SHA', 'SHA1', 'SHA2', 'CRC32', 'CHARSET', 'COLLATION', 'WEIGHT_STRING', 'REGEXP_REPLACE', 'REGEXP_LIKE', 'REGEXP_SUBSTR', 'REGEXP_INSTR', 'MATCH', 'AGAINST', 'ROUND', 'FLOOR', 'CEIL', 'CEILING', 'TRUNCATE', 'ABS', 'MOD', 'SIGN', 'POW', 'POWER', 'SQRT', 'LOG', 'LOG2', 'LOG10', 'LN', 'EXP', 'PI', 'RAND', 'CONV', 'INET_ATON', 'INET_NTOA', 'JSON_EXTRACT', 'JSON_UNQUOTE', 'JSON_VALUE', 'JSON_CONTAINS', 'JSON_CONTAINS_PATH', 'JSON_LENGTH', 'JSON_KEYS', 'JSON_SEARCH', 'JSON_TYPE', 'JSON_VALID', 'JSON_OBJECT', 'JSON_ARRAY', 'JSON_ARRAYAGG', 'JSON_OBJECTAGG', 'JSON_OVERLAPS', 'MEMBER', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'PERCENT_RANK', 'CUME_DIST', 'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE', 'FOUND_ROWS', 'DATABASE', 'SCHEMA', 'VERSION', 'CONNECTION_ID', 'USER', 'CURRENT_USER' );
			$unknown = array_diff( $names, $known );
			if ( $unknown ) {
				$errors[] = 'Analyze refused: ' . implode( ', ', $unknown ) . '() is not a built-in function this helper knows, and a stored function could write data. Run the plain EXPLAIN instead.';
			}
		}

		return array(
			'ok'     => ! $errors,
			'errors' => $errors,
			'sql'    => $sql,
		);
	}
}

if ( ! function_exists( 'sqi_explain_print_rows' ) ) {
	/**
	 * Prints result rows as an aligned text table.
	 *
	 * @param array $rows Rows as associative arrays.
	 */
	function sqi_explain_print_rows( $rows ) {
		if ( ! $rows ) {
			echo "(no rows)\n";
			return;
		}
		$columns = array_keys( $rows[0] );
		$widths  = array();
		foreach ( $columns as $column ) {
			$widths[ $column ] = strlen( $column );
			foreach ( $rows as $row ) {
				$value = null === $row[ $column ] ? 'NULL' : (string) $row[ $column ];
				if ( false === strpos( $value, "\n" ) ) {
					$widths[ $column ] = max( $widths[ $column ], strlen( $value ) );
				}
			}
		}
		$multiline = false;
		foreach ( $rows as $row ) {
			foreach ( $row as $value ) {
				if ( false !== strpos( (string) $value, "\n" ) ) {
					$multiline = true;
				}
			}
		}
		if ( $multiline || 1 === count( $columns ) ) {
			foreach ( $rows as $row ) {
				foreach ( $row as $column => $value ) {
					printf( "%s:\n%s\n", $column, null === $value ? 'NULL' : $value );
				}
			}
			return;
		}
		$line = '';
		foreach ( $columns as $column ) {
			$line .= str_pad( $column, $widths[ $column ] ) . '  ';
		}
		echo rtrim( $line ), "\n";
		foreach ( $rows as $row ) {
			$line = '';
			foreach ( $columns as $column ) {
				$line .= str_pad( null === $row[ $column ] ? 'NULL' : (string) $row[ $column ], $widths[ $column ] ) . '  ';
			}
			echo rtrim( $line ), "\n";
		}
	}
}

if ( ! defined( 'ABSPATH' ) || ! isset( $GLOBALS['wpdb'] ) ) {
	return;
}

$sqi_args    = isset( $args ) && is_array( $args ) ? array_values( $args ) : array();
$sqi_file    = isset( $sqi_args[0] ) ? (string) $sqi_args[0] : '';
$sqi_analyze = in_array( 'analyze', $sqi_args, true );
$sqi_json    = in_array( 'json', $sqi_args, true );

if ( '' === $sqi_file || ! is_readable( $sqi_file ) ) {
	echo "Usage: wp eval-file explain-select.php <file with one SELECT> [json] [analyze]\n";
	return;
}

global $wpdb;
$sqi_sql   = str_replace( array( '{prefix}', '{base_prefix}' ), array( $wpdb->prefix, $wpdb->base_prefix ), (string) file_get_contents( $sqi_file ) );
$sqi_check = sqi_explain_check( $sqi_sql, $sqi_analyze );
if ( ! $sqi_check['ok'] ) {
	echo "Refused, nothing was run:\n";
	foreach ( $sqi_check['errors'] as $sqi_error ) {
		echo '- ', $sqi_error, "\n";
	}
	return;
}

$sqi_mariadb = false !== stripos( (string) $wpdb->db_server_info(), 'mariadb' );
$sqi_run     = static function ( $statement ) use ( $wpdb ) {
	$suppress = $wpdb->suppress_errors( true );
	$rows     = $wpdb->get_results( $statement, ARRAY_A );
	$error    = $wpdb->last_error;
	$wpdb->suppress_errors( $suppress );
	return array( is_array( $rows ) ? $rows : array(), $error );
};

printf( "Server: %s\n", $wpdb->db_server_info() );

// Plain EXPLAIN never executes the statement.
echo "\n== EXPLAIN (plan and estimates; the statement is not executed) ==\n";
list( $sqi_rows, $sqi_error ) = $sqi_run( 'EXPLAIN ' . ( $sqi_json ? 'FORMAT=JSON ' : '' ) . $sqi_check['sql'] );
if ( '' !== $sqi_error ) {
	echo 'EXPLAIN failed: ', $sqi_error, "\n";
	return;
}
sqi_explain_print_rows( $sqi_rows );

// Notes about unusable indexes (MariaDB 10.6.16 and later); the rewritten statement (code 1003) is skipped.
list( $sqi_warnings ) = $sqi_run( 'SHOW WARNINGS' );
foreach ( $sqi_warnings as $sqi_warning ) {
	if ( isset( $sqi_warning['Code'] ) && '1003' !== (string) $sqi_warning['Code'] ) {
		printf( "Note %s: %s\n", $sqi_warning['Code'], $sqi_warning['Message'] );
	}
}

if ( ! $sqi_mariadb && ! $sqi_json ) {
	echo "\n== EXPLAIN FORMAT=TREE (MySQL 8.0.16 and later) ==\n";
	list( $sqi_rows, $sqi_error ) = $sqi_run( 'EXPLAIN FORMAT=TREE ' . $sqi_check['sql'] );
	if ( '' === $sqi_error ) {
		sqi_explain_print_rows( $sqi_rows );
	} else {
		echo '(not available: ', $sqi_error, ")\n";
	}
}

if ( ! $sqi_analyze ) {
	echo "\nPlan only. Add the argument `analyze` on a staging copy or replica to measure it.\n";
	return;
}

list( $sqi_id ) = $sqi_run( 'SELECT CONNECTION_ID() AS id' );
$sqi_statement  = $sqi_mariadb ? 'ANALYZE ' . ( $sqi_json ? 'FORMAT=JSON ' : '' ) : 'EXPLAIN ANALYZE ';
printf(
	"\n== %s(this executes the SELECT; connection id %s, stop it with KILL QUERY %s from another session) ==\n",
	$sqi_statement,
	isset( $sqi_id[0]['id'] ) ? $sqi_id[0]['id'] : '?',
	isset( $sqi_id[0]['id'] ) ? $sqi_id[0]['id'] : '<id>'
);
$sqi_start = microtime( true );
list( $sqi_rows, $sqi_error ) = $sqi_run( $sqi_statement . $sqi_check['sql'] );
$sqi_ms = ( microtime( true ) - $sqi_start ) * 1000;
if ( '' !== $sqi_error ) {
	echo 'Measurement failed: ', $sqi_error, "\n";
	return;
}
sqi_explain_print_rows( $sqi_rows );
printf( "\nWall time of the measured run, seen from PHP: %.1f ms\n", $sqi_ms );
