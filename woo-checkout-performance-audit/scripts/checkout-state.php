<?php
/**
 * Read-only helper for `wp eval-file`. Prints the checkout-related setup of one WooCommerce site for a performance
 * audit: versions, block or classic checkout, page paths, HPOS state, object cache, autoload size, debug and cron
 * constants, settings and features that change checkout time, enabled payment gateways and shipping methods,
 * webhooks by topic, and every callback hooked into the checkout and order hooks with the plugin, theme or file that
 * added it.
 *
 * It only reads. It calls no update, delete, save or schedule function (it deliberately does not create the Site
 * Health object, whose constructor schedules an event). It prints no customer data, no gateway settings or keys, and
 * no webhook delivery URLs. Loading WordPress and the payment gateway classes runs the site's own code, as any admin
 * request does.
 *
 * Usage (from the WordPress root, or with --path=...):
 *   wp eval-file checkout-state.php
 *   wp eval-file checkout-state.php --url=example.com/shop     # one site of a multisite
 *
 * WP-CLI loads WordPress without a front-end request, so callbacks that plugins add only on front-end, Ajax or REST
 * requests are missing from the hook list: treat it as a lower bound and confirm with Query Monitor.
 *
 * Sources for the hooks, options and features: references/*.md (WooCommerce 11.1.2, WordPress 7.1.2).
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

$wcpa_line = static function ( $label, $value ) {
	if ( is_bool( $value ) ) {
		$value = $value ? 'yes' : 'no';
	} elseif ( null === $value || '' === $value || false === $value ) {
		$value = '(not set)';
	} elseif ( ! is_scalar( $value ) ) {
		$value = wp_json_encode( $value );
	}
	printf( "%-52s %s\n", $label . ':', $value );
};

$wcpa_section = static function ( $title ) {
	printf( "\n== %s ==\n", $title );
};

// Name the plugin, theme or core file that a path belongs to.
$wcpa_component = static function ( $file ) {
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
			$rest  = substr( $file, strlen( $dir ) );
			$first = strtok( $rest, '/' );
			if ( 'plugin' === $type && 'woocommerce' === $first ) {
				return 'woocommerce';
			}
			return $type . ' ' . $first;
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
$wcpa_callback = static function ( $callback ) {
	try {
		if ( is_string( $callback ) && false !== strpos( $callback, '::' ) ) {
			$callback = explode( '::', $callback, 2 );
		}
		if ( is_array( $callback ) && 2 === count( $callback ) ) {
			$class  = is_object( $callback[0] ) ? get_class( $callback[0] ) : (string) $callback[0];
			$ref    = new ReflectionMethod( $class, (string) $callback[1] );
			$label  = $class . '::' . $callback[1];
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

$wcpa_relative = static function ( $file ) {
	$file = wp_normalize_path( (string) $file );
	$root = trailingslashit( wp_normalize_path( ABSPATH ) );
	return 0 === strpos( $file, $root ) ? substr( $file, strlen( $root ) ) : $file;
};

if ( ! function_exists( 'WC' ) ) {
	echo "WooCommerce is not active on this site.\n";
	return;
}

// Versions.
$wcpa_section( 'Versions' );
$wcpa_line( 'WordPress', get_bloginfo( 'version' ) );
$wcpa_line( 'WooCommerce', WC()->version );
$wcpa_line( 'PHP (the WP-CLI process; the web server may differ)', PHP_VERSION );
$wcpa_line( 'Action Scheduler (active copy)', class_exists( 'ActionScheduler_Versions' ) ? ActionScheduler_Versions::instance()->latest_version() : null );
$wcpa_line( 'Multisite', is_multisite() );
$wcpa_line( 'Block theme', function_exists( 'wp_is_block_theme' ) && wp_is_block_theme() );
$wcpa_line( 'Theme (template / stylesheet)', get_template() . ' / ' . get_stylesheet() );

// Pages and checkout type.
$wcpa_section( 'Cart, checkout and account pages (exclude these paths from page caches)' );
foreach ( array( 'cart' => 'Cart page', 'checkout' => 'Checkout page', 'myaccount' => 'My account page' ) as $wcpa_page => $wcpa_label ) {
	$wcpa_id = (int) wc_get_page_id( $wcpa_page );
	$wcpa_line( $wcpa_label, $wcpa_id > 0 ? '#' . $wcpa_id . ' ' . wp_make_link_relative( (string) get_permalink( $wcpa_id ) ) : null );
}
$wcpa_checkout_id      = (int) wc_get_page_id( 'checkout' );
$wcpa_checkout_content = $wcpa_checkout_id > 0 ? (string) get_post_field( 'post_content', $wcpa_checkout_id ) : '';
$wcpa_utils            = 'Automattic\\WooCommerce\\Blocks\\Utils\\CartCheckoutUtils';
if ( class_exists( $wcpa_utils ) && method_exists( $wcpa_utils, 'is_checkout_block_default' ) ) {
	$wcpa_line( 'Checkout block (page or block template)', call_user_func( array( $wcpa_utils, 'is_checkout_block_default' ) ) );
} else {
	$wcpa_line( 'Checkout block on the checkout page', $wcpa_checkout_id > 0 && has_block( 'woocommerce/checkout', $wcpa_checkout_id ) );
}
$wcpa_line( '[woocommerce_checkout] shortcode on the checkout page', has_shortcode( $wcpa_checkout_content, 'woocommerce_checkout' ) );
$wcpa_line( 'Classic shortcode block on the checkout page', has_block( 'woocommerce/classic-shortcode', $wcpa_checkout_content ) );

// Cart widget (loads wc-cart-fragments where it renders).
$wcpa_section( 'Classic Cart widget (enqueues wc-cart-fragments where it renders)' );
$wcpa_areas = array();
foreach ( (array) get_option( 'sidebars_widgets', array() ) as $wcpa_area => $wcpa_widgets ) {
	if ( 'wp_inactive_widgets' === $wcpa_area || ! is_array( $wcpa_widgets ) ) {
		continue;
	}
	foreach ( $wcpa_widgets as $wcpa_widget ) {
		if ( is_string( $wcpa_widget ) && 0 === strpos( $wcpa_widget, 'woocommerce_widget_cart-' ) ) {
			$wcpa_areas[] = $wcpa_area;
		}
	}
}
$wcpa_line( 'Cart widget in widget areas', $wcpa_areas ? implode( ', ', array_unique( $wcpa_areas ) ) : 'none' );
$wcpa_line( 'Storefront (renders the Cart widget in its header)', 'storefront' === get_template() );

// Order storage.
$wcpa_section( 'Order storage' );
$wcpa_order_util = 'Automattic\\WooCommerce\\Utilities\\OrderUtil';
$wcpa_line( 'HPOS authoritative', class_exists( $wcpa_order_util ) && call_user_func( array( $wcpa_order_util, 'custom_orders_table_usage_is_enabled' ) ) );
$wcpa_line( 'Compatibility mode (sync to posts)', get_option( 'woocommerce_custom_orders_table_data_sync_enabled' ) );

// Object cache and autoload.
$wcpa_section( 'Object cache and autoloaded options' );
$wcpa_line( 'Persistent object cache in use', wp_using_ext_object_cache() );
$wcpa_dropin = WP_CONTENT_DIR . '/object-cache.php';
if ( file_exists( $wcpa_dropin ) ) {
	$wcpa_header = get_file_data( $wcpa_dropin, array( 'name' => 'Plugin Name' ) );
	$wcpa_line( 'object-cache.php drop-in', '' !== $wcpa_header['name'] ? $wcpa_header['name'] : 'present, no Plugin Name header' );
} else {
	$wcpa_line( 'object-cache.php drop-in', 'none' );
}
$wcpa_alloptions = wp_load_alloptions();
$wcpa_line( 'Autoloaded options: rows / serialized bytes', count( $wcpa_alloptions ) . ' / ' . strlen( serialize( $wcpa_alloptions ) ) );
$wcpa_line( 'Site Health object cache thresholds', '500 rows or 100000 bytes (see references/caching-and-transients.md)' );

// Constants.
$wcpa_section( 'Debug and cron constants' );
foreach ( array( 'WP_DEBUG', 'WP_DEBUG_LOG', 'SAVEQUERIES', 'DISABLE_WP_CRON', 'ALTERNATE_WP_CRON', 'WC_LOG_THRESHOLD' ) as $wcpa_constant ) {
	$wcpa_line( $wcpa_constant, defined( $wcpa_constant ) ? var_export( constant( $wcpa_constant ), true ) : '(not defined)' );
}

// Settings.
$wcpa_section( 'Settings that change checkout time' );
$wcpa_options = array(
	'woocommerce_manage_stock',
	'woocommerce_hold_stock_minutes',
	'woocommerce_shipping_debug_mode',
	'woocommerce_enable_ajax_add_to_cart',
	'woocommerce_logs_level_threshold',
	'woocommerce_logs_default_handler',
	'woocommerce_analytics_scheduled_import',
	'woocommerce_analytics_immediate_import',
);
foreach ( $wcpa_options as $wcpa_option ) {
	$wcpa_line( $wcpa_option, get_option( $wcpa_option, null ) );
}
$wcpa_scheduler = 'Automattic\\WooCommerce\\Internal\\Admin\\Schedulers\\OrdersScheduler';
// Public since WooCommerce 11.0; private in 10.5 to 10.9, where calling it would be a fatal error.
if ( is_callable( array( $wcpa_scheduler, 'is_scheduled_import_enabled' ) ) ) {
	$wcpa_line( 'Analytics updates', call_user_func( array( $wcpa_scheduler, 'is_scheduled_import_enabled' ) ) ? 'Scheduled' : 'Immediately' );
} elseif ( class_exists( $wcpa_scheduler ) && method_exists( $wcpa_scheduler, 'is_scheduled_import_enabled' ) ) {
	$wcpa_line( 'Analytics updates', 'not readable before WooCommerce 11.0; see the two analytics options above' );
}

// Features.
$wcpa_section( 'WooCommerce features' );
$wcpa_features_util = 'Automattic\\WooCommerce\\Utilities\\FeaturesUtil';
if ( class_exists( $wcpa_features_util ) && method_exists( $wcpa_features_util, 'get_features' ) ) {
	$wcpa_features = call_user_func( array( $wcpa_features_util, 'get_features' ), true, true );
	foreach ( array( 'custom_order_tables', 'hpos_datastore_caching', 'order_attribution', 'deferred_transactional_emails', 'destroy-empty-sessions', 'rate_limit_checkout' ) as $wcpa_feature ) {
		if ( isset( $wcpa_features[ $wcpa_feature ] ) ) {
			$wcpa_line( $wcpa_feature, ! empty( $wcpa_features[ $wcpa_feature ]['is_enabled'] ) ? 'enabled' : 'disabled' );
		} else {
			$wcpa_line( $wcpa_feature, 'not in this version' );
		}
	}
} else {
	echo "(FeaturesUtil not available in this WooCommerce version)\n";
}

// Payment gateways: IDs and enabled state only, never their settings.
$wcpa_section( 'Payment gateways (enabled)' );
$wcpa_gateways = WC()->payment_gateways() ? WC()->payment_gateways()->payment_gateways() : array();
$wcpa_enabled  = 0;
foreach ( (array) $wcpa_gateways as $wcpa_gateway ) {
	if ( is_object( $wcpa_gateway ) && isset( $wcpa_gateway->enabled ) && 'yes' === $wcpa_gateway->enabled ) {
		$wcpa_class = get_class( $wcpa_gateway );
		try {
			$wcpa_file = ( new ReflectionClass( $wcpa_class ) )->getFileName();
		} catch ( Throwable $e ) {
			$wcpa_file = '';
		}
		$wcpa_line( (string) $wcpa_gateway->id, $wcpa_class . ' (' . $wcpa_component( $wcpa_file ) . ')' );
		++$wcpa_enabled;
	}
}
if ( 0 === $wcpa_enabled ) {
	echo "(none enabled)\n";
}

// Shipping methods per zone.
$wcpa_section( 'Shipping methods per zone (non-core methods may call a carrier API)' );
if ( class_exists( 'WC_Shipping_Zones' ) ) {
	$wcpa_core_methods = array( 'flat_rate', 'free_shipping', 'local_pickup', 'pickup_location' );
	$wcpa_zones        = WC_Shipping_Zones::get_zones();
	$wcpa_zones[]      = array(
		'zone_name'        => 'Rest of the world',
		'shipping_methods' => WC_Shipping_Zones::get_zone( 0 ) ? WC_Shipping_Zones::get_zone( 0 )->get_shipping_methods() : array(),
	);
	foreach ( $wcpa_zones as $wcpa_zone ) {
		$wcpa_methods = array();
		foreach ( (array) $wcpa_zone['shipping_methods'] as $wcpa_method ) {
			if ( ! is_object( $wcpa_method ) || ( isset( $wcpa_method->enabled ) && 'yes' !== $wcpa_method->enabled ) ) {
				continue;
			}
			$wcpa_methods[] = $wcpa_method->id . ( in_array( $wcpa_method->id, $wcpa_core_methods, true ) ? '' : ' (non-core)' );
		}
		$wcpa_line( (string) $wcpa_zone['zone_name'], $wcpa_methods ? implode( ', ', $wcpa_methods ) : 'none enabled' );
	}
}

// Webhooks: counts by status and topic, never the delivery URL.
$wcpa_section( 'Webhooks (delivered through Action Scheduler unless a filter says otherwise)' );
if ( class_exists( 'WC_Data_Store' ) ) {
	try {
		$wcpa_store  = WC_Data_Store::load( 'webhook' );
		$wcpa_counts = array();
		foreach ( (array) $wcpa_store->search_webhooks( array( 'limit' => -1 ) ) as $wcpa_webhook_id ) {
			$wcpa_webhook = wc_get_webhook( $wcpa_webhook_id );
			if ( $wcpa_webhook ) {
				$wcpa_key                 = $wcpa_webhook->get_status() . ' ' . $wcpa_webhook->get_topic();
				$wcpa_counts[ $wcpa_key ] = ( $wcpa_counts[ $wcpa_key ] ?? 0 ) + 1;
			}
		}
		if ( ! $wcpa_counts ) {
			echo "(none)\n";
		}
		foreach ( $wcpa_counts as $wcpa_key => $wcpa_count ) {
			$wcpa_line( $wcpa_key, $wcpa_count );
		}
	} catch ( Throwable $e ) {
		echo "(could not read webhooks)\n";
	}
}

// Callbacks on checkout, order and cache hooks.
$wcpa_hooks = array(
	'Totals updates'                  => array( 'woocommerce_checkout_update_order_review', 'woocommerce_before_calculate_totals', 'woocommerce_after_calculate_totals', 'woocommerce_cart_calculate_fees', 'woocommerce_before_get_rates_for_package', 'woocommerce_after_get_rates_for_package', 'woocommerce_package_rates', 'woocommerce_available_payment_gateways', 'woocommerce_update_order_review_fragments' ),
	'Classic place order'             => array( 'woocommerce_before_checkout_process', 'woocommerce_checkout_process', 'woocommerce_after_checkout_validation', 'woocommerce_checkout_create_order', 'woocommerce_checkout_update_order_meta', 'woocommerce_checkout_order_created', 'woocommerce_checkout_order_processed' ),
	'Block place order (Store API)'   => array( 'woocommerce_store_api_checkout_update_customer_from_request', 'woocommerce_store_api_checkout_order_created', 'woocommerce_store_api_checkout_update_order_meta', 'woocommerce_store_api_checkout_update_order_from_request', 'woocommerce_store_api_checkout_order_processed', 'woocommerce_rest_checkout_process_payment_with_context' ),
	'Every order save'                => array( 'woocommerce_before_order_object_save', 'woocommerce_after_order_object_save', 'woocommerce_new_order', 'woocommerce_update_order' ),
	'Status change, payment, thank-you' => array( 'woocommerce_payment_complete', 'woocommerce_order_status_changed', 'woocommerce_order_status_pending_to_processing', 'woocommerce_order_status_pending_to_on-hold', 'woocommerce_order_status_processing', 'woocommerce_order_status_completed', 'woocommerce_before_thankyou', 'woocommerce_thankyou' ),
	'Cart fragments'                  => array( 'woocommerce_add_to_cart_fragments' ),
	'Filters that change defaults'    => array( 'wc_session_expiration', 'wc_session_expiring', 'woocommerce_persistent_cart_enabled', 'woocommerce_defer_transactional_emails', 'woocommerce_webhook_deliver_async', 'woocommerce_order_step_logging_enabled', 'woocommerce_store_api_rate_limit_options', 'action_scheduler_retention_period', 'action_scheduler_queue_runner_time_limit', 'action_scheduler_queue_runner_batch_size', 'action_scheduler_queue_runner_concurrent_batches' ),
);

$wcpa_section( 'Callbacks on checkout hooks (WooCommerce and WordPress core counted, others listed)' );
global $wp_filter;
foreach ( $wcpa_hooks as $wcpa_group => $wcpa_names ) {
	printf( "\n-- %s\n", $wcpa_group );
	foreach ( $wcpa_names as $wcpa_hook ) {
		if ( empty( $wp_filter[ $wcpa_hook ] ) || ! $wp_filter[ $wcpa_hook ] instanceof WP_Hook ) {
			printf( "%s: no callbacks\n", $wcpa_hook );
			continue;
		}
		$wcpa_core   = 0;
		$wcpa_others = array();
		foreach ( $wp_filter[ $wcpa_hook ]->callbacks as $wcpa_priority => $wcpa_items ) {
			foreach ( $wcpa_items as $wcpa_item ) {
				list( $wcpa_label, $wcpa_file, $wcpa_start ) = $wcpa_callback( $wcpa_item['function'] );
				$wcpa_owner = $wcpa_component( $wcpa_file );
				// __return_false and friends live in WordPress core but are added by plugins and themes: list them.
				if ( 'wordpress' === $wcpa_owner && 0 === strpos( $wcpa_label, '__return_' ) ) {
					$wcpa_owner = 'core helper, added elsewhere';
				}
				if ( in_array( $wcpa_owner, array( 'woocommerce', 'wordpress' ), true ) ) {
					++$wcpa_core;
					continue;
				}
				$wcpa_where    = '' !== $wcpa_file ? $wcpa_relative( $wcpa_file ) . ':' . $wcpa_start : 'file unknown';
				$wcpa_others[] = sprintf( '  %5d  %-32s %s (%s)', $wcpa_priority, $wcpa_owner, $wcpa_label, $wcpa_where );
			}
		}
		printf( "%s: %d core callback(s), %d other(s)\n", $wcpa_hook, $wcpa_core, count( $wcpa_others ) );
		foreach ( $wcpa_others as $wcpa_other ) {
			echo $wcpa_other, "\n";
		}
	}
}

echo "\nDone. Nothing was changed.\n";
