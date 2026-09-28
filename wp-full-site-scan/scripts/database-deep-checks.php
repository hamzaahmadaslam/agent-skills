<?php
/**
 * Read-only helper for the wp-full-site-scan skill. Decodes the serialized values that SQL alone cannot read well,
 * from the throwaway copy of a WordPress database:
 *   - active plugins, with duplicates flagged (WordPress never writes a duplicate)
 *   - every cron hook, with its event count and next run, and hook names that look random flagged
 *   - every role with its capability count, flagging roles other than administrator that hold admin-level
 *     capabilities, and a subscriber role that can do more than read
 *   - stored login sessions per user, flagging sessions with no user agent or a bot or script user agent, and
 *     identical session sets shared by different users (signs of a forged login)
 *   - bulk spam registrations: scam-worded display names and registrations per month
 *
 * It only reads. It runs SELECT statements in a read-only session (SET SESSION TRANSACTION READ ONLY), changes no
 * rows or settings, and makes no network requests other than the database connection you configure. Serialized
 * values are decoded with allowed_classes set to false, so no class code runs. It prints plugin paths, hook names,
 * role names, user logins, session IPs and user agents: keep the output with the case evidence.
 *
 * Connection settings come from environment variables (defaults suit the throwaway server in the skill):
 *   DB_HOST (127.0.0.1)  DB_PORT (3307)  DB_USER (root)  DB_PASS (empty)  DB_NAME (scan)  TABLE_PREFIX (wp_)
 *
 * Usage (PHP 7.4 or later with the mysqli extension, from the command line):
 *   php database-deep-checks.php
 *   TABLE_PREFIX=ab3_ DB_NAME=scan php database-deep-checks.php
 *
 * Exit codes: 0 nothing flagged, 1 something flagged (read the lines marked <<<), 2 bad settings or no connection.
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 2 );
}

function dc_env( $name, $default ) {
	$value = getenv( $name );
	return ( false === $value || '' === $value ) ? $default : $value;
}

function dc_fail( $message ) {
	fwrite( STDERR, 'database-deep-checks: ' . $message . "\n" );
	exit( 2 );
}

$dc_host   = dc_env( 'DB_HOST', '127.0.0.1' );
$dc_port   = (int) dc_env( 'DB_PORT', '3307' );
$dc_user   = dc_env( 'DB_USER', 'root' );
$dc_pass   = getenv( 'DB_PASS' ) === false ? '' : (string) getenv( 'DB_PASS' );
$dc_name   = dc_env( 'DB_NAME', 'scan' );
$dc_prefix = dc_env( 'TABLE_PREFIX', 'wp_' );

if ( ! preg_match( '/^[A-Za-z0-9_]+$/', $dc_prefix ) ) {
	dc_fail( 'TABLE_PREFIX may hold only letters, digits and underscores.' );
}
if ( $dc_port < 1 || $dc_port > 65535 ) {
	dc_fail( 'DB_PORT must be a port number.' );
}
if ( ! extension_loaded( 'mysqli' ) ) {
	dc_fail( 'the mysqli extension is not loaded (enable it in php.ini).' );
}

mysqli_report( MYSQLI_REPORT_OFF );
$dc_db = @new mysqli( $dc_host, $dc_user, $dc_pass, $dc_name, $dc_port );
if ( $dc_db->connect_errno ) {
	dc_fail( 'cannot connect to ' . $dc_user . '@' . $dc_host . ':' . $dc_port . '/' . $dc_name . ': ' . $dc_db->connect_error );
}
$dc_db->set_charset( 'utf8mb4' );
$dc_read_only = (bool) $dc_db->query( 'SET SESSION TRANSACTION READ ONLY' );

$dc_flags = 0;

function dc_rows( $db, $sql ) {
	$result = $db->query( $sql );
	if ( ! $result ) {
		echo '  (query failed: ' . $db->error . ")\n";
		return array();
	}
	$rows = $result->fetch_all( MYSQLI_ASSOC );
	$result->free();
	return $rows;
}

function dc_option( $db, $prefix, $name ) {
	$stmt = $db->prepare( 'SELECT option_value FROM `' . $prefix . 'options` WHERE option_name = ? LIMIT 1' );
	if ( ! $stmt ) {
		return null;
	}
	$stmt->bind_param( 's', $name );
	$stmt->execute();
	$value = null;
	$stmt->bind_result( $value );
	$found = $stmt->fetch();
	$stmt->close();
	return $found ? $value : null;
}

function dc_decode( $value ) {
	if ( ! is_string( $value ) || '' === $value ) {
		return null;
	}
	$data = @unserialize( trim( $value ), array( 'allowed_classes' => false ) );
	return ( false === $data && 'b:0;' !== trim( $value ) ) ? null : $data;
}

function dc_section( $title ) {
	echo "\n== " . $title . " ==\n";
}

echo 'Database: ' . $dc_user . '@' . $dc_host . ':' . $dc_port . '/' . $dc_name . '   table prefix: ' . $dc_prefix . "\n";
echo 'Read-only session: ' . ( $dc_read_only ? 'yes' : 'no (the server refused SET SESSION TRANSACTION READ ONLY; this script still runs only SELECT)' ) . "\n";

if ( ! $dc_db->query( 'SELECT 1 FROM `' . $dc_prefix . 'options` LIMIT 1' ) ) {
	dc_fail( 'no ' . $dc_prefix . 'options table in ' . $dc_name . '. Check TABLE_PREFIX (letter case matters on Linux) and DB_NAME.' );
}

// Active plugins.
dc_section( 'Active plugins (compare with the folders on disk)' );
$dc_active = dc_decode( dc_option( $dc_db, $dc_prefix, 'active_plugins' ) );
if ( ! is_array( $dc_active ) ) {
	echo "  (active_plugins missing or not decodable)\n";
} else {
	$dc_seen = array();
	foreach ( $dc_active as $dc_plugin ) {
		$dc_plugin = is_scalar( $dc_plugin ) ? (string) $dc_plugin : '(not a string)';
		$dc_dup    = isset( $dc_seen[ $dc_plugin ] );
		$dc_seen[ $dc_plugin ] = true;
		echo '  ' . $dc_plugin . ( $dc_dup ? '   <<< DUPLICATE (the option was edited outside WordPress)' : '' ) . "\n";
		if ( $dc_dup ) {
			$dc_flags++;
		}
	}
	echo '  total: ' . count( $dc_active ) . "\n";
}

// Cron hooks.
dc_section( 'Cron hooks (search the code for each name; a hook nothing registers is orphaned or malicious)' );
$dc_cron = dc_decode( dc_option( $dc_db, $dc_prefix, 'cron' ) );
if ( ! is_array( $dc_cron ) ) {
	echo "  (cron missing or not decodable)\n";
} else {
	$dc_hooks = array();
	foreach ( $dc_cron as $dc_time => $dc_events ) {
		if ( ! is_array( $dc_events ) ) {
			continue;
		}
		foreach ( $dc_events as $dc_hook => $dc_instances ) {
			$dc_hook = (string) $dc_hook;
			if ( ! isset( $dc_hooks[ $dc_hook ] ) ) {
				$dc_hooks[ $dc_hook ] = array( 'events' => 0, 'next' => (int) $dc_time );
			}
			$dc_hooks[ $dc_hook ]['events'] += is_array( $dc_instances ) ? count( $dc_instances ) : 1;
			$dc_hooks[ $dc_hook ]['next']    = min( $dc_hooks[ $dc_hook ]['next'], (int) $dc_time );
		}
	}
	ksort( $dc_hooks );
	foreach ( $dc_hooks as $dc_hook => $dc_info ) {
		// Real hooks are named after their plugin, with words and underscores. A long run of letters and digits
		// with no separator looks generated.
		$dc_random = (bool) preg_match( '/^[a-z0-9]{12,}$/i', $dc_hook ) && preg_match( '/[0-9]/', $dc_hook ) && preg_match( '/[a-z]/i', $dc_hook );
		printf(
			"  %-50s events %-3d next %s%s\n",
			$dc_hook,
			$dc_info['events'],
			gmdate( 'Y-m-d H:i', $dc_info['next'] ),
			$dc_random ? '   <<< RANDOM-LOOKING NAME' : ''
		);
		if ( $dc_random ) {
			$dc_flags++;
		}
	}
	echo '  hooks: ' . count( $dc_hooks ) . "\n";
}

// Roles and capabilities.
dc_section( 'Roles and capabilities' );
$dc_admin_caps = array( 'manage_options', 'activate_plugins', 'install_plugins', 'edit_plugins', 'edit_themes', 'edit_files', 'edit_users', 'create_users', 'promote_users', 'delete_users', 'unfiltered_upload', 'update_core' );
$dc_roles      = dc_decode( dc_option( $dc_db, $dc_prefix, $dc_prefix . 'user_roles' ) );
if ( ! is_array( $dc_roles ) ) {
	echo '  (' . $dc_prefix . "user_roles missing or not decodable)\n";
} else {
	foreach ( $dc_roles as $dc_role => $dc_def ) {
		$dc_caps    = ( is_array( $dc_def ) && isset( $dc_def['capabilities'] ) && is_array( $dc_def['capabilities'] ) ) ? $dc_def['capabilities'] : array();
		$dc_granted = array_keys( array_filter( $dc_caps ) );
		$dc_risky   = array_values( array_intersect( $dc_granted, $dc_admin_caps ) );
		$dc_note    = '';
		if ( 'administrator' !== $dc_role && $dc_risky ) {
			$dc_note = '   <<< ADMIN-LEVEL: ' . implode( ', ', $dc_risky );
		} elseif ( 'subscriber' === $dc_role && array_diff( $dc_granted, array( 'read', 'level_0' ) ) ) {
			$dc_note = '   <<< SUBSCRIBER CAN DO MORE THAN READ: ' . implode( ', ', array_diff( $dc_granted, array( 'read', 'level_0' ) ) );
		}
		printf( "  %-30s %3d capabilities%s\n", (string) $dc_role, count( $dc_granted ), $dc_note );
		if ( '' !== $dc_note ) {
			$dc_flags++;
		}
	}
}

// Sessions.
dc_section( 'Stored login sessions (forged-login check)' );
$dc_bot     = '/bot|crawler|spider|uptimerobot|facebookexternalhit|curl|wget|python|go-http|java[/]|libwww|WordPress/i';
$dc_sets    = array();
$dc_session_rows = dc_rows(
	$dc_db,
	'SELECT u.ID, u.user_login, m.meta_value AS v FROM `' . $dc_prefix . 'usermeta` m JOIN `' . $dc_prefix . "users` u ON u.ID = m.user_id WHERE m.meta_key = 'session_tokens' ORDER BY u.ID"
);
if ( ! $dc_session_rows ) {
	echo "  (no stored sessions)\n";
}
foreach ( $dc_session_rows as $dc_row ) {
	$dc_tokens = dc_decode( $dc_row['v'] );
	if ( ! is_array( $dc_tokens ) ) {
		echo '  ' . $dc_row['user_login'] . ": session data not decodable   <<< READ IT\n";
		$dc_flags++;
		continue;
	}
	echo '  ' . $dc_row['user_login'] . ' (ID ' . $dc_row['ID'] . '): ' . count( $dc_tokens ) . " sessions\n";
	$dc_keys = array_keys( $dc_tokens );
	sort( $dc_keys );
	$dc_sets[ md5( implode( ',', $dc_keys ) ) ][] = $dc_row['user_login'];
	foreach ( $dc_tokens as $dc_session ) {
		$dc_session = is_array( $dc_session ) ? $dc_session : array();
		$dc_has_ua  = isset( $dc_session['ua'] ) && '' !== trim( (string) $dc_session['ua'] );
		$dc_ua      = $dc_has_ua ? (string) $dc_session['ua'] : '(NO USER AGENT)';
		$dc_bad     = ! $dc_has_ua || preg_match( $dc_bot, $dc_ua );
		printf(
			"     login %s  expires %s  %-39s %s%s\n",
			gmdate( 'Y-m-d H:i', isset( $dc_session['login'] ) ? (int) $dc_session['login'] : 0 ),
			gmdate( 'Y-m-d H:i', isset( $dc_session['expiration'] ) ? (int) $dc_session['expiration'] : 0 ),
			isset( $dc_session['ip'] ) ? (string) $dc_session['ip'] : '?',
			substr( $dc_ua, 0, 70 ),
			$dc_bad ? '   <<< SUSPICIOUS' : ''
		);
		if ( $dc_bad ) {
			$dc_flags++;
		}
	}
}
foreach ( $dc_sets as $dc_users ) {
	if ( count( $dc_users ) > 1 ) {
		echo '  <<< IDENTICAL SESSION SETS shared by: ' . implode( ', ', $dc_users ) . "\n";
		$dc_flags++;
	}
}

// Bulk spam registrations.
dc_section( 'Bulk spam registrations' );
$dc_spam = dc_rows(
	$dc_db,
	'SELECT COUNT(*) AS n, MIN(user_registered) AS first_seen, MAX(user_registered) AS last_seen FROM `' . $dc_prefix . "users` WHERE display_name REGEXP 'bonus|usd|casino|roulette|claim|crypto|prize|reward|winner|gift'"
);
if ( $dc_spam ) {
	$dc_n = (int) $dc_spam[0]['n'];
	echo '  scam-worded display names: ' . $dc_n . ( $dc_n ? ' (' . $dc_spam[0]['first_seen'] . ' to ' . $dc_spam[0]['last_seen'] . ')   <<< CHECK' : '' ) . "\n";
	if ( $dc_n ) {
		$dc_flags++;
	}
}
$dc_total = dc_rows( $dc_db, 'SELECT COUNT(*) AS n FROM `' . $dc_prefix . 'users`' );
if ( $dc_total ) {
	echo '  users in total: ' . $dc_total[0]['n'] . "\n";
}
echo "  registrations per month (newest first):\n";
foreach ( dc_rows( $dc_db, "SELECT DATE_FORMAT(user_registered, '%Y-%m') AS m, COUNT(*) AS n FROM `" . $dc_prefix . 'users` GROUP BY m ORDER BY m DESC LIMIT 12' ) as $dc_month ) {
	echo '    ' . $dc_month['m'] . ': ' . $dc_month['n'] . "\n";
}

$dc_db->close();
echo "\n" . ( $dc_flags ? $dc_flags . ' line(s) marked <<< to read.' : 'Nothing flagged.' ) . " Nothing was changed.\n";
exit( $dc_flags ? 1 : 0 );
