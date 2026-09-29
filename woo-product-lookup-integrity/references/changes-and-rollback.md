# Changes, each with a backup, a check and an undo

Every step on this page writes to the database. Before each one, state the step, its backup, its check and its undo
to the owner and wait for approval of that step; one approval covers one step. Run it on a staging copy restored from
production first, then on production at a quiet hour. Take the report before (`lookup-report-before.txt`) and after
(`lookup-report-after.txt`) with the same settings, and compare them with `scripts/summarise-lookup-report.mjs`.

## Backups used below

| Backup | Command | Restore | Source |
| --- | --- | --- | --- |
| One lookup table | `wp db export /path/outside/webroot/<name>.sql --tables=<prefix>wc_product_attributes_lookup` (or `<prefix>wc_product_meta_lookup`) | `wp db import <file>` | [db export](https://developer.wordpress.org/cli/commands/db/export/) (`--tables`, and extra arguments go to `mysqldump`); [db import](https://developer.wordpress.org/cli/commands/db/import/) (runs the SQL in the file) |
| One option | `wp option get <name> --format=json > <name>.json` | `wp option update <name> --format=json < <name>.json` | [option get](https://developer.wordpress.org/cli/commands/option/get/); [option update](https://developer.wordpress.org/cli/commands/option/update/) (value read from STDIN when omitted) |
| One post meta value | `wp post meta get <id> <key>` written into the change record | `wp post meta update <id> <key> '<value>'`, or `wp post meta delete <id> <key>` if it did not exist | [post meta](https://developer.wordpress.org/cli/commands/post/meta/) |

- `mysqldump` writes a `DROP TABLE` before each `CREATE TABLE` unless told otherwise (`--add-drop-table` is part of
  `--opt`, which is on by default), so importing a one-table export replaces that table with the saved copy
  ([mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)). It also drops every row written after the
  backup: take it right before the step.
- When `wp option get` finds no option, write that down: the undo is then `wp option delete <name>`
  ([option delete](https://developer.wordpress.org/cli/commands/option/delete/)).
- The lookup tables hold catalog data only. Still, keep exports outside the web root and delete them when the owner's
  retention period ends. A backup counts once it has been restored on staging.

## Regenerate one product's attribute rows

- Command: `wp wc palt regenerate_for_product <id> --disable-db-optimization`, or Status > Tools > "Regenerate the
  product attributes lookup table" with the product chosen
  ([regeneration.md](regeneration.md#the-product-attributes-lookup-table)).
- Backup: one-table export of `<prefix>wc_product_attributes_lookup`.
- Check: `wp eval-file scripts/lookup-product-diff.php <id>` shows no missing, extra or different rows (or only the
  path differences it names); the product appears in the shop's attribute filter for its terms.
- Undo: import the export. On failure the command says so and points to the `palt-updates` log.

## Regenerate the whole attributes table

- Command, in the queue: Status > Tools > "Regenerate the product attributes lookup table" with no product, or
  `wp wc palt initiate_regeneration`. In the WP-CLI process instead:
  `wp wc palt regenerate --disable-db-optimization --batch-size=<n>`.
- During the run table usage is off, so the catalog's attribute filters run as taxonomy queries until it ends
  ([class-wc-query.php L915-L926](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-query.php#L915-L926);
  [regeneration.md](regeneration.md#the-product-attributes-lookup-table)).
- Backup: one-table export of `<prefix>wc_product_attributes_lookup`, and the value of
  `woocommerce_attribute_lookup_enabled`.
- Check: `wp wc palt info` shows usage as it was and no regeneration in progress; no pending
  `woocommerce_run_product_attribute_lookup_regeneration_callback` actions; the report's `attr.*` counts fall; the
  CLI command's own summary reports no failed product.
- Undo: for a background run still going, `wp wc palt abort_regeneration --cleanup` first; then import the export and
  restore the option.

## Regenerate the meta lookup table

- Command: Status > Tools > "Product lookup tables", or `wp wc tool run regenerate_product_lookup_tables --user=<id>`
  with the ID of a user who has `manage_woocommerce`.
- Backup: one-table export of `<prefix>wc_product_meta_lookup`.
- Check: no pending actions in the group `wc_update_product_lookup_tables`; the option
  `woocommerce_product_lookup_table_is_generating` is gone; `meta.missing_row` and `meta.stale_value` fall. It leaves
  `meta.orphan_row` and `meta.no_price` as they were, by design.
- Undo: import the export.

## Refresh one product's meta lookup row

For one or a few products when a full regeneration is too much.

- Command: `wp cache delete lookup_table object_<id>`, then
  `wp eval 'WC_Data_Store::load( "product" )->refresh_product_lookup_table( <id> );'` (WooCommerce 10.8.0 and later).
  The first removes the cached copy that would make the write look unnecessary
  ([class-wc-data-store-wp.php L613-L622](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-data-store-wp.php#L613-L622);
  [cache delete](https://developer.wordpress.org/cli/commands/cache/delete/)); the second rebuilds the row from post
  meta ([class-wc-product-data-store-cpt.php L947-L955](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L947-L955)).
- Backup: one-table export of `<prefix>wc_product_meta_lookup` (small), or the row itself saved with
  `wp db query "SELECT * FROM <prefix>wc_product_meta_lookup WHERE product_id = <id>"` into the change record.
- Check: `lookup-product-diff.php <id>` reports "Row matches post meta".
- Undo: import the export.

## Rebuild an empty `_price` (issue 68605)

For a simple product or a variation that `meta.no_price` lists with "`_regular_price` is set". Issue
[68605](https://github.com/woocommerce/woocommerce/issues/68605) shows that neither a plain save nor the regeneration
rebuilds `_price`. This step writes `_price` with the rule WooCommerce's own save uses: the sale price while the
product is on sale, otherwise the regular price
([class-wc-product-data-store-cpt.php L853-L880](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L853-L880)),
then refreshes the lookup row.

- Command (one product; replace `<id>` in both places):

  ```sh
  wp eval '$p = wc_get_product( <id> ); if ( $p && ! $p->is_type( array( "variable", "grouped" ) ) && "" === (string) get_post_meta( <id>, "_price", true ) ) { $price = $p->is_on_sale( "edit" ) ? $p->get_sale_price( "edit" ) : $p->get_regular_price( "edit" ); update_post_meta( <id>, "_price", $price ); wc_delete_product_transients( <id> ); WC_Data_Store::load( "product" )->refresh_product_lookup_table( <id> ); echo "set _price to {$price}\n"; } else { echo "skipped\n"; }'
  ```

- Backup: `wp post meta get <id> _price` and `wp post meta get <id> _regular_price` in the change record, and the
  one-table export of the meta lookup table.
- Check: `lookup-product-diff.php <id>` reports "Row matches post meta"; the product page shows the price and the Add
  to cart button; the report no longer lists the product under `meta.no_price`.
- Undo: `wp post meta update <id> _price '<old value>'` (or `wp post meta delete <id> _price` when it was missing),
  then refresh the row as in the step above. Variable and grouped products take their price from their children
  ([meta-lookup-rules.md](meta-lookup-rules.md#prices-of-variable-and-grouped-products)): repair the children.

## Delete orphan rows

`meta.orphan_row` and `attr.orphan_row` rows belong to posts that are gone or trashed. A meta regeneration never
deletes; an attributes regeneration empties the table and so removes them too. For the meta table, or to avoid a full
attributes run:

- Command, meta table:
  `wp db query "DELETE ml FROM <prefix>wc_product_meta_lookup ml LEFT JOIN <prefix>posts p ON p.ID = ml.product_id WHERE p.ID IS NULL OR p.post_type NOT IN ('product', 'product_variation')"`
- Command, attributes table:
  `wp db query "DELETE al FROM <prefix>wc_product_attributes_lookup al LEFT JOIN <prefix>posts p ON p.ID = al.product_id LEFT JOIN <prefix>posts pp ON pp.ID = al.product_or_parent_id WHERE p.ID IS NULL OR pp.ID IS NULL OR p.post_status = 'trash' OR pp.post_status = 'trash' OR p.post_type NOT IN ('product', 'product_variation')"`
- Before running either, run the matching Detail block with the same `WHERE` and confirm the count equals the report's.
- Backup: one-table export of the table.
- Check: the class count is 0 and every other class count is unchanged.
- Undo: import the export.

## Run queued lookup updates now

- Command: `wp action-scheduler run --hooks=woocommerce_run_product_attribute_lookup_update_callback --batch-size=100`
  ([regeneration.md](regeneration.md#the-action-scheduler-jobs)). It does what the queue would do later.
- Backup: one-table export of `<prefix>wc_product_attributes_lookup`.
- Check: the pending count for the hook falls to about zero; the failed count does not rise; the report's `attr.*`
  counts for those products fall.
- Undo: import the export, which also drops rows written since the backup.
- If the queue does not run on its own, repairing it is the `wp-cron-action-scheduler-health` skill's job.

## Change "Direct updates" or "Optimized updates"

- Change: WooCommerce > Settings > Products > Advanced, the "Direct updates" or "Optimized updates" checkbox (options
  `woocommerce_attribute_lookup_direct_updates`, `woocommerce_attribute_lookup_optimized_updates`)
  ([lookup-tables.md](lookup-tables.md#settings-and-options)).
- Backup: the option value.
- Check: save a test product on staging and run `lookup-product-diff.php` on it; with direct updates on, no new
  `woocommerce_run_product_attribute_lookup_update_callback` action appears for it.
- Undo: restore the option.

## Turn table usage on after a verified table

- Command: `wp wc palt enable`, or the "Enable table usage" checkbox.
- Only after a report with no high `attr.*` rows and no regeneration in progress or aborted; the command itself asks
  for confirmation in those cases ([regeneration.md](regeneration.md#the-product-attributes-lookup-table)).
- Backup: the value of `woocommerce_attribute_lookup_enabled`.
- Check: the shop's attribute filters show the same products and counts as before for three or four terms checked by
  hand, with `in_stock` behaving as the out-of-stock setting says.
- Undo: `wp wc palt disable`.

## Stop a stuck background regeneration

- Command: `wp wc palt abort_regeneration`, then either `wp wc palt resume_regeneration` or, to start over,
  `wp wc palt cleanup_regeneration_progress` and a new regeneration.
- Backup: none beyond the table export taken before the regeneration started.
- Check: `wp wc palt info`.
- Undo: `resume_regeneration` continues where the abort stopped.
