#!/usr/bin/env bash
# Read-only helper. Prints the HPOS migration state of one WooCommerce site.
#
# It runs only WP-CLI read commands (two of them are `wp eval` one-liners that read values: is_multisite() and
# wc_get_order_types()) and the SELECT statements in parity-checks.sql. It changes no settings, orders or tables, and
# it makes no network calls (plugin and theme lists skip the update check). One side effect inside
# WooCommerce: `wp wc hpos status` may refresh the flag option woocommerce_custom_orders_table_created when that option
# is missing. No order data changes.
# WordPress loads with WP-Cron spawning turned off (a spawn writes the doing_cron lock and sends a loopback request)
# and without WP-CLI's own update check.
#
# Usage (run where WP-CLI can reach the site; any arguments are passed to every wp call as global flags):
#   bash hpos-readonly-report.sh --path=/var/www/html
#   bash hpos-readonly-report.sh --path=/var/www/html --url=example.com/shop   # one site of a multisite
#   HPOS_REPORT_SKIP_SQL=1 bash hpos-readonly-report.sh --path=/var/www/html          # skip the SQL section
#
# Needs: bash, WP-CLI with WooCommerce active, and the mysql client that `wp db query` uses.
# The SQL section joins large tables; on a big store run it on a staging copy or a replica, or at a quiet hour.

set -u

# Keep the report read-only: no WP-CLI update check, and no WP-Cron spawn while WordPress loads (WP-CLI removes
# wp_cron only when ALTERNATE_WP_CRON is set).
export WP_CLI_DISABLE_AUTO_CHECK_UPDATE=1
NO_SPAWN='--exec=WP_CLI::add_wp_hook( "init", static function () { remove_action( "init", "wp_cron" ); }, 0 );'
WP=(wp "$NO_SPAWN" "$@")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$HERE/parity-checks.sql"

section() {
	printf '\n== %s ==\n' "$1"
}

# Print a command (without the --exec guard), run it, and keep going when it fails (older WooCommerce releases lack some commands).
run() {
	local shown=() arg
	for arg in "$@"; do [ "$arg" = "$NO_SPAWN" ] || shown+=("$arg"); done
	printf '$ %s\n' "${shown[*]}"
	"$@" 2>&1 || printf '(command failed with exit code %s)\n' "$?"
}

section "Report time (UTC)"
date -u '+%Y-%m-%d %H:%M:%S'

section "Versions and site type"
run "${WP[@]}" core version
run "${WP[@]}" plugin get woocommerce --field=version
run "${WP[@]}" eval 'echo is_multisite() ? "multisite\n" : "single site\n";'

section "Cron"
printf 'DISABLE_WP_CRON: '
"${WP[@]}" config get DISABLE_WP_CRON 2>/dev/null || printf '(not defined in wp-config.php)\n'
printf 'Action Scheduler is started by WP-Cron and by admin requests; without either, background sync stalls.\n'

section "HPOS options"
for option in \
	woocommerce_custom_orders_table_enabled \
	woocommerce_custom_orders_table_data_sync_enabled \
	woocommerce_custom_orders_table_created \
	woocommerce_custom_orders_table_background_sync_mode \
	woocommerce_custom_orders_table_background_sync_interval; do
	printf '%s: ' "$option"
	"${WP[@]}" option get "$option" 2>/dev/null || printf '(not set)\n'
done

section "wp wc hpos status"
run "${WP[@]}" wc hpos status

section "Queued batch processors (wc_pending_batch_processes)"
run "${WP[@]}" option get wc_pending_batch_processes --format=json

section "Plugin compatibility as WooCommerce sees it (WooCommerce 9.2.0 and later)"
run "${WP[@]}" wc hpos compatibility-info --include-inactive --display-filenames

section "All plugins, including must-use and drop-ins"
run "${WP[@]}" plugin list --skip-update-check --fields=name,status,version

section "Themes (WooCommerce never checks themes for HPOS compatibility)"
run "${WP[@]}" theme list --skip-update-check --fields=name,status,version

section "Registered order types that the sync covers"
ORDER_TYPES_RAW="$("${WP[@]}" eval 'echo implode( ",", wc_get_order_types( "cot-migration" ) );' 2>/dev/null)"
printf '%s\n' "${ORDER_TYPES_RAW:-(could not read; falling back to shop_order,shop_order_refund)}"

if [ "${HPOS_REPORT_SKIP_SQL:-0}" = "1" ]; then
	section "SQL parity checks"
	printf 'Skipped (HPOS_REPORT_SKIP_SQL=1).\n'
	exit 0
fi

section "SQL parity checks ($SQL_FILE)"
if [ ! -r "$SQL_FILE" ]; then
	printf 'Cannot read %s\n' "$SQL_FILE"
	exit 0
fi

PREFIX="$("${WP[@]}" db prefix 2>/dev/null)"
if ! printf '%s' "$PREFIX" | grep -Eq '^[A-Za-z0-9_]+$'; then
	printf 'Unexpected table prefix "%s"; skipping SQL.\n' "$PREFIX"
	exit 0
fi

ORDER_TYPES_RAW="${ORDER_TYPES_RAW:-shop_order,shop_order_refund}"
if ! printf '%s' "$ORDER_TYPES_RAW" | grep -Eq '^[A-Za-z0-9_,-]+$'; then
	printf 'Unexpected order types "%s"; using shop_order,shop_order_refund.\n' "$ORDER_TYPES_RAW"
	ORDER_TYPES_RAW="shop_order,shop_order_refund"
fi
# shop_order,shop_order_refund -> 'shop_order','shop_order_refund'
ORDER_TYPES_SQL="'$(printf '%s' "$ORDER_TYPES_RAW" | sed "s/,/','/g")'"
printf 'Table prefix: %s\nOrder types: %s\n' "$PREFIX" "$ORDER_TYPES_SQL"

# Run one block: substitute the placeholders, print its name, send it to wp db query.
run_block() {
	local name="$1" sql="$2"
	[ -z "$name" ] && return 0
	sql="${sql//\{prefix\}/$PREFIX}"
	sql="${sql//\{order_types\}/$ORDER_TYPES_SQL}"
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
		"--"* | "")
			;;
		*)
			if [ -n "$block_name" ]; then
				block_sql="${block_sql}${line}"$'\n'
			fi
			;;
	esac
done <"$SQL_FILE"
run_block "$block_name" "$block_sql"

printf '\nDone. Nothing was changed.\n'
