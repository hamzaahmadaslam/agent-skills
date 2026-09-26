# What changed by release

Read the store's versions first (the state report prints them) and apply the rows at or below them. WooCommerce dates
come from its [changelog](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt) and
[releases](https://github.com/woocommerce/woocommerce/releases); each row links the pull request or the code that shows
the change.

## WooCommerce

| Release | Change that matters for checkout performance | Source |
| --- | --- | --- |
| 7.8.0 (2023-06-13) | `wc-cart-fragments` no longer enqueued on every page, only by the Cart widget | [PR 35530](https://github.com/woocommerce/woocommerce/pull/35530), [advisory](https://developer.woocommerce.com/2023/06/16/best-practices-for-the-use-of-the-cart-fragments-api/) |
| 9.2.0 (2024-08-20) | Store API holds stock only on the place-order POST, not for every draft order | [Checkout.php L621-L639](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L621-L639) |
| 9.8.0 (2025-04-07) | Bundles Action Scheduler 3.9.2, which has `wp action-scheduler status` and `action list` | [9.8.0 composer.json](https://github.com/woocommerce/woocommerce/blob/9.8.0/plugins/woocommerce/composer.json) |
| 9.9.0 (2025-06-02) | Place-order step logging in both checkouts | [PR 53230](https://github.com/woocommerce/woocommerce/pull/53230) |
| 10.1.0 (2025-08-12) | All WooCommerce cron jobs, session cleanup included, move to Action Scheduler; session lifetime capped at 30 days; persistent carts moved to the sessions table; no-cache headers sent through `wp_headers` | [PR 59325](https://github.com/woocommerce/woocommerce/pull/59325), [advisory](https://developer.woocommerce.com/2025/08/08/developer-advisory-changes-to-session-management-and-cron-jobs-in-woocommerce-10-1/), [PR 57961](https://github.com/woocommerce/woocommerce/pull/57961), [class-wc-cache-helper.php L40-L49](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cache-helper.php#L40-L49) |
| 10.1.2 (2025-08-27) | Persistent carts back in user meta | [PR 60605](https://github.com/woocommerce/woocommerce/pull/60605) |
| 10.3.0 (2025-10-22) | `session_expiry` index and batched session cleanup; 30-day cap removed (warning kept); experimental "Clear Customer Sessions When Empty"; less shipping and customer data in sessions | [PR 60711](https://github.com/woocommerce/woocommerce/pull/60711), [PR 60460](https://github.com/woocommerce/woocommerce/pull/60460), [PR 60855](https://github.com/woocommerce/woocommerce/pull/60855), [PR 60800](https://github.com/woocommerce/woocommerce/pull/60800), [PR 60852](https://github.com/woocommerce/woocommerce/pull/60852) |
| 10.4.0 (2025-12-10) | Place-order logger respects the log level threshold; cart contents removed from emptied sessions | [PR 61842](https://github.com/woocommerce/woocommerce/pull/61842), [PR 61223](https://github.com/woocommerce/woocommerce/pull/61223) |
| 10.5.0 (2026-02-04) | Analytics "Scheduled" imports (every 12 hours) are the default for new stores; existing stores opt in | [release post](https://developer.woocommerce.com/2026/02/06/woocommerce-10-5-improving-analytics-and-admin-performance/), [class-wc-install.php L1338-L1351](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1338-L1351) |
| 10.6.0 (2026-03-10) | Store API cart responses send `Cache-Control: no-store` | [PR 62653](https://github.com/woocommerce/woocommerce/pull/62653) |
| 10.8.0 (2026-05-26) | Deferred emails sent through Action Scheduler; `wc_reserved_stock` index `product_id_expires`; `wc_orders_meta.meta_key_value` reshaped; cleanup of leftover place-order debug logs | [PR 63832](https://github.com/woocommerce/woocommerce/pull/63832), [PR 63864](https://github.com/woocommerce/woocommerce/pull/63864), [wc-update-functions.php L3466-L3528](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-update-functions.php#L3466-L3528), [PR 63756](https://github.com/woocommerce/woocommerce/pull/63756) |
| 10.9.0 (2026-06-23) | Block checkout creates the order at place-order time, not on page views and form changes | [PR 64155](https://github.com/woocommerce/woocommerce/pull/64155) |
| 11.0.0 (2026-08-04) | Bundles Action Scheduler 4.0.0; filter `woocommerce_shipping_package_hash_ignored_fields` | [11.0.0 composer.json](https://github.com/woocommerce/woocommerce/blob/11.0.0/plugins/woocommerce/composer.json), [class-wc-shipping.php L419-L451](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-shipping.php#L419-L451) |
| 11.0.1 (2026-08-10) | Filter `woocommerce_order_step_logging_enabled` turns the place-order logger off | [11.0.1 wc-order-step-logger-functions.php L40-L50](https://github.com/woocommerce/woocommerce/blob/11.0.1/plugins/woocommerce/includes/wc-order-step-logger-functions.php#L40-L50) |

Current release when this skill was last verified (2026-09-26): 11.1.2, released 2026-09-22
([release](https://github.com/woocommerce/woocommerce/releases/tag/11.1.2)).

## Action Scheduler

| Release | Change | Source |
| --- | --- | --- |
| 3.9.1 (2025-01-21) | New WP-CLI commands, among them `status` and `action list` | [3.9.1 System_Command.php](https://github.com/woocommerce/action-scheduler/blob/3.9.1/classes/WP_CLI/System_Command.php), [changelog](https://github.com/woocommerce/action-scheduler/blob/4.0.0/changelog.txt) |
| 4.0.0 (2026-06-16) | Failed actions purged after 3 months by default; cleanup runs as its own daily action at 3 am | [changelog](https://github.com/woocommerce/action-scheduler/blob/4.0.0/changelog.txt) |

## WordPress

| Release | Change | Source |
| --- | --- | --- |
| 6.1.0 | Site Health test that suggests a persistent object cache | [class-wp-site-health.php L2556-L2560, L3750-L3756](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3750-L3756) |
| 6.6.0 | Options autoload when `autoload` is `yes`, `on`, `auto-on` or `auto` (filter `wp_autoload_values_to_autoload`); queries that test only `yes` miss rows | [option.php L3259-L3275](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L3259-L3275) |
| 6.9.0 | WP-Cron is spawned at `shutdown` instead of `wp_loaded`, so it no longer delays a page's first byte | [cron.php L1005-L1032](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1005-L1032) |

## What this means for the audit

- Before 10.1.0, session cleanup is the WP-Cron event `woocommerce_cleanup_sessions`: check it with
  `wp cron event list` instead of the Action Scheduler rows.
- Before 10.3.0 there is no `session_expiry` index and the cleanup deletes every expired row in one statement
  ([10.2.0 class-wc-session-handler.php L630](https://github.com/woocommerce/woocommerce/blob/10.2.0/plugins/woocommerce/includes/class-wc-session-handler.php#L630)),
  which on a large table is one long scan and delete.
- Before 10.9.0, count `wc-checkout-draft` orders: block checkout created them on page views and form changes.
- Before 11.0.1 the place-order logger cannot be turned off with a filter; measure its cost, and treat a WooCommerce
  update as its own change (staging first).
- Before 9.8.0, the `wp action-scheduler status` command may be missing; use the SQL blocks.
- Before WordPress 6.9.0, WP-Cron's spawn can add to the checkout page's first byte time on the requests that start it.
