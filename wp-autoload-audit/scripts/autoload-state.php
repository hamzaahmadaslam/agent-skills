<?php
/**
 * Read-only helper for `wp eval-file`. Prints how one WordPress site decides and loads its autoloaded options: the
 * versions, the autoload values WordPress loads after filters, the per-option threshold and the Site Health limits
 * after filters, every callback on the autoload hooks with the plugin or theme that added it, the object cache in
 * use, the cached alloptions entry compared with the database, and the time and memory the autoload query and the
 * unserializing take in this process. Option names given as arguments get a line each.
 *
 * It only reads. It runs SELECT queries and cache reads (wp_cache_get), calls no add, update, delete, set or flush
 * function, and does not create the Site Health object (its constructor schedules an event). Values are unserialized
 * with allowed_classes set to false, so no plugin class is woken up. It prints option names, sizes and counts, never
 * option values. Loading WordPress runs the site's own code, as any request does.
 *
 * Usage (from the WordPress root, or with --path=...):
 *   wp eval-file autoload-state.php
 *   wp eval-file autoload-state.php option_one option_two      # also report on these options
 *   wp eval-file autoload-state.php --url=example.com/blog      # one site of a multisite
 *
 * Sources for every hook, function and threshold: references/*.md (WordPress 7.1.2).
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

global $wpdb, $wp_filter;

$aa_names = ( isset( $args ) && is_array( $args ) ) ? array_values( array_filter( array_map( 'strval', $args ), 'strlen' ) ) : array();

$aa_line = static function ( $label, $value ) {
	if ( is_bool( $value ) ) {
		$value = $value ? 'yes' : 'no';
	} elseif ( null === $value || '' === $value ) {
		$value = '(not set)';
	} elseif ( is_array( $value ) ) {
		$value = implode( ', ', array_map( 'strval', $value ) );
	}
	printf( "%-58s %s\n", $label . ':', $value );
};

$aa_section = static function ( $title ) {
	printf( "\n== %s ==\n", $title );
};

$aa_bytes = static function ( $bytes ) {
	return number_format( (float) $bytes ) . ' bytes';
};

// Name the plugin, theme, must-use plugin or core file that a path belongs to.
$aa_component = static function ( $file ) {
	if ( ! $file ) {
		return 'unknown';
	}
	$file = wp_normalize_path( $file );
	$map  = array(
		'mu-plugin' => defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : '',
		'plugin'    => defined( 'WP_PLUGIN_DIR' ) ? WP_PLUGIN_DIR : '',
		'theme'     => function_exists( 'get_theme_root' ) ? get_theme_root() : '',
	);
	foreach ( $map as $type => $dir ) {
		$dir = trailingslashit( wp_normalize_path( (string) $dir ) );
		if ( '/' !== $dir && 0 === strpos( $file, $dir ) ) {
			$first = strtok( substr( $file, strlen( $dir ) ), '/' );
			return $type . ' ' . $first;
		}
	}
	$abspath = trailingslashit( wp_normalize_path( ABSPATH ) );
	if ( 0 === strpos( $file, $abspath . 'wp-includes/' ) || 0 === strpos( $file, $abspath . 'wp-admin/' ) ) {
		return 'wordpress core';
	}
	$content = trailingslashit( wp_normalize_path( WP_CONTENT_DIR ) );
	if ( 0 === strpos( $file, $content ) ) {
		return 'wp-content ' . substr( $file, strlen( $content ) );
	}
	return 'other';
};

// Describe one callback: its name, and the file and line that define it.
$aa_callback = static function ( $callback ) {
	try {
		if ( is_string( $callback ) && false !== strpos( $callback, '::' ) ) {
			$callback = explode( '::', $callback, 2 );
		}
		if ( is_array( $callback ) && 2 === count( $callback ) ) {
			$class = is_object( $callback[0] ) ? get_class( $callback[0] ) : (string) $callback[0];
			$ref   = new ReflectionMethod( $class, (string) $callback[1] );
			$label = $class . '::' . $callback[1];
		} elseif ( $callback instanceof Closure || is_string( $callback ) ) {
			$ref   = new ReflectionFunction( $callback );
			$label = $callback instanceof Closure ? 'closure' : $callback;
		} elseif ( is_object( $callback ) && method_exists( $callback, '__invoke' ) ) {
			$ref   = new ReflectionMethod( $callback, '__invoke' );
			$label = get_class( $callback ) . '::__invoke';
		} else {
			return array( 'callable', '', 0 );
		}
		return array( $label, (string) $ref->getFileName(), (int) $ref->getStartLine() );
	} catch ( Throwable $e ) {
		return array( 'unresolved callable', '', 0 );
	}
};

$aa_relative = static function ( $file ) {
	$file = wp_normalize_path( (string) $file );
	$root = trailingslashit( wp_normalize_path( ABSPATH ) );
	return 0 === strpos( $file, $root ) ? substr( $file, strlen( $root ) ) : $file;
};

$aa_sql_list = static function ( array $values ) {
	return "'" . implode( "', '", array_map( 'esc_sql', $values ) ) . "'";
};

// Versions and site.
$aa_section( 'Versions and site' );
$aa_line( 'WordPress', get_bloginfo( 'version' ) );
$aa_db_version = (int) get_option( 'db_version' );
$aa_line( 'Database revision (58975 or later: 6.7 upgrade has run)', $aa_db_version );
$aa_line( 'PHP (this WP-CLI process; the web server may differ)', PHP_VERSION );
$aa_line( 'Multisite', is_multisite() );
$aa_line( 'Site ID', get_current_blog_id() );
$aa_line( 'Options table', $wpdb->options );
$aa_line( 'Environment type', function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : null );
$aa_line( 'Active theme (stylesheet / template)', get_stylesheet() . ' / ' . get_template() );

// Loaded values and thresholds, after filters.
$aa_section( 'Autoload values and thresholds, after filters' );
$aa_default_values = array( 'yes', 'on', 'auto-on', 'auto' );
if ( function_exists( 'wp_autoload_values_to_autoload' ) ) {
	$aa_loaded = array_values( wp_autoload_values_to_autoload() );
	$aa_line( 'Values WordPress loads', $aa_loaded );
	$aa_missing = array_diff( $aa_default_values, $aa_loaded );
	if ( $aa_missing ) {
		$aa_line( 'Removed by a filter', array_values( $aa_missing ) );
	}
	$aa_size_rule = has_filter( 'wp_default_autoload_value', 'wp_filter_default_autoload_value_via_option_size' );
	$aa_line( 'Size rule for new options hooked (priority)', false === $aa_size_rule ? 'no, removed' : (string) $aa_size_rule );
	$aa_line( 'Per-option threshold (wp_max_autoloaded_option_size)', $aa_bytes( (int) apply_filters( 'wp_max_autoloaded_option_size', 150000, '' ) ) );
	$aa_line( 'Site Health limit for the loaded total, after filters', $aa_bytes( (int) apply_filters( 'site_status_autoloaded_options_size_limit', 800000 ) ) );
} else {
	$aa_loaded = array( 'yes' );
	$aa_line( 'Values WordPress loads', 'yes (WordPress before 6.6)' );
}
$aa_threshold_defaults = array(
	'alloptions_count' => 500,
	'alloptions_bytes' => 100000,
	'comments_count'   => 1000,
	'options_count'    => 1000,
	'posts_count'      => 1000,
	'terms_count'      => 1000,
	'users_count'      => 1000,
);
$aa_thresholds         = wp_parse_args( (array) apply_filters( 'site_status_persistent_object_cache_thresholds', $aa_threshold_defaults ), $aa_threshold_defaults );
$aa_line( 'Object cache suggested above (options / bytes)', (int) $aa_thresholds['alloptions_count'] . ' / ' . $aa_bytes( $aa_thresholds['alloptions_bytes'] ) );

// Callbacks on the hooks that change what is autoloaded.
$aa_section( 'Callbacks on the autoload hooks (plugin, theme or core that added them)' );
$aa_hooks = array(
	'wp_default_autoload_value',
	'wp_max_autoloaded_option_size',
	'wp_autoload_values_to_autoload',
	'pre_wp_load_alloptions',
	'pre_cache_alloptions',
	'alloptions',
	'site_status_autoloaded_options_size_limit',
	'site_status_should_suggest_persistent_object_cache',
	'site_status_persistent_object_cache_thresholds',
);
foreach ( $aa_hooks as $aa_hook ) {
	if ( empty( $wp_filter[ $aa_hook ] ) || empty( $wp_filter[ $aa_hook ]->callbacks ) ) {
		printf( "%s: none\n", $aa_hook );
		continue;
	}
	printf( "%s:\n", $aa_hook );
	foreach ( $wp_filter[ $aa_hook ]->callbacks as $aa_priority => $aa_callbacks ) {
		foreach ( $aa_callbacks as $aa_entry ) {
			list( $aa_label, $aa_file, $aa_start ) = $aa_callback( $aa_entry['function'] );
			printf(
				"  %4d  %-50s %-28s %s\n",
				(int) $aa_priority,
				$aa_label,
				$aa_component( $aa_file ),
				$aa_file ? $aa_relative( $aa_file ) . ':' . $aa_start : ''
			);
		}
	}
}

// The object cache in use.
$aa_section( 'Object cache' );
$aa_ext = wp_using_ext_object_cache();
$aa_line( 'Persistent object cache in use', (bool) $aa_ext );
$aa_dropin = WP_CONTENT_DIR . '/object-cache.php';
if ( file_exists( $aa_dropin ) ) {
	$aa_header = get_file_data( $aa_dropin, array( 'name' => 'Plugin Name', 'version' => 'Version' ) );
	$aa_line( 'Drop-in wp-content/object-cache.php', trim( $aa_header['name'] . ' ' . $aa_header['version'] ) ? trim( $aa_header['name'] . ' ' . $aa_header['version'] ) : 'present, no header' );
} else {
	$aa_line( 'Drop-in wp-content/object-cache.php', 'none' );
}
if ( function_exists( 'wp_cache_supports' ) ) {
	$aa_line( 'Drop-in supports flushing one group', wp_cache_supports( 'flush_group' ) );
}

// The database side: rows and bytes per value, and the loaded set.
$aa_section( 'Options table: rows and bytes per autoload value' );
$aa_rows = $wpdb->get_results( "SELECT autoload, COUNT(*) AS options, COALESCE(SUM(LENGTH(option_value)), 0) AS bytes FROM {$wpdb->options} GROUP BY autoload ORDER BY bytes DESC" );
printf( "  %-12s %-7s %10s %16s\n", 'autoload', 'loaded', 'options', 'bytes' );
foreach ( (array) $aa_rows as $aa_row ) {
	printf(
		"  %-12s %-7s %10s %16s\n",
		'' === (string) $aa_row->autoload ? '(empty)' : $aa_row->autoload,
		in_array( $aa_row->autoload, $aa_loaded, true ) ? 'yes' : 'no',
		number_format( (float) $aa_row->options ),
		number_format( (float) $aa_row->bytes )
	);
}

// Load the autoloaded rows the way WordPress does, and time it.
$aa_section( 'Loaded set: size, Site Health status, cost in this process' );
$aa_sql = "SELECT option_name, option_value FROM {$wpdb->options} WHERE autoload IN ( " . $aa_sql_list( $aa_loaded ) . ' )';
$aa_memory_before = memory_get_usage();
$aa_time_start    = microtime( true );
$aa_db_rows       = $wpdb->get_results( $aa_sql );
$aa_time_query    = microtime( true );
$aa_db            = array();
$aa_unserialized  = array();
foreach ( (array) $aa_db_rows as $aa_row ) {
	$aa_db[ $aa_row->option_name ] = $aa_row->option_value;
	if ( is_serialized( $aa_row->option_value ) ) {
		// allowed_classes false: objects become __PHP_Incomplete_Class and no class code runs.
		$aa_unserialized[ $aa_row->option_name ] = @unserialize( trim( $aa_row->option_value ), array( 'allowed_classes' => false ) ); // phpcs:ignore
	}
}
$aa_time_done   = microtime( true );
$aa_memory_used = memory_get_usage() - $aa_memory_before;
unset( $aa_db_rows, $aa_unserialized );

$aa_total = 0;
foreach ( $aa_db as $aa_value ) {
	$aa_total += strlen( (string) $aa_value );
}
$aa_limit = function_exists( 'wp_autoload_values_to_autoload' ) ? (int) apply_filters( 'site_status_autoloaded_options_size_limit', 800000 ) : 800000;
$aa_line( 'Loaded options', number_format( count( $aa_db ) ) );
$aa_line( 'Loaded bytes (sum of value lengths, as Site Health)', $aa_bytes( $aa_total ) );
$aa_line( 'Site Health "Autoloaded options" result', $aa_total < $aa_limit ? 'good (below ' . $aa_bytes( $aa_limit ) . ')' : 'critical (at or above ' . $aa_bytes( $aa_limit ) . ')' );
$aa_serialized_size = strlen( serialize( $aa_db ) );
$aa_line( 'Serialized array size (object cache suggestion input)', $aa_bytes( $aa_serialized_size ) );
$aa_line( 'Suggests an object cache on the autoload counts alone', count( $aa_db ) > (int) $aa_thresholds['alloptions_count'] || $aa_serialized_size > (int) $aa_thresholds['alloptions_bytes'] );
$aa_line( 'Autoload query time in this process', number_format( ( $aa_time_query - $aa_time_start ) * 1000, 1 ) . ' ms' );
$aa_line( 'Unserializing every loaded value', number_format( ( $aa_time_done - $aa_time_query ) * 1000, 1 ) . ' ms' );
$aa_line( 'Memory for rows and unserialized values', number_format( $aa_memory_used / 1024, 1 ) . ' KiB' );
if ( $aa_serialized_size >= 900000 ) {
	echo "Note: the serialized array is near or over 1,000,000 bytes, Memcached's default item size and VIP's limit\n";
	echo "      (references/object-cache.md). The drop-in's own serializer and compression change the stored size.\n";
}

// The cached alloptions entry compared with the database.
$aa_section( 'Cached alloptions compared with the database' );
$aa_cached = wp_cache_get( 'alloptions', 'options', true );
if ( ! $aa_ext ) {
	echo "No persistent object cache: the cache below is the copy this process loaded, so it matches by design.\n";
}
if ( ! is_array( $aa_cached ) ) {
	$aa_line( 'alloptions in the cache', 'missing (the next request runs the autoload query and caches the result)' );
} else {
	$aa_cached_total = 0;
	foreach ( $aa_cached as $aa_value ) {
		$aa_cached_total += strlen( is_scalar( $aa_value ) ? (string) $aa_value : serialize( $aa_value ) );
	}
	$aa_line( 'alloptions in the cache: options / value bytes', number_format( count( $aa_cached ) ) . ' / ' . $aa_bytes( $aa_cached_total ) );
	$aa_line( 'alloptions in the cache: serialized size', $aa_bytes( strlen( serialize( $aa_cached ) ) ) );

	$aa_only_db    = array_diff( array_keys( $aa_db ), array_keys( $aa_cached ) );
	$aa_only_cache = array_diff( array_keys( $aa_cached ), array_keys( $aa_db ) );
	$aa_changed    = array();
	foreach ( array_intersect( array_keys( $aa_db ), array_keys( $aa_cached ) ) as $aa_name ) {
		$aa_cached_value = is_scalar( $aa_cached[ $aa_name ] ) ? (string) $aa_cached[ $aa_name ] : serialize( $aa_cached[ $aa_name ] );
		if ( md5( $aa_cached_value ) !== md5( (string) $aa_db[ $aa_name ] ) ) {
			$aa_changed[] = $aa_name;
		}
	}
	$aa_line( 'Loaded in the database, missing from the cache', count( $aa_only_db ) );
	foreach ( array_slice( $aa_only_db, 0, 25 ) as $aa_name ) {
		echo '  ' . $aa_name . "\n";
	}
	$aa_line( 'In the cache, not loaded in the database', count( $aa_only_cache ) );
	foreach ( array_slice( $aa_only_cache, 0, 25 ) as $aa_name ) {
		echo '  ' . $aa_name . "\n";
	}
	$aa_line( 'Same name, different value (stale, or a filter)', count( $aa_changed ) );
	foreach ( array_slice( $aa_changed, 0, 25 ) as $aa_name ) {
		echo '  ' . $aa_name . "\n";
	}
	if ( $aa_only_db || $aa_only_cache || $aa_changed ) {
		echo "Differences mean the cache holds an older state (changes made with SQL or wp option set-autoload, or\n";
		echo "lost updates), or that pre_cache_alloptions changed the cached copy. See references/object-cache.md.\n";
	}
}
$aa_notoptions = wp_cache_get( 'notoptions', 'options', true );
$aa_line( 'Names cached as missing (notoptions)', is_array( $aa_notoptions ) ? count( $aa_notoptions ) : 'none cached' );

// One line per option named on the command line.
if ( $aa_names ) {
	$aa_section( 'Named options' );
	foreach ( $aa_names as $aa_name ) {
		$aa_row = $wpdb->get_row( $wpdb->prepare( "SELECT autoload, LENGTH(option_value) AS size_bytes FROM {$wpdb->options} WHERE option_name = %s", $aa_name ) );
		if ( ! $aa_row ) {
			$aa_in_notoptions = is_array( $aa_notoptions ) && isset( $aa_notoptions[ $aa_name ] );
			printf( "%s: not in the table%s\n", $aa_name, $aa_in_notoptions ? ' (cached as missing in notoptions)' : '' );
			continue;
		}
		$aa_threshold = function_exists( 'wp_autoload_values_to_autoload' ) ? (int) apply_filters( 'wp_max_autoloaded_option_size', 150000, $aa_name ) : 0;
		$aa_own_key   = wp_cache_get( $aa_name, 'options', true );
		printf(
			"%s: autoload %s, loaded %s, %s, over the per-option threshold %s, in cached alloptions %s, own cache key %s\n",
			$aa_name,
			$aa_row->autoload,
			in_array( $aa_row->autoload, $aa_loaded, true ) ? 'yes' : 'no',
			$aa_bytes( $aa_row->size_bytes ),
			$aa_threshold && (int) $aa_row->size_bytes > $aa_threshold ? 'yes' : 'no',
			is_array( $aa_cached ) && array_key_exists( $aa_name, $aa_cached ) ? 'yes' : 'no',
			false === $aa_own_key ? 'no' : 'yes'
		);
	}
}

echo "\nDone. Nothing was changed.\n";
