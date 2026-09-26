# Page cache, object cache and transients

Read this for step 7 of the procedure. WooCommerce links point at the 11.1.2 tag, WordPress links at the 7.1.2 tag.

## What must never come from a page cache

- The cart, checkout and my-account pages show one customer's data and must stay dynamic; caching layers must exclude
  them, and WooCommerce lists the cookies a cache can key on: `woocommerce_cart_hash`, `woocommerce_items_in_cart`,
  `wp_woocommerce_session_*`, `woocommerce_recently_viewed`, `store_notice*`
  ([WooCommerce caching guide](https://developer.woocommerce.com/docs/best-practices/performance/configuring-caching-plugins/)).
  The checkout page also serves the order-pay and order-received endpoints.
- The same guide's Varnish example passes `/cart`, `/my-account`, `/checkout`, `?add-to-cart=` and `wc-api` requests
  to the origin, and asks database caches to skip `_wc_session_` queries.
- Requests that are never cacheable by design: `?wc-ajax=` endpoints, which send no-cache headers
  ([class-wc-ajax.php L98-L110](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L98-L110)),
  and Store API cart and checkout routes, which send `Cache-Control: no-store`
  ([AbstractCartRoute.php L153-L164](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/AbstractCartRoute.php#L153-L164)).
  An edge or CDN rule that caches them anyway serves one shopper's cart to another.

## What WooCommerce itself sends

- On the pages set as cart, checkout and my account (by page ID), WooCommerce defines `DONOTCACHEPAGE`,
  `DONOTCACHEOBJECT` and `DONOTCACHEDB` and merges WordPress's no-cache headers into `Cache-Control` through the
  `wp_headers` filter at priority 5 (since 10.1.0; before, on the `wp` action)
  ([class-wc-cache-helper.php L29-L38, L49-L123, L275-L280](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cache-helper.php#L49-L123)).
- For logged-out visitors it drops `no-store` from that header so the browser's back/forward cache can keep the page;
  `private` still keeps it out of shared caches
  ([L85-L117](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cache-helper.php#L85-L117)).
- WordPress's no-cache header set is `Cache-Control: no-cache, must-revalidate, max-age=0, no-store, private` with an
  `Expires` date in 1984 ([functions.php L1508-L1530](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L1508-L1530)).
- The constants only work with cache plugins that read them, and the headers only with caches that honour
  `Cache-Control` from the origin. A host or CDN page cache may keep its own rule list; check it.
- The page-ID check means a checkout block placed on some other page gets none of this
  ([L62-L65](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cache-helper.php#L62-L65)).
  Set that page as the checkout page in WooCommerce > Settings > Advanced, or exclude it in the cache by path.

## Checking it (read-only)

- `scripts/checkout-state.php` prints the paths of the cart, checkout and my-account pages. Compare them with the page
  cache's exclusion list.
- In the browser, with an item in the cart: the checkout document's response headers (DevTools Network panel) show
  `Cache-Control` with `private` or `no-store`, and no cache-hit header from the host or CDN.
- For the cart and my-account pages without a cart, `curl -sI https://<store>/cart/` shows the same headers. Run it a
  few times: an `Age` header, which a cache adds to a stored response
  ([RFC 9111 section 5.1](https://www.rfc-editor.org/rfc/rfc9111#section-5.1)), or a hit status on the second run means
  the page is cached.
- Two browser profiles, each with a different test cart, must each see their own cart on the cart and checkout pages.

## Object cache

- WordPress's default object cache lasts one request; a persistent object cache (a drop-in for Redis, Memcached or
  similar) keeps it across requests, and Query Monitor's Overview says "External object cache not in use" without one
  ([how to use Query Monitor](https://querymonitor.com/docs/how-to-use)). `wp_using_ext_object_cache()` reports it
  ([load.php L810-L820](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L810-L820)),
  and `wp cache type` names the implementation ([WP-CLI](https://developer.wordpress.org/cli/commands/cache/type/)).
- Site Health (since 6.1.0) suggests a persistent object cache on multisite, or when autoloaded options exceed 500 rows
  or 100,000 bytes, or when comments, options, posts, terms or users reach 1,000 rows (filter
  `site_status_persistent_object_cache_thresholds`)
  ([class-wp-site-health.php L3756-L3829](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3756-L3829)).
  A posts table with 1,000 rows (products, pages, revisions and, on posts storage, orders) already meets it. The state
  helper prints the autoload numbers; it does not run the Site Health check itself, because creating the Site Health
  object schedules an event
  ([class-wp-site-health.php L37-L57](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L37-L57)).
- "HPOS Data Caching" (`hpos_datastore_caching`, not experimental in 11.1.2, off by default) caches order data in the
  data store and is described as recommended for stores using object caching
  ([FeaturesController.php L400-L412](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L400-L412)).
  Turning it on is a change with its own test pass.

### Sessions and the object cache

WooCommerce writes session data to the table and the object cache, and reads the cache first
([class-wc-session-handler.php L551-L578, L656-L680](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L656-L680)).
If the store runs on several web servers and each has its own object cache (for example APCu per server), a request on
another server can read an older copy of the cart from its cache. The persistent object cache of a multi-server store
has to be shared by every server.

### Database query caches

WooCommerce shows an admin notice when W3 Total Cache's database cache is on without `_wc_session_` in its ignored
query stems ([class-wc-cache-helper.php L285-L306](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cache-helper.php#L285-L306)).
The same rule applies to any cache of SQL results: session queries must bypass it (the caching guide above).

## Transients

- Without a persistent object cache, a transient is two rows in the options table: the value and, when it has an
  expiration, a `_transient_timeout_` row. With an expiration both rows are not autoloaded; without one the value is
  autoloaded. With a persistent object cache, transients go to the cache group `transient` instead
  ([option.php L1541-L1570](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1541-L1570)).
- An expired transient is deleted when code reads it
  ([get_transient L1431-L1492](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1431-L1492)),
  and by the daily event `delete_expired_transients`, which WordPress schedules from admin page loads
  ([admin.php L111-L114](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/admin.php#L111-L114)).
  That function does nothing while a persistent object cache is in use
  ([option.php L1638-L1687](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1638-L1687)).
- Autoloaded rows are those whose `autoload` is `yes`, `on`, `auto-on` or `auto` (WordPress 6.6 and later)
  ([option.php L3259-L3275](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L3259-L3275)).
  Transients saved without an expiration are loaded on every request; the SQL report lists the largest.
- WooCommerce > Status > Tools has "WooCommerce transients" (clears product and shop transients) and "Expired
  transients" (deletes every expired transient, `wc_delete_expired_transients()`)
  ([tools controller L130-L139, L533-L563](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-tools-v2-controller.php#L533-L563);
  [wc-core-functions.php L2324-L2345](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L2324-L2345)).
  Both are changes; see [changes-and-rollback.md](changes-and-rollback.md#transients).
- Read-only WP-CLI: `wp transient type` (database or object cache), `wp transient list --format=count`
  ([transient type](https://developer.wordpress.org/cli/commands/transient/type/);
  [transient list](https://developer.wordpress.org/cli/commands/transient/list/)).
- A deeper audit of autoloaded options belongs to the `wp-autoload-audit` skill in this collection.

| Result from the SQL report | Meaning |
| --- | --- |
| Thousands of expired transients | The daily event is not running (admin never visited, WP-Cron stalled) or plugins create transients faster than it removes them |
| Large autoloaded transients | Transients saved without expiration; every request loads them |
| Transient rows while `wp transient type` says object cache | Leftovers from before the object cache; they are no longer read |
