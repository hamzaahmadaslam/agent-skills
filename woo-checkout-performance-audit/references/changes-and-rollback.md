# Changes, each with a backup, a check and an undo

Every step here changes the site. Before each one: state the step, its backup, its check and its undo to the owner and
wait for approval of that step. Run it on staging first, then on production at a quiet hour. Change one thing at a
time and measure before and after with the same method ([measuring.md](measuring.md)).

## Backups used below

| Backup | Command | Restore | Source |
| --- | --- | --- | --- |
| Full database | `wp db export /path/outside/webroot/<name>.sql --single-transaction` | `wp db import <file>` on staging, never blindly over a live store | [db export](https://developer.wordpress.org/cli/commands/db/export/) (extra flags go to `mysqldump`); [db import](https://developer.wordpress.org/cli/commands/db/import/) |
| One table | `wp db export /path/outside/webroot/<name>.sql --tables=<prefix><table> --single-transaction` | `wp db import <file>` replaces that table with the saved copy | same |
| One option | `wp option get <name> --format=json > <name>.json` | `wp option update <name> --format=json < <name>.json` | [option get](https://developer.wordpress.org/cli/commands/option/get/); [option update](https://developer.wordpress.org/cli/commands/option/update/) (value read from STDIN when omitted) |
| A file | `cp <file> <file>.bak-<date>` | copy it back | |

When `wp option get` finds no option, write that down instead: the undo is then `wp option delete <name>`.

Database exports hold customer data: write them outside the web root, keep them off shared drives and chats, and
delete them after the retention period the owner sets. A backup counts only after one test restore on staging.

## Install Query Monitor (to measure)

- Command: `wp plugin install query-monitor --activate`.
- Backup: note whether `wp-content/db.php` exists; Query Monitor symlinks its own there only when none exists
  ([Activation.php L31-L68](https://github.com/johnbillion/query-monitor/blob/4.0.7/classes/Activation.php#L31-L68)).
- Check: the toolbar entry appears for administrators; the site behaves as before.
- Undo: `wp plugin deactivate query-monitor`, then `wp plugin delete query-monitor`; deactivation removes the symlink it
  created (same source).

## Temporary outbound HTTP timing

- Change: add `wp-content/mu-plugins/checkout-audit-http-timing.php` with the code in
  [gateways-and-shipping.md](gateways-and-shipping.md#timing-outbound-http-calls).
- Backup: none needed, the file is new.
- Check: after a test checkout on staging, WooCommerce > Status > Logs has entries under `checkout-audit-http`.
- Undo: delete the file, then delete that log source.

## Remove expired sessions now

Use this once, after the Action Scheduler runner works again, when the table is full of expired rows. It runs the
same function the scheduled job runs, which deletes only rows whose `session_expiry` has passed
([sessions.md](sessions.md#how-rows-are-removed)).

- Backup: one-table export of `<prefix>woocommerce_sessions`.
- Command: `wp eval 'wc_cleanup_session_data();'`
- Check: the expired count in the SQL report falls to about zero; a test cart survives a page reload; the slow query
  log shows no long-running delete.
- Undo: rarely needed, since expired sessions cannot be used. Importing the export restores the table as it was, and
  loses the carts created since the backup.
- Never use the "Clear customer sessions" tool for this: it empties every cart and flushes the object cache.

## Session lifetime

- Change: shorten or remove the plugin setting or filter that extends `wc_session_expiration` (found in the state
  report). WooCommerce's defaults are 2 days for guests and 7 for customers.
- Backup: the plugin's settings (one option) or a copy of the file with the filter.
- Check: new rows in the SQL report's expiry-day block fall within the new lifetime.
- Undo: restore the option or the file.

## "Clear Customer Sessions When Empty" (experimental)

- Change: WooCommerce > Settings > Advanced > Features, tick the feature (option
  `woocommerce_feature_destroy-empty-sessions_enabled`). The settings screen runs WooCommerce's own checks; prefer it
  to setting the option by hand.
- Backup: the option's current value.
- Check: a guest who empties the cart has no session cookie on the next page; the store's own flows (wishlists,
  currency switchers, anything that uses the session) still work, since the feature description warns about
  extensions that rely on the cookie
  ([FeaturesController.php L614-L624](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L614-L624)).
- Undo: untick it.

## Cart fragments

Option A, the Mini-Cart block in place of the classic Cart widget:

- Backup: `wp option get sidebars_widgets --format=json` and `wp option get widget_woocommerce_widget_cart --format=json`
  to files; on a block theme, the header template part's content (`wp post get <id> --field=post_content`).
- Check: a HAR of one page view per page type shows no `get_refreshed_fragments`; adding to cart updates the mini cart.
- Undo: restore the two options or the template part content.

Option B, stop the script from running outside WooCommerce pages (the approach in WooCommerce's
[advisory](https://developer.woocommerce.com/2023/06/16/best-practices-for-the-use-of-the-cart-fragments-api/)), as
`wp-content/mu-plugins/checkout-audit-fragments.php`:

```php
<?php
/**
 * Plugin Name: Cart fragments only on WooCommerce pages
 */
add_filter(
	'woocommerce_get_script_data',
	static function ( $data, $handle ) {
		if ( 'wc-cart-fragments' === $handle && ! ( is_woocommerce() || is_cart() || is_checkout() ) ) {
			return null;
		}
		return $data;
	},
	10,
	2
);
```

- Backup: none needed, the file is new.
- Check: no `get_refreshed_fragments` on the home page and posts; on shop pages the mini cart still updates.
- Undo: delete the file.

## Analytics import mode

- Change: Analytics > Settings > Updates: "Scheduled"
  ([Analytics settings](https://woocommerce.com/document/woocommerce-analytics/)).
- Backup: the values of `woocommerce_analytics_scheduled_import` and `woocommerce_analytics_immediate_import` (either
  may be missing).
- Check: a recurring `wc-admin_process_pending_orders_batch` action exists; new orders no longer schedule
  `wc-admin_import_orders`. Analytics lags up to 12 hours unless someone presses "Update now" in Analytics.
- Undo: set "Immediately" again.

## Deferred emails

- Change: WooCommerce > Settings > Advanced > Features, "Deferred emails"
  ([FeaturesController.php L448-L457](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L448-L457)).
  Only with a healthy Action Scheduler queue, since the emails then wait in it.
- Backup: the value of `woocommerce_feature_deferred_transactional_emails_enabled`.
- Check: on staging, the place-order time before and after; the order emails arrive, and the
  `woocommerce_send_queued_transactional_email` actions complete.
- Undo: untick it.

## Shipping debug mode off

- Change: WooCommerce > Settings > Shipping > Shipping settings, untick "Enable debug mode"
  (`woocommerce_shipping_debug_mode`), whose tip says it bypasses the shipping rate cache
  ([class-wc-settings-shipping.php L160-L167](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/settings/class-wc-settings-shipping.php#L160-L167)).
- Backup: the option's value.
- Check: a repeated totals update with an unchanged address is faster than the first.
- Undo: tick it again.

## Page cache rules

- Change: in the page cache (plugin, host panel or CDN), exclude the cart, checkout and my-account paths, requests with
  the WooCommerce cart cookies, `?add-to-cart=`, `?wc-ajax=`, `wc-api` and the Store API
  ([caching-and-transients.md](caching-and-transients.md)).
- Backup: export or copy the current rule set.
- Check: the header checks and the two-profile test in caching-and-transients.md.
- Undo: restore the rule set and purge the cache.

## Object cache and HPOS Data Caching

- A persistent object cache is a hosting change: record the Site Health numbers in the report and ask the host.
- "HPOS Data Caching" (with HPOS and a persistent object cache): WooCommerce > Settings > Advanced > Features; backup
  the option `woocommerce_hpos_datastore_caching_enabled`; check order edits, refunds and a test checkout; undo by
  unticking it.

## Transients

- Change: WooCommerce > Status > Tools > "Expired transients", or `wp transient delete --expired`
  ([transient delete](https://developer.wordpress.org/cli/commands/transient/delete/)).
- Backup: one-table export of `<prefix>options`.
- Check: the expired count in the SQL report is zero; the site behaves as before.
- Undo: expired transients are dead data, so there is nothing to put back. Never import the whole options export over
  a live store, since it would roll back every option changed since; copy single rows from it if one is ever needed.

## A missing index

- Change: WooCommerce > Status > Tools > "Verify base database tables", which runs WooCommerce's schema through
  `dbDelta()` again ([database-indexes.md](database-indexes.md#how-indexes-get-added-and-why-one-can-be-missing)).
  On InnoDB, MySQL 8.4 keeps the table readable and writable while it adds a secondary index, and finishes only when
  the transactions using the table have ended
  ([online DDL](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)). Still, a quiet hour.
- Backup: full database.
- Check: the index block of the SQL report shows the index; the slow query from Query Monitor is faster.
- Undo: `wp db query "ALTER TABLE <prefix><table> DROP INDEX <index_name>"`, only if the new index causes trouble.

## Place-order step logger off (WooCommerce 11.0.1 and later)

- Change: `wp-content/mu-plugins/checkout-audit-step-logger.php` with
  `add_filter( 'woocommerce_order_step_logging_enabled', '__return_false' );`
  ([checkout-requests.md](checkout-requests.md#the-place-order-step-logger)).
- Backup: none needed, the file is new.
- Check: on staging, the place-order request's query count and time before and after; no new `place-order-debug-*`
  log sources.
- Undo: delete the file. The trade-off: failed orders have no step log for WooCommerce support to read.

## Action Scheduler backlog and history

- Old history: `wp action-scheduler clean --status=complete,canceled --before='31 days ago' --batch-size=500 --pause=1`
  deletes what the daily cleaner would ([WP-CLI](https://actionscheduler.org/wp-cli/)). Backup: one-table exports of
  `<prefix>actionscheduler_actions` and `<prefix>actionscheduler_logs`. Check: counts by status. Undo: import both
  files, which also drops actions scheduled since the backup, so take the backup right before and run it at a quiet
  hour.
- Pending backlog: `wp action-scheduler run --batch-size=100 --batches=10` runs due actions now, with their side
  effects (emails, webhooks, API calls). It is the queue's normal work, done sooner; there is no undo. Set up the
  runner itself with the `wp-cron-action-scheduler-health` skill.
