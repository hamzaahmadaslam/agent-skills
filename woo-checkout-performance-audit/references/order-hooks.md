# Hooks that run while a checkout is placed

Read this for step 8 of the procedure: when "Place order" is slow while the gateway itself answers fast, or when totals
updates are slow. Code links point at the WooCommerce 11.1.2 tag.

Every callback on these hooks runs inside the shopper's request unless it hands its work to a queue. The audit lists
them, finds the slow ones, and asks whether each one has to run before the shopper sees the next page.

## Hooks that run on every totals update

These run on each `update_order_review` (classic) and each Store API cart update (block), and during the checkout
page's own render, which recalculates totals on both checkouts
([class-wc-shortcode-checkout.php L352](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/shortcodes/class-wc-shortcode-checkout.php#L352);
[CartController.php L68-L85](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/CartController.php#L68-L85)).

| Hook | Type | Source |
| --- | --- | --- |
| `woocommerce_checkout_update_order_review` | action, classic only | [class-wc-ajax.php L405](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L405) |
| `woocommerce_before_calculate_totals`, `woocommerce_after_calculate_totals` | action | [class-wc-cart.php L1568, L1572](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart.php#L1568-L1572) |
| `woocommerce_cart_calculate_fees` | action | [class-wc-cart.php L2233](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart.php#L2233) |
| `woocommerce_before_get_rates_for_package`, `woocommerce_after_get_rates_for_package` | action, around each shipping method's rate lookup | [class-wc-shipping.php L345, L357](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-shipping.php#L345-L357) |
| `woocommerce_package_rates` | filter | [class-wc-shipping.php L390](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-shipping.php#L390) |
| `woocommerce_available_payment_gateways` | filter | [class-wc-payment-gateways.php L388](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-payment-gateways.php#L388) |
| `woocommerce_update_order_review_fragments` | filter, classic only | [class-wc-ajax.php L377, L494](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L494) |

## Hooks that run when the order is placed

Classic checkout ([class-wc-checkout.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php)):

| Hook | Line |
| --- | --- |
| `woocommerce_before_checkout_process`, `woocommerce_checkout_process` | [L1370, L1378](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L1370-L1378) |
| `woocommerce_after_checkout_validation` | [L1056](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L1056) |
| `woocommerce_checkout_create_order`, then the save, `woocommerce_checkout_update_order_meta`, `woocommerce_checkout_order_created` | [L476, L479, L503, L510](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L476-L510) |
| `woocommerce_checkout_order_processed` | [L1427](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L1427) |

Block checkout ([StoreApi Checkout.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php),
[CheckoutTrait.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/CheckoutTrait.php)):

| Hook | Line |
| --- | --- |
| `woocommerce_store_api_checkout_update_customer_from_request` | [Checkout.php L949](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L949) |
| `woocommerce_store_api_checkout_order_created` (10.9.0 and later) | [Checkout.php L806](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L806) |
| `woocommerce_store_api_checkout_update_order_meta` | [Checkout.php L849](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L849) |
| `woocommerce_store_api_checkout_update_order_from_request` | [CheckoutTrait.php L247](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/CheckoutTrait.php#L247) |
| `woocommerce_store_api_checkout_order_processed` | [Checkout.php L690](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L690) |
| `woocommerce_rest_checkout_process_payment_with_context` | [CheckoutTrait.php L108](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/CheckoutTrait.php#L108) |

## Hooks that run on every order save

- Every `$order->save()` fires `woocommerce_before_order_object_save`, calls the data store's `update()` (or `create()`)
  and fires `woocommerce_after_order_object_save`
  ([abstract-wc-order.php L273-L318](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L273-L318)).
- Both data stores end `update()` with `woocommerce_update_order`, or `woocommerce_new_order` when the order leaves a
  draft or new status
  ([HPOS OrdersTableDataStore.php L3039-L3099](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3039-L3099);
  [posts class-wc-order-data-store-cpt.php L199-L245](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-order-data-store-cpt.php#L199-L245)).
- With HPOS and compatibility mode on, each save also writes the posts copy
  ([OrdersTableDataStore.php L3124-L3157](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3124-L3157)).
- A checkout saves the order several times: creation, status changes, payment, and the place-order step logger's saves
  ([checkout-requests.md](checkout-requests.md#the-place-order-step-logger)). A callback on these hooks runs on each
  save, so one that calls an outside API adds that call's time several times over, while any single run of it looks
  fast.

## Hooks that run on the status change and payment

| Hook | Source |
| --- | --- |
| `woocommerce_payment_complete` | [class-wc-order.php L186](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order.php#L186) |
| `woocommerce_order_status_<to>`, `woocommerce_order_status_<from>_to_<to>`, `woocommerce_order_status_changed` | [class-wc-order.php L457, L477-L478](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order.php#L457-L478) |
| Transactional emails, hooked on status transitions such as `woocommerce_order_status_pending_to_processing` | [class-wc-emails.php L91-L149](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-emails.php#L91-L149) |
| Thank-you page: `woocommerce_before_thankyou`, `woocommerce_thankyou_<gateway>`, `woocommerce_thankyou` | [thankyou.php L28, L81-L82](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/templates/checkout/thankyou.php#L81-L82) |

## Work WooCommerce moves out of the request, and how to check it does

| Work | Default | In the request when | Source |
| --- | --- | --- | --- |
| Transactional emails | Sent during the request | Always, unless the feature "Deferred emails" (`deferred_transactional_emails`, off by default) or the filter `woocommerce_defer_transactional_emails` defers them; since 10.8.0 deferred emails are sent by Action Scheduler (hook `woocommerce_send_queued_transactional_email`, group `woocommerce-emails`) | [class-wc-emails.php L130-L148](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-emails.php#L130-L148); [FeaturesController.php L448-L457](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L448-L457); [DeferredEmailQueue.php L24-L29, L71-L114](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Email/DeferredEmailQueue.php#L71-L114); [PR 63832](https://github.com/woocommerce/woocommerce/pull/63832) |
| Webhook delivery | Queued at `shutdown` to Action Scheduler (`woocommerce_deliver_webhook_async`, group `woocommerce-webhooks`) | A callback on `woocommerce_webhook_deliver_async` returns false: delivery then happens in the request | [wc-webhook-functions.php L16-L45](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-webhook-functions.php#L16-L45) |
| Analytics import | Setting "Immediately": an import action is scheduled on each order create and update. "Scheduled": a batch every 12 hours (filter `woocommerce_analytics_import_interval`) | Scheduling itself is in the request in "Immediately" mode | [OrdersScheduler.php L121-L156, L352-L363, L720-L728](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Schedulers/OrdersScheduler.php#L121-L156); [Analytics settings](https://woocommerce.com/document/woocommerce-analytics/) |
| Session save | At `shutdown` | Always, one write when the session changed | [class-wc-session-handler.php L94](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L94) |

New stores since 10.5.0 start on "Scheduled"; existing stores stay on "Immediately" until changed in Analytics >
Settings ([10.5 release post](https://developer.woocommerce.com/2026/02/06/woocommerce-10-5-improving-analytics-and-admin-performance/);
[class-wc-install.php L1348-L1351](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1348-L1351);
the option is `woocommerce_analytics_scheduled_import`,
[OrdersScheduler.php L56-L78, L1016-L1033](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Schedulers/OrdersScheduler.php#L1016-L1033)).

## Finding the callbacks and their cost

1. List them (read-only): `wp eval-file scripts/checkout-state.php` prints, for each hook above, every callback with its
   priority and the plugin, theme or file that added it. WP-CLI loads WordPress without a front-end request, so
   callbacks added only on front-end, Ajax or REST requests are missing: the list is a lower bound.
2. See them on a live request: Query Monitor's Hooks & Actions panel lists the hooks that fired and their callbacks by
   component; `QM_SHOW_ALL_HOOKS` shows every hook with a callback attached
   ([Query Monitor](https://wordpress.org/plugins/query-monitor/);
   [configuration constants](https://querymonitor.com/help/configuration-constants/)).
3. Find outside calls: the HTTP API Calls panel, or the timing log in
   [gateways-and-shipping.md](gateways-and-shipping.md#timing-outbound-http-calls), shows which component calls which
   host during the request.
4. Time one callback (staging): from a temporary mu-plugin, hook Query Monitor's `qm/start` action onto the same hook
   at a priority just before the callback and `qm/stop` just after it, then read the Timings panel
   ([profiling](https://querymonitor.com/wordpress-debugging/profiling-and-logging/)). The panel shows on page loads;
   for the Ajax and REST requests of a checkout, have the same two callbacks record `microtime( true )` and write the
   difference with `wc_get_logger()` instead. Both are code changes: delete the mu-plugin afterwards.

What to look for:

- A CRM, ERP, marketing, fraud or shipping-label call inside the request. Look for a background or queue setting in
  that plugin first, and ask its vendor when there is none.
- A callback on a per-save hook (`woocommerce_update_order`, `woocommerce_after_order_object_save`) that does heavy
  work, since it runs several times per checkout.
- The same callback registered twice (the same file and function at two priorities).
- Emails sent in the request with a slow mail transport: compare the place-order time with deferred emails on and off
  on staging.
