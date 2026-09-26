# Payment gateways and shipping rate APIs

Read this for step 6 of the procedure. Gateways cost time in two places: the scripts they load in the browser, and the
API call they make inside the place-order request. Live shipping rates cost time inside every totals update. Code
links point at the WooCommerce 11.1.2 tag unless they say otherwise.

## Gateway scripts in the browser

- Classic checkout: a gateway prints its form in `payment_fields()`
  ([Payment Gateway API](https://developer.woocommerce.com/docs/features/payments/payment-gateway-api/)) and enqueues
  whatever script that form needs on its own, so find those scripts by host in the HAR summary or in Query Monitor's
  Scripts panel.
- Block checkout: a gateway's block integration registers its script handles in
  `get_payment_method_script_handles()`; WooCommerce adds them as dependencies of the checkout script, and a method
  whose `is_active()` returns false does not enqueue them
  ([payment method integration](https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/checkout-payment-methods/payment-method-integration/)).
- A gateway can enqueue scripts on any page, for example for express payment buttons on product and cart pages, so
  measure those pages as well as checkout.
- Order Attribution (enabled by default) adds `sourcebuster-js` and `wc-order-attribution` to every front-end page
  ([FeaturesController.php L363-L374](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L363-L374);
  [OrderAttributionController.php L109-L130, L271-L300](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Orders/OrderAttributionController.php#L271-L300)).
  It is served from the store's own host, and it belongs in the script inventory like any other.

Measure (read-only):

- DevTools Network panel with "3rd-party requests" ticked, or `domain:` filters per payment host
  ([network reference](https://developer.chrome.com/docs/devtools/network/reference)).
- `node scripts/har-summary.mjs checkout.har` lists hosts with request count, kilobytes and time, first-party and
  third-party.
- The Coverage panel shows how much of each script the page used
  ([Coverage](https://developer.chrome.com/docs/devtools/coverage)).
- The Performance panel's Interactions track shows slow interactions (typing card details, choosing a method) and the
  scripts behind them ([performance reference](https://developer.chrome.com/docs/devtools/performance/reference)).
- Query Monitor's Scripts panel shows which component enqueued each script
  ([how to use Query Monitor](https://querymonitor.com/docs/how-to-use)).

## Gateway time on the server

- `get_available_payment_gateways()` calls every gateway's `is_available()` and then the filter
  `woocommerce_available_payment_gateways`
  ([class-wc-payment-gateways.php L375-L389](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-payment-gateways.php#L375-L389)).
  It runs on checkout renders and totals updates, so a gateway that calls its API from `is_available()` slows each of
  them.
- The payment itself runs inside the place-order request. Classic checkout saves the session, then calls the gateway's
  `process_payment()`; WooCommerce's own comment explains the early save with gateways that hang
  ([class-wc-checkout.php L1141-L1184](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L1141-L1184)).
  `process_payment()` is where a gateway takes the posted payment data and charges it through its provider
  ([Payment Gateway API](https://developer.woocommerce.com/docs/features/payments/payment-gateway-api/)).
- Block checkout calls `woocommerce_rest_checkout_process_payment_with_context`, or the gateway's `process_payment()`
  for gateways without their own Store API handler
  ([CheckoutTrait.php L88-L130](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/CheckoutTrait.php#L88-L130);
  [payment method integration](https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/checkout-payment-methods/payment-method-integration/)).
- The place-order time is therefore at least the gateway's API round trip. Compare the place-order time with the
  store's gateway set to a method without an API (for example cheque, on staging) to separate the gateway from
  everything else.

## Timing outbound HTTP calls

- Calls through the WordPress HTTP API pass the filter `http_request_args` before the request and the action
  `http_api_debug` after the response; the default timeout is 5 seconds (filter `http_request_timeout`)
  ([WordPress 7.1.2 class-wp-http.php L181, L252, L441](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-http.php#L252);
  [http_request_args](https://developer.wordpress.org/reference/hooks/http_request_args/);
  [http_api_debug](https://developer.wordpress.org/reference/hooks/http_api_debug/)).
- Query Monitor's HTTP API Calls panel lists those calls with component and time on page requests
  ([how to use Query Monitor](https://querymonitor.com/docs/how-to-use)); for REST requests the enveloped response
  carries them in `qm.http` ([REST requests](https://querymonitor.com/wordpress-debugging/rest-api-requests/)).
- Clients that bypass the WordPress HTTP API, such as Guzzle, do not show in that panel without extra setup
  ([Guzzle requests](https://querymonitor.com/wordpress-debugging/guzzle-http-requests/)), and they skip the two hooks
  above too. When a gateway uses its own HTTP client, read that gateway's own debug log instead.

For `?wc-ajax=checkout` and the Store API place-order request, the panel is not visible. On staging, a temporary
must-use plugin can log the host, path and duration of each HTTP API call to the WooCommerce logs. It is a change:
staging first, and delete the file when the audit is done (undo). It logs no query strings, headers or bodies.

```php
<?php
/**
 * Plugin Name: Checkout audit, outbound HTTP timing (temporary)
 * Description: Logs method, host, path, status and duration of WordPress HTTP API calls. Delete after the audit.
 */
add_filter(
	'http_request_args',
	static function ( $args, $url ) {
		$GLOBALS['checkout_audit_http'][ md5( $url ) ] = microtime( true );
		return $args;
	},
	PHP_INT_MAX,
	2
);
add_action(
	'http_api_debug',
	static function ( $response, $context, $transport, $args, $url ) {
		$key = md5( $url );
		if ( empty( $GLOBALS['checkout_audit_http'][ $key ] ) || ! function_exists( 'wc_get_logger' ) ) {
			return;
		}
		$ms = (int) round( ( microtime( true ) - $GLOBALS['checkout_audit_http'][ $key ] ) * 1000 );
		unset( $GLOBALS['checkout_audit_http'][ $key ] );
		$parts  = wp_parse_url( $url );
		$status = is_wp_error( $response ) ? $response->get_error_code() : wp_remote_retrieve_response_code( $response );
		$during = isset( $_GET['wc-ajax'] ) ? 'wc-ajax=' . sanitize_key( wp_unslash( $_GET['wc-ajax'] ) ) : strtok( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), '?' );
		wc_get_logger()->info(
			sprintf( '%s %s%s -> %s in %d ms, during %s', $args['method'] ?? 'GET', $parts['host'] ?? '', $parts['path'] ?? '', $status, $ms, $during ),
			array( 'source' => 'checkout-audit-http' )
		);
	},
	10,
	5
);
```

Read the entries in WooCommerce > Status > Logs, source `checkout-audit-http`
([logging](https://developer.woocommerce.com/docs/best-practices/data-management/logging/)).

## Live shipping rates

- Rates are cached in the customer session per package (`shipping_for_package_<n>`) and recalculated only when the
  package hash changes, or on every calculation while "Enable debug mode" (`woocommerce_shipping_debug_mode`) is on
  ([class-wc-shipping.php L311-L359](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-shipping.php#L311-L359)).
  Debug mode left on in production turns every totals update into fresh carrier API calls.
- The hash ignores subtotal, total, package ID and name, rates and index; since 11.0.0 the filter
  `woocommerce_shipping_package_hash_ignored_fields` can add fields that should not trigger a recalculation
  ([L419-L451](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-shipping.php#L419-L451)).
- Each method's rate lookup is wrapped by `woocommerce_before_get_rates_for_package` and
  `woocommerce_after_get_rates_for_package`
  ([L345-L357](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-shipping.php#L345-L357)).
  Methods from plugins (carrier APIs, table rates with many rows) do their work there. On block checkout that includes
  the checkout page render, which embeds the Store API cart and so calculates totals and shipping
  ([Blocks Checkout.php L579-L583](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Blocks/BlockTypes/Checkout.php#L579-L583);
  [CartController.php L68-L85](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/CartController.php#L68-L85));
  on classic checkout, each `update_order_review`.
- `scripts/checkout-state.php` lists the shipping methods per zone and marks the ones that are not WooCommerce core
  methods.

What to measure: the server time of the totals updates (classic `update_order_review`, block `batch`) with the same
address entered twice. The second time the package is unchanged and the session cache should answer, so a second
request as slow as the first points at debug mode, a changing package hash, or a method that ignores the cache.
