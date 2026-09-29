# Regenerating the lookup tables

Every command and tool on this page writes to the database. Run none of them without the owner's approval of that
step, a backup, and the checks in `changes-and-rollback.md`. This page says what each one does, so the owner can
choose. Links point at the WooCommerce 11.1.2 tag and Action Scheduler 4.0.0, the version 11.1.2 bundles
([composer.json L56](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/composer.json#L56)).

## The product meta lookup table

### From the admin

WooCommerce > Status > Tools > "Product lookup tables", button "Regenerate" (tool ID
`regenerate_product_lookup_tables`). It calls `wc_update_product_lookup_tables()` unless a run is already pending
([tools controller L150-L155, L605-L610](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-tools-v2-controller.php#L605-L610)).
While it runs the button reads "Regenerating in progress", links to the pending actions, and warns when
`DISABLE_WP_CRON` is set that the run may not complete
([L256-L301](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-tools-v2-controller.php#L256-L301)).

### What it does

From [wc-product-functions.php L1959-L2033](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L1959-L2033):

1. Sets the option `woocommerce_product_lookup_table_is_generating`.
2. `INSERT IGNORE` of one row per `product` and `product_variation` post, any status. Existing rows are kept, and rows
   of deleted products are not removed.
3. Schedules one action per column, one second apart: hook `wc_update_product_lookup_tables_column`, argument
   `column`, group `wc_update_product_lookup_tables`, in this order: `min_max_price`, `stock_quantity`, `sku`,
   `global_unique_id`, `stock_status`, `average_rating`, `total_sales`, `downloadable`, `virtual`, `onsale`,
   `tax_class`, `tax_status`. Each is one `UPDATE` of the whole table joined to post meta
   ([L2041-L2164](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L2041-L2164)).
4. Schedules `wc_update_product_lookup_tables_rating_count_batch` 10 seconds later, 50 products per action, each one
   scheduling the next until no rows are left
   ([L2200-L2234](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L2200-L2234)).
5. The `tax_status` action deletes the "generating" option
   ([L2160-L2163](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L2160-L2163)),
   so rating count batches can still be pending after it is gone. "Running" for the tools page means any pending
   action in the group ([L1942-L1952](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L1942-L1952)).

While the option is set, the product filter blocks read stock from post meta instead of the table
([FilterData.php L148-L160](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductFilters/FilterData.php#L148-L160)),
and so does the variable product child stock check
([class-wc-product-variable-data-store-cpt.php L806-L810](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L806-L810)).
The catalog's price filter and sorts keep reading the table.

### From WP-CLI

`wp wc tool run regenerate_product_lookup_tables --user=<id>` runs the same tool
([performance improvements in 3.6](https://developer.woocommerce.com/2019/04/01/performance-improvements-in-3-6/)).
`wp wc tool` goes through the REST tools endpoint
([class-wc-cli-tool-command.php L28-L60](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/cli/class-wc-cli-tool-command.php#L28-L60)),
which needs a user with `manage_woocommerce`
([tools controller L114-L119](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-tools-v2-controller.php#L114-L119);
[wc-rest-functions.php L345](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-rest-functions.php#L345)).
Under WP-CLI the function runs every column and all rating counts in that process instead of scheduling them
([wc-product-functions.php L1962, L1995-L2021](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L1995-L2021)).

### What it does not fix

Orphan rows (it never deletes), an empty `_price` (it copies `_price`, issue
[68605](https://github.com/woocommerce/woocommerce/issues/68605)), and a `stock_quantity` left on a product whose stock
is no longer managed (it updates managed rows only). See `meta-lookup-rules.md`.

## The product attributes lookup table

### From the admin

WooCommerce > Status > Tools > "Regenerate the product attributes lookup table" (tool ID
`regenerate_product_attributes_lookup_table`). With a product chosen in its search box it rebuilds that product; left
empty it starts a full regeneration
([DataRegenerator L294-L330, L375-L385](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L294-L330)).
During a full run the button reads "Filling in progress (N)" and an "Abort" tool appears; after an abort a "Resume"
tool appears ([L319-L362](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L319-L362)).
Since 11.0.0 these tools also run through the REST API
([changelog L16](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L16)).

### What a full regeneration does

From [L102-L118, L125-L168](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L102-L168):

1. Turns table usage off (`woocommerce_attribute_lookup_enabled` = `no`), so the catalog's attribute filters run as
   taxonomy queries until the end
   ([class-wc-query.php L915-L926](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-query.php#L915-L926)).
2. Empties the table with `TRUNCATE` and runs its schema through `dbDelta`.
3. Stores the highest product ID and sets `woocommerce_attribute_lookup_regeneration_in_progress`.
4. Runs steps as actions: hook `woocommerce_run_product_attribute_lookup_regeneration_callback`, group
   `woocommerce-db-updates`, one second apart, 100 products per step, using the optimized path when "Optimized
   updates" is on ([L197-L273](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L197-L273)).
5. After the last step, sets table usage to `yes` and deletes the progress options
   ([L280-L284](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L280-L284)).

If the in-progress option is deleted by hand, the next step marks the run aborted and leaves usage off
([L197-L204](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L197-L204)).
When WooCommerce is installed or updated and the table is empty while products exist, it starts a full regeneration by
itself ([L568-L588](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/DataRegenerator.php#L568-L588)).

### From WP-CLI

`wp wc palt` (registered in [class-wc-cli.php L76-L77](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cli.php#L76-L77),
added in 9.1.0 per [changelog L5024](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L5024)).
All from [CLIRunner.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/CLIRunner.php):

| Command | Writes | What it does | Lines |
| --- | --- | --- | --- |
| `wp wc palt info` | No | Table name, usage on or off, rows and products, highest product ID, regeneration state | [L176-L220](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/CLIRunner.php#L176-L220) |
| `wp wc palt regenerate_for_product <id> [--disable-db-optimization]` | Yes | Deletes and rebuilds one product's rows. Uses the optimized path unless the flag is given, whatever the setting says; on failure it points to the `palt-updates` log | [L115-L168](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/CLIRunner.php#L115-L168) |
| `wp wc palt regenerate [--force] [--from-scratch] [--disable-db-optimization] [--batch-size=<size>]` | Yes | Empties the table and rebuilds it in this process, not in the queue; asks to confirm when the table has rows unless `--force`; resumes an unfinished run unless `--from-scratch`; restores table usage to what it was; warns when a product failed. Optimized path unless the flag is given. The help text gives 10 as the batch size default | [L337-L443](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/CLIRunner.php#L337-L443) |
| `wp wc palt initiate_regeneration [--force]` | Yes | Starts the background full regeneration described above | [L298-L335](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/CLIRunner.php#L298-L335) |
| `wp wc palt abort_regeneration [--cleanup]`, `resume_regeneration`, `cleanup_regeneration_progress` | Yes | Stop, continue, or forget a background regeneration | [L222-L296](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/CLIRunner.php#L222-L296) |
| `wp wc palt enable [--force]`, `wp wc palt disable` | Yes | Turn table usage on or off; `enable` asks to confirm while a regeneration runs, after an abort, or when the table is empty | [L49-L113](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/CLIRunner.php#L49-L113) |

`wp wc palt info` suggests "wp cli palt abort_regeneration" and "wp cli palt resume_regeneration"
([L209-L218](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/CLIRunner.php#L209-L218));
the command WooCommerce registers is `wp wc palt`.

### Which path to use

Issue [68112](https://github.com/woocommerce/woocommerce/issues/68112) (open) affects the
optimized path, and the WP-CLI commands use that path by default. Unless the owner chooses otherwise for speed, pass
`--disable-db-optimization`, which runs the object path through the product objects, and check the result with the
same SQL blocks either way.

## Per-product updates: scheduled or direct

These are not regenerations: they are the updates a product save queues (`references/attributes-lookup-rules.md`).
"Direct updates" (`woocommerce_attribute_lookup_direct_updates`) runs them inside the save request instead of as an
action ([LookupDataStore L153-L179](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ProductAttributesLookup/LookupDataStore.php#L153-L179)).
With direct updates the work happens inside the save request; with scheduled updates the table is only as current as
the queue. Changing it is a setting change with its own backup and undo.

## The Action Scheduler jobs

| Hook | Group | Scheduled by |
| --- | --- | --- |
| `woocommerce_run_product_attribute_lookup_update_callback` | `woocommerce-db-updates` | Each product change, unless direct updates are on |
| `woocommerce_run_product_attribute_lookup_regeneration_callback` | `woocommerce-db-updates` | Each step of a background full regeneration |
| `wc_update_product_lookup_tables_column` | `wc_update_product_lookup_tables` | Meta lookup regeneration, one per column |
| `wc_update_product_lookup_tables_rating_count_batch` | `wc_update_product_lookup_tables` | Meta lookup regeneration, rating counts |

- Count them without changing anything:
  `wp action-scheduler action list --hook=<hook> --status=pending --per_page=0 --format=count`. Keep `--per_page=0`:
  the store's default page size is 5, and `--format=count` counts the rows returned
  ([Action_Command.php L213-L263](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L213-L263);
  [ActionScheduler_DBStore.php L429-L448](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L429-L448)).
- Run them now (a write, with the same effects as the queue running them later):
  `wp action-scheduler run --hooks=<hook> --batch-size=<n>`, or `--group=<group>`
  ([ActionScheduler_WPCLI_Scheduler_command.php L43-L68](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_Scheduler_command.php#L43-L68)).
- A queue that does not run leaves both regenerations unfinished and per-product updates waiting. Fixing the runner is
  the `wp-cron-action-scheduler-health` skill's job.

## Verify after every regeneration

Wait until the report shows no pending lookup actions and neither progress option, then run the same report and
compare: `node scripts/summarise-lookup-report.mjs before.txt after.txt`. A class that did not fall to zero has a
cause a regeneration does not reach; `mismatch-classes.md` lists them.
