<?php
/**
 * Keeps the PHPCS findings that sit on lines a change added or modified, and sorts them into the review
 * levels of the wp-vip-code-review skill: blocker, fix before merge, should fix, cleanup.
 *
 * Read-only helper: it reads a PHPCS JSON report and a unified diff and prints the result to standard output.
 * It writes no files, changes nothing and makes no network requests. Requires PHP 7.4 or later.
 *
 * Usage:
 *   php scripts/filter-report.php --report=phpcs.json --diff=change.diff [--format=markdown|json] [--all] [--max=N]
 *
 * Exit codes: 0 finished (with or without findings), 1 bad arguments, 2 input missing or not readable.
 */

const LEVELS = array(
	'blocker'          => 'Blocker (error)',
	'fix_before_merge' => 'Fix before merge (warning, severity 6 to 10)',
	'should_fix'       => 'Should fix (warning, severity 5)',
	'cleanup'          => 'Cleanup (warning, severity 1 to 4)',
);

const HELP = <<<'TXT'
Usage: php filter-report.php --report=<file> --diff=<file> [--format=markdown|json] [--all] [--max=N]

Keeps the PHPCS findings on lines the change added or modified and sorts them into review levels:
  Blocker           every ERROR (errors fail the VIP Code Analysis Bot's status check)
  Fix before merge  WARNING with severity 6 to 10
  Should fix        WARNING with severity 5
  Cleanup           WARNING with severity 1 to 4

Options:
  --report=<file>   PHPCS JSON report, from: phpcs ... --report=json --report-file=phpcs.json
                    Use "-" to read it from standard input.
  --diff=<file>     Unified diff of the change, from: git diff BASE...HEAD > change.diff
  --format=<name>   markdown (default) or json
  --all             Also list findings on lines the change did not touch, as "pre-existing"
  --max=<N>         Rows listed per section (default 200); counts always cover everything
  --help            Show this help

Examples:
  php scripts/filter-report.php --report=phpcs.json --diff=change.diff
  php scripts/filter-report.php --report=phpcs.json --diff=change.diff --format=json --all

Exit codes: 0 finished, 1 bad arguments, 2 input missing or not readable.

TXT;

/**
 * Prints an error to standard error and exits.
 *
 * @param string $message What went wrong and what to do.
 * @param int    $code    Exit code.
 */
function stop_with( $message, $code ) {
	fwrite( STDERR, 'Error: ' . $message . PHP_EOL );
	exit( $code );
}

/**
 * Reads a file, or standard input for "-".
 *
 * @param string $path  Path given on the command line.
 * @param string $label Option name, for error messages.
 * @return string
 */
function read_input( $path, $label ) {
	if ( '-' === $path ) {
		$raw = stream_get_contents( STDIN );
	} elseif ( is_file( $path ) && is_readable( $path ) ) {
		$raw = file_get_contents( $path );
	} else {
		stop_with( "--{$label}: cannot read \"{$path}\". Check the path.", 2 );
	}
	if ( false === $raw ) {
		stop_with( "--{$label}: reading \"{$path}\" failed.", 2 );
	}
	return $raw;
}

/**
 * Normalizes a path for comparison: forward slashes, no leading "./".
 *
 * @param string $path Path from the report or the diff.
 * @return string
 */
function normalize_path( $path ) {
	$path = str_replace( '\\', '/', $path );
	while ( 0 === strpos( $path, './' ) ) {
		$path = substr( $path, 2 );
	}
	return $path;
}

/**
 * Reads the path from a "--- " or "+++ " diff header line (without the marker).
 *
 * @param string $value Header value, such as "b/themes/x/functions.php".
 * @return string Path, or "/dev/null".
 */
function header_path( $value ) {
	$tab = strpos( $value, "\t" );
	if ( false !== $tab ) {
		$value = substr( $value, 0, $tab );
	}
	$value = rtrim( $value, "\r" );
	if ( strlen( $value ) > 1 && '"' === $value[0] && '"' === substr( $value, -1 ) ) {
		// Git quotes unusual paths C-style, with octal escapes for non-ASCII bytes.
		$value = stripcslashes( substr( $value, 1, -1 ) );
	}
	return $value;
}

/**
 * Parses a unified diff into the new-side line numbers that were added or modified, per file.
 *
 * @param string $raw Diff text.
 * @return array<string, array<int, bool>>
 */
function parse_diff( $raw ) {
	$changed   = array();
	$current   = null;
	$old_path  = null;
	$new_line  = 0;
	$old_left  = 0;
	$new_left  = 0;

	foreach ( preg_split( '/\r?\n/', $raw ) as $line ) {
		// Inside a hunk, the header counts say how many lines belong to it.
		if ( $old_left > 0 || $new_left > 0 ) {
			$first = ( '' === $line ) ? ' ' : $line[0];
			if ( '+' === $first ) {
				if ( null !== $current ) {
					$changed[ $current ][ $new_line ] = true;
				}
				++$new_line;
				--$new_left;
				continue;
			}
			if ( '-' === $first ) {
				--$old_left;
				continue;
			}
			if ( ' ' === $first ) {
				++$new_line;
				--$new_left;
				--$old_left;
				continue;
			}
			if ( '\\' === $first ) {
				continue; // "\ No newline at end of file".
			}
			$old_left = 0; // Malformed hunk: stop counting and read headers again.
			$new_left = 0;
		}

		if ( preg_match( '/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/', $line, $m ) ) {
			$old_left = ( isset( $m[2] ) && '' !== $m[2] ) ? (int) $m[2] : 1;
			$new_left = ( isset( $m[4] ) && '' !== $m[4] ) ? (int) $m[4] : 1;
			$new_line = (int) $m[3];
			continue;
		}
		if ( 0 === strpos( $line, 'diff --git ' ) ) {
			$current  = null;
			$old_path = null;
			continue;
		}
		if ( 0 === strpos( $line, '--- ' ) ) {
			$old_path = header_path( substr( $line, 4 ) );
			continue;
		}
		if ( 0 === strpos( $line, '+++ ' ) ) {
			$path = header_path( substr( $line, 4 ) );
			if ( '/dev/null' === $path ) {
				$current = null;
				continue;
			}
			$prefixed = ( null === $old_path || '/dev/null' === $old_path || 0 === strpos( $old_path, 'a/' ) );
			if ( $prefixed && 0 === strpos( $path, 'b/' ) ) {
				$path = substr( $path, 2 );
			}
			$current = normalize_path( $path );
			if ( ! isset( $changed[ $current ] ) ) {
				$changed[ $current ] = array();
			}
		}
	}
	return $changed;
}

/**
 * Decodes the PHPCS JSON report into a flat list of messages.
 *
 * @param string $raw Report text.
 * @return array<int, array<string, mixed>>
 */
function parse_report( $raw ) {
	$data = json_decode( $raw, true );
	if ( ! is_array( $data ) ) {
		// PHPCS may print notices before the JSON when the report goes to standard output.
		$start = strpos( $raw, '{"totals"' );
		$end   = strrpos( $raw, '}' );
		if ( false !== $start && false !== $end && $end > $start ) {
			$data = json_decode( substr( $raw, $start, $end - $start + 1 ), true );
		}
	}
	if ( ! is_array( $data ) || ! isset( $data['files'] ) || ! is_array( $data['files'] ) ) {
		stop_with( '--report: not a PHPCS JSON report. Run phpcs with --report=json --report-file=<file>.', 2 );
	}

	$messages = array();
	foreach ( $data['files'] as $file => $info ) {
		if ( empty( $info['messages'] ) || ! is_array( $info['messages'] ) ) {
			continue;
		}
		foreach ( $info['messages'] as $message ) {
			$messages[] = array(
				'path'     => normalize_path( (string) $file ),
				'line'     => isset( $message['line'] ) ? (int) $message['line'] : 0,
				'column'   => isset( $message['column'] ) ? (int) $message['column'] : 0,
				'type'     => isset( $message['type'] ) ? strtoupper( (string) $message['type'] ) : 'ERROR',
				'severity' => isset( $message['severity'] ) ? (int) $message['severity'] : 5,
				'source'   => isset( $message['source'] ) ? (string) $message['source'] : '',
				'message'  => isset( $message['message'] ) ? (string) $message['message'] : '',
				'fixable'  => ! empty( $message['fixable'] ),
			);
		}
	}
	return $messages;
}

/**
 * Finds the diff path a report path refers to: an exact match, else the longest diff path it ends with.
 *
 * @param string                           $report_path Normalized report path (relative or absolute).
 * @param array<string, array<int, bool>>  $changed     Parsed diff.
 * @return string|null
 */
function match_path( $report_path, $changed ) {
	if ( isset( $changed[ $report_path ] ) ) {
		return $report_path;
	}
	$best = null;
	foreach ( array_keys( $changed ) as $diff_path ) {
		$suffix = '/' . $diff_path;
		$length = strlen( $suffix );
		if ( strlen( $report_path ) > $length && substr( $report_path, -$length ) === $suffix ) {
			if ( null === $best || strlen( $diff_path ) > strlen( $best ) ) {
				$best = $diff_path;
			}
		}
	}
	return $best;
}

/**
 * Review level for a PHPCS message.
 *
 * @param string $type     ERROR or WARNING.
 * @param int    $severity 1 to 10.
 * @return string Key of LEVELS.
 */
function level_for( $type, $severity ) {
	if ( 'ERROR' === $type ) {
		return 'blocker';
	}
	if ( $severity >= 6 ) {
		return 'fix_before_merge';
	}
	if ( 5 === $severity ) {
		return 'should_fix';
	}
	return 'cleanup';
}

/**
 * Escapes text for a Markdown table cell.
 *
 * @param string $text Cell text.
 * @return string
 */
function cell( $text ) {
	return str_replace( array( '|', "\r", "\n" ), array( '\\|', ' ', ' ' ), $text );
}

/**
 * Markdown table for a list of findings, cut at $max rows.
 *
 * @param array<int, array<string, mixed>> $rows Findings.
 * @param int                              $max  Row limit.
 * @return string
 */
function table( $rows, $max ) {
	$out  = "| Where | Source | Type | Severity | Message |\n";
	$out .= "| ----- | ------ | ---- | -------- | ------- |\n";
	foreach ( array_slice( $rows, 0, $max ) as $row ) {
		$out .= sprintf(
			"| `%s:%d` | `%s` | %s | %d | %s |\n",
			cell( $row['path'] ),
			$row['line'],
			cell( $row['source'] ),
			strtolower( $row['type'] ),
			$row['severity'],
			cell( $row['message'] )
		);
	}
	if ( count( $rows ) > $max ) {
		$out .= "\n" . ( count( $rows ) - $max ) . " more not listed (raise --max to see them).\n";
	}
	return $out;
}

// Arguments.
$options = getopt( '', array( 'report:', 'diff:', 'format:', 'all', 'max:', 'help' ) );
if ( false === $options ) {
	$options = array();
}
if ( isset( $options['help'] ) ) {
	fwrite( STDOUT, HELP );
	exit( 0 );
}
foreach ( array( 'report', 'diff', 'format', 'max' ) as $name ) {
	if ( isset( $options[ $name ] ) && ! is_string( $options[ $name ] ) ) {
		stop_with( "--{$name} was given more than once.", 1 );
	}
}
if ( empty( $options['report'] ) || empty( $options['diff'] ) ) {
	stop_with( "--report and --diff are both required.\n\n" . HELP, 1 );
}
$format = isset( $options['format'] ) ? $options['format'] : 'markdown';
if ( ! in_array( $format, array( 'markdown', 'json' ), true ) ) {
	stop_with( "--format must be markdown or json. Received: \"{$format}\".", 1 );
}
$max = 200;
if ( isset( $options['max'] ) ) {
	if ( ! preg_match( '/^\d+$/', $options['max'] ) || (int) $options['max'] < 1 ) {
		stop_with( "--max must be a whole number of 1 or more. Received: \"{$options['max']}\".", 1 );
	}
	$max = (int) $options['max'];
}
$include_all = isset( $options['all'] );

// Work.
$changed  = parse_diff( read_input( $options['diff'], 'diff' ) );
$messages = parse_report( read_input( $options['report'], 'report' ) );

$changed_lines = 0;
foreach ( $changed as $lines ) {
	$changed_lines += count( $lines );
}

$kept         = array();
$pre_existing = array();
$report_files = array();
$unmatched    = array();
foreach ( $messages as $message ) {
	$report_files[ $message['path'] ] = true;
	$diff_path                        = match_path( $message['path'], $changed );
	if ( null === $diff_path ) {
		$unmatched[ $message['path'] ] = true;
	}
	$message['level'] = level_for( $message['type'], $message['severity'] );
	if ( null !== $diff_path && isset( $changed[ $diff_path ][ $message['line'] ] ) ) {
		$message['path'] = $diff_path;
		$kept[]          = $message;
	} else {
		$pre_existing[] = $message;
	}
}

$by_position = function ( $a, $b ) {
	return array( $a['path'], $a['line'], $a['column'] ) <=> array( $b['path'], $b['line'], $b['column'] );
};
usort( $kept, $by_position );
usort( $pre_existing, $by_position );

$grouped = array_fill_keys( array_keys( LEVELS ), array() );
foreach ( $kept as $message ) {
	$grouped[ $message['level'] ][] = $message;
}

if ( 'json' === $format ) {
	// Most serious level first, so a --max cut drops cleanup rows before blockers.
	$by_level   = call_user_func_array( 'array_merge', array_values( $grouped ) );
	$first_rows = function ( $rows ) use ( $max ) {
		return array_slice( array_values( $rows ), 0, $max );
	};
	$result     = array(
		'summary'  => array(
			'report_files'       => count( $report_files ),
			'report_messages'    => count( $messages ),
			'diff_files'         => count( $changed ),
			'changed_lines'      => $changed_lines,
			'kept'               => count( $kept ),
			'on_unchanged_lines' => count( $pre_existing ),
			'files_not_in_diff'  => count( $unmatched ),
			'levels'             => array_map( 'count', $grouped ),
		),
		'findings' => $first_rows( $by_level ),
	);
	if ( $include_all ) {
		$result['pre_existing'] = $first_rows( $pre_existing );
	}
	fwrite( STDOUT, json_encode( $result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . "\n" );
	exit( 0 );
}

$out  = "# PHPCS findings on changed lines\n\n";
$out .= sprintf(
	"Report: %d messages in %d files. Diff: %d files, %d added or modified lines.\n",
	count( $messages ),
	count( $report_files ),
	count( $changed ),
	$changed_lines
);
$out .= sprintf( 'Kept: %d messages on changed lines. On unchanged lines: %d', count( $kept ), count( $pre_existing ) );
$out .= $include_all ? ".\n" : " (add --all to list them).\n";
if ( count( $unmatched ) > 0 ) {
	$out .= sprintf( "Report files not in the diff: %d (their messages count as unchanged).\n", count( $unmatched ) );
}
$out .= "\n| Level | Count |\n| ----- | ----- |\n";
foreach ( LEVELS as $key => $label ) {
	$out .= sprintf( "| %s | %d |\n", $label, count( $grouped[ $key ] ) );
}
foreach ( LEVELS as $key => $label ) {
	if ( count( $grouped[ $key ] ) > 0 ) {
		$out .= "\n## {$label}\n\n" . table( $grouped[ $key ], $max );
	}
}
if ( $include_all ) {
	$out .= "\n## Pre-existing (lines the change did not touch)\n\n";
	$out .= count( $pre_existing ) > 0 ? table( $pre_existing, $max ) : "None.\n";
}
fwrite( STDOUT, $out );
exit( 0 );
