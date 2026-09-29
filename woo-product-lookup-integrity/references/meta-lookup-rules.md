# How WooCommerce writes `{prefix}wc_product_meta_lookup`

Read this before judging a `meta.*` row in the report. It gives, column by column, what WooCommerce 11.1.2 writes and
from which post meta, so each check in `scripts/lookup-checks.sql` can be traced to the code. Links point at the
11.1.2 tag.

## Two writers with different rules

1. Product save: `WC_Data_Store_WP::update_lookup_table()` builds the row with `get_data_for_lookup_table()` and
   writes it with `$wpdb->replace()`. It skips the write when the new data equals the copy it cached under the key
   `lookup_table` in the object cache group `object_<id>`
   ([class-wc-data-store-wp.php L603-L623](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-data-store-wp.php#L603-L623)).
   A save calls it only when one of these properties changed: `sku`, `global_unique_id`, `regular_price`,
   `sale_price`, `date_on_sale_from`, `date_on_sale_to`, `total_sales`, `average_rating`, `stock_quantity`,
   `stock_status`, `manage_stock`, `downloadable`, `virtual`, `tax_status`, `tax_class`, plus `cogs_value` while Cost
   of Goods Sold is on
   ([class-wc-product-data-store-cpt.php L931-L937](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L931-L937)).
   Other callers: stock and sales updates
   ([L1749-L1767, L1783-L1836, L1860-L1900](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1783-L1836)),
   variable price and stock syncs
   ([class-wc-product-variable-data-store-cpt.php L861-L912, L921-L955](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L921-L955)),
   grouped price sync
   ([class-wc-product-grouped-data-store-cpt.php L90-L98](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-grouped-data-store-cpt.php#L90-L98)),
   and, since 10.8.0, `refresh_product_lookup_table()`
   ([L947-L955](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L947-L955)),
   which the product editor calls for external products
   ([class-wc-meta-box-product-data.php L465-L490](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/meta-boxes/class-wc-meta-box-product-data.php#L465-L490)).
2. Regeneration: `wc_update_product_lookup_tables()` inserts a row with only `product_id` for every post of type
   `product` or `product_variation`, whatever its status (`INSERT IGNORE`, so existing rows stay), then fills each
   column with one `UPDATE ... JOIN postmeta` per column
   ([wc-product-functions.php L1959-L2033](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L1959-L2033);
   [L2041-L2164](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L2041-L2164)).
   `references/regeneration.md` covers how it runs.

Neither writer deletes rows of products that no longer exist. The row goes when WordPress deletes the post: the
`delete_post` action runs `WC_Post_Data::delete_post_data()`, which calls `delete_from_lookup_table()` for products and
variations
([class-wc-post-data.php L62, L407-L432](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-post-data.php#L407-L432);
[class-wc-data-store-wp.php L632-L651](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-data-store-wp.php#L632-L651)).
Trashing keeps the row
([trash_post L469-L497](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-post-data.php#L469-L497)).
A product removed with SQL, outside WordPress, leaves its row behind.

## Column by column

"Save" is `get_data_for_lookup_table()`
([class-wc-product-data-store-cpt.php L2510-L2541](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L2510-L2541)).
"Regeneration" is `wc_update_product_lookup_tables_column()` and the rating count batch
([wc-product-functions.php L2041-L2234](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L2041-L2164)).

| Column | Save writes | Regeneration writes | How the SQL check compares |
| --- | --- | --- | --- |
| `sku` | `_sku` (`''` when missing) | `_sku` (NULL when missing) | Byte for byte, NULL and `''` equal |
| `global_unique_id` | `_global_unique_id`, only while `woocommerce_schema_version` is 920 or more | `_global_unique_id` | Same |
| `virtual`, `downloadable` | 1 when `_virtual` / `_downloadable` is `yes`, else 0 | Same rule | 0 or 1 against the meta |
| `min_price`, `max_price` | First and last `_price` rows, in the order `get_post_meta()` returns them | `MIN` and `MAX` of the non-empty `_price` rows as numbers; unchanged when there is none | Against `MIN` and `MAX` of non-empty `_price`, to 4 decimals; products without any go to `meta.no_price` |
| `onsale` | 1 when `_sale_price` is set and equals `_price` after `wc_format_decimal()` | 1 when `_price` is 0 or more, `_sale_price` is not empty, equals `_price`, and `_regular_price` is higher, at the store's price decimals | Stale only when the value matches neither rule |
| `stock_quantity` | `wc_stock_amount( _stock )` when `_manage_stock` is `yes` (an integer by default), else NULL | `_stock` where `_manage_stock` is `yes`; other rows unchanged | Managed: equal to `_stock` or its integer part. Not managed and not NULL: `stock_quantity_unmanaged` |
| `stock_status` | `_stock_status` | `_stock_status` | Byte for byte |
| `rating_count` | Sum of the `_wc_rating_count` array | Same sum, for rows whose meta is not empty; others unchanged | SQL cannot unserialize: it flags 0 against set counts and non-zero against empty ones (`rating_count_suspect`); `lookup-product-diff.php` compares the sum |
| `average_rating` | `_wc_average_rating` | Same | To 2 decimals, empty as 0 |
| `total_sales` | `total_sales` meta | Same | As whole numbers, empty as 0 |
| `tax_status`, `tax_class` | `_tax_status`, `_tax_class` | Same | Byte for byte, NULL and `''` equal |

Sources for the helper functions in the table: `wc_stock_amount()` passes the value through the filter
`woocommerce_stock_amount`, which WooCommerce sets to `intval`
([wc-formatting-functions.php L492-L501](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L492-L501);
[wc-core-functions.php L46](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L46)).
The regeneration's `onsale` rule compares at `wc_get_price_decimals()`
([wc-product-functions.php L2129-L2157](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L2129-L2157));
its use of `_regular_price` came in 8.8.0
([changelog L5761](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L5761)).

## Prices of variable and grouped products

- A variable product's `_price` rows are one per distinct price of its visible variations, added in ascending order,
  and its own `_sale_price` and `_regular_price` are deleted
  ([class-wc-product-variable-data-store-cpt.php L921-L955](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L921-L955)).
  So its `min_price` and `max_price` are the cheapest and dearest visible variation, and both `onsale` rules give 0.
- Visible variations are the published ones, without out-of-stock ones when the store hides out-of-stock items
  ([L188-L227](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L188-L227)).
  A variable product whose variations are all disabled has no `_price`; `meta.no_price` lists it, and that is expected.
- A grouped product stores two `_price` rows, the lowest and highest child price
  ([class-wc-product-grouped-data-store-cpt.php L90-L98](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-grouped-data-store-cpt.php#L90-L98)).

## How rows go stale

| Cause | What happens | Source |
| --- | --- | --- |
| Code writes post meta directly (`update_post_meta`, SQL, an import tool) instead of through the product objects | Nothing updates the row. WooCommerce's 3.6 notes say the table stays in sync "provided that" plugins use the CRUD classes and data stores | [performance improvements in 3.6](https://developer.woocommerce.com/2019/04/01/performance-improvements-in-3-6/) |
| `_price` is empty while `_regular_price` is set | A save does not rebuild `_price` unless a price, a sale date or the product type changed, and the regeneration leaves `min_price` and `max_price` as they were; the product loses its Add to cart button. Closed as not planned on 2026-09-11 | [issue 68605](https://github.com/woocommerce/woocommerce/issues/68605); [class-wc-product-data-store-cpt.php L853-L880](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L853-L880) |
| A plain "Update" with no changed lookup property | The row is not rewritten, so a missing or edited row stays as it is | L931-L937 above |
| The row changed or vanished outside WordPress while the object cache still holds the last written copy | The next save with the same data skips the write (the cache comparison above) | [class-wc-data-store-wp.php L613-L622](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-data-store-wp.php#L613-L622) |
| A product deleted with SQL | The row stays: only the `delete_post` action removes it | above |
| Scheduled sales before 10.8.0 | Fixed in 10.8.0: "scheduled sale actions leaving lookup table data stale" | [changelog L627](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L627) |
| Stock not managed after a regeneration | `stock_quantity` keeps an old number, since the regeneration only writes managed rows | [wc-product-functions.php L2066-L2079](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L2066-L2079) |
