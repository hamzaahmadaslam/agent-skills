# What changed by release

Read the store's versions first (the report prints them) and apply the rows at or below them. WooCommerce dates and
entries come from its [changelog at 11.1.2](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt) and
[releases](https://github.com/woocommerce/woocommerce/releases); each row links the changelog line.

## WooCommerce

| Release | Change that matters for lookup table checks | Source |
| --- | --- | --- |
| 3.6.0 (2019-04-17) | `wc_product_meta_lookup` added; lookup table updates can run through WP-CLI | [changelog L12680, L12704](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L12704); [performance improvements in 3.6](https://developer.woocommerce.com/2019/04/01/performance-improvements-in-3-6/) |
| 4.0.0 (2020-03-10) | `tax_status` and `tax_class` columns; wider `min_price` and `max_price` | [L11951, L11994](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L11994) |
| 5.4.0 (2021-06-08) | `wc_product_attributes_lookup` and debug tools to fill or delete it | [L10243](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L10243) |
| 5.5.0, 5.6.0, 6.0.0 | Table used for filtering when enabled; kept in sync when it exists; filtering performance | [L10057](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L10057), [L9907](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L9907), [L9543](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L9543) |
| 6.3.0 (2022-03-08) | Data migration creates and activates the attributes table; indexes added | [L9212, L9238](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L9238) |
| 6.4.0 (2022-04-12) | Primary key on the attributes table | [L9107](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L9107) |
| 6.6.0 (2022-06-14) | Attributes table updated on WooCommerce upgrade and on REST batch requests | [L8912](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L8912) |
| 7.3.0 (2023-01-10) | Non-ASCII attribute names handled with the attributes table | [L8005](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L8005) |
| 7.6.0 (2023-04-13) | Regeneration empties the attributes table with `TRUNCATE` and `dbDelta` instead of dropping it | [L7771](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L7771) |
| 8.8.0 (2024-04-10) | Meta regeneration uses `_regular_price` when it computes `onsale` | [L5761](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L5761) |
| 9.0.0 (2024-06-18) | Index on `sku` in the meta table | [L5393](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L5393) |
| 9.1.0 (2024-07-10) | `wp wc palt` commands; optimized attributes regeneration | [L5024, L5069](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L5069) |
| 9.2.0 (2024-08-20) | `global_unique_id` column in the meta table, written only once the schema version reached 920; parent check when variation rows are built | [L4721, L4630, L4632](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L4721) |
| 9.8.0 (2025-04-07) | Optional COGS column in the meta table | [L3030](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L3030) |
| 10.6.0 (2026-03-10) | Faster insert and delete when the attributes table is synced | [L1071](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L1071) |
| 10.8.0 (2026-05-26) | Scheduled sales no longer leave the meta table stale; `refresh_product_lookup_table()` added | [L627, L724](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L627) |
| 11.0.0 (2026-08-04) | Attributes regeneration tools (regenerate, abort, resume) run through the REST API; `unserialize()` in the lookup data store refuses objects | [L16, L120](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L16) |
| 11.3.0 (milestone, not released when checked) | Disabled variations get no attribute rows, a variation's status change rebuilds its rows, and a migration deletes existing rows of disabled variations | [PR 68482](https://github.com/woocommerce/woocommerce/pull/68482), merged 2026-09-25 |

Current release when this skill was last verified (2026-09-29): 11.1.2, released 2026-09-22
([release](https://github.com/woocommerce/woocommerce/releases/tag/11.1.2)). 11.2.0 was in beta (11.2.0-beta.2,
2026-09-28) ([releases](https://github.com/woocommerce/woocommerce/releases)).

Open reports this skill checks for, as of 2026-09-29:

- [Issue 68112](https://github.com/woocommerce/woocommerce/issues/68112), filed 2026-08-27, open: a failed query in
  the optimized update path removes a product's attribute rows without a log entry.
- [Issue 69008](https://github.com/woocommerce/woocommerce/issues/69008), filed 2026-09-23, open: after PR 68482,
  variation status changes made outside WooCommerce's save do not resync the rows.
- [Issue 68605](https://github.com/woocommerce/woocommerce/issues/68605), filed 2026-09-11, closed as not planned: an
  empty `_price` is rebuilt by neither a save nor the regeneration.

## WordPress

| Release | Change | Source |
| --- | --- | --- |
| 6.2.0 | `$wpdb->prepare()` accepts `%i` for identifiers, which `scripts/lookup-product-diff.php` and WooCommerce's lookup code use | [class-wpdb.php L1442](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L1442) |

Current release when last verified: WordPress 7.1.2
([version check API](https://api.wordpress.org/core/version-check/1.7/)).

## What this means for the checks

- Before 9.1.0 there is no `wp wc palt`; the report prints the command failing and the SQL still runs. Regenerate with
  the Status > Tools entries.
- Before 9.2.0 the meta table has no `global_unique_id`: the stale-value blocks fail on that column. Remove the two
  `global_unique_id` comparisons from a copy of `lookup-checks.sql`, or update WooCommerce first as its own change.
- Before 6.4.0 the attributes table can hold repeated rows; the "repeating the same key" block counts them.
- Before 10.8.0, sale prices that start or end on schedule can leave `onsale` and prices stale in the meta table;
  expect `meta.stale_value` rows on those products.
- From 11.3.0 WooCommerce keeps no rows for `private` (disabled) variations, so the expected set changes: the
  variation status lists in `attr.missing_variation_rows` and `attr.stale_term` and the helper's child query go from
  `publish, private` to `publish`, and rows of private variations become extra rows. Re-read PR 68482 for the exact
  rules before updating this skill.
- `wp action-scheduler action list` needs Action Scheduler 3.9.1 or later: its command class first appears in that
  tag ([3.9.1 Action_Command.php](https://github.com/woocommerce/action-scheduler/blob/3.9.1/classes/WP_CLI/Action_Command.php),
  absent at 3.9.0), whose changelog lists "a number of new WP CLI commands"
  ([changelog L39-L40](https://github.com/woocommerce/action-scheduler/blob/4.0.0/changelog.txt#L39-L40)).
  WooCommerce 11.1.2 bundles 4.0.0
  ([composer.json L56](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/composer.json#L56)).
  On older copies the report's count lines say the command is unavailable; the SQL block with the same counts still
  runs.
