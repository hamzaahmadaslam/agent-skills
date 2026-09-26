# Cart fragments (wc-cart-fragments)

Read this for step 4 of the procedure, and whenever access logs show many `?wc-ajax=get_refreshed_fragments` requests.
Code links point at the WooCommerce 11.1.2 tag.

## What the script does

- `wc-cart-fragments` keeps the classic mini cart current. It POSTs to `?wc-ajax=get_refreshed_fragments` with a
  5 second timeout ([cart-fragments.js L38-L67](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/cart-fragments.js#L38-L67);
  `request_timeout` 5000 in [class-wc-frontend-scripts.php L729-L737](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-frontend-scripts.php#L729-L737)).
- On the server that request loads WordPress up to `template_redirect`, renders the mini cart, runs the
  `woocommerce_add_to_cart_fragments` filter and returns the fragments with the cart hash
  ([class-wc-ajax.php L38-L42, L117-L132, L262-L280](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L262-L280)).
  It is sent with no-cache headers, so a page cache never absorbs it
  ([L98-L110](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L98-L110)).
  Every call is a full PHP request.

## When the request fires

From [cart-fragments.js](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/cart-fragments.js):

| Trigger | Lines |
| --- | --- |
| On every page load when the browser has no usable `sessionStorage` or `localStorage` | [L10-L21, L159-L161](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/cart-fragments.js#L159-L161) |
| On page load when stored fragments are missing, or the stored cart hash differs from the `woocommerce_cart_hash` cookie | [L117-L157](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/cart-fragments.js#L117-L157) |
| 24 hours after the cart was created, and then every 24 hours in an open tab | [L77-L98, L135-L142](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/cart-fragments.js#L77-L98) |
| On the `wc_fragment_refresh` and `updated_wc_div` events (the classic cart page triggers these) | [L80-L82](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/cart-fragments.js#L80-L82) |
| When another tab changes the cart | [L100-L107](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/cart-fragments.js#L100-L107) |
| When a page is restored from the back/forward cache | [L109-L115](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/cart-fragments.js#L109-L115) |

With working storage, the first page view makes one request because nothing is stored yet (the `throw 'No fragment'`
branch); later views make none while the stored hash matches the cookie. The cost falls on first views, on shoppers
whose carts change, and on every page view by clients without storage.

## When it still loads in current WooCommerce

- Since 7.8.0 WooCommerce registers the script but no longer enqueues it on every page
  ([PR 35530](https://github.com/woocommerce/woocommerce/pull/35530);
  [WooCommerce advisory, 2023-06-16](https://developer.woocommerce.com/2023/06/16/best-practices-for-the-use-of-the-cart-fragments-api/)).
  In 11.1.2 it is registered with `jquery` and `wc-js-cookie` as dependencies and `load_scripts()` does not enqueue it
  ([class-wc-frontend-scripts.php L258-L262, L475-L581](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-frontend-scripts.php#L475-L581)).
- The classic Cart widget enqueues it whenever the widget renders, and the widget does not render on the cart and
  checkout pages; in the Customizer preview it is always enqueued
  ([class-wc-widget-cart.php L39-L41, L54-L59](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/widgets/class-wc-widget-cart.php#L54-L59)).
- A theme or plugin that enqueues it, or lists it as a dependency of its own script, loads it too (the advisory above).
- Storefront renders the Cart widget in its header with `the_widget( 'WC_Widget_Cart' )`, so on Storefront and its child
  themes the script loads on every page except cart and checkout
  ([storefront 4.6.2 L126-L143](https://github.com/woocommerce/storefront/blob/4.6.2/inc/woocommerce/storefront-woocommerce-template-functions.php#L126-L143)).
  The advisory names Storefront as a theme that hard-codes the widget.
- The Mini-Cart block does not use the cart fragments API (the advisory above).

## Cart fragments on the checkout page

The script does not load on checkout by default (the widget is hidden there). The classic checkout returns its own
fragments in the `update_order_review` response through `woocommerce_update_order_review_fragments`
([class-wc-ajax.php L377, L494](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L377));
those requests are covered in [checkout-requests.md](checkout-requests.md). If `get_refreshed_fragments` does fire on
checkout, something enqueues the script there: find it before changing anything.

## What to measure

- In a HAR of one page view per page type (home, category, product, cart, checkout), count
  `wc-ajax get_refreshed_fragments` with `scripts/har-summary.mjs`, with an empty cart and with one item.
- In the access log, the share and the p95 time of `wc-ajax get_refreshed_fragments` with
  `scripts/access-log-timings.mjs`. Many calls with a slow p95 load PHP workers that checkouts also need.
- Who enqueues it: Query Monitor's Scripts panel lists each enqueued script with its dependencies and dependents
  ([Query Monitor](https://wordpress.org/plugins/query-monitor/)).
- Callbacks on `woocommerce_add_to_cart_fragments`: `scripts/checkout-state.php` lists them. Each one runs on every
  fragments request.

## Options

All three are changes: take the backup and follow the undo in
[changes-and-rollback.md](changes-and-rollback.md#cart-fragments).

1. Replace the classic Cart widget (or a theme's header cart) with the Mini-Cart block, which the advisory recommends.
2. Stop the script from running outside WooCommerce pages with the `woocommerce_get_script_data` filter snippet in the
   advisory. The file still loads, but without its parameters it exits at once
   ([cart-fragments.js L4-L7](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/frontend/cart-fragments.js#L4-L7);
   the filter is applied in [class-wc-frontend-scripts.php L795](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-frontend-scripts.php#L795)
   and a falsy result skips the parameters at [L593](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-frontend-scripts.php#L593)).
   The advisory's caveats apply: custom pages outside `is_woocommerce()`, cart and checkout stop updating the mini cart,
   and cached pages may show a stale mini cart.
3. Remove the code that enqueues it without a mini cart on the page (a theme or plugin found in the step above).
