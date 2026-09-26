# Customer sessions and the sessions table

Read this for step 3 of the procedure and whenever `{prefix}woocommerce_sessions` is large or slow. Code links point at
the WooCommerce 11.1.2 tag unless a line says otherwise.

## Where sessions live

- Table `{prefix}woocommerce_sessions`: `session_id` (auto-increment primary key), `session_key` (unique), `session_value`
  (serialized array), `session_expiry` (Unix time), and since 10.3.0 an index on `session_expiry`
  ([class-wc-install.php L1807-L1815](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1807-L1815);
  index added with the cleanup rework in [PR 60711](https://github.com/woocommerce/woocommerce/pull/60711), listed under
  10.3.0 in the [changelog](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt)).
- `session_key` is the user ID for signed-in customers and `t_` plus 30 random characters for guests
  ([class-wc-session-handler.php L450-L452, L460-L462](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L450-L462)).
  The SQL checks split guests from customers on that prefix.
- The browser holds the key in the cookie `wp_woocommerce_session_<COOKIEHASH>` (filter `woocommerce_cookie`)
  ([L72](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L72)).
  WooCommerce's caching guide lists it with a 2-day lifetime next to `woocommerce_cart_hash` and
  `woocommerce_items_in_cart` ([caching guide](https://developer.woocommerce.com/docs/best-practices/performance/configuring-caching-plugins/)).

## When a row is written

- The session cookie is set when the cart cookies are set, that is when the cart has items
  ([session handler L90-L100](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L90-L100);
  [class-wc-cart-session.php L337-L347, L498-L524](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-session.php#L337-L347)),
  and on the order-pay endpoint for guests without a cart
  ([L304-L308](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L304-L308)).
  A visitor who never adds to cart gets no row. Any request with a numeric `add-to-cart` parameter adds to the cart,
  including GET requests from crawlers that follow such links
  ([class-wc-form-handler.php L44, L915-L967](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-form-handler.php#L915-L967)).
- Data is saved once per request at `shutdown`, only when it changed, as one
  `INSERT ... ON DUPLICATE KEY UPDATE`, and copied into the object cache
  ([save_data L551-L578](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L551-L578)).
- Reads try the object cache first, then the table
  ([get_session L656-L680](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L656-L680)).
  See [caching-and-transients.md](caching-and-transients.md#sessions-and-the-object-cache) for what that means on
  several web servers.

## How long a session lives

| Setting | Default | Filter | Source |
| --- | --- | --- | --- |
| Lifetime, guest | 2 days | `wc_session_expiration` | [L391-L443](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L391-L443) |
| Lifetime, signed-in customer | 7 days | `wc_session_expiration` | same |
| Expiry pushed forward on a request once the session is older than | 1 day | `wc_session_expiring` | same; refresh at [L195-L198](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L195-L198) |

- A filter value above 30 days is kept, and WooCommerce logs a warning under the source `wc_session_handler` at most
  once per 30 days ([L417-L434](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L417-L434)).
  In 10.1.0 the value was cut to 30 days
  ([10.1 advisory](https://developer.woocommerce.com/2025/08/08/developer-advisory-changes-to-session-management-and-cron-jobs-in-woocommerce-10-1/));
  10.3.0 removed the cut and kept the warning ([PR 60460](https://github.com/woocommerce/woocommerce/pull/60460)).
- Every day of lifetime is a day of rows. A filter that keeps guest sessions for weeks is the first thing to look
  for when the table is large (`scripts/checkout-state.php` lists callbacks on both filters).

## How rows are removed

- The Action Scheduler action `woocommerce_cleanup_sessions` runs every 12 hours, first at 06:00 site time
  ([class-woocommerce.php L1777](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L1777)).
  It calls `wc_cleanup_session_data()`
  ([wc-core-functions.php L2413-L2421](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L2413-L2421)),
  which deletes expired rows 100 at a time in `session_expiry` order, pausing about 10 ms per full batch, then
  invalidates the session cache group
  ([cleanup_sessions L625-L647](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L625-L647)).
- Before 10.1.0 the same job was a WP-Cron event scheduled `twicedaily`
  ([10.0.0 class-wc-install.php L918](https://github.com/woocommerce/woocommerce/blob/10.0.0/plugins/woocommerce/includes/class-wc-install.php#L918));
  10.1.0 moved all WooCommerce cron jobs to Action Scheduler
  ([PR 59325](https://github.com/woocommerce/woocommerce/pull/59325)).
- So the table only shrinks while Action Scheduler runs. A table full of expired rows means the cleanup action is not
  running or keeps failing: check its rows in the SQL report and read [action-scheduler.md](action-scheduler.md).
- Without the `session_expiry` index (stores whose 10.3.0 schema update did not complete), each batch of the cleanup
  has to scan the table. [database-indexes.md](database-indexes.md) shows how to check and add it.

## Other changes that reduce session data

| Release | Change | Source |
| --- | --- | --- |
| 9.9.0 | Filter `woocommerce_restored_session_data` can trim or empty session data when it is loaded | [L252-L272](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L252-L272) |
| 10.3.0 | Shipping data removed from the session when the cart is emptied or checkout completes | [PR 60800](https://github.com/woocommerce/woocommerce/pull/60800) |
| 10.3.0 | Customer data stored in the session only when it differs from the default customer | [PR 60852](https://github.com/woocommerce/woocommerce/pull/60852) |
| 10.3.0 | Experimental feature "Clear Customer Sessions When Empty" (`destroy-empty-sessions`, off by default): for guests with an empty session, removes the row and the cookie so pages can be served from cache | [FeaturesController.php L614-L624](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L614-L624), [L721-L747](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-session-handler.php#L721-L747), [PR 60855](https://github.com/woocommerce/woocommerce/pull/60855) |
| 10.4.0 | Cart contents removed from the session on the next request after the cart empties | [PR 61223](https://github.com/woocommerce/woocommerce/pull/61223) |

The feature's own description warns that extensions relying on the session cookie without session data may break,
so treat it as a change with a test pass on staging
([FeaturesController.php L614-L624](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L614-L624)).

## Saved carts of signed-in customers

- Signed-in customers' carts are also kept in user meta `_woocommerce_persistent_cart_<blog id>`, updated on add, remove,
  restore and quantity change (filter `woocommerce_persistent_cart_enabled`)
  ([class-wc-cart-session.php L80-L83, L460-L491](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-session.php#L460-L491)).
- 10.1.0 moved them into the sessions table ([PR 57961](https://github.com/woocommerce/woocommerce/pull/57961)) and 10.1.2
  moved them back to user meta ([PR 60605](https://github.com/woocommerce/woocommerce/pull/60605)). The 10.1 advisory
  still describes the moved version; the code above is what runs in 11.1.2.

## The "Clear customer sessions" tool

WooCommerce > Status > Tools > "Clear customer sessions" truncates the sessions table, deletes every saved cart in user
meta and flushes the whole object cache
([tools controller L171-L178, L628-L635](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-tools-v2-controller.php#L628-L635)).
Every shopper loses their cart and every page starts with a cold cache. It is not a cleanup tool for a live store. To
remove expired rows only, run the same function the scheduled job runs (see
[changes-and-rollback.md](changes-and-rollback.md#remove-expired-sessions-now)).

## What to measure

Run the session blocks of `scripts/checkout-checks.sql` (the report script runs them):

- rows, expired rows, guest and customer rows, stored megabytes, average and largest `session_value`;
- rows per expiry day: by default a guest row expires within 2 days of its last activity, so the next two days show
  roughly how many guest carts were active in the last two days;
- whether the `session_expiry` index exists;
- the status and last run of `woocommerce_cleanup_sessions` in Action Scheduler.

Read the results this way:

| Result | Likely cause | Next |
| --- | --- | --- |
| Many expired rows | Cleanup action not running or failing | [action-scheduler.md](action-scheduler.md) |
| Expiry days far in the future | A filter extends session lifetime | Callbacks on `wc_session_expiration` in the state report |
| Guest rows far above the number of shoppers in analytics | Bots adding to cart, or add-to-cart links crawled | Access log counts for `add-to-cart`; bot rules at the edge |
| Large average `session_value` | Big carts, or plugins storing data in the session | Inspect one test session's keys on staging, never a customer's |
| No `session_expiry` index | Schema update incomplete | [database-indexes.md](database-indexes.md) |
