# How WooCommerce stores a sale and decides the price

Read this before any other file: every check in the skill compares these stored values with these rules. Code links
point at the WooCommerce 11.1.2 tag unless a line says otherwise.

## The five meta keys

| Meta key | Product prop | What it holds | Source |
| --- | --- | --- | --- |
| `_regular_price` | `regular_price` | The regular price, as a decimal string | [read_product_data L447-L457](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L447-L457) |
| `_sale_price` | `sale_price` | The sale price, as a decimal string, or nothing | same |
| `_sale_price_dates_from` | `date_on_sale_from` | Sale start, a Unix timestamp (UTC seconds), or nothing | same; written at [L764-L767](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L764-L767) with `getTimestamp()` |
| `_sale_price_dates_to` | `date_on_sale_to` | Sale end, a Unix timestamp (UTC seconds), or nothing | same |
| `_price` | `price` | The active price that is stored, sorted and filtered on | same |

- All five are internal meta keys of the product data store, so they do not appear as custom fields
  ([L36-L44](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L36-L44)).
- `_price` is read into the `price` prop, but it is not in the list of keys `update_post_meta()` writes from props
  ([L706-L713](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L706-L713)).
  WooCommerce writes it in `handle_updated_props()` (next section) and in the scheduled-sale code
  ([scheduled-events.md](scheduled-events.md)).
