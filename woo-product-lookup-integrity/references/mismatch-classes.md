# Mismatch classes

Each "Detail" block of `scripts/lookup-checks.sql` returns one class. This file says what a row in each class means,
what usually causes it, how to confirm it, and which repair in `changes-and-rollback.md` fixes it. The rules behind
each check are in `meta-lookup-rules.md` and `attributes-lookup-rules.md`.

Severity is about shoppers: high changes what a shopper sees or can buy (prices, stock, filters), medium makes
filters or counts wrong in edge cases, low is dead data with no visible effect.

Before judging any class:

- A regeneration in progress makes everything look wrong. Check the options block (`woocommerce_product_lookup_table_is_generating`,
  `woocommerce_attribute_lookup_regeneration_in_progress`) and the Action Scheduler block first.
- A pending `woocommerce_run_product_attribute_lookup_update_callback` action for a product explains its `attr.*` rows
  until the queue runs. The report lists pending and failed ones with their product ID.
- Run `wp eval-file scripts/lookup-product-diff.php <id>` on two or three listed products per class. It rebuilds the
  expected rows through WooCommerce's own objects and shows the difference, and notes where the optimized path would
  write something else.

## Product meta lookup

| Class | Severity | Meaning | Usual causes | Repair |
| --- | --- | --- | --- | --- |
| `meta.missing_row` | high | A product or variation (not trashed, not auto-draft) has no row. Price filters, sorting and Store API price and stock filters skip it | Created or imported without the CRUD classes; row deleted by hand; an old regeneration that never finished | Meta regeneration (it inserts every missing row), or a CRUD save that changes a lookup property |
| `meta.orphan_row` | low | A row whose `product_id` has no post, or belongs to another post type | Product deleted with SQL; database copied in parts | Owner-approved `DELETE` of those rows with a backup. A regeneration does not remove them |
| `meta.stale_value` | high | The row's values differ from post meta. The detail lists the columns and both values | Direct meta writes; imports; plugins that bypass `WC_Product` | Meta regeneration for the whole table, or a CRUD save of the product. `stock_quantity_unmanaged` alone is low: a regeneration left an old number on an unmanaged product |
| `meta.no_price` | high when `_regular_price` is set on a simple product or variation; expected for a variable product without published variations | No non-empty `_price` in post meta. A regeneration cannot fix it: it copies `_price` | [Issue 68605](https://github.com/woocommerce/woocommerce/issues/68605): the product shows no Add to cart button, and neither a plain save nor "Product lookup tables" rebuilds `_price` | Rewrite the price through WooCommerce (see changes-and-rollback.md, "Rebuild an empty `_price`"), then check the row |

`meta.stale_value` column notes:

- `onsale` is stale only when the value fits neither the save rule nor the regeneration rule.
- `rating_count_suspect` compares zero with non-zero only; confirm the sum with the PHP helper.
- `global_unique_id` differences on a store whose `woocommerce_schema_version` is below 920 are expected: the save
  path does not write that column there.

## Product attributes lookup

| Class | Severity | Meaning | Usual causes | Repair |
| --- | --- | --- | --- | --- |
| `attr.missing_product_rows` | high | A product with attribute terms (listed in its `_product_attributes`, not hidden from the catalog, and for variable products with at least one published or private variation) has no rows at all. It is missing from every attribute filter | [Issue 68112](https://github.com/woocommerce/woocommerce/issues/68112) (optimized path, failed read after delete); an aborted regeneration; created outside the CRUD classes; an empty table as in the [support thread](https://wordpress.org/support/topic/empty-table-wc_product_attributes_lookup-no-matter-what/) | Regenerate the product, or the table when many are missing |
| `attr.missing_term_row` | high | A simple, grouped or external product has a term that has no row | Term added with `wp_set_object_terms()` or SQL; an update still queued | Regenerate the product |
| `attr.missing_variation_rows` | high | A published or private variation has an `attribute_pa_*` value (or "Any") for a taxonomy of its parent and no row for that taxonomy | Variation created or enabled outside WooCommerce's save ([issue 69008](https://github.com/woocommerce/woocommerce/issues/69008) on 11.3.0 and later); issue 68112 | Regenerate the parent product |
| `attr.stale_term` | high | A row for a term the product no longer has, or for an attribute no longer listed on it; for a variation set to "Any", a term the parent no longer has | Terms removed directly; attribute removed without a CRUD save | Regenerate the product |
| `attr.variation_term_mismatch` | high | A variation row's term slug differs from the variation's own `attribute_<taxonomy>` value | Variation value changed by a direct meta write | Regenerate the parent product |
| `attr.stale_stock` | medium (high while out-of-stock items are hidden) | `in_stock` says 1 for an `outofstock` item or 0 for an `instock` one. Only read while `woocommerce_hide_out_of_stock_items` is `yes` | `_stock_status` written directly; stock-only update still queued | Regenerate the product, or a CRUD stock save |
| `attr.orphan_row` | medium | Rows of a product or parent that no longer exists or is in the trash | Deleted with SQL; trash handler skipped | Regenerate the table, or an owner-approved `DELETE` of those rows with a backup |
| `attr.structure_mismatch` | medium | A variation row filed under another parent, a variation row not flagged as one, or the reverse | Variation moved to another parent by a direct write; rows from another site's copy | Regenerate the affected parents |
| `attr.deleted_term` | medium | A row for a term ID that no longer exists in that taxonomy | Term or attribute deleted; no handler removes the rows | Regenerate the affected products, or the table |

Product types added by extensions need a second look. The object path treats any product whose class extends
`WC_Product_Variable` as variable, while the optimized path and the SQL checks look for the `product_type` term
`variable` only
([LookupDataStore L559-L561, L900](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L900)).
A variable-like type from an extension can therefore show up in `attr.missing_term_row` for its variation attributes.
Confirm such products with `lookup-product-diff.php`, which follows the class.

## Information, not mismatches

The last block of the SQL file counts rows that depend on how they were written:

| Finding | Why it is not a mismatch |
| --- | --- |
| Rows of products hidden from the catalog | A regeneration writes them, a save that hides the product removes them |
| `onbackorder` rows with `in_stock` 0 or 1 | The optimized path writes 0, the object path 1 |
| Rows of `private` variations | Expected in 11.1.2; removed from 11.3.0 ([PR 68482](https://github.com/woocommerce/woocommerce/pull/68482)) |
| Rows of `draft` or `pending` variations | Only the optimized path writes them |
| Rows for `pa_` taxonomies not registered as WooCommerce attributes | Only the optimized path writes them |

A count that grows between two runs without product edits is worth a question to the owner even when the class is
informational: something writes to the table outside WooCommerce.

## Reading counts before and after

`node scripts/summarise-lookup-report.mjs before.txt after.txt` prints, per class, the full counts from both runs and,
among the listed rows, how many were fixed, remain and are new. When a listing was capped (fewer rows listed than
counted), raise `LOOKUP_DETAIL_LIMIT` for both runs before relying on the row columns.
