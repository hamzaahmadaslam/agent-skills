# What changed by WooCommerce release

Read the store's version first (`wp plugin get woocommerce --field=version`) and apply the rows at or below it. Dates are
release dates from WooCommerce's [changelog.txt](https://github.com/woocommerce/woocommerce/blob/trunk/changelog.txt);
each row links the pull request or the tagged code that shows the change.

| Release | Change that matters for a migration | Source |
| --- | --- | --- |
| 8.2.0 (2023-10-13) | HPOS leaves the experimental flag and becomes the default for new installs; `wp wc cot enable` and `disable` added; filter `woocommerce_hpos_enable_sync_on_read` added | [PR 39846](https://github.com/woocommerce/woocommerce/pull/39846), [PR 40296](https://github.com/woocommerce/woocommerce/pull/40296), [PR 39865](https://github.com/woocommerce/woocommerce/pull/39865), [PR 40039](https://github.com/woocommerce/woocommerce/pull/40039) |
| 8.3.0 (2023-11-16) | Background sync independent of real-time sync; "Sync orders now" button on the Features screen | [PR 39952](https://github.com/woocommerce/woocommerce/pull/39952) |
| 8.5.0 (2024-01-09) | `wp wc hpos cleanup`; with HPOS on, trashed orders are deleted after `EMPTY_TRASH_DAYS` | [PR 42848](https://github.com/woocommerce/woocommerce/pull/42848), [PR 41949](https://github.com/woocommerce/woocommerce/pull/41949) |
| 8.6.0 (2024-02-13) | `wp wc hpos status` and `wp wc hpos diff`; filter `woocommerce_hpos_sync_ignored_order_props`; Order ID and Customer email options in the order search | [8.6.0 tag](https://github.com/woocommerce/woocommerce/blob/8.6.0/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L67-L69), [PR 43173](https://github.com/woocommerce/woocommerce/pull/43173), [PR 43123](https://github.com/woocommerce/woocommerce/pull/43123), [PR 43865](https://github.com/woocommerce/woocommerce/pull/43865) |
| 8.7.0 (2024-03-01) | `wp wc hpos backfill`; background legacy data cleanup | [PR 44281](https://github.com/woocommerce/woocommerce/pull/44281), [PR 43293](https://github.com/woocommerce/woocommerce/pull/43293) |
| 8.8.0 (2024-04-10) | Partial backfill (`--meta_keys`, `--props`); backup posts restored during sync; safeguards against orders removed by sync; backup posts protected from deletion while HPOS is on | [PR 45171](https://github.com/woocommerce/woocommerce/pull/45171), [PR 45332](https://github.com/woocommerce/woocommerce/pull/45332), [PR 45330](https://github.com/woocommerce/woocommerce/pull/45330), [DataSynchronizer.php L967-L987](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L967-L987) |
| 8.9.0 (2024-05-14) | `count_unmigrated`, `sync`, `verify_data`, `enable`, `disable` move to `wp wc hpos`; the `wp wc cot` names are deprecated; custom admin search filters; Legacy REST API warnings | [PR 46766](https://github.com/woocommerce/woocommerce/pull/46766), [PR 45954](https://github.com/woocommerce/woocommerce/pull/45954), [PR 46841](https://github.com/woocommerce/woocommerce/pull/46841) |
| 9.0.0 (2024-06-18) | Experimental full text search indexes; `get_edit_post_link()` on placeholders returns the HPOS edit URL; cleanup also removes meta of deleted orders | [PR 46130](https://github.com/woocommerce/woocommerce/pull/46130), [PR 47149](https://github.com/woocommerce/woocommerce/pull/47149), [PR 46970](https://github.com/woocommerce/woocommerce/pull/46970) |
| 9.1.0 (2024-07-10) | `wp wc hpos compatibility-mode enable` and `disable` | [PR 48117](https://github.com/woocommerce/woocommerce/pull/48117) |
| 9.2.0 (2024-08-20) | `wp wc hpos compatibility-info`; filter `woocommerce_plugins_are_incompatible_with_feature_by_default` | [9.2.0 tag](https://github.com/woocommerce/woocommerce/blob/9.2.0/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php), [FeaturesController.php L906-L918](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L906-L918) |
| 9.5.0 (2024-12-16) | Turning on compatibility mode creates the HPOS tables if missing | [PR 51973](https://github.com/woocommerce/woocommerce/pull/51973) |
| 9.9.0 (2025-06-02) | Settings-screen "in sync" check can miss orders changed after a full sync (the CLI count is unaffected) | [PR 56186](https://github.com/woocommerce/woocommerce/pull/56186), described in [PR 67838](https://github.com/woocommerce/woocommerce/pull/67838) |
| 10.4.0 (2025-12-10) | HPOS Data Caching leaves the experimental phase | [PR 61521](https://github.com/woocommerce/woocommerce/pull/61521) |
| 10.7.0 (2026-04-14) | Sync-on-read off by default, with an admin notice for sites on HPOS plus compatibility mode; order capability checks translated for HPOS orders when sync is off | [PR 63175](https://github.com/woocommerce/woocommerce/pull/63175), [HposOrderCapabilityHelper.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/HposOrderCapabilityHelper.php#L17-L32) |
| 11.0.0 (2026-08-04) | `OrderUtil::custom_orders_table_data_sync_is_enabled()`; order capabilities for placeholder posts; faster HPOS order list on large stores | [PR 65649](https://github.com/woocommerce/woocommerce/pull/65649), [PR 58432](https://github.com/woocommerce/woocommerce/pull/58432), [PR 65663](https://github.com/woocommerce/woocommerce/pull/65663) |
| 11.1.0 (2026-09-03) | Legacy reports read the HPOS tables when HPOS is on; settings-screen "in sync" false negative fixed | [PR 65493](https://github.com/woocommerce/woocommerce/pull/65493), [PR 67838](https://github.com/woocommerce/woocommerce/pull/67838) |

## What this means for the plan

- On any release before 11.1.0: update WooCommerce (on staging, then production, as its own change) before starting,
  so the settings-screen check and the legacy reports behave as described in this skill.
- Before 8.9.0: replace `wp wc hpos count_unmigrated|sync|verify_data|enable|disable` with
  `wp wc cot count_unmigrated|sync|verify_cot_data|enable|disable`
  ([8.8.0 tag](https://github.com/woocommerce/woocommerce/blob/8.8.0/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L61-L70)).
- Before 9.1.0: turn compatibility mode on or off with the settings checkbox, or with
  `wp option update woocommerce_custom_orders_table_data_sync_enabled yes` (or `no`). The 9.1.0 command does exactly
  that option update ([CLIRunner.php L1355-L1383](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L1355-L1383)),
  and WooCommerce reacts to the option change itself, creating tables and queueing the sync
  ([DataSynchronizer.php L111-L112, L264-L299](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L264-L299)).
  The `--with-sync` flag of `enable` and `disable` also switches the storage, so it cannot do step 3 on its own
  ([CLIRunner.php L739-L743, L851-L855](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L739-L743)).
- Before 9.2.0: read plugin compatibility from the settings screen or the plugins screen filter instead of
  `compatibility-info`.
- Before 10.7.0: sync-on-read is on while compatibility mode is on. The large-store guide turns it off with
  `add_filter( 'woocommerce_hpos_enable_sync_on_read', '__return_false' );` a few hours after the switch
  ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).
- Current release when this skill was last verified (2026-09-26): 11.1.2, released 2026-09-22
  ([release](https://github.com/woocommerce/woocommerce/releases/tag/11.1.2)).
