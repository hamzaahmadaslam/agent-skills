<?php
/**
 * Read-only helper for `wp eval-file`. For each product ID given, rebuilds the rows that WooCommerce 11.1.2 would
 * write to {prefix}wc_product_meta_lookup and {prefix}wc_product_attributes_lookup, using the same rules as its own
 * code, and prints every difference from the rows in the tables. Use it on the products the SQL checks list, before
 * and after a repair, and to confirm a single-product regeneration.
 *
 * Rules it follows (sources in references/meta-lookup-rules.md and references/attributes-lookup-rules.md):
 * - meta lookup: WC_Product_Data_Store_CPT::get_data_for_lookup_table(), the values a product save writes;
 * - attributes lookup: LookupDataStore::create_data_for() and its helpers, the "object" path that runs when
 *   "Optimized updates" is off. Where the optimized path writes something else, the output says so.
 *
 * It only reads: get_post(), get_post_meta(), wc_get_product(), get_term_by() and SELECT statements through $wpdb.
 * It calls no function that saves, updates, deletes or schedules anything. Loading products fills WordPress's object
 * cache, as any page view does. It prints product IDs, SKUs, prices, stock values and term IDs: catalog data only.
 *
 * Usage (from the WordPress root, or with --path=...):
 *   wp eval-file lookup-product-diff.php 123 456
 *   wp eval-file lookup-product-diff.php 123 --url=example.com/shop     # one site of a multisite
 * A variation ID is checked through its parent product.
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

if ( ! function_exists( 'WC' ) ) {
	echo "WooCommerce is not active on this site.\n";
	return;
}

global $wpdb;

$wlpd_ids = array_values( array_unique( array_filter( array_map( 'absint', isset( $args ) ? (array) $args : array() ) ) ) );
if ( ! $wlpd_ids ) {
	echo "Usage: wp eval-file lookup-product-diff.php <product-id> [<product-id>...]\n";
	return;
}

$wlpd_meta_table = $wpdb->prefix . 'wc_product_meta_lookup';
$wlpd_attr_table = $wpdb->prefix . 'wc_product_attributes_lookup';

printf( "WooCommerce %s, lookup settings: table usage %s, direct updates %s, optimized updates %s\n",
	WC()->version,
	get_option( 'woocommerce_attribute_lookup_enabled', '(not set)' ),
	get_option( 'woocommerce_attribute_lookup_direct_updates', '(not set)' ),
	get_option( 'woocommerce_attribute_lookup_optimized_updates', '(not set)' )
);

// Normalise a value for comparison: NULL and '' are the same, numbers compare as numbers.
$wlpd_same = static function ( $expected, $actual, $numeric ) {
	if ( $numeric ) {
		$e = ( null === $expected || '' === $expected || false === $expected ) ? 0.0 : (float) $expected;
		$a = ( null === $actual || '' === $actual ) ? 0.0 : (float) $actual;
		return abs( $e - $a ) < 0.00005;
	}
	return (string) $expected === (string) $actual;
};

$wlpd_show = static function ( $value ) {
	if ( null === $value ) {
		return 'NULL';
	}
	if ( false === $value ) {
		return 'false';
	}
	return "'" . $value . "'";
};

// Expected meta lookup row, as WC_Product_Data_Store_CPT::get_data_for_lookup_table() builds it in 11.1.2.
$wlpd_expected_meta = static function ( $id ) {
	$price_meta   = (array) get_post_meta( $id, '_price', false );
	$manage_stock = get_post_meta( $id, '_manage_stock', true );
	$stock        = 'yes' === $manage_stock ? wc_stock_amount( get_post_meta( $id, '_stock', true ) ) : null;
	$price        = wc_format_decimal( get_post_meta( $id, '_price', true ) );
	$sale_price   = wc_format_decimal( get_post_meta( $id, '_sale_price', true ) );
	$data         = array(
		'sku'            => get_post_meta( $id, '_sku', true ),
		'virtual'        => 'yes' === get_post_meta( $id, '_virtual', true ) ? 1 : 0,
		'downloadable'   => 'yes' === get_post_meta( $id, '_downloadable', true ) ? 1 : 0,
		'min_price'      => reset( $price_meta ),
		'max_price'      => end( $price_meta ),
		'onsale'         => $sale_price && $price === $sale_price ? 1 : 0,
		'stock_quantity' => $stock,
		'stock_status'   => get_post_meta( $id, '_stock_status', true ),
		'rating_count'   => array_sum( array_map( 'intval', (array) get_post_meta( $id, '_wc_rating_count', true ) ) ),
		'average_rating' => get_post_meta( $id, '_wc_average_rating', true ),
		'total_sales'    => get_post_meta( $id, 'total_sales', true ),
		'tax_status'     => get_post_meta( $id, '_tax_status', true ),
		'tax_class'      => get_post_meta( $id, '_tax_class', true ),
	);
	if ( get_option( 'woocommerce_schema_version', 0 ) >= 920 ) {
		$data['global_unique_id'] = get_post_meta( $id, '_global_unique_id', true );
	}
	return array( $data, count( array_filter( $price_meta, static function ( $p ) { return '' !== $p && null !== $p; } ) ) );
};

$wlpd_numeric_columns = array( 'virtual', 'downloadable', 'min_price', 'max_price', 'onsale', 'stock_quantity', 'rating_count', 'average_rating', 'total_sales' );

foreach ( $wlpd_ids as $wlpd_id ) {
	printf( "\n== Product %d ==\n", $wlpd_id );
	$wlpd_post = get_post( $wlpd_id );
	if ( ! $wlpd_post || ! in_array( $wlpd_post->post_type, array( 'product', 'product_variation' ), true ) ) {
		echo "Not a product or variation. Rows for this ID in either table are orphans:\n";
		printf( "  meta lookup rows: %d\n", (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE product_id = %d', $wlpd_meta_table, $wlpd_id ) ) );
		printf( "  attribute lookup rows: %d\n", (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE product_id = %d OR product_or_parent_id = %d', $wlpd_attr_table, $wlpd_id, $wlpd_id ) ) );
		continue;
	}
	printf( "%s, status %s%s\n", $wlpd_post->post_type, $wlpd_post->post_status, $wlpd_post->post_parent ? ', parent ' . $wlpd_post->post_parent : '' );

	// Meta lookup row of this post.
	echo "\n-- wc_product_meta_lookup\n";
	list( $wlpd_expected, $wlpd_price_rows ) = $wlpd_expected_meta( $wlpd_id );
	$wlpd_row                              = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE product_id = %d', $wlpd_meta_table, $wlpd_id ), ARRAY_A );
	if ( ! $wlpd_row ) {
		echo "No row. A save that changes a lookup property, or the \"Product lookup tables\" tool, writes one.\n";
	} else {
		$wlpd_diffs = 0;
		foreach ( $wlpd_expected as $wlpd_column => $wlpd_value ) {
			if ( ! array_key_exists( $wlpd_column, $wlpd_row ) ) {
				printf( "  %-16s column missing from the table\n", $wlpd_column );
				++$wlpd_diffs;
				continue;
			}
			if ( in_array( $wlpd_column, array( 'min_price', 'max_price' ), true ) && 0 === $wlpd_price_rows ) {
				continue; // Reported below: without _price there is no value to compare.
			}
			if ( 'stock_quantity' === $wlpd_column && null === $wlpd_value ) {
				if ( null !== $wlpd_row['stock_quantity'] ) {
					printf( "  %-16s table %s, expected NULL (stock not managed; a regeneration leaves the old number)\n", $wlpd_column, $wlpd_show( $wlpd_row['stock_quantity'] ) );
					++$wlpd_diffs;
				}
				continue;
			}
			if ( ! $wlpd_same( $wlpd_value, $wlpd_row[ $wlpd_column ], in_array( $wlpd_column, $wlpd_numeric_columns, true ) ) ) {
				printf(
					"  %-16s table %s, expected %s%s\n",
					$wlpd_column,
					$wlpd_show( $wlpd_row[ $wlpd_column ] ),
					$wlpd_show( $wlpd_value ),
					'onsale' === $wlpd_column ? ' (save rule; the regeneration rule differs, see meta-lookup-rules.md)' : ''
				);
				++$wlpd_diffs;
			}
		}
		if ( 0 === $wlpd_price_rows ) {
			printf( "  _price is empty or missing (table min/max %s/%s): saving and regenerating do not rebuild it, see mismatch-classes.md\n", $wlpd_show( $wlpd_row['min_price'] ), $wlpd_show( $wlpd_row['max_price'] ) );
			++$wlpd_diffs;
		}
		if ( 0 === $wlpd_diffs ) {
			echo "  Row matches post meta.\n";
		}
	}

	// Attribute lookup rows are kept per parent product.
	$wlpd_parent_id = 'product_variation' === $wlpd_post->post_type ? (int) $wlpd_post->post_parent : $wlpd_id;
	printf( "\n-- wc_product_attributes_lookup (product_or_parent_id %d)\n", $wlpd_parent_id );
	$wlpd_parent = wc_get_product( $wlpd_parent_id );
	if ( ! $wlpd_parent ) {
		echo "Parent product cannot be loaded; any rows under it are orphans.\n";
		continue;
	}

	$wlpd_expected_rows = array();
	$wlpd_notes         = array();
	$wlpd_add           = static function ( &$rows, $product_id, $parent_id, $taxonomy, $term_id, $is_variation, $in_stock ) {
		$rows[ $product_id . '|' . $taxonomy . '|' . $term_id ] = array( (int) $product_id, (int) $parent_id, (string) $taxonomy, (int) $term_id, $is_variation ? 1 : 0, $in_stock ? 1 : 0 );
	};

	// Taxonomy attributes of the parent: LookupDataStore::get_attribute_taxonomies().
	$wlpd_attributes = array();
	foreach ( $wlpd_parent->get_attributes() as $wlpd_taxonomy => $wlpd_attribute ) {
		if ( ! is_object( $wlpd_attribute ) || ! $wlpd_attribute->get_id() ) {
			continue; // Custom attribute, not used for filtering.
		}
		$wlpd_attributes[ $wlpd_taxonomy ] = array(
			'term_ids'            => array_map( 'intval', (array) $wlpd_attribute->get_options() ),
			'used_for_variations' => (bool) $wlpd_attribute->get_variation(),
		);
	}

	$wlpd_visibility = $wlpd_parent->get_catalog_visibility();
	if ( in_array( $wlpd_visibility, array( 'search', 'hidden' ), true ) ) {
		$wlpd_notes[] = "Catalog visibility is \"{$wlpd_visibility}\": a save that sets it removes the rows, a regeneration writes them.";
	}

	$wlpd_parent_in_stock = $wlpd_parent->is_in_stock();
	if ( is_a( $wlpd_parent, 'WC_Product_Variable' ) ) {
		foreach ( $wlpd_attributes as $wlpd_taxonomy => $wlpd_data ) {
			if ( ! $wlpd_data['used_for_variations'] ) {
				foreach ( $wlpd_data['term_ids'] as $wlpd_term_id ) {
					$wlpd_add( $wlpd_expected_rows, $wlpd_parent_id, $wlpd_parent_id, $wlpd_taxonomy, $wlpd_term_id, false, $wlpd_parent_in_stock );
				}
			}
		}
		// Children as WC_Product_Variable::get_children() lists them (publish and private), read without the transient.
		$wlpd_children = array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					"SELECT ID FROM {$wpdb->posts} WHERE post_parent = %d AND post_type = 'product_variation' AND post_status IN ('publish', 'private') ORDER BY menu_order ASC, ID ASC",
					$wlpd_parent_id
				)
			)
		);
		$wlpd_other = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_parent = %d AND post_type = 'product_variation' AND post_status IN ('draft', 'pending')",
				$wlpd_parent_id
			)
		);
		if ( $wlpd_other ) {
			$wlpd_notes[] = "{$wlpd_other} draft or pending variation(s): the optimized path writes rows for them, the object path does not.";
		}
		foreach ( $wlpd_children as $wlpd_child_id ) {
			$wlpd_variation = wc_get_product( $wlpd_child_id );
			if ( ! $wlpd_variation ) {
				continue;
			}
			$wlpd_variation_attributes = (array) $wlpd_variation->get_attributes();
			$wlpd_child_in_stock       = $wlpd_variation->is_in_stock();
			if ( 'onbackorder' === $wlpd_variation->get_stock_status() ) {
				$wlpd_notes[] = "Variation {$wlpd_child_id} is on backorder: the object path writes in_stock 1, the optimized path 0.";
			}
			foreach ( $wlpd_attributes as $wlpd_taxonomy => $wlpd_data ) {
				if ( ! $wlpd_data['used_for_variations'] ) {
					continue;
				}
				$wlpd_slug = isset( $wlpd_variation_attributes[ $wlpd_taxonomy ] ) ? (string) $wlpd_variation_attributes[ $wlpd_taxonomy ] : '';
				$wlpd_term = '' !== $wlpd_slug ? get_term_by( 'slug', $wlpd_slug, $wlpd_taxonomy ) : false;
				if ( '' !== $wlpd_slug && $wlpd_term ) {
					$wlpd_add( $wlpd_expected_rows, $wlpd_child_id, $wlpd_parent_id, $wlpd_taxonomy, $wlpd_term->term_id, true, $wlpd_child_in_stock );
					if ( ! in_array( (int) $wlpd_term->term_id, $wlpd_data['term_ids'], true ) ) {
						$wlpd_notes[] = "Variation {$wlpd_child_id} uses {$wlpd_taxonomy} '{$wlpd_slug}', which the parent does not have: the optimized path writes no row for it.";
					}
				} else {
					if ( '' !== $wlpd_slug ) {
						$wlpd_notes[] = "Variation {$wlpd_child_id} uses {$wlpd_taxonomy} '{$wlpd_slug}', which is not a term of that taxonomy: the object path writes every parent term, the optimized path writes none.";
					}
					foreach ( $wlpd_data['term_ids'] as $wlpd_term_id ) {
						$wlpd_add( $wlpd_expected_rows, $wlpd_child_id, $wlpd_parent_id, $wlpd_taxonomy, $wlpd_term_id, true, $wlpd_child_in_stock );
					}
				}
			}
		}
	} else {
		foreach ( $wlpd_attributes as $wlpd_taxonomy => $wlpd_data ) {
			foreach ( $wlpd_data['term_ids'] as $wlpd_term_id ) {
				$wlpd_add( $wlpd_expected_rows, $wlpd_parent_id, $wlpd_parent_id, $wlpd_taxonomy, $wlpd_term_id, false, $wlpd_parent_in_stock );
			}
		}
	}
	if ( 'onbackorder' === $wlpd_parent->get_stock_status() ) {
		$wlpd_notes[] = 'The product is on backorder: the object path writes in_stock 1, the optimized path 0.';
	}

	$wlpd_actual_rows = array();
	$wlpd_results     = $wpdb->get_results(
		$wpdb->prepare(
			'SELECT product_id, product_or_parent_id, taxonomy, term_id, is_variation_attribute, in_stock FROM %i WHERE product_or_parent_id = %d OR product_id = %d',
			$wlpd_attr_table,
			$wlpd_parent_id,
			$wlpd_parent_id
		),
		ARRAY_N
	);
	foreach ( (array) $wlpd_results as $wlpd_r ) {
		$wlpd_actual_rows[ $wlpd_r[0] . '|' . $wlpd_r[2] . '|' . $wlpd_r[3] ] = array( (int) $wlpd_r[0], (int) $wlpd_r[1], (string) $wlpd_r[2], (int) $wlpd_r[3], (int) $wlpd_r[4], (int) $wlpd_r[5] );
	}

	$wlpd_missing = array_diff_key( $wlpd_expected_rows, $wlpd_actual_rows );
	$wlpd_extra   = array_diff_key( $wlpd_actual_rows, $wlpd_expected_rows );
	$wlpd_changed = array();
	foreach ( array_intersect_key( $wlpd_expected_rows, $wlpd_actual_rows ) as $wlpd_key => $wlpd_e ) {
		if ( $wlpd_e !== $wlpd_actual_rows[ $wlpd_key ] ) {
			$wlpd_changed[ $wlpd_key ] = array( $wlpd_e, $wlpd_actual_rows[ $wlpd_key ] );
		}
	}

	printf( "expected rows %d, rows in table %d, missing %d, extra %d, different %d\n", count( $wlpd_expected_rows ), count( $wlpd_actual_rows ), count( $wlpd_missing ), count( $wlpd_extra ), count( $wlpd_changed ) );
	$wlpd_print = static function ( $label, $r ) {
		printf( "  %-9s product_id %d, parent %d, %s term %d, is_variation_attribute %d, in_stock %d\n", $label, $r[0], $r[1], $r[2], $r[3], $r[4], $r[5] );
	};
	foreach ( $wlpd_missing as $wlpd_r ) {
		$wlpd_print( 'missing', $wlpd_r );
	}
	foreach ( $wlpd_extra as $wlpd_r ) {
		$wlpd_print( 'extra', $wlpd_r );
	}
	foreach ( $wlpd_changed as $wlpd_pair ) {
		$wlpd_print( 'expected', $wlpd_pair[0] );
		$wlpd_print( 'in table', $wlpd_pair[1] );
	}
	foreach ( array_unique( $wlpd_notes ) as $wlpd_note ) {
		echo '  note: ', $wlpd_note, "\n";
	}

	// Attribute lookup updates for this product still waiting in Action Scheduler (args are [product id, action]).
	$wlpd_actions = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT action_id, status, args, scheduled_date_gmt FROM {$wpdb->prefix}actionscheduler_actions WHERE hook = 'woocommerce_run_product_attribute_lookup_update_callback' AND status IN ('pending', 'in-progress', 'failed') AND ( args LIKE %s OR args LIKE %s )",
			'[' . $wpdb->esc_like( (string) $wlpd_parent_id ) . ',%',
			'[' . $wpdb->esc_like( (string) $wlpd_id ) . ',%'
		),
		ARRAY_A
	);
	foreach ( (array) $wlpd_actions as $wlpd_action ) {
		printf( "  queued: action %d %s %s scheduled %s\n", $wlpd_action['action_id'], $wlpd_action['status'], $wlpd_action['args'], $wlpd_action['scheduled_date_gmt'] );
	}
}

echo "\nDone. Nothing was changed.\n";
