# How WooCommerce writes `{prefix}wc_product_attributes_lookup`

Read this before judging an `attr.*` row in the report. Links point at the WooCommerce 11.1.2 tag; `LookupDataStore`
is [src/Internal/ProductAttributesLookup/LookupDataStore.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php)
and `DataRegenerator` is [DataRegenerator.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php)
in the same folder.

## When WooCommerce touches the table

| Event | What it does | Source |
| --- | --- | --- |
| A product or variation is saved | `WC_Product::save()` passes the changes to `on_product_changed()`, for a new product or when anything changed | [abstract-wc-product.php L1546-L1585](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-product.php#L1546-L1585) |
| The changes include `catalog_visibility` | Rebuild when the new value is `visible` or `catalog`, delete the rows when it is `search` or `hidden` | [LookupDataStore L223-L245](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L223-L256) |
| The changes include `attributes` | Rebuild | same |
| The changes include `stock_quantity`, `stock_status` or `manage_stock` | Update `in_stock` of the rows whose `product_id` is this product | [L251-L253, L263-L276](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L263-L276) |
| Any other change, a variation's status included | Nothing | [L255](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L255) |
| Trash, permanent delete | Delete the rows | [class-wc-post-data.php L407-L432, L469-L497](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-post-data.php#L469-L497); [abstract-wc-product.php L1612-L1625](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-product.php#L1612-L1625) |
| Restore from trash | Rebuild | [class-wc-post-data.php L505-L535](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-post-data.php#L505-L535) |
| REST API batch create or update | Rebuild | [LookupDataStore L651-L655](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L651-L655) |

Those are the only callers of the lookup data store in 11.1.2 besides its own regeneration and CLI code
([abstract-wc-product.php L1575, L1622](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-product.php#L1575);
[class-wc-post-data.php L416, L428, L492-L494, L530-L532](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-post-data.php#L416);
[LookupDataStore hooks L68-L73](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L68-L73)).
So deleting or renaming an attribute term, removing an attribute taxonomy, writing post meta or term relationships
directly, or changing a post's status with `wp_update_post()` leaves the rows as they were.

## Scheduled or direct updates

- By default each update is an Action Scheduler action: hook `woocommerce_run_product_attribute_lookup_update_callback`,
  arguments `[product id, action]`, group `woocommerce-db-updates`, due one second later, and not added again while the
  same action is pending. With "Direct updates" (`woocommerce_attribute_lookup_direct_updates` = `yes`) the update
  runs inside the request that saved the product
  ([L153-L179](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L153-L179)).
- Action codes: 1 rebuild, 2 stock only, 3 delete
  ([L25-L28](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L25-L28)).
  Action Scheduler stores the arguments as JSON, for example `[123,1]`
  ([ActionScheduler_DBStore.php L110-L116](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L110-L116)),
  which is how the report shows which products still wait.
- When the action runs, a product that no longer loads is treated as a delete; a rebuild deletes the rows first and
  then writes new ones ([L189-L215](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L189-L215)).
- Scheduled updates lag while the queue lags. Before judging a product, check the report's list of pending and failed
  lookup actions.

## The rows the object path builds

This is the path used when "Optimized updates" is off, and by the tools page for one product while it is off.

- Only taxonomy attributes count: an attribute whose ID is 0 (a custom attribute) is skipped
  ([L588-L604](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L588-L604)).
  For a taxonomy attribute the product data store reads the term IDs assigned to the product, and needs the taxonomy
  to exist and be registered as a WooCommerce attribute
  ([class-wc-product-data-store-cpt.php L598-L650](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L598-L650)).
  Which taxonomies a product uses, and whether each is "used for variations", is stored in its `_product_attributes`
  post meta ([L1044-L1095](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1044-L1095)).
- Simple, grouped and external products: one row per assigned term, `product_id` = `product_or_parent_id` = the
  product, `is_variation_attribute` 0
  ([L384-L394](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L384-L394)).
- Variable products: the same for attributes not used for variations; for attributes used for variations, rows per
  variation, `is_variation_attribute` 1
  ([L402-L435](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L402-L435)).
  The variations come from `get_children()`, which lists published and private (disabled) variations
  ([L543-L551](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L543-L551);
  [class-wc-product-variable-data-store-cpt.php L188-L199](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L188-L199)).
- A variation with a value for the attribute gets one row, for the term with that slug in the whole taxonomy; a
  variation set to "Any" gets one row per term the parent has
  ([L474-L486, L502-L535](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L474-L486)).
  The variation's values are post meta `attribute_<taxonomy>` holding the term slug, empty for "Any"
  ([class-wc-product-variation-data-store-cpt.php L560-L588](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variation-data-store-cpt.php#L560-L588)).
- `in_stock` is `is_in_stock()`: true unless the stock status is `outofstock`, so `onbackorder` gives 1; plugins can
  change it with `woocommerce_product_is_in_stock`
  ([abstract-wc-product.php L1835-L1844](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-product.php#L1835-L1844)).
- Catalog visibility is not consulted when rows are built. A regeneration writes rows for hidden products; a save that
  sets them hidden removes them (table above).
- Errors are logged at level error under the source `palt-updates`
  ([L337-L349](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L337-L349)).

## Where the optimized path differs

With "Optimized updates" on, `create_data_for_product_cpt_core()` builds the rows with its own SQL
([L847-L1087](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L847-L1087)):

| Point | Optimized path | Object path |
| --- | --- | --- |
| Order of work | Deletes the rows (by `product_or_parent_id`) first, then reads the product ([L850-L856](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L850-L856)) | Deletes by `product_or_parent_id` and by `product_id`, then builds ([L358-L376](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L358-L376)) |
| Variations included | `publish`, `draft`, `pending`, `private` ([L865-L890](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L865-L890)) | `publish`, `private` |
| `in_stock` | 1 only for `instock` ([L906](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L906)), so `onbackorder` gives 0 | 1 unless `outofstock` |
| Attributes | `pa_` keys of `_product_attributes` with an empty value, terms from `term_relationships` ([L911-L964](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L911-L964)) | Taxonomy attributes registered in WooCommerce |
| A variation value that is not one of the parent's terms | No row ([L1022-L1025](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L1017-L1028)) | A row for the term with that slug, or every parent term when no such term exists |
| Failed `INSERT` | Throws and is logged ([L1054-L1086, L816-L838](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L1054-L1086)) | Not checked |

Because of these differences, the SQL checks accept either value for `onbackorder` items, report rows of draft and
pending variations as information, and leave variation values outside the parent's terms to the PHP helper.

Issue [68112](https://github.com/woocommerce/woocommerce/issues/68112) (filed 2026-08-27, open when this skill was
checked) reports that when the read after the delete fails (a database error, a timeout, a dropped connection),
`wpdb` returns an empty array, the method returns early, the product's rows stay deleted, and nothing is logged. The
product then drops out of attribute filters.

## Which products should have rows

- A full regeneration walks `wc_get_products()` in ID order, 100 products per step by default (filter
  `woocommerce_attribute_lookup_regeneration_step_size`)
  ([DataRegenerator L32, L235-L273](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L235-L273)).
  Its defaults are the statuses `draft`, `pending`, `private`, `publish` and the product types of
  `wc_get_product_types()`: simple, grouped, external, variable
  ([class-wc-product-query.php L30-L31](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-product-query.php#L30-L31);
  [wc-product-functions.php L1025-L1035](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L1025-L1035)).
  Variations are handled through their parent.
- The SQL checks therefore expect rows for products in those four statuses that are not hidden from the catalog, and
  for their published and private variations. Products hidden from the catalog, and products of other statuses, are
  reported as information, since either writer may have left them either way.
- WooCommerce 11.3.0 changes this: disabled variations get no rows, a status change of a variation rebuilds its rows,
  and a migration deletes the old rows of disabled variations
  ([PR 68482](https://github.com/woocommerce/woocommerce/pull/68482), merged 2026-09-25, milestone 11.3.0). See
  `version-notes.md`.

## Known ways the table goes wrong

| Symptom | Cause | Source |
| --- | --- | --- |
| A product vanishes from attribute filters after a save, no error logged | Failed read in the optimized path after its delete | [issue 68112](https://github.com/woocommerce/woocommerce/issues/68112) |
| A variation re-enabled with `wp_update_post()`, `wp_publish_post()` or WP-CLI is missing from filters (on 11.3.0 and later) | Status changes outside WooCommerce's save do not queue a rebuild | [issue 69008](https://github.com/woocommerce/woocommerce/issues/69008), filed 2026-09-23 |
| Filters offer terms no one can buy | Rows of disabled variations (expected in 11.1.2) | [PR 68482](https://github.com/woocommerce/woocommerce/pull/68482) |
| The table stays empty whatever tool is run | In the reported case the table filled once edited theme and plugin files were replaced; no single cause was named | [support thread](https://wordpress.org/support/topic/empty-table-wc_product_attributes_lookup-no-matter-what/), WooCommerce 9.1.2 |
| Half the catalog has rows, table usage switched off | A full regeneration was aborted: abort keeps the progress options and turns usage off, and the settings screen warns that the table "is probably in an inconsistent state" | [DataRegenerator L426-L445](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L426-L445); [LookupDataStore L757-L763](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L757-L763) |
| Rows lag behind edits | Pending `woocommerce_run_product_attribute_lookup_update_callback` actions in a stalled queue | above |
| Rows for a term that was deleted, or a term the product lost through a direct write | No handler removes rows on term changes (callers above) | above |

Attribute taxonomies with non-ASCII names are stored URL-encoded in some places
([changelog L8005](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L8005)); the SQL checks compare
names as stored and may list such rows. Confirm them with `scripts/lookup-product-diff.php`.
