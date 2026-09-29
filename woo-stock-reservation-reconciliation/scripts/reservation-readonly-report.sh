#!/usr/bin/env bash
# Read-only helper. Prints the stock reservation state of one WooCommerce site: versions, the stock and hold settings,
# the order storage in use, the unpaid-order cancel action, the callbacks on the filters that change how stock is held,
# reduced and restored, and the SELECT statements in reservation-checks.sql for the matching order storage.
#
# It runs WP-CLI read commands only: `wp option get`, `wp eval` that prints the WordPress version and reads hook
# callbacks (it calls no update, delete, save or schedule function), `wp action-scheduler action next` and
# `action list`, `wp cron event list`, `wp db prefix`, and `wp db query` with the SELECT blocks. It makes no network
# calls of its own and changes no settings, orders, products or tables. Loading WordPress runs the site's own code, as
# any request does. WordPress loads with WP-Cron spawning turned off (a spawn writes the doing_cron lock and sends a
# loopback request) and without WP-CLI's own update check.
#
# Usage (run where WP-CLI can reach the site; any arguments are passed to every wp call as global flags):
#   bash reservation-readonly-report.sh --path=/var/www/html
#   bash reservation-readonly-report.sh --path=/var/www/html --url=example.com/shop      # one site of a multisite
#   RESERVATION_REPORT_SKIP_SQL=1 bash reservation-readonly-report.sh --path=/var/www/html
#   RESERVATION_REPORT_SKIP_SCANS=1 bash reservation-readonly-report.sh --path=/var/www/html   # skip "(scan)" blocks
#
# Needs: bash, WP-CLI with WooCommerce active, and the mysql client that `wp db query` uses.
# The output holds settings, hook names, counts, product IDs, SKUs and order IDs. It prints no names, emails or
# addresses. Treat it as store data all the same: keep it out of public places and delete it after the work.

set -u

export WP_CLI_DISABLE_AUTO_CHECK_UPDATE=1
NO_SPAWN='--exec=WP_CLI::add_wp_hook( "init", static function () { remove_action( "init", "wp_cron" ); }, 0 );'
WP=(wp "$NO_SPAWN" "$@")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$HERE/reservation-checks.sql"

section() {
	printf '\n== %s ==\n' "$1"
}

# Print a command (without the --exec guard), run it, and keep going when it fails (older releases lack some commands).
run() {
	local shown=() arg
	for arg in "$@"; do [ "$arg" = "$NO_SPAWN" ] || shown+=("$arg"); done
	printf '$ %s\n' "${shown[*]}"
	"$@" 2>&1 || printf '(command failed with exit code %s)\n' "$?"
}

option() {
	local value
	value="$("${WP[@]}" option get "$1" 2>/dev/null)" || value='(not set)'
	printf '%-52s %s\n' "$1:" "$value"
}

section "Report time (UTC)"
date -u '+%Y-%m-%d %H:%M:%S'

section "Versions"
option woocommerce_version
option woocommerce_schema_version
printf '%-52s ' 'WordPress:'
"${WP[@]}" eval 'echo get_bloginfo( "version" ), "\n";' 2>/dev/null || printf '(unknown)\n'

section "Stock and hold settings (references/orders-and-cancellation.md)"
option woocommerce_manage_stock
option woocommerce_hold_stock_minutes
option woocommerce_stock_format
printf 'A blank hold setting means no holds at checkout and no cancel action.\n'

section "Order storage (references/storage-hpos-and-posts.md)"
option woocommerce_custom_orders_table_enabled
option woocommerce_custom_orders_table_data_sync_enabled
HPOS="$("${WP[@]}" option get woocommerce_custom_orders_table_enabled 2>/dev/null)"
if [ "$HPOS" = "yes" ]; then
	STORAGE="HPOS"
else
	STORAGE="posts"
fi
printf 'Authoritative order storage: %s\n' "$STORAGE"

section "Unpaid-order cancel action (Action Scheduler; WP-Cron before WooCommerce 10.1.0)"
run "${WP[@]}" action-scheduler action next woocommerce_cancel_unpaid_orders
for status in pending failed; do
	printf 'woocommerce_cancel_unpaid_orders, %s: ' "$status"
	"${WP[@]}" action-scheduler action list --hook=woocommerce_cancel_unpaid_orders --status="$status" --per_page=0 --format=count 2>/dev/null ||
		printf '(action-scheduler command unavailable)\n'
done
printf 'Latest completed runs:\n'
run "${WP[@]}" action-scheduler action list --hook=woocommerce_cancel_unpaid_orders --status=complete --per_page=3 \
	--orderby=date --order=DESC --fields=id,status,scheduled_date
printf 'WP-Cron events for the same hook (expected only before WooCommerce 10.1.0):\n'
"${WP[@]}" cron event list --fields=hook,next_run_gmt,recurrence --format=csv 2>/dev/null |
	grep -E '^hook,|woocommerce_cancel_unpaid_orders' ||
	printf '(no matching events, or the cron command is unavailable)\n'

