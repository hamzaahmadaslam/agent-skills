# What each checkout request does

Read this before measuring (steps 1 and 2), so each request in a HAR file or an access log can be named and tied to
the server code it runs. Code links point at the WooCommerce 11.1.2 tag.

## Which checkout the store uses

- Block checkout: the checkout page (or, on block themes, the checkout template) contains the `woocommerce/checkout`
  block. WooCommerce's own test is `CartCheckoutUtils::is_checkout_block_default()`
  ([CartCheckoutUtils.php L170-L182](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Blocks/Utils/CartCheckoutUtils.php#L170-L182)).
- Classic checkout: the page holds the `[woocommerce_checkout]` shortcode, directly or through the classic shortcode block.
- `scripts/checkout-state.php` prints both answers and the page paths. With an empty cart the checkout page redirects to
  the cart page (filter `woocommerce_checkout_redirect_empty_cart`)
  ([wc-template-functions.php L38-L43](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-template-functions.php#L38-L43)),
  so every checkout measurement needs an item in the cart.

## Classic checkout

| Request | Sent when | Server work | Source |
| --- | --- | --- | --- |
| `GET /checkout/` | Page view | Full page render; enqueues `wc-checkout` with its parameters, `selectWoo` and the country scripts | [class-wc-frontend-scripts.php L475-L581, L669-L684](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-frontend-scripts.php#L669-L684) |
| `POST /?wc-ajax=update_order_review` | Once on page load; on a change of shipping method, ship-to-different-address or `update_totals_on_change` fields; on address select changes; 1 second after typing stops in an address field once that address group's required fields are filled. A new update aborts the one in flight | Runs `woocommerce_checkout_update_order_review`, recalculates shipping and totals, returns HTML fragments through `woocommerce_update_order_review_fragments` | [checkout.js L176-L197, L218-L221, L433-L505, L609-L625](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/checkout.js#L176-L197); [class-wc-ajax.php L396-L502](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L396-L502) |
| `POST /?wc-ajax=apply_coupon`, `remove_coupon` | Coupon form | Applies or removes the coupon, then an `update_order_review` follows | [checkout.js L1238-L1312, L1313-L1375](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/checkout.js#L1238-L1312) |
| `POST /?wc-ajax=checkout` | "Place order" | `WC_Checkout::process_checkout()`: validation, order creation, payment | [checkout.js L961-L965](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/checkout.js#L961-L965); [class-wc-ajax.php L596-L600](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L596-L600) |
| `GET /checkout/order-received/<id>/?key=...` | After payment | Thank-you page; runs `woocommerce_before_thankyou`, `woocommerce_thankyou_<gateway>`, `woocommerce_thankyou` | [thankyou.php L28, L81-L82](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/templates/checkout/thankyou.php#L81-L82) |

`?wc-ajax=` requests are front-end requests: WordPress loads fully, runs the main query, and WooCommerce answers at
`template_redirect` priority 0 with no-cache headers
([class-wc-ajax.php L38-L42, L98-L110, L117-L132](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L117-L132)).
Everything a plugin does on every front-end request also runs on each of them. The order-received URL carries the
order key; the helper scripts never print it.

## Block checkout

| Request | Sent when | Server work | Source |
| --- | --- | --- | --- |
| `GET /checkout/` | Page view | Page render that also runs the Store API cart and checkout routes internally to embed their data in the page, so the page's server time includes a full cart and shipping calculation | [Blocks Checkout.php L579-L583](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Blocks/BlockTypes/Checkout.php#L579-L583); [Hydration.php L97](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Blocks/Domain/Services/Hydration.php#L97) |
| `POST /wp-json/wc/store/v1/batch` (holds `cart/update-customer`) | Address field changes, debounced | Customer and cart update, returns the full cart | [data flow guide](https://developer.woocommerce.com/docs/block-development/cart-and-checkout-blocks/overview-of-data-flow/) |
| `PUT /wp-json/wc/store/v1/checkout` | Additional checkout fields change | Stores the fields; since 10.9.0 in the customer session unless an unpaid order exists | same guide; [Checkout.php L360-L458](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L360-L458) |
| Store API coupon and `cart/select-shipping-rate` calls | Coupon applied, shipping method changed | Cart update, returns the full cart | same guide |
| none | Payment method changed | Nothing is sent until the order is placed | same guide |
| `POST /wp-json/wc/store/v1/checkout` | "Place order" | `process_order()`: validation, order creation, payment | [Checkout.php L75-L146, L540-L720](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L540-L720) |

- With plain permalinks the same routes arrive as `?rest_route=/wc/store/v1/...`; the helper scripts recognise both.
- Store API cart routes, including checkout, answer with `Cache-Control: no-store`
  ([AbstractCartRoute.php L153-L164](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/AbstractCartRoute.php#L153-L164);
  added in 10.6.0, [PR 62653](https://github.com/woocommerce/woocommerce/pull/62653)).
- Since 10.9.0 page views and form changes no longer create `wc-checkout-draft` orders; the order is created when the
  shopper places it ([PR 64155](https://github.com/woocommerce/woocommerce/pull/64155);
  [Checkout.php L213-L229](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L213-L229)).
  On older releases, checkout visits that ended without an order left draft order rows behind; see
  [database-indexes.md](database-indexes.md) for the count.
- Optional rate limiting: the feature "Rate limit Checkout" (`rate_limit_checkout`, off by default) allows 3 place-order
  POSTs per 60 seconds per client on the Store API checkout route
  ([FeaturesController.php L325-L337](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L325-L337);
  [Authentication.php L189-L207](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Authentication.php#L189-L207);
  [rate limiting docs](https://developer.woocommerce.com/docs/apis/store-api/rate-limiting/)). It does not cover the
  classic `?wc-ajax=checkout` request.

## Place order, step by step

Classic, `WC_Checkout::process_checkout()`
([class-wc-checkout.php L1348-L1456](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L1348-L1456)):

1. Nonce check, `woocommerce_before_checkout_process`, `woocommerce_checkout_process`.
2. Session update and totals, then validation ending in `woocommerce_after_checkout_validation`
   ([L1007-L1057](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L1007-L1057)).
3. Customer processing, then `create_order()`: `woocommerce_checkout_create_order`, the save, then
   `woocommerce_checkout_update_order_meta` and `woocommerce_checkout_order_created`
   ([L387-L525](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L387-L525)).
   Stock is reserved on `woocommerce_checkout_order_created`
   ([wc-stock-functions.php L446-L465](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L446-L465)).
4. `woocommerce_checkout_order_processed`.
5. Payment: the session is saved first, then the gateway's `process_payment()` runs inside this request
   ([L1141-L1184](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L1141-L1184)).

Block, Store API `process_order()`
([Checkout.php L540-L720](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L540-L720)):
validation, customer update, totals, cart and total checks, order creation or update
(`woocommerce_store_api_checkout_order_created`, `woocommerce_store_api_checkout_update_order_meta`), request data,
customer processing, order validation, coupon holds, stock reservation, status `pending`,
`woocommerce_store_api_checkout_order_processed`, then payment through
`woocommerce_rest_checkout_process_payment_with_context` or the gateway's `process_payment()`
([CheckoutTrait.php L88-L130](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/CheckoutTrait.php#L88-L130)).

Both paths then change the order status, which sends the transactional emails and runs every callback on the status
hooks in the same request. [order-hooks.md](order-hooks.md) lists them.

## The place-order step logger

Since 9.9.0 both flows log each step of placing an order
([PR 53230](https://github.com/woocommerce/woocommerce/pull/53230);
[wc-order-step-logger-functions.php L30-L118](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-step-logger-functions.php#L30-L118)):

- Each step is logged at debug level under the source `place-order-debug-<8 characters>`. Whether it is stored depends
  on the log level threshold (10.4.0, [PR 61842](https://github.com/woocommerce/woocommerce/pull/61842)); the default
  threshold "None" stores every level
  ([Logging Settings.php L26-L31, L507-L521](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Logging/Settings.php#L26-L31)).
- When a step carries the order, the logger adds the meta `_debug_log_source` and calls `$order->save()`
  ([L70-L77](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-step-logger-functions.php#L70-L77)),
  whatever the threshold. In the 11.1.2 Store API flow, steps 4 to 9 and the draft-order helper carry the order
  ([Checkout.php L590-L711, L791-L862](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L590-L711));
  in the classic flow, steps 4 and 5
  ([class-wc-checkout.php L1422-L1432](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L1422-L1432)).
- Each save runs the order save hooks again (see [order-hooks.md](order-hooks.md#hooks-that-run-on-every-order-save)).
- After a clean finish the logger saves the order once more to mark its logs for deletion and queues a batch processor
  (Action Scheduler) that deletes them
  ([L91-L108](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-step-logger-functions.php#L91-L108));
  since 10.8.0 leftover logs older than 3 days are removed as well (filter
  `woocommerce_cleanup_order_debug_logs_max_age`)
  ([OrderLogsCleanupHelper.php L70-L80](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Logging/OrderLogsCleanupHelper.php#L70-L80);
  [PR 63756](https://github.com/woocommerce/woocommerce/pull/63756)).
- Since 11.0.1 the filter `woocommerce_order_step_logging_enabled` turns the logger off
  ([L40-L50](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-step-logger-functions.php#L40-L50)).
  The logs exist to debug failed orders, so turning it off is the owner's decision, made on measured numbers (query
  count and time of the place-order request on staging, with and without the filter).
