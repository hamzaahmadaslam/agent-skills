<?php
/**
 * Read-only helper for `wp eval-file`. Prints one order's tax data as the JSON input of tax-trace.mjs: the tax settings
 * in effect (after filters), the rates recorded on the order's tax lines, and the stored values of every product,
 * shipping and fee line, tax line and refund.
 *
 * It only reads. It calls no save, update, delete, calculate or schedule function. It prints no names, addresses, email
 * addresses, phone numbers, notes, product names or item meta other than the tax and total fields listed below.
 * Loading WordPress runs the site's own code, as any request does.
 *
 * Usage (from the WordPress root, or with --path=...):
 *   wp eval-file export-order.php 1234 > order-1234.json
 *   wp eval-file export-order.php 1234 --url=example.com/shop > order-1234.json   # one site of a multisite
 *
 * Sources for every getter, option and constant: references/*.md (WooCommerce 11.1.2).
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited -- $args is WP-CLI's positional argument list.
$wtr_order_id = isset( $args[0] ) ? absint( $args[0] ) : 0;

if ( ! function_exists( 'wc_get_order' ) ) {
	fwrite( STDERR, "WooCommerce is not active on this site.\n" );
	return;
}

$wtr_order = $wtr_order_id ? wc_get_order( $wtr_order_id ) : false;
if ( ! $wtr_order || 'shop_order' !== $wtr_order->get_type() ) {
	fwrite( STDERR, "Give the ID of an order: wp eval-file export-order.php <order id>\n" );
	return;
}

// Tax data of a line: tax rate IDs as strings, amounts as stored.
$wtr_taxes = static function ( $item ) {
	$taxes = $item->get_taxes();
	$out   = array();
	foreach ( array( 'total', 'subtotal' ) as $key ) {
		if ( isset( $taxes[ $key ] ) && is_array( $taxes[ $key ] ) ) {
			foreach ( $taxes[ $key ] as $rate_id => $amount ) {
				$out[ $key ][ (string) $rate_id ] = (string) $amount;
			}
		}
	}
	return $out;
};

$wtr_mode_names = array(
	1 => 'HALF_UP',
	2 => 'HALF_DOWN',
	3 => 'HALF_EVEN',
	4 => 'HALF_ODD',
);

$wtr_data = array(
	'synthetic' => 'No. Exported from a store: keep this file out of chats, tickets and repositories, and delete it when the report is written.',
	'order_id'  => $wtr_order->get_id(),
	'currency'  => $wtr_order->get_currency(),
	'settings'  => array(
		'woocommerce_prices_include_tax'    => $wtr_order->get_prices_include_tax() ? 'yes' : 'no',
		'prices_include_tax_option_now'     => get_option( 'woocommerce_prices_include_tax', 'no' ),
		'woocommerce_tax_round_at_subtotal' => get_option( 'woocommerce_tax_round_at_subtotal', 'no' ),
		'woocommerce_price_num_decimals'    => wc_get_price_decimals(),
		'woocommerce_price_num_decimals_option' => get_option( 'woocommerce_price_num_decimals', 2 ),
		'rounding_precision'                => wc_get_rounding_precision(),
		'wc_rounding_precision_constant'    => defined( 'WC_ROUNDING_PRECISION' ) ? WC_ROUNDING_PRECISION : null,
		'tax_rounding_mode'                 => $wtr_mode_names[ wc_get_tax_rounding_mode() ] ?? wc_get_tax_rounding_mode(),
		'woocommerce_tax_display_cart'      => get_option( 'woocommerce_tax_display_cart', 'excl' ),
		'woocommerce_tax_display_shop'      => get_option( 'woocommerce_tax_display_shop', 'excl' ),
		'woocommerce_tax_total_display'     => get_option( 'woocommerce_tax_total_display', 'itemized' ),
		'woocommerce_tax_based_on'          => get_option( 'woocommerce_tax_based_on', 'shipping' ),
		'woocommerce_shipping_tax_class'    => get_option( 'woocommerce_shipping_tax_class', 'inherit' ),
		'woocommerce_calc_taxes'            => get_option( 'woocommerce_calc_taxes', 'no' ),
		'is_vat_exempt'                     => $wtr_order->get_meta( 'is_vat_exempt' ),
		'created_via'                       => $wtr_order->get_created_via( 'edit' ),
		'order_version'                     => $wtr_order->get_version( 'edit' ),
		'woocommerce_version_now'           => WC()->version,
	),
	'rates'     => array(),
	'items'     => array(),
	'shipping'  => array(),
	'fees'      => array(),
	'order'     => array(
		'stored' => array(
			'total'          => (string) $wtr_order->get_total( 'edit' ),
			'cart_tax'       => (string) $wtr_order->get_cart_tax( 'edit' ),
			'shipping_tax'   => (string) $wtr_order->get_shipping_tax( 'edit' ),
			'total_tax'      => (string) $wtr_order->get_total_tax( 'edit' ),
			'discount_total' => (string) $wtr_order->get_discount_total( 'edit' ),
			'discount_tax'   => (string) $wtr_order->get_discount_tax( 'edit' ),
			'shipping_total' => (string) $wtr_order->get_shipping_total( 'edit' ),
			'total_refunded' => (string) $wtr_order->get_total_refunded(),
			'payment_method' => $wtr_order->get_payment_method( 'edit' ),
		),
	),
	'tax_lines' => array(),
	'coupons'   => array(),
	'refunds'   => array(),
	'observed'  => new stdClass(),
);

// Rates as recorded on the order's tax lines (rate_percent), falling back to the current rate table.
foreach ( $wtr_order->get_items( 'tax' ) as $wtr_tax ) {
	$wtr_rate_id = (string) $wtr_tax->get_rate_id();
	$wtr_current = WC_Tax::_get_tax_rate( $wtr_tax->get_rate_id() );
	$wtr_percent = $wtr_tax->get_rate_percent();

	$wtr_data['rates'][ $wtr_rate_id ] = array(
		'rate'     => null !== $wtr_percent && '' !== $wtr_percent ? (string) $wtr_percent : ( $wtr_current ? (string) $wtr_current['tax_rate'] : null ),
		'source'   => null !== $wtr_percent && '' !== $wtr_percent ? 'order tax line rate_percent' : 'current tax rate table (may differ from the rate at order time)',
		'rate_now' => $wtr_current ? (string) $wtr_current['tax_rate'] : null,
		'compound' => $wtr_tax->is_compound() ? 'yes' : 'no',
		'priority' => $wtr_current ? (int) $wtr_current['tax_rate_priority'] : 1,
		'shipping' => $wtr_current ? (int) $wtr_current['tax_rate_shipping'] : null,
		'label'    => $wtr_tax->get_label(),
	);
	$wtr_data['tax_lines'][] = array(
		'rate_id'             => $wtr_rate_id,
		'tax_amount'          => (string) $wtr_tax->get_tax_total( 'edit' ),
		'shipping_tax_amount' => (string) $wtr_tax->get_shipping_tax_total( 'edit' ),
	);
}

foreach ( $wtr_order->get_items( 'line_item' ) as $wtr_item ) {
	$wtr_data['items'][] = array(
		'id'        => $wtr_item->get_id(),
		'qty'       => $wtr_item->get_quantity(),
		'tax_class' => $wtr_item->get_tax_class(),
		'stored'    => array(
			'subtotal'     => (string) $wtr_item->get_subtotal( 'edit' ),
			'subtotal_tax' => (string) $wtr_item->get_subtotal_tax( 'edit' ),
			'total'        => (string) $wtr_item->get_total( 'edit' ),
			'total_tax'    => (string) $wtr_item->get_total_tax( 'edit' ),
			'taxes'        => $wtr_taxes( $wtr_item ),
		),
	);
}

foreach ( $wtr_order->get_items( 'shipping' ) as $wtr_item ) {
	$wtr_data['shipping'][] = array(
		'id'        => $wtr_item->get_id(),
		'method_id' => $wtr_item->get_method_id(),
		'stored'    => array(
			'total'     => (string) $wtr_item->get_total( 'edit' ),
			'total_tax' => (string) $wtr_item->get_total_tax( 'edit' ),
			'taxes'     => $wtr_taxes( $wtr_item ),
		),
	);
}

foreach ( $wtr_order->get_items( 'fee' ) as $wtr_item ) {
	$wtr_data['fees'][] = array(
		'id'         => $wtr_item->get_id(),
		'amount'     => (string) $wtr_item->get_amount( 'edit' ),
		'taxable'    => 'taxable' === $wtr_item->get_tax_status(),
		'tax_class'  => $wtr_item->get_tax_class(),
		'stored'     => array(
			'total'     => (string) $wtr_item->get_total( 'edit' ),
			'total_tax' => (string) $wtr_item->get_total_tax( 'edit' ),
			'taxes'     => $wtr_taxes( $wtr_item ),
		),
	);
}

foreach ( $wtr_order->get_items( 'coupon' ) as $wtr_item ) {
	$wtr_data['coupons'][] = array(
		'id'           => $wtr_item->get_id(),
		'discount'     => (string) $wtr_item->get_discount( 'edit' ),
		'discount_tax' => (string) $wtr_item->get_discount_tax( 'edit' ),
	);
}

foreach ( $wtr_order->get_refunds() as $wtr_refund ) {
	$wtr_lines = array();
	foreach ( $wtr_refund->get_items( array( 'line_item', 'shipping', 'fee' ) ) as $wtr_item ) {
		$wtr_lines[] = array(
			'refunded_item_id' => (int) $wtr_item->get_meta( '_refunded_item_id' ),
			'qty'              => is_callable( array( $wtr_item, 'get_quantity' ) ) ? $wtr_item->get_quantity() : null,
			'total'            => (string) $wtr_item->get_total( 'edit' ),
			'total_tax'        => (string) $wtr_item->get_total_tax( 'edit' ),
			'taxes'            => $wtr_taxes( $wtr_item ),
		);
	}
	$wtr_data['refunds'][] = array(
		'id'               => $wtr_refund->get_id(),
		'amount'           => (string) $wtr_refund->get_amount( 'edit' ),
		'total'            => (string) $wtr_refund->get_total( 'edit' ),
		'total_tax'        => (string) $wtr_refund->get_total_tax( 'edit' ),
		'refunded_payment' => (bool) $wtr_refund->get_refunded_payment( 'edit' ),
		'lines'            => $wtr_lines,
	);
}

// Callbacks that change the arithmetic, with the file that added them. WooCommerce's own callbacks are counted only.
$wtr_hooks = array(
	'woocommerce_calc_tax',
	'woocommerce_calc_shipping_tax',
	'woocommerce_tax_round',
	'wc_round_tax_total',
	'woocommerce_price_inc_tax_amount',
	'woocommerce_price_ex_tax_amount',
	'woocommerce_internal_rounding_precision',
	'wc_get_price_decimals',
	'woocommerce_adjust_non_base_location_prices',
	'woocommerce_shipping_prices_include_tax',
	'woocommerce_cart_totals_get_item_tax_rates',
	'woocommerce_calculate_item_totals_taxes',
	'woocommerce_cart_totals_get_fees_from_cart_taxes',
	'woocommerce_get_discounted_price',
	'woocommerce_coupon_sort',
	'woocommerce_calculated_total',
	'woocommerce_calculate_totals',
	'woocommerce_order_get_tax_location',
	'woocommerce_order_is_vat_exempt',
	'woocommerce_order_before_calculate_totals',
	'woocommerce_order_after_calculate_totals',
	'woocommerce_order_item_after_calculate_taxes',
	'woocommerce_cart_tax_totals',
	'woocommerce_order_get_total',
	'woocommerce_order_amount_item_subtotal',
	'woocommerce_order_amount_line_total',
);
$wtr_callbacks = array();
global $wp_filter;
foreach ( $wtr_hooks as $wtr_hook ) {
	if ( empty( $wp_filter[ $wtr_hook ] ) || ! $wp_filter[ $wtr_hook ] instanceof WP_Hook ) {
		continue;
	}
	foreach ( $wp_filter[ $wtr_hook ]->callbacks as $wtr_priority => $wtr_list ) {
		foreach ( $wtr_list as $wtr_cb ) {
			$wtr_fn   = $wtr_cb['function'];
			$wtr_file = '';
			try {
				if ( is_string( $wtr_fn ) && false !== strpos( $wtr_fn, '::' ) ) {
					$wtr_fn = explode( '::', $wtr_fn, 2 );
				}
				if ( is_array( $wtr_fn ) ) {
					$wtr_ref  = new ReflectionMethod( is_object( $wtr_fn[0] ) ? get_class( $wtr_fn[0] ) : $wtr_fn[0], $wtr_fn[1] );
					$wtr_name = ( is_object( $wtr_fn[0] ) ? get_class( $wtr_fn[0] ) : $wtr_fn[0] ) . '::' . $wtr_fn[1];
				} elseif ( $wtr_fn instanceof Closure || is_string( $wtr_fn ) ) {
					$wtr_ref  = new ReflectionFunction( $wtr_fn );
					$wtr_name = is_string( $wtr_fn ) ? $wtr_fn : 'closure';
				} else {
					$wtr_ref  = null;
					$wtr_name = 'callable object';
				}
				$wtr_file = $wtr_ref ? wp_normalize_path( (string) $wtr_ref->getFileName() ) . ':' . $wtr_ref->getStartLine() : '';
			} catch ( Throwable $e ) {
				$wtr_name = 'unresolved callable';
			}
			if ( false !== strpos( $wtr_file, '/plugins/woocommerce/' ) ) {
				$wtr_callbacks[ $wtr_hook ]['woocommerce_callbacks'] = ( $wtr_callbacks[ $wtr_hook ]['woocommerce_callbacks'] ?? 0 ) + 1;
				continue;
			}
			$wtr_root                         = wp_normalize_path( ABSPATH );
			$wtr_callbacks[ $wtr_hook ]['other'][] = $wtr_priority . ' ' . $wtr_name . ' ' . ( 0 === strpos( $wtr_file, $wtr_root ) ? substr( $wtr_file, strlen( $wtr_root ) ) : $wtr_file );
		}
	}
}
$wtr_data['hooks'] = $wtr_callbacks ? $wtr_callbacks : new stdClass();

echo wp_json_encode( $wtr_data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ), "\n";
