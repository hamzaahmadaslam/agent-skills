# WooCommerce lookup tables and product queries

Read this when the slow queries come from shop pages, catalog sorting, price or attribute filters, or product search.
Links point at the WooCommerce 11.1.2 tag. WooCommerce creates and maintains these tables and their indexes; do not
add or drop indexes on them yourself. Orders are covered by the `woo-hpos-live-migration` skill (moving orders to
HPOS) and the `woo-checkout-performance-audit` skill (order table indexes) in this collection.

## The product meta lookup table

- WooCommerce 3.6 added lookup tables because sorting and filtering by several post meta values needs one join of
  `wp_postmeta` per value; the lookup table holds the same data in columns with indexes, synced when a product is
  saved ([performance improvements in 3.6](https://developer.woocommerce.com/2019/04/01/performance-improvements-in-3-6/)).
- Table `{prefix}wc_product_meta_lookup`: `product_id` (primary key), `sku`, `global_unique_id`, `virtual`,
  `downloadable`, `min_price`, `max_price`, `onsale`, `stock_quantity`, `stock_status`, `rating_count`,
  `average_rating`, `total_sales`, `tax_status`, `tax_class`; indexes on `virtual`, `downloadable`, `stock_status`,
  `stock_quantity`, `onsale`, `min_max_price (min_price, max_price)` and `sku(50)`
  ([class-wc-install.php L1985-L2009](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1985-L2009)).
- What uses it: the catalog's price filter and its sorting by price, popularity (`total_sales`) and rating join this
  table instead of post meta
  ([class-wc-query.php L776-L885](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-query.php#L776-L885));
  so do SKU lookups and the on-sale product list
  ([class-wc-product-data-store-cpt.php L1196-L1400](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1196-L1400)).
  The featured product list is a taxonomy query on `product_visibility` and does not use the table
  ([L1245-L1270](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1245-L1270)).
- When a product is saved, the data store updates its row only if a property the table holds changed: SKU, global
  unique ID, prices, sale dates, total sales, rating, stock, the virtual and downloadable flags, or tax settings
  ([class-wc-product-data-store-cpt.php L931-L937](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L931-L937)).
  WooCommerce > Status > Tools > "Product lookup tables" (Regenerate) rebuilds it: it inserts every product ID, then
  fills the columns through scheduled actions
  ([tools controller L150-L155](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-tools-v2-controller.php#L150-L155);
  [wc-product-functions.php L1959-L2033](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L1959-L2033)).
  The report compares its row count with the number of products and variations; a large gap is a reason to
  regenerate (a change, see [changes-and-rollback.md](changes-and-rollback.md#regenerate-the-woocommerce-product-lookup-table)).
- Code that bypasses it: a theme or plugin that sorts products with `'meta_key' => '_price'` or `'total_sales'` and
  `'orderby' => 'meta_value_num'`, or filters with a `meta_query` on `_price` or `_stock_status`, joins post meta and
  sorts every matching row ([query-patterns.md](query-patterns.md)). WooCommerce's documentation asks extensions to
  query products through `wc_get_products()` and `WC_Product_Query`, because custom `WP_Query` or SQL on product data
  is likely to break as the data moves to custom tables
  ([wc_get_products and product queries](https://developer.woocommerce.com/docs/features/products/wc-get-products/)).

## Product search

`WC_Product_Data_Store_CPT::search_products()`, behind the admin and Ajax product searches, matches each term with
`LIKE '%term%'` against the post title, excerpt and content and the lookup table's `sku` and `global_unique_id`
([class-wc-product-data-store-cpt.php L1988-L2145](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1988-L2145)).
A leading wildcard cannot use an index, so on a large catalog this search reads every product row
([B-tree index use](https://dev.mysql.com/doc/refman/8.4/en/index-btree-hash.html)). No index changes that; searching
by exact SKU, or a search service, does.

## The product attributes lookup table

- Rolled out in WooCommerce 6.3: one row per product or variation and attribute term, with its stock status, used to
  render the catalog and the filter-by-attribute widgets when filtering by attributes
  ([new product filtering in 6.3](https://developer.woocommerce.com/2022/02/02/new-product-filtering-by-attributes-rolling-out-in-woocommerce-6-3/)).
- Table `{prefix}wc_product_attributes_lookup`: `product_id`, `product_or_parent_id`, `taxonomy`, `term_id`,
  `is_variation_attribute`, `in_stock`; primary key `(product_or_parent_id, term_id, product_id, taxonomy)`; indexes
  `is_variation_attribute_term_id`, `taxonomy_term_id_in_stock_product_or_parent_id` and `product_id`
  ([DataRegenerator.php L524-L541](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L524-L541)).
- It is used only when the option `woocommerce_attribute_lookup_enabled` is `yes`
  ([Filterer.php L46-L48](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/Filterer.php#L46-L48)).
  When it is off, each chosen attribute filter becomes a tax query clause, with the `AND` operator for "and" filters
  ([class-wc-query.php L908-L925](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-query.php#L908-L925)),
  which WordPress runs as a correlated `COUNT` subquery per product ([query-patterns.md](query-patterns.md)).
- Settings, in WooCommerce > Settings > Products > Advanced
  ([LookupDataStore.php L72, L741-L799](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L741-L799)):
  - "Enable table usage" (`woocommerce_attribute_lookup_enabled`): use the table for catalog filtering.
  - "Direct updates" (`woocommerce_attribute_lookup_direct_updates`): update the table when a product is saved
    instead of in a deferred scheduled action.
  - "Optimized updates" (`woocommerce_attribute_lookup_optimized_updates`, WooCommerce 9.1 and later): faster update
    queries that the setting says may not be compatible with some extensions, and that apply only while products are
    stored as posts ([lookup table optimization](https://developer.woocommerce.com/2024/06/20/an-optimization-for-the-product-attributes-lookup-table-is-coming/)).
- WooCommerce keeps the table updated on product changes even while table usage is off
  ([new product filtering in 6.3](https://developer.woocommerce.com/2022/02/02/new-product-filtering-by-attributes-rolling-out-in-woocommerce-6-3/)).
- Regeneration: WooCommerce > Status > Tools > "Regenerate the product attributes lookup table", for one product or
  for all, the full run in scheduled batches of 100 products (filter `woocommerce_attribute_lookup_regeneration_step_size`)
  ([DataRegenerator.php L32, L231-L242, L294-L330](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L294-L330)).
  A full regeneration empties the table and turns table usage off until it finishes
  ([DataRegenerator.php L102-L130](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L102-L130)),
  so the catalog falls back to tax queries meanwhile; WooCommerce recommends the tool only when support asks for it
  ([new product filtering in 6.3](https://developer.woocommerce.com/2022/02/02/new-product-filtering-by-attributes-rolling-out-in-woocommerce-6-3/)).
- WP-CLI (WooCommerce 9.1 and later): `wp wc palt info` prints the table name, whether usage is on, and its rows and
  products, and changes nothing; `enable`, `disable`, `regenerate`, `regenerate_for_product` and the abort and resume
  commands are changes
  ([CLIRunner.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/CLIRunner.php);
  [lookup table optimization](https://developer.woocommerce.com/2024/06/20/an-optimization-for-the-product-attributes-lookup-table-is-coming/)).

## Orders

On posts storage, order data sits in `wp_posts` and `wp_postmeta`; High-Performance Order Storage moves it into
dedicated tables with their own indexes
([HPOS overview](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/)). A slow
order query on posts storage is often a reason to plan the HPOS migration with the `woo-hpos-live-migration` skill
rather than to add indexes to `wp_postmeta`.
