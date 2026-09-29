# Caches and the lookup table that can serve an old price

Read this for step 6 of the procedure, and whenever the database is right and a page or a list is wrong.
WooCommerce links point at the 11.1.2 tag, WordPress links at the 7.1.2 tag.

## Layers, from the database out

| Layer | Holds | Stale when | Cleared by | Source |
| --- | --- | --- | --- | --- |
| `wc_product_meta_lookup` row | `min_price`, `max_price` (from `_price`), `onsale` | `_price` changed without a lookup refresh | The sale handlers (10.8.0 and later), a CRUD save that changes a tracked prop, `refresh_product_lookup_table()`, the "Product lookup tables" tool | below |
| `wc_products_onsale` transient | IDs of products and parents on sale, from the lookup table | Not deleted after `onsale` changed | `wc_delete_product_transients()`, the daily run | [wc-product-functions.php L197-L213](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L197-L213) |
| `wc_var_prices_<id>` transient | A variable product's price arrays | Built before a variation's sale changed | `wc_delete_product_transients()` | [variable-products.md](variable-products.md#the-price-transient) |
| Object cache, group `post_meta` | Each post's meta, `_price` included | Meta changed by SQL outside WordPress | `update_post_meta()` and friends delete the entry; a direct SQL update does not | [meta.php L324-L329, L673-L678](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/meta.php#L673-L678) |
| Product instance cache (`product_objects` group) | Whole product objects | Within one request only | Non-persistent group; cleared on save | [ProductCacheController.php L113-L114](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Caches/ProductCacheController.php#L113-L114); [clear_caches L1160-L1181](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1160-L1181) |
| Page cache, CDN | Rendered product, shop and category pages | Page stored before the sale boundary | The cache's own purge | below |

## The product lookup table

- Columns that matter here: `min_price`, `max_price` and `onsale`
  ([class-wc-install.php L1985-L2009](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1985-L2009)).
- Per-product refresh: `min_price` is the first `_price` row, `max_price` the last, and `onsale` is 1 when
  `_sale_price` is set and `_price` equals it
  ([get_data_for_lookup_table L2510-L2524](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L2510-L2524)).
  `onsale` never looks at the dates: it copies whatever `_price` says.
- The catalog's price sorting and the price filter read `min_price` and `max_price`
  ([class-wc-query.php L776-L842](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-query.php#L776-L842));
  "on sale" lists read `onsale`
  ([get_on_sale_products L1196-L1235](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1196-L1235)).
- A CRUD save refreshes the row only when a tracked prop changed, and `price` is not tracked
  ([L931-L937](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L931-L937)).
  In 10.5.0 to 10.7.x the sale handlers therefore left the row stale until a manual save; 10.8.0 added the refresh
  ([PR 63856](https://github.com/woocommerce/woocommerce/pull/63856),
  [changelog](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L627)) and wrapped it in the
  public `refresh_product_lookup_table( $product_id )`
  ([L953-L955](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L953-L955);
  [PR 64093](https://github.com/woocommerce/woocommerce/pull/64093)).
- The whole-table tool (WooCommerce > Status > Tools > "Product lookup tables", id
  `regenerate_product_lookup_tables`) queues one Action Scheduler action per column, or runs them inline under WP-CLI
  ([tools controller L150-L155, L605-L610](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-tools-v2-controller.php#L605-L610);
  [wc_update_product_lookup_tables L1959-L2008](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L1959-L2008)).
  Its `min_max_price` and `onsale` columns are computed from `_price` too
  ([L2047-L2065, L2129-L2157](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L2129-L2157)),
  so it repeats a wrong `_price`. Fix `_price` first.

## The price reconciler (11.1.0 and later)

- `ScheduledSalePriceReconciler` filters `woocommerce_product_get_price` at priority 99 and, in view context only,
  returns the sale price when the window is open but the stored price equals the regular price, and the regular price
  when the window is closed but the stored price equals the sale price. It writes nothing
  ([ScheduledSalePriceReconciler.php L29-L112](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ScheduledSalePriceReconciler.php#L29-L112);
  registered in [class-woocommerce.php L429](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L429);
  [PR 65551](https://github.com/woocommerce/woocommerce/pull/65551)).
- It steps aside when another callback already changed the price (currency switchers, dynamic pricing), when the
  product has no sale price or no dates, and when the stored price matches neither price (same lines).
- It does not cover the lookup table, the variable parent's transient, or code that reads `_price` from the database.
  On 11.1.x a product page and the cart can therefore be right while sorting, filtering, "on sale" lists, feeds and
  the parent's range are wrong. That split is a sign of a stale `_price`, not of a page cache.
- Before 11.1.0 the view price is the stored `_price`, so the product page and the cart show and charge the stale
  price ([issue 64542](https://github.com/woocommerce/woocommerce/issues/64542)).

## Object cache

- `get_post_meta()` reads the object cache group `post_meta` first
  ([meta.php L673-L678](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/meta.php#L673-L678)),
  and `update_metadata()` deletes the entry after a changed row
  ([L324-L329](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/meta.php#L324-L329)).
- An SQL `UPDATE` on `postmeta` from outside WordPress (an ERP, a migration, a manual query) leaves the cached meta in
  a persistent object cache, and WordPress keeps reading the old `_price` until that entry expires or is deleted.
  The fix is to write through WordPress, or to delete the cache entry for those posts.
- `wp cache type` names the object cache in use
  ([WP-CLI](https://developer.wordpress.org/cli/commands/cache/type/)).
- The product instance cache added in 10.5.0 is a non-persistent group, so it lives for one request
  ([ProductCacheController.php L113-L114](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Caches/ProductCacheController.php#L113-L114)).
  It is turned on for new installs ([class-wc-install.php L393, L1363-L1366](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1363-L1366)).
  A long request (the daily run on a big catalog) holds its objects for the whole run; PR 68016 releases them per
  batch in 11.3.0 ([PR 68016](https://github.com/woocommerce/woocommerce/pull/68016)).

## Page caches

- WooCommerce's caching guide lists cart, my account and checkout as the pages to exclude from caching
  ([caching guide](https://developer.woocommerce.com/docs/best-practices/performance/configuring-caching-plugins/)).
  Product, shop and category pages are not on that list, so a page cache can serve them as they were rendered, old
  price included, until the page expires or is purged.
- When the sale handlers save a product whose post fields did not change, WooCommerce does not call
  `wp_update_post()`, so `save_post` does not fire. It calls `clean_post_cache()` and fires
  `woocommerce_update_product`
  ([class-wc-product-data-store-cpt.php L323-L398](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L323-L398)).
  A cache plugin that purges only on `save_post` or on post status changes does not purge at a sale boundary.
  Check which hooks the store's cache plugin purges on (its documentation or code), and whether category and shop
  pages, which also show the price, are purged with the product.
- Check a page, without changing anything: request it twice and read the `Age` header and any cache-hit header; an
  `Age` greater than the time since the boundary means the page was stored before it
  ([RFC 9111 section 5.1](https://www.rfc-editor.org/rfc/rfc9111#section-5.1)).

## WooCommerce's own transient tool

WooCommerce > Status > Tools > "WooCommerce transients" (id `clear_transients`) calls `wc_delete_product_transients()`
without a product ID, plus other shop, attribute and filter transients
([tools controller L130-L134, L535-L558](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-tools-v2-controller.php#L535-L558)).
Without an ID that function deletes the fixed-name transients (`wc_products_onsale`, `wc_featured_products` and the
stock counts) and no per-product transient, because the ID list is filtered to non-zero IDs
([ProductUtil.php L35-L68](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Utilities/ProductUtil.php#L35-L68)).
It does not clear `wc_var_prices_<id>`. The per-product call in [fixes-and-rollback.md](fixes-and-rollback.md) does.
