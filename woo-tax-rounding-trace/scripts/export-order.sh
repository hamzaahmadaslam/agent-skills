#!/usr/bin/env bash
# Read-only helper. Exports one WooCommerce order's tax data for tax-trace.mjs.
#
# Standard output: the JSON that tax-trace.mjs reads (from `wp eval-file export-order.php`), so the output can be
# redirected to a file. Standard error: the raw tax options (`wp option get`) and, when WOO_TAX_TRACE_USER is set, the
# order's totals as the REST API returns them (`wp wc shop_order get` with a field list that leaves out addresses and
# customer details).
#
# It runs WP-CLI read commands only: `wp option get`, `wp eval-file export-order.php` (reads, changes nothing) and
# `wp wc shop_order get`. It makes no network calls of its own and changes no settings, orders or tables. Loading
# WordPress runs the site's own code, as any request does. WordPress loads with WP-Cron spawning turned off (a spawn
# writes the doing_cron lock and sends a loopback request) and without WP-CLI's own update check.
#
# Usage (run where WP-CLI can reach the site; arguments after the order ID are passed to every wp call):
#   bash export-order.sh 1234 --path=/var/www/html > order-1234.json
#   bash export-order.sh 1234 --path=/var/www/html --url=example.com/shop > order-1234.json   # one site of a multisite
#   WOO_TAX_TRACE_USER=admin bash export-order.sh 1234 --path=/var/www/html > order-1234.json # adds the REST view
#
# The JSON holds order totals, tax rates and line amounts, no names or addresses. It is still store data: keep it out
# of chats, tickets and repositories, and delete it when the report is written.

set -u

if [ "$#" -lt 1 ] || ! [[ "$1" =~ ^[0-9]+$ ]]; then
	printf 'Usage: bash export-order.sh <order id> [wp global flags, e.g. --path=/var/www/html]\n' >&2
	exit 2
fi
ORDER_ID="$1"
shift

export WP_CLI_DISABLE_AUTO_CHECK_UPDATE=1
NO_SPAWN='--exec=WP_CLI::add_wp_hook( "init", static function () { remove_action( "init", "wp_cron" ); }, 0 );'
WP=(wp "$NO_SPAWN" "$@")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPORT_FILE="$HERE/export-order.php"

say() {
	printf '%s\n' "$*" >&2
}

say "== Tax options (raw values; export-order.php also prints the values after filters) =="
for option in woocommerce_calc_taxes woocommerce_prices_include_tax woocommerce_tax_round_at_subtotal \
	woocommerce_price_num_decimals woocommerce_tax_display_shop woocommerce_tax_display_cart \
	woocommerce_tax_total_display woocommerce_tax_based_on woocommerce_shipping_tax_class \
	woocommerce_currency woocommerce_custom_orders_table_enabled; do
	value="$("${WP[@]}" option get "$option" 2>/dev/null)" || value="(not set)"
	say "$(printf '%-42s %s' "$option" "$value")"
done

if [ -n "${WOO_TAX_TRACE_USER:-}" ]; then
	say ""
	say "== REST view of the order totals (wp wc shop_order get, user $WOO_TAX_TRACE_USER) =="
	"${WP[@]}" wc shop_order get "$ORDER_ID" --user="$WOO_TAX_TRACE_USER" \
		--fields=id,currency,prices_include_tax,discount_total,discount_tax,shipping_total,shipping_tax,cart_tax,total,total_tax,tax_lines \
		--format=json >&2 || say "(wp wc shop_order get failed; check the user and the order ID)"
	say ""
fi

if [ ! -r "$EXPORT_FILE" ]; then
	say "Cannot read $EXPORT_FILE"
	exit 1
fi

say "== Exporting order $ORDER_ID (JSON on standard output) =="
"${WP[@]}" eval-file "$EXPORT_FILE" "$ORDER_ID"
