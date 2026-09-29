# The product lookup tables in WooCommerce 11.1.2

Read this first, and whenever the report's index block or a column name looks unfamiliar. Code links point at the
WooCommerce 11.1.2 tag, WordPress links at 7.1.2.

## Which lookup tables exist, and which this skill checks

WooCommerce lists its tables in `WC_Install::get_tables()`
([class-wc-install.php L2153-L2200](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L2153-L2200)).
The ones with "lookup" in the name:

| Table | Holds | Checked here |
| --- | --- | --- |
| `{prefix}wc_product_meta_lookup` | One row per product and variation: SKU, prices, stock, ratings, sales, tax, flags | Yes |
| `{prefix}wc_product_attributes_lookup` | One row per product or variation and attribute term, for attribute filters | Yes |
| `{prefix}wc_category_lookup` | Pairs of `category_tree_id` and `category_id` ([schema L2134-L2138](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L2134-L2138)), kept by a class described as keeping "the product category lookup table in sync" ([CategoryLookup.php L1-L4](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/CategoryLookup.php#L1-L4)) and read by Analytics segmenting ([Segmenter.php L192-L194](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Admin/API/Reports/Products/Stats/Segmenter.php#L192-L194)) | No: it describes the category tree, not products |
| `{prefix}wc_order_product_lookup`, `wc_order_tax_lookup`, `wc_order_coupon_lookup`, `wc_customer_lookup` | Analytics order data ([get_tables L2184-L2191](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L2184-L2191)) | No: order data |

Sizing these tables and their queries belongs to the `wp-slow-query-investigation` skill; this skill checks whether
their rows are correct.

## Where the product data lives

- WooCommerce 11.1.2 maps the `product`, `product-grouped`, `product-variable` and `product-variation` data stores to the post-based
  classes `WC_Product_Data_Store_CPT` and its children
  ([class-wc-data-store.php L50-L53](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-data-store.php#L50-L53)).
  The filter `woocommerce_data_stores` can swap them
  ([L82](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-data-store.php#L82)).
- So the source of truth for both lookup tables is `{prefix}posts` (products and `product_variation` posts),
  `{prefix}postmeta`, and the term tables: `term_relationships` links a post to a `term_taxonomy` row, which names the
  taxonomy and the term ([WordPress schema.php L65-L91](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L65-L91);
  postmeta [L150-L158](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L150-L158)).
- The attribute lookup's "optimized" code reads those tables directly, and runs only when the product data store is
  `WC_Product_Data_Store_CPT` or a subclass
  ([LookupDataStore.php L80-L86](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L80-L86)).
  A store that replaced the product data store is outside what the SQL checks can judge; use
  `scripts/lookup-product-diff.php`, which reads through the product objects.

## `{prefix}wc_product_meta_lookup`

Schema ([class-wc-install.php L1985-L2009](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1985-L2009)):

| Column | Type and default |
| --- | --- |
| `product_id` | `bigint(20)`, primary key |
| `sku`, `global_unique_id` | `varchar(100)`, default `''` |
| `virtual`, `downloadable`, `onsale` | `tinyint(1)`, default 0 |
| `min_price`, `max_price` | `decimal(19,4)`, default NULL |
| `stock_quantity` | `double`, default NULL |
| `stock_status` | `varchar(100)`, default `'instock'` |
| `rating_count`, `total_sales` | `bigint(20)`, default 0 |
| `average_rating` | `decimal(3,2)`, default 0.00 |
| `tax_status` | `varchar(100)`, default `'taxable'` |
| `tax_class` | `varchar(100)`, default `''` |

Indexes: `PRIMARY (product_id)`, `virtual`, `downloadable`, `stock_status`, `stock_quantity`, `onsale`,
`min_max_price (min_price, max_price)`, `sku (sku(50))` (same lines).

- An extra column `cogs_total_value DECIMAL(19,4)` exists only after the Status > Tools entry "Create COGS columns in
  the product meta lookup table" ran with the Cost of Goods Sold feature on
  ([CostOfGoodsSoldController.php L71-L119, L140-L150](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/CostOfGoodsSold/CostOfGoodsSoldController.php#L104-L119)).
  The SQL checks leave it out.
- What reads it, so what a stale row breaks:
  - the catalog price filter and the price, popularity and rating sorts
    ([class-wc-query.php L815-L882](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-query.php#L815-L882));
  - the product filter blocks' stock, price and tax clauses
    ([QueryClauses.php L137, L175-L185, L416-L426](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductFilters/QueryClauses.php#L416-L426));
  - Store API product queries by SKU, stock status and price
    ([ProductQuery.php L436-L507](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/ProductQuery.php#L436-L507));
  - the on-sale product list and SKU uniqueness checks
    ([class-wc-product-data-store-cpt.php L1215-L1225, L1284-L1296](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1284-L1296));
  - whether a variable product has a child with a given stock status, read from this table unless the option
    `woocommerce_product_lookup_table_is_generating` is set
    ([class-wc-product-variable-data-store-cpt.php L799-L816](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L799-L816)).

## `{prefix}wc_product_attributes_lookup`

Schema ([DataRegenerator.php L524-L541](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L524-L541)):

| Column | Meaning |
| --- | --- |
| `product_id` | The product, or the variation |
| `product_or_parent_id` | The product itself, or a variation's parent product |
| `taxonomy` | The attribute taxonomy, `varchar(32)`, for example `pa_colour` |
| `term_id` | The attribute term |
| `is_variation_attribute` | 1 for rows of variations, 0 for rows of products |
| `in_stock` | 1 or 0 |

Indexes: `PRIMARY (product_or_parent_id, term_id, product_id, taxonomy)`, `is_variation_attribute_term_id`,
`taxonomy_term_id_in_stock_product_or_parent_id`, `product_id` (same lines). The primary key arrived in 6.4.0
([changelog L9107](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L9107);
[DataRegenerator.php L549-L561](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L549-L561)).
Without it the same row can be stored twice; the report's "repeating the same key" block counts such rows.

- It is part of WooCommerce's schema, so "Verify base database tables" creates it when it is missing
  ([class-wc-install.php L1784, L2034](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L2034);
  [L805-L822](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L805-L822)).
- Catalog filtering reads it only while `woocommerce_attribute_lookup_enabled` is `yes`
  ([Filterer.php L46-L48](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/Filterer.php#L46-L48)).
  The product filter blocks read it for attribute filters
  ([QueryClauses.php L269-L293, L591-L596](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductFilters/QueryClauses.php#L591-L596)).
- `in_stock` matters only while out-of-stock items are hidden: the filter adds `in_stock = 1` when
  `woocommerce_hide_out_of_stock_items` is `yes` (filter `woocommerce_product_attributes_filterer_hide_out_of_stock`)
  ([Filterer.php L81-L92, L276-L284](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/Filterer.php#L81-L92)).
- A missing row makes a product or variation disappear from the attribute filter and its counts; an extra row makes
  a filter offer a term the shopper cannot buy. Issue
  [68112](https://github.com/woocommerce/woocommerce/issues/68112) describes the first,
  [PR 68482](https://github.com/woocommerce/woocommerce/pull/68482) the second for disabled variations.

## Settings and options

| Option | Set by | Meaning | Source |
| --- | --- | --- | --- |
| `woocommerce_attribute_lookup_enabled` | Settings > Products > Advanced, "Enable table usage"; regeneration | Filters read the attributes table | [LookupDataStore.php L765-L773](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L765-L773) |
| `woocommerce_attribute_lookup_direct_updates` | Same screen, "Direct updates" (default off) | Product changes update the table in the request instead of through a scheduled action | [L775-L782](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L775-L782), [L153-L179](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L153-L179) |
| `woocommerce_attribute_lookup_optimized_updates` | Same screen, "Optimized updates" (default off) | Rows are built with direct SQL; the setting's text says it "may not be compatible with some extensions" and works only with products in the posts table | [L784-L792](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L784-L792) |
| `woocommerce_attribute_lookup_regeneration_in_progress`, `_regeneration_aborted`, `_last_product_id_to_process`, `_processed_count` | Full regeneration | Progress of a full regeneration | [DataRegenerator.php L125-L168](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L125-L168); [LookupDataStore.php L662-L702](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L662-L702) |
| `woocommerce_product_lookup_table_is_generating` | Meta lookup regeneration | Set when it starts, deleted after the last column (`tax_status`) | [wc-product-functions.php L1965, L2160-L2163](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L2160-L2163) |
| `woocommerce_schema_version` | Install, update, "Verify base database tables" | Below 920 the save path does not write `global_unique_id` | [class-wc-install.php L818](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L818); [class-wc-product-data-store-cpt.php L2537-L2539](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L2537-L2539) |

The Advanced section and these settings show only while the attributes table exists
([LookupDataStore.php L724-L730](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L724-L730)).