- When CRUD saves an empty value, the meta row is deleted rather than stored empty, except for keys the store marks as
  "must exist" (`_tax_class` only for products)
  ([class-wc-data-store-wp.php L258-L266](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-data-store-wp.php#L258-L266);
  [L90-L92](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L90-L92)).
  An empty `_sale_price` row (`''`) therefore comes from direct meta writes, importers, or the `update_post_meta()`
  call in `handle_updated_props()` below.
- Variations use the same keys on the `product_variation` post
  ([class-wc-product-variation-data-store-cpt.php L370-L371](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variation-data-store-cpt.php#L370-L371)).
  A variable or grouped parent derives its `_price` from its children ([variable-products.md](variable-products.md)).
- The product type is the `product_type` taxonomy term (`simple`, `grouped`, `external`, `variable`)
  ([class-wc-post-types.php L66-L67](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-post-types.php#L66-L67)).
  Variations have no `product_type` term; the SQL checks treat a missing term on a `product_variation` post as a
  variation.

## When a CRUD save writes `_price`

`handle_updated_props()` runs after every CRUD save of a product that is not variable or grouped
([L853-L881](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L853-L881)):

1. If `regular_price` or `sale_price` changed and the sale price is not below the regular price, it empties
   `_sale_price` (with `update_post_meta( ..., '' )`, so an empty row stays) and the prop.
2. If any of `date_on_sale_from`, `date_on_sale_to`, `regular_price`, `sale_price` or `product_type` changed, it sets
   `_price` to the sale price when `is_on_sale( 'edit' )` is true, else to the regular price.
3. A save that changes none of those props leaves `_price` alone. The code comment explains why `price` itself is
   not a trigger: `_price` "can also be set as a temporary active price for a product", and WooCommerce does not want
   to override it (same lines, the comment at L865-L869).

So re-saving a product whose meta did not change does not repair a stale `_price`. The repair steps in
[fixes-and-rollback.md](fixes-and-rollback.md) call the scheduled-sale handlers instead.

After the price handling, the lookup table row is refreshed when one of its tracked props changed; `price` is not in
that list ([L931-L937](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L931-L937)).

## When a product is on sale

`WC_Product::is_on_sale()` ([abstract-wc-product.php L1794-L1809](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-product.php#L1794-L1809)):

- true when the sale price is not empty and the regular price is greater than the sale price,
- then false again when a start date is set and is later than `time()`, or an end date is set and is earlier than
  `time()`;
- in `view` context the result passes through the filter `woocommerce_product_is_on_sale`.

This is a live check against the clock on every call. `_price` changes only when something writes it. The gap between
the two is what this skill audits.

- The price HTML shows the regular price struck through next to the active price when `is_on_sale()` is true, and the
  active price alone otherwise; the active price is `get_price()`, the `price` prop
  ([get_price_html L2050-L2060](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-product.php#L2050-L2060)).
  A stale `_price` shows as "regular struck through next to the same regular price" at a missed start, or a sale
  price without the strike at a missed end.
- Since 11.1.0 a `woocommerce_product_get_price` filter corrects the view-context price of simple products during
  that gap ([caches-and-lookup.md](caches-and-lookup.md#the-price-reconciler-1110-and-later)). The stored `_price`,
  the lookup table and the variable parent's cached range stay as they are.
- Variations re-derive their `price` prop from `is_on_sale( 'edit' )` every time they are read
  ([class-wc-product-variation-data-store-cpt.php L421-L425](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variation-data-store-cpt.php#L421-L425)),
  so a variation's displayed price follows the dates even when its `_price` meta is stale. Its `_price` meta still
  feeds the parent's range and the lookup table.

## How dates reach the meta

| Path | What it stores | Source |
| --- | --- | --- |
| Product editor (classic), simple and variations | Start `Y-m-d 00:00:00` and end `Y-m-d 23:59:59`, read in the site timezone, stored as UTC timestamps | [class-wc-meta-box-product-data.php L354-L371, L553-L570](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/meta-boxes/class-wc-meta-box-product-data.php#L354-L371); the field tip at [html-product-data-general.php L98](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/meta-boxes/views/html-product-data-general.php#L98) |
| Quick Edit (11.1.0 and later, simple and external) | Same `00:00:00` and `23:59:59` shape | [class-wc-admin-post-types.php L467-L503](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/class-wc-admin-post-types.php#L467-L503); [11.1.0 changelog](https://github.com/woocommerce/woocommerce/blob/11.1.0/plugins/woocommerce/readme.txt#L180) |
| Bulk Edit, any price change | Clears both dates | [L632-L642](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/class-wc-admin-post-types.php#L632-L642); [issue 66696](https://github.com/woocommerce/woocommerce/issues/66696) |
| REST API v2/v3 `date_on_sale_from` / `_to` | Site-timezone date-time strings, converted to UTC | [class-wc-rest-products-v2-controller.php L1266-L1280](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-products-v2-controller.php#L1266-L1280); schema text at [L1961-L1980](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-products-v2-controller.php#L1961-L1980) |
| REST API `date_on_sale_from_gmt` / `_to_gmt` | Read with `strtotime()` as UTC | same lines |
| CSV importer | A Unix timestamp as UTC; any other `strtotime()` string passed on as is, so a date-only value means 00:00:00 site time, for the end date too | [class-wc-product-csv-importer.php L616-L642, L797-L798](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/import/class-wc-product-csv-importer.php#L616-L642); open [PR 66634](https://github.com/woocommerce/woocommerce/pull/66634) proposes 23:59:59 for date-only end values |
| Direct `update_post_meta()` | Whatever the caller writes; nothing checks it | [scheduled-events.md](scheduled-events.md#how-per-product-events-get-scheduled) |

The conversion rules themselves are in [timezones-and-dates.md](timezones-and-dates.md).

## Where each value is read

| Reader | Reads | Source |
| --- | --- | --- |
| Product page and loop price HTML | `price` prop (from `_price`, or re-derived for variations) and `is_on_sale()` | [L2050-L2060](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-product.php#L2050-L2060) |
| Catalog sort by price and the price filter | `wc_product_meta_lookup.min_price` / `max_price` | [class-wc-query.php L776-L842](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-query.php#L776-L842) |
| "On sale" product lists (`wc_get_product_ids_on_sale()`) | `wc_product_meta_lookup.onsale`, cached in the `wc_products_onsale` transient | [wc-product-functions.php L197-L213](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L197-L213); [get_on_sale_products L1196-L1235](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1196-L1235) |
| REST API `price`, `on_sale`, `date_on_sale_*` | `get_price()`, `is_on_sale()`, the date props | [L885-L904](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-products-v2-controller.php#L885-L904) |
| Variable parent "From" price and badge | The `wc_var_prices_<id>` transient built from the variations | [variable-products.md](variable-products.md) |
| Product feeds, ERP syncs, custom SQL | Often `_price` directly | Check the plugin; the audit lists what reads `_price` on the store |
