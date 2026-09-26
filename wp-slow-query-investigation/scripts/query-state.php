<?php
/**
 * Read-only helper for `wp eval-file`. Prints what shapes a WordPress site's database queries: versions, the database
 * server, table prefix and collation, debug constants, the db.php and object-cache.php drop-ins, whether a persistent
 * object cache is in use, the WordPress 7.1.2 core indexes that are missing or extra on this site, the autoloaded
 * options total, WooCommerce lookup table settings, and every callback hooked into the filters that rewrite queries,
 * with the plugin, theme or file that added it.
 *
 * It only reads: SHOW INDEX statements, get_option(), wp_load_alloptions() and PHP reflection. It calls no update,
 * delete, save or schedule function and prints no row contents. Loading WordPress runs the site's own code, as any
 * request does.
 *
 * Usage (from the WordPress root, or with --path=...):
 *   wp eval-file query-state.php
 *   wp eval-file query-state.php --url=example.com/shop     # one site of a multisite
 *
 * WP-CLI loads WordPress without a front-end request, so callbacks that plugins add only on front-end, Ajax or REST
 * requests are missing from the hook list: treat it as a lower bound and confirm with Query Monitor.
 *
 * Sources: references/wordpress-schema.md (core indexes), references/query-patterns.md (query filters),
 * references/woocommerce-lookup-tables.md (WooCommerce options).
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

$sqi_line = static function ( $label, $value ) {
	if ( is_bool( $value ) ) {
		$value = $value ? 'yes' : 'no';
	} elseif ( null === $value || '' === $value || false === $value ) {
		$value = '(not set)';
	} elseif ( ! is_scalar( $value ) ) {
		$value = wp_json_encode( $value );
	}
	printf( "%-52s %s\n", $label . ':', $value );
};

$sqi_section = static function ( $title ) {
	printf( "\n== %s ==\n", $title );
};

// Name the plugin, theme or core file that a path belongs to.
$sqi_component = static function ( $file ) {
	if ( ! $file ) {
		return 'unknown';
	}
	$file = wp_normalize_path( $file );
	$map  = array(
		'mu-plugin' => defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : '',
		'plugin'    => defined( 'WP_PLUGIN_DIR' ) ? WP_PLUGIN_DIR : '',
		'theme'     => get_theme_root(),
	);
	foreach ( $map as $type => $dir ) {
		$dir = trailingslashit( wp_normalize_path( (string) $dir ) );
		if ( '/' !== $dir && 0 === strpos( $file, $dir ) ) {
			return $type . ' ' . strtok( substr( $file, strlen( $dir ) ), '/' );
		}
	}
	$abspath = trailingslashit( wp_normalize_path( ABSPATH ) );
	if ( 0 === strpos( $file, $abspath . 'wp-includes/' ) || 0 === strpos( $file, $abspath . 'wp-admin/' ) ) {
		return 'wordpress';
	}
	$content = trailingslashit( wp_normalize_path( WP_CONTENT_DIR ) );
	if ( 0 === strpos( $file, $content ) ) {
		return 'wp-content ' . substr( $file, strlen( $content ) );
	}
	return 'other';
};

// Describe one callback: its name, and the file and line that define it.
$sqi_callback = static function ( $callback ) {
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

$sqi_relative = static function ( $file ) {
	$file = wp_normalize_path( (string) $file );
	$root = trailingslashit( wp_normalize_path( ABSPATH ) );
	return 0 === strpos( $file, $root ) ? substr( $file, strlen( $root ) ) : $file;
};

global $wpdb, $wp_filter;

// Versions and server.
$sqi_section( 'Versions and database server' );
$sqi_server = (string) $wpdb->db_server_info();
$sqi_line( 'WordPress', get_bloginfo( 'version' ) );
$sqi_line( 'Database schema version (db_version option)', get_option( 'db_version' ) );
$sqi_line( 'PHP (the WP-CLI process; the web server may differ)', PHP_VERSION );
$sqi_line( 'Database server', $sqi_server );
$sqi_line( 'Server type', false !== stripos( $sqi_server, 'mariadb' ) ? 'MariaDB' : 'MySQL (or compatible)' );
$sqi_line( 'Multisite', is_multisite() );
$sqi_line( 'Table prefix (this site / base)', $wpdb->prefix . ' / ' . $wpdb->base_prefix );
$sqi_line( 'Connection charset / collation', $wpdb->charset . ' / ' . $wpdb->collate );

// Constants.
$sqi_section( 'Debug and cache constants' );
foreach ( array( 'SAVEQUERIES', 'WP_DEBUG', 'QM_DB_EXPENSIVE', 'QM_DISABLED', 'QM_DB_SYMLINK', 'WP_CACHE', 'DISALLOW_FILE_MODS' ) as $sqi_constant ) {
	$sqi_line( $sqi_constant, defined( $sqi_constant ) ? var_export( constant( $sqi_constant ), true ) : '(not defined)' );
}

// Drop-ins and object cache.
$sqi_section( 'Drop-ins and object cache' );
foreach ( array( 'db.php', 'object-cache.php' ) as $sqi_dropin ) {
	$sqi_path = WP_CONTENT_DIR . '/' . $sqi_dropin;
	if ( file_exists( $sqi_path ) ) {
		$sqi_header = get_file_data( $sqi_path, array( 'name' => 'Plugin Name' ) );
		$sqi_kind   = is_link( $sqi_path ) ? 'symlink' : 'file';
		$sqi_line( 'wp-content/' . $sqi_dropin, ( '' !== $sqi_header['name'] ? $sqi_header['name'] : 'no Plugin Name header' ) . ' (' . $sqi_kind . ')' );
	} else {
		$sqi_line( 'wp-content/' . $sqi_dropin, 'none' );
	}
}
$sqi_line( 'Persistent object cache in use', wp_using_ext_object_cache() );
$sqi_line( 'Object cache class', isset( $GLOBALS['wp_object_cache'] ) && is_object( $GLOBALS['wp_object_cache'] ) ? get_class( $GLOBALS['wp_object_cache'] ) : null );
$sqi_line( 'Query Monitor active', class_exists( 'QueryMonitor' ) || defined( 'QM_VERSION' ) );

// Autoloaded options.
$sqi_section( 'Autoloaded options (the query every uncached request runs)' );
$sqi_alloptions = wp_load_alloptions();
$sqi_line( 'Autoloaded options: rows / serialized bytes', count( $sqi_alloptions ) . ' / ' . strlen( serialize( $sqi_alloptions ) ) );
$sqi_line( 'Site Health thresholds', '800000 bytes critical; object cache suggested from 500 rows or 100000 bytes' );

// Core indexes: compare SHOW INDEX with the WordPress 7.1.2 schema (references/wordpress-schema.md).
$sqi_section( 'WordPress 7.1.2 core indexes on this site (SHOW INDEX, read-only)' );
$sqi_expected = array(
	$wpdb->posts              => array( 'PRIMARY', 'post_name', 'type_status_date', 'post_parent', 'post_author', 'type_status_author' ),
	$wpdb->postmeta           => array( 'PRIMARY', 'post_id', 'meta_key' ),
	$wpdb->options            => array( 'PRIMARY', 'option_name', 'autoload' ),
	$wpdb->terms              => array( 'PRIMARY', 'slug', 'name' ),
	$wpdb->term_taxonomy      => array( 'PRIMARY', 'term_id_taxonomy', 'taxonomy' ),
	$wpdb->term_relationships => array( 'PRIMARY', 'term_taxonomy_id' ),
	$wpdb->termmeta           => array( 'PRIMARY', 'term_id', 'meta_key' ),
	$wpdb->comments           => array( 'PRIMARY', 'comment_post_ID', 'comment_approved_date_gmt', 'comment_date_gmt', 'comment_parent', 'comment_author_email' ),
	$wpdb->commentmeta        => array( 'PRIMARY', 'comment_id', 'meta_key' ),
	$wpdb->users              => array( 'PRIMARY', 'user_login_key', 'user_nicename', 'user_email' ),
	$wpdb->usermeta           => array( 'PRIMARY', 'user_id', 'meta_key' ),
);
foreach ( $sqi_expected as $sqi_table => $sqi_names ) {
	if ( ! preg_match( '/^[A-Za-z0-9_]+$/', (string) $sqi_table ) ) {
		$sqi_line( (string) $sqi_table, 'skipped (unexpected table name)' );
		continue;
	}
	$sqi_suppress = $wpdb->suppress_errors( true );
	$sqi_rows     = $wpdb->get_results( "SHOW INDEX FROM `{$sqi_table}`", ARRAY_A );
	$wpdb->suppress_errors( $sqi_suppress );
	if ( ! $sqi_rows ) {
		$sqi_line( $sqi_table, 'could not read indexes' );
		continue;
	}
	$sqi_found = array();
	foreach ( $sqi_rows as $sqi_row ) {
		$sqi_found[ $sqi_row['Key_name'] ] = true;
	}
	$sqi_missing = array_diff( $sqi_names, array_keys( $sqi_found ) );
	$sqi_extra   = array_diff( array_keys( $sqi_found ), $sqi_names );
	$sqi_line(
		$sqi_table,
		( $sqi_missing ? 'MISSING ' . implode( ', ', $sqi_missing ) : 'all core indexes present' )
		. ( $sqi_extra ? '; extra: ' . implode( ', ', $sqi_extra ) : '' )
	);
}

// WooCommerce.
$sqi_section( 'WooCommerce (lookup tables and order storage)' );
if ( function_exists( 'WC' ) ) {
	$sqi_line( 'WooCommerce', WC()->version );
	$sqi_order_util = 'Automattic\\WooCommerce\\Utilities\\OrderUtil';
	$sqi_line( 'HPOS authoritative', class_exists( $sqi_order_util ) && call_user_func( array( $sqi_order_util, 'custom_orders_table_usage_is_enabled' ) ) );
	foreach ( array( 'woocommerce_attribute_lookup_enabled', 'woocommerce_attribute_lookup_direct_updates', 'woocommerce_attribute_lookup_optimized_updates' ) as $sqi_option ) {
		$sqi_line( $sqi_option, get_option( $sqi_option, null ) );
	}
} else {
	echo "WooCommerce is not active on this site.\n";
}

// Callbacks on the filters that change query SQL (references/query-patterns.md).
$sqi_hooks = array(
	'All queries (wpdb)'   => array( 'query', 'log_query_custom_data' ),
	'Post queries'         => array( 'pre_get_posts', 'posts_pre_query', 'posts_search', 'posts_where', 'posts_join', 'posts_groupby', 'posts_orderby', 'posts_distinct', 'posts_fields', 'posts_limits', 'posts_clauses', 'posts_where_request', 'posts_join_request', 'posts_orderby_request', 'posts_clauses_request', 'posts_request', 'posts_request_ids', 'split_the_query', 'found_posts_query', 'post_search_columns', 'get_meta_sql' ),
	'Other query classes'  => array( 'pre_user_query', 'users_pre_query', 'terms_clauses', 'comments_clauses', 'postmeta_form_keys' ),
);
$sqi_section( 'Callbacks on query filters (WordPress core counted, others listed)' );
foreach ( $sqi_hooks as $sqi_group => $sqi_names ) {
	printf( "\n-- %s\n", $sqi_group );
	foreach ( $sqi_names as $sqi_hook ) {
		if ( empty( $wp_filter[ $sqi_hook ] ) || ! $wp_filter[ $sqi_hook ] instanceof WP_Hook ) {
			continue;
		}
		$sqi_core   = 0;
		$sqi_others = array();
		foreach ( $wp_filter[ $sqi_hook ]->callbacks as $sqi_priority => $sqi_items ) {
			foreach ( $sqi_items as $sqi_item ) {
				list( $sqi_label, $sqi_file, $sqi_start ) = $sqi_callback( $sqi_item['function'] );
				$sqi_owner = $sqi_component( $sqi_file );
				if ( 'wordpress' === $sqi_owner && 0 !== strpos( $sqi_label, '__return_' ) ) {
					++$sqi_core;
					continue;
				}
				$sqi_where    = '' !== $sqi_file ? $sqi_relative( $sqi_file ) . ':' . $sqi_start : 'file unknown';
				$sqi_others[] = sprintf( '  %5d  %-32s %s (%s)', $sqi_priority, $sqi_owner, $sqi_label, $sqi_where );
			}
		}
		printf( "%s: %d core callback(s), %d other(s)\n", $sqi_hook, $sqi_core, count( $sqi_others ) );
		foreach ( $sqi_others as $sqi_other ) {
			echo $sqi_other, "\n";
		}
	}
}
echo "(Hooks with no callbacks are not listed.)\n";

echo "\nDone. Nothing was changed.\n";
