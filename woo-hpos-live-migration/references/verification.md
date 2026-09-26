# Verifying data parity

Every change step ends with a check from this file. All commands here are read-only unless marked. Code links point at
the WooCommerce 11.1.2 tag.

## The tools, from cheapest to most thorough

### 1. `wp wc hpos status` and `wp wc hpos count_unmigrated`

- Prints the pending count described in [sync-mechanics.md](sync-mechanics.md#what-unsynced-orders-counts): missing rows,
  newer modified dates on the authoritative side, and pending deletion records
  ([DataSynchronizer.php L527-L623](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L527-L623)).
- `Unsynced orders: 0` is required before any storage switch, and `wp wc hpos enable` / `disable` refuse otherwise
  ([CLIRunner.php L812-L821, L877-L886](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L812-L821)).
- It does not compare field values. Use the next two tools for that.
- On a large store the count is a join across the posts and orders tables; run it at a quiet time.

### 2. `wp wc hpos verify_data`

- Walks order IDs from the posts table and compares core columns and meta with the HPOS copy
  ([CLIRunner.php L351-L576](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L351-L576)).
  The comparison queries are SELECTs
  ([MetaToCustomTableMigrator.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/MetaToCustomTableMigrator.php)),
  so without `--re-migrate` it changes nothing.
- Options: `--batch-size` (default 500), `--start-from` and `--end-at` (order ID range), `--order-types` (comma list),
  `--verbose` (print errors per batch), `--re-migrate` (writes, see below)
  ([L305-L350](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L305-L350)).
- Ends with `Success: N orders were verified in S seconds.` or an `Error:` listing the failing orders as JSON with the
  column or meta key, the original value and the new value; the error sets a non-zero exit code
  ([L528-L575](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L528-L575);
  sample output on the [CLI tools page](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/cli-tools/)).
- Skipped by design: `_paid_date`, `_completed_date`, the edit-lock meta, and keys added through
  `woocommerce_hpos_sync_ignored_order_props`
  ([DataSynchronizer.php L352-L377](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L352-L377)).
  Add a key to that filter only after you know why it differs.
- It starts from posts, so orders that exist only in HPOS (created after the switch with compatibility mode off) are
  outside its reach. Use `diff` and the SQL checks for those.
- Large stores: verify in ID ranges, newest first, for example
  `wp wc hpos verify_data --start-from=900001 --end-at=1000000 --verbose`, and log each range's exit code.

### 3. `wp wc hpos diff <order_id> --format=json`

- Reads one order from each storage with sync-on-read forced off and lists every property or top-level meta key that
  differs; "Success: No differences found." otherwise
  ([CLIRunner.php L1063-L1141](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L1063-L1141);
  [LegacyDataHandler.php L235-L340](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/LegacyDataHandler.php#L235-L340)).
- Run it on every order `verify_data` reports and on a sample: the newest orders, one of each status, refunds, and each
  extension order type. Newest IDs:
  `wp db query "SELECT id FROM $(wp db prefix)wc_orders ORDER BY id DESC LIMIT 20" --skip-column-names`.
- After `wp wc hpos cleanup`, the post side is a placeholder, so `diff` reports differences by design.

### 4. SQL parity checks (`scripts/parity-checks.sql`)

SELECT-only queries; `scripts/hpos-readonly-report.sh` fills in the table prefix and the order types and runs them one by
one. Column names come from the HPOS schema
([OrdersTableDataStore.php L3447](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3447))
and the posts-storage meta keys (`_order_total` maps to the order total,
[abstract-wc-order-data-store-cpt.php L39-L46, L482](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/abstract-wc-order-data-store-cpt.php#L39-L46)).

| Query | Expect before the switch | Expect after the switch, sync on |
| --- | --- | --- |
| Orders by type and status, posts vs `wc_orders` | Same counts per type and status | Same |
| Order posts with no `wc_orders` row | 0 | 0 |
| `wc_orders` rows whose post is missing or a placeholder | 0 | 0 (placeholders appear only with sync off) |
| Rows where the modified dates differ, by direction | 0 | 0, or briefly above 0 while backfills run |
| Status mismatches | 0 | 0 |
| `_order_total` vs `wc_orders.total_amount` mismatches (`shop_order` only) | 0 | 0 |
| Order count and total sum per storage | Equal | Equal |
| Pending `_deleted_from` records | 0 after sync | 0 after sync |
| Batch actions by hook and status (`is_order_sync` = 1) | No pending order-sync batches once the backfill ends; no new failed ones since the last check | Same |

The checks join large tables. On a big store, run them against a staging copy or a read replica, or at a quiet hour.

## Fixing mismatches

Take a backup of the destination tables before any write (see [cutover-and-rollback.md](cutover-and-rollback.md#backups)).

- Before HPOS has ever been authoritative, the posts copy is the truth:
  - one order: `wp wc hpos backfill <id> --from=posts --to=hpos`
    ([CLIRunner.php L1143-L1230](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L1143-L1230));
  - many orders: `wp wc hpos verify_data --re-migrate`. Its help text allows this only when the site has never run with
    HPOS authoritative, or after you have checked each reported error
    ([L339-L341](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L339-L341)).
- After HPOS has been authoritative, anything written since the switch is only right in HPOS. Never use `--re-migrate`.
  Decide per field with `diff`, then copy only that field in the right direction, for example
  `wp wc hpos backfill <id> --from=posts --to=hpos --meta_keys=_my_key` or
  `wp wc hpos backfill <id> --from=hpos --to=posts --props=status,total`
  ([CLI tools page, backfill examples](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/cli-tools/)).
  Internal meta keys must go through `--props`
  ([LegacyDataHandler.php L518-L575](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/LegacyDataHandler.php#L518-L575)).
- Re-run `diff` on each fixed order, then `wp wc hpos status`.
- The same meta key failing on many orders usually means some code writes it straight to `wp_postmeta` (or straight to
  the HPOS tables). Find that code with the audit in [compatibility-audit.md](compatibility-audit.md) before fixing data
  again.

## Gates

| Gate | Pass when |
| --- | --- |
| Before the switch to HPOS | `Unsynced orders: 0`; `verify_data` exits 0 for every range, or each reported order is explained and fixed; SQL counts and totals match; the sample `diff` runs are clean; staging tests passed with sync on and with sync off |
| Before turning compatibility mode off | The soak period is over; `Unsynced orders` stays at 0 between checks; no `batch-processing` errors in WooCommerce > Status > Logs; the critical flows passed again on production |
| Before cleanup | Compatibility mode has been off for the agreed period with no incident; the full backup that still has the posts-side data is stored and a restore was tested |
