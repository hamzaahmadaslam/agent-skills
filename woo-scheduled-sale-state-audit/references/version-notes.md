# What changed by release, and what is still open

Read the store's versions first (the report prints them) and apply the rows at or below them. Release dates come from
WooCommerce's [changelog](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt) (up to 11.0.0) and the
[11.1.0 readme](https://github.com/woocommerce/woocommerce/blob/11.1.0/plugins/woocommerce/readme.txt) and
[11.1.2 readme](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/readme.txt#L173) (11.1.x).
Each row links the pull request or issue that shows the change; the milestone named is the one on the pull request.

Current releases when this skill was last verified (2026-09-29): WooCommerce 11.1.2, released 2026-09-22
([release](https://github.com/woocommerce/woocommerce/releases/tag/11.1.2)); 11.2.0 in beta
([11.2.0-beta.2](https://github.com/woocommerce/woocommerce/releases/tag/11.2.0-beta.2), 2026-09-28). WordPress 7.1.2
([version check](https://api.wordpress.org/core/version-check/1.7/), [tag](https://github.com/WordPress/wordpress-develop/tree/7.1.2)). Action Scheduler 4.0.0 bundled with WooCommerce 11.1.2
([composer.json](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/composer.json)).

## WooCommerce

| Release | Change for scheduled sales | Source |
| --- | --- | --- |
| Before 10.1.0 | `woocommerce_scheduled_sales` is a daily WP-Cron event, first at midnight site time | [10.0.0 class-wc-install.php L898](https://github.com/woocommerce/woocommerce/blob/10.0.0/plugins/woocommerce/includes/class-wc-install.php#L898) |
| 10.1.0 (2025-08-12) | It becomes a daily Action Scheduler action in the `woocommerce` group | [10.1.0 class-woocommerce.php L1403](https://github.com/woocommerce/woocommerce/blob/10.1.0/plugins/woocommerce/includes/class-woocommerce.php#L1403) |
| 10.3.0 to 10.4.3 | No change to the sale code: `wc_scheduled_sales()` is identical in 10.3.0 and 10.4.3. The daily start clears the start date, the daily end clears the sale price and both dates | [10.3.0](https://github.com/woocommerce/woocommerce/blob/10.3.0/plugins/woocommerce/includes/wc-product-functions.php), [10.4.3](https://github.com/woocommerce/woocommerce/blob/10.4.3/plugins/woocommerce/includes/wc-product-functions.php) |
| 10.5.0 (2026-02-04) | Per-product events `wc_product_start_scheduled_sale` and `wc_product_end_scheduled_sale` at the exact boundary; the daily action stays as a safety net; sale price and dates are kept after a sale ends | [PR 62115](https://github.com/woocommerce/woocommerce/pull/62115), [changelog L1163](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L1163), [issue 62130](https://github.com/woocommerce/woocommerce/issues/62130) |
| 10.5.0 | Product instance caching added (on for new installs) | [ProductCacheController.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Caches/ProductCacheController.php#L13-L26) |
| 10.8.0 (2026-05-26) | The sale handlers refresh the lookup row | [PR 63856](https://github.com/woocommerce/woocommerce/pull/63856), [changelog L627](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L627) |
| 10.8.0 | Events are scheduled from the date meta hooks, so direct `update_post_meta()` writes and importers get them | [PR 64140](https://github.com/woocommerce/woocommerce/pull/64140), [changelog L649](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L649) |
| 10.8.0 | The daily run primes the post cache for the products it loads | [PR 63773](https://github.com/woocommerce/woocommerce/pull/63773), [changelog L736](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L736) |
| 11.0.0 (2026-08-04) | No duplicate pending events for the same product, hook and time | [PR 65709](https://github.com/woocommerce/woocommerce/pull/65709), [changelog L99](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L99) |
| 11.0.0 | Variation bulk action "Set scheduled sale dates" rejects an end before the start and no longer stores 1970-01-01 for a blank date | [PR 66013](https://github.com/woocommerce/woocommerce/pull/66013), [changelog L137](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L137) |
| 11.1.0 (2026-09-03) | View-context price corrected during the gap between a boundary and its event (simple products; not variable parents, the lookup table or `_price`) | [PR 65551](https://github.com/woocommerce/woocommerce/pull/65551), [readme L243](https://github.com/woocommerce/woocommerce/blob/11.1.0/plugins/woocommerce/readme.txt#L243) |
| 11.1.0 | Quick Edit gets sale date fields and keeps a valid schedule when prices change | [PR 66931](https://github.com/woocommerce/woocommerce/pull/66931), [readme L180](https://github.com/woocommerce/woocommerce/blob/11.1.0/plugins/woocommerce/readme.txt#L180), [PR 66648](https://github.com/woocommerce/woocommerce/pull/66648), [PR 66726](https://github.com/woocommerce/woocommerce/pull/66726), [PR 67052](https://github.com/woocommerce/woocommerce/pull/67052) |
| 11.2.0 (in beta on 2026-09-29) | The daily "starting" query skips sales whose end date has passed | [PR 67958](https://github.com/woocommerce/woocommerce/pull/67958), [11.2.0-beta.2 L1457-L1485](https://github.com/woocommerce/woocommerce/blob/11.2.0-beta.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1457-L1485) |
| 11.3.0 (milestone) | The daily run processes products in groups of 50 and releases caches between groups | [PR 68016](https://github.com/woocommerce/woocommerce/pull/68016) |

## The regressions that 10.5.0 introduced, and where each was fixed

[PR 62115](https://github.com/woocommerce/woocommerce/pull/62115) moved sales to per-product events in 10.5.0. Three
faults in the code it added were confirmed in issues or pull requests and fixed in later releases:

| Fault | Introduced | Fixed | Source |
| --- | --- | --- | --- |
| Sale events wrote `_price` but left the lookup table stale until a manual save ("What I missed") | 10.5.0 | 10.8.0 | [PR 63856](https://github.com/woocommerce/woocommerce/pull/63856) |
| Duplicate pending `wc_product_*_scheduled_sale` actions from concurrent saves | 10.5.0 | 11.0.0 | [issue 63517](https://github.com/woocommerce/woocommerce/issues/63517), [PR 65709](https://github.com/woocommerce/woocommerce/pull/65709) |
| The daily run selects every completed sale as starting and ending, every day | 10.5.0 | 11.2.0, not yet stable on 2026-09-29 | [issue 66720](https://github.com/woocommerce/woocommerce/issues/66720), [PR 67958](https://github.com/woocommerce/woocommerce/pull/67958) |

Two related gaps from the same change were also closed: events were not scheduled for direct meta writes until 10.8.0
([PR 64140](https://github.com/woocommerce/woocommerce/pull/64140)), and the shown and charged price lagged the
boundary until the event ran until 11.1.0 ([issue 64542](https://github.com/woocommerce/woocommerce/issues/64542),
[PR 65551](https://github.com/woocommerce/woocommerce/pull/65551)).

## Reported on 10.4.x, not confirmed as a code change

A WordPress.org support topic reports that on 10.4.3 a sale started by `wc_scheduled_sales()` showed as on sale while
`_price` and the lookup `onsale` flag kept the regular price, and that saving the product fixed it
([support topic](https://wordpress.org/support/topic/scheduled-sale-prices-still-not-persisting-to-_price-meta-woocommerce-10-4-x/)).
The topic is marked resolved without a fix version; support pointed to
[issue 61735](https://github.com/woocommerce/woocommerce/issues/61735), which was closed as not planned. The sale code
is the same in 10.3.0 and 10.4.3 (table above), so treat such a report as a store-specific cause (a filter, a direct
meta write, a cache) and check it with this skill's SQL and per-product reads rather than as a known 10.4 fault.

## Still open or unfixed in 11.1.2

| Item | State on 2026-09-29 | Source |
| --- | --- | --- |
| Completed sales reprocessed daily | Fix merged for 11.2.0; present in 11.1.2 | [issue 66720](https://github.com/woocommerce/woocommerce/issues/66720) |
| Empty or `0` sale price with a start date reprocessed daily | Open | [issue 67995](https://github.com/woocommerce/woocommerce/issues/67995) |
| Daily run can run out of memory before saving anything | Fix milestoned 11.3.0 | [PR 68016](https://github.com/woocommerce/woocommerce/pull/68016) |
| Daily action stuck at the time of day it was first created | Open; the realignment PR was closed unmerged | [issue 63061](https://github.com/woocommerce/woocommerce/issues/63061), [PR 65797](https://github.com/woocommerce/woocommerce/pull/65797), [issue 65854](https://github.com/woocommerce/woocommerce/issues/65854) |
| Bulk Edit clears both sale dates on any price change | Issue closed on 2026-07-28 while the fix PR was closed unmerged; the clearing code is unchanged in 11.1.2, 11.2.0-beta.2 and trunk | [issue 66696](https://github.com/woocommerce/woocommerce/issues/66696), [PR 66715](https://github.com/woocommerce/woocommerce/pull/66715), [11.1.2 L632-L642](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/class-wc-admin-post-types.php#L632-L642), [trunk](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/admin/class-wc-admin-post-types.php) |
| Date-only CSV end date imports as 00:00 | Fix PR open | [PR 66634](https://github.com/woocommerce/woocommerce/pull/66634) |
| Variation "cancel schedule" link does not clear expired dates | Open | [issue 62270](https://github.com/woocommerce/woocommerce/issues/62270) |

## Action Scheduler

| Release | Change | Source |
| --- | --- | --- |
| 3.9.3 | `action_scheduler_ensure_recurring_actions`, fired daily, lets plugins re-create recurring actions | [ActionScheduler_RecurringActionScheduler.php L62-L83](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_RecurringActionScheduler.php#L62-L83) (`@since 3.9.3`) |
| 4.0.0 | Bundled with WooCommerce 11.1.2 | [composer.json](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/composer.json) |

## What this means for the audit

- Before 10.5.0: only the daily action changes `_price`; no per-product events exist, and the SQL event blocks return
  nothing. A sale starts and ends at the daily action's time, not at the boundary.
- 10.5.0 to 10.7.x: also refresh lookup rows after fixing `_price` (F4 does not exist there; the lookup tool does);
  products whose dates were written directly have no events.
- 10.5.0 to 11.1.x: expect the churn set of issue 66720 in the daily "starting" list; do not run the daily action
  by hand.
- Before 11.0.0: duplicate pending events are expected on busy stores; they are harmless.
- Before 11.1.0: the product page and the cart show and charge the stale `_price` until the event runs.