section "Callbacks on filters that change holds, reductions and restores"
printf 'WP-CLI loads WordPress without a front-end request: callbacks added only there are missing (a lower bound).\n'
# The PHP below only reads $wp_filter and prints; it contains no single quotes so the shell passes it unchanged.
"${WP[@]}" eval '
$hooks = array(
	"woocommerce_hold_stock_for_checkout",
	"woocommerce_order_hold_stock_minutes",
	"woocommerce_query_for_reserved_stock",
	"woocommerce_order_item_quantity",
	"woocommerce_cart_item_required_stock_is_not_enough",
	"woocommerce_cancel_unpaid_order",
	"woocommerce_cancel_unpaid_orders_interval_minutes",
	"woocommerce_payment_complete_reduce_order_stock",
	"woocommerce_can_reduce_order_stock",
	"woocommerce_can_restore_order_stock",
	"woocommerce_update_product_stock_query",
	"woocommerce_bacs_process_payment_order_status",
	"woocommerce_delete_expired_draft_orders_batch_size",
);
global $wp_filter;
$root = wp_normalize_path( ABSPATH );
foreach ( $hooks as $hook ) {
	if ( empty( $wp_filter[ $hook ] ) || ! $wp_filter[ $hook ] instanceof WP_Hook ) {
		printf( "%s: no callbacks\n", $hook );
		continue;
	}
	foreach ( $wp_filter[ $hook ]->callbacks as $priority => $items ) {
		foreach ( $items as $item ) {
			$fn = $item["function"];
			try {
				if ( is_string( $fn ) ) {
					$name = $fn;
				} elseif ( is_array( $fn ) ) {
					$name = ( is_object( $fn[0] ) ? get_class( $fn[0] ) : (string) $fn[0] ) . "::" . $fn[1];
				} elseif ( $fn instanceof Closure ) {
					$ref  = new ReflectionFunction( $fn );
					$name = "closure in " . str_replace( $root, "", wp_normalize_path( (string) $ref->getFileName() ) ) . ":" . $ref->getStartLine();
				} else {
					$name = "callable object " . get_class( $fn );
				}
			} catch ( Throwable $e ) {
				$name = "unresolved callable";
			}
			printf( "%s: priority %s, %s\n", $hook, $priority, $name );
		}
	}
}
' 2>&1 || printf '(could not read hook callbacks)\n'

if [ "${RESERVATION_REPORT_SKIP_SQL:-0}" = "1" ]; then
	section "SQL checks"
	printf 'Skipped (RESERVATION_REPORT_SKIP_SQL=1).\n'
	printf '\nDone. Nothing was changed.\n'
	exit 0
fi

section "SQL checks ($SQL_FILE), $STORAGE blocks"
if [ ! -r "$SQL_FILE" ]; then
	printf 'Cannot read %s\n' "$SQL_FILE"
	exit 0
fi

PREFIX="$("${WP[@]}" db prefix 2>/dev/null)"
if ! [[ "$PREFIX" =~ ^[A-Za-z0-9_]+$ ]]; then
	printf 'Unexpected table prefix "%s"; skipping SQL.\n' "$PREFIX"
	exit 0
fi
printf 'Table prefix: %s\n' "$PREFIX"

# Run one block: skip blocks for the other storage (and scans when asked), fill in the prefix, send it to wp db query.
run_block() {
	local name="$1" sql="$2"
	[ -z "$name" ] && return 0
	case "$name" in
		*"(HPOS)") [ "$STORAGE" = "HPOS" ] || return 0 ;;
		*"(posts)") [ "$STORAGE" = "posts" ] || return 0 ;;
	esac
	if [ "${RESERVATION_REPORT_SKIP_SCANS:-0}" = "1" ] && [[ "$name" == *"(scan)"* ]]; then
		printf '\n-- %s\n(skipped: RESERVATION_REPORT_SKIP_SCANS=1)\n' "$name"
		return 0
	fi
	sql="${sql//\{prefix\}/$PREFIX}"
	printf '\n-- %s\n' "$name"
	printf '%s\n' "$sql" | "${WP[@]}" db query 2>&1 || printf '(query failed with exit code %s)\n' "$?"
}

block_name=""
block_sql=""
while IFS= read -r line || [ -n "$line" ]; do
	case "$line" in
		"-- name:"*)
			run_block "$block_name" "$block_sql"
			block_name="${line#-- name: }"
			block_sql=""
			;;
		"--"* | "") ;;
		*)
			if [ -n "$block_name" ]; then
				block_sql="${block_sql}${line}"$'\n'
			fi
			;;
	esac
done <"$SQL_FILE"
run_block "$block_name" "$block_sql"

printf '\nDone. Nothing was changed.\n'
