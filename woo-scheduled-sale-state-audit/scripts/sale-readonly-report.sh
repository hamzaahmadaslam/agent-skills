#!/usr/bin/env bash
# Read-only helper. Prints the scheduled sale state of one WooCommerce site: versions, the site timezone, WP-Cron
# constants and events, the daily woocommerce_scheduled_sales action and the per-product sale events in Action
# Scheduler, the object cache type, optional per-product reads, and the SELECT statements in sale-state-checks.sql.
#
# It runs WP-CLI read commands only: `wp core version`, `wp plugin get`, `wp option get`, `wp config get`,
# `wp cron event list`, `wp action-scheduler version` and `action list`, `wp cache type`, `wp post meta list`,
# `wp db prefix`, `wp eval` with code that only reads (it prints the timezone and, for listed products, prices, dates
# and is_on_sale()), and `wp db query` with the SELECT blocks. It makes no network calls of its own and changes no
# settings, products, actions or tables. Loading WordPress runs the site's own code, as any request does.
# WordPress loads with WP-Cron spawning turned off (a spawn writes the doing_cron lock and sends a loopback request)
# and without WP-CLI's own update check.
#
# Usage (run where WP-CLI can reach the site; any arguments are passed to every wp call as global flags):
#   bash sale-readonly-report.sh --path=/var/www/html
#   bash sale-readonly-report.sh --path=/var/www/html --url=example.com/shop          # one site of a multisite
#   SALE_AUDIT_PRODUCTS=101,102 bash sale-readonly-report.sh --path=/var/www/html     # also read these product IDs
#   SALE_AUDIT_AT=1790000000 bash sale-readonly-report.sh --path=/var/www/html        # audit time (Unix, UTC); default now
#   SALE_AUDIT_BLOCK=Export bash sale-readonly-report.sh --path=/var/www/html         # only SQL blocks whose name has this text
#   SALE_AUDIT_SKIP_SQL=1 bash sale-readonly-report.sh --path=/var/www/html           # skip the SQL section
#
# Without SALE_AUDIT_BLOCK the "Export" block is skipped; run it alone and save its output for explain-sale-state.mjs.
# Needs: bash, WP-CLI with WooCommerce active, and the mysql client that `wp db query` uses.
# Blocks marked "(scan)" in sale-state-checks.sql read every product price row. On a big store run the report against
# a replica or a staging copy, or at a quiet hour. The output holds product IDs, prices, dates and hook names.

set -u

# Keep the report read-only: no WP-CLI update check, and no WP-Cron spawn while WordPress loads (WP-CLI removes
# wp_cron only when ALTERNATE_WP_CRON is set).
export WP_CLI_DISABLE_AUTO_CHECK_UPDATE=1
NO_SPAWN='--exec=WP_CLI::add_wp_hook( "init", static function () { remove_action( "init", "wp_cron" ); }, 0 );'
WP=(wp "$NO_SPAWN" "$@")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$HERE/sale-state-checks.sql"

AUDIT_AT="${SALE_AUDIT_AT:-$(date -u +%s)}"
if ! [[ "$AUDIT_AT" =~ ^[0-9]{9,11}$ ]]; then
	printf 'SALE_AUDIT_AT must be a Unix timestamp in seconds, got "%s".\n' "$AUDIT_AT"
	exit 1
fi

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

section "Report and audit time (UTC)"
printf 'Report: %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S')"
printf 'Audit time used in the SQL blocks: %s (Unix %s)\n' "$(date -u -d "@$AUDIT_AT" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || printf 'see Unix value')" "$AUDIT_AT"

section "Versions"
run "${WP[@]}" core version
run "${WP[@]}" plugin get woocommerce --field=version
run "${WP[@]}" action-scheduler version

section "Site timezone"
run "${WP[@]}" option get timezone_string
printf '(gmt_offset below is computed from timezone_string when that is set)\n'
run "${WP[@]}" option get gmt_offset
run "${WP[@]}" eval 'echo "wp_timezone_string(): ", wp_timezone_string(), PHP_EOL, "Site time now: ", wp_date( "Y-m-d H:i:s T" ), PHP_EOL;'

section "WP-Cron"
for constant in DISABLE_WP_CRON ALTERNATE_WP_CRON; do
	printf '%s: ' "$constant"
	"${WP[@]}" config get "$constant" --type=constant 2>/dev/null || printf '(not defined in wp-config.php)\n'
done
printf 'Action Scheduler runner and any legacy scheduled-sales cron event:\n'
"${WP[@]}" cron event list --fields=hook,next_run_gmt,recurrence --format=csv 2>/dev/null |
	grep -E '^hook,|action_scheduler_run_queue|woocommerce_scheduled_sales' ||
	printf '(no matching events, or the cron command is unavailable)\n'

section "Action Scheduler: daily safety net and per-product sale events"
run "${WP[@]}" action-scheduler action list --hook=woocommerce_scheduled_sales --status=pending --per_page=0 --fields=id,hook,status,group,recurring,scheduled_date --format=csv
printf 'Pending per-product sale events (group woocommerce-sales): '
"${WP[@]}" action-scheduler action list --group=woocommerce-sales --status=pending --per_page=0 --format=count 2>/dev/null || printf '(command failed)\n'

section "Object cache"
run "${WP[@]}" cache type

if [ -n "${SALE_AUDIT_PRODUCTS:-}" ]; then
	section "Listed products"
	IFS=',' read -r -a PRODUCT_IDS <<<"$SALE_AUDIT_PRODUCTS"
	for id in "${PRODUCT_IDS[@]}"; do
		id="${id// /}"
		if ! [[ "$id" =~ ^[0-9]+$ ]]; then
			printf 'Skipping "%s": not a numeric ID.\n' "$id"
			continue
		fi
		printf '\n-- product %s\n' "$id"
		run "${WP[@]}" post meta list "$id" --keys=_regular_price,_sale_price,_price,_sale_price_dates_from,_sale_price_dates_to --format=csv
		# Reads only. Variable and grouped parents are not asked for is_on_sale() or a view price, because those calls
		# can build and store the wc_var_prices transient.
		run "${WP[@]}" eval '
$p = wc_get_product( '"$id"' );
if ( ! $p ) { echo "No product with this ID.", PHP_EOL; return; }
$fmt = static function ( $d ) { return $d ? $d->date( "Y-m-d H:i:s" ) . " site time, " . gmdate( "Y-m-d H:i:s", $d->getTimestamp() ) . " UTC, Unix " . $d->getTimestamp() : "(none)"; };
echo "type: ", $p->get_type(), "  parent: ", $p->get_parent_id(), PHP_EOL;
echo "regular (edit): ", $p->get_regular_price( "edit" ), "  sale (edit): ", $p->get_sale_price( "edit" ), "  price (edit): ", $p->get_price( "edit" ), PHP_EOL;
echo "sale from: ", $fmt( $p->get_date_on_sale_from( "edit" ) ), PHP_EOL;
echo "sale to:   ", $fmt( $p->get_date_on_sale_to( "edit" ) ), PHP_EOL;
if ( ! $p->is_type( array( "variable", "grouped" ) ) ) {
	echo "is_on_sale (edit): ", $p->is_on_sale( "edit" ) ? "yes" : "no", "  is_on_sale (view): ", $p->is_on_sale() ? "yes" : "no", PHP_EOL;
	echo "price (view, after filters): ", $p->get_price(), PHP_EOL;
} else {
	echo "Derived-price parent: compare its _price rows with its variations (SQL block for variable parents).", PHP_EOL;
}'
	done
fi

if [ "${SALE_AUDIT_SKIP_SQL:-0}" = "1" ]; then
	section "SQL checks"
	printf 'Skipped (SALE_AUDIT_SKIP_SQL=1).\n'
	exit 0
fi

section "SQL checks ($SQL_FILE)"
if [ ! -r "$SQL_FILE" ]; then
	printf 'Cannot read %s\n' "$SQL_FILE"
	exit 0
fi

PREFIX="$("${WP[@]}" db prefix 2>/dev/null)"
if ! [[ "$PREFIX" =~ ^[A-Za-z0-9_]+$ ]]; then
	printf 'Unexpected table prefix "%s"; skipping SQL.\n' "$PREFIX"
	exit 0
fi
printf 'Table prefix: %s   Audit time: %s\n' "$PREFIX" "$AUDIT_AT"

# Run one block: skip it when a filter is set and its name does not match (or when it is the export block and no
# filter is set), substitute the placeholders, print its name, send it to wp db query.
run_block() {
	local name="$1" sql="$2"
	[ -z "$name" ] && return 0
	if [ -n "${SALE_AUDIT_BLOCK:-}" ]; then
		[[ "$name" == *"$SALE_AUDIT_BLOCK"* ]] || return 0
	elif [[ "$name" == Export* ]]; then
		return 0
	fi
	name="${name//\{now\}/$AUDIT_AT}"
	sql="${sql//\{prefix\}/$PREFIX}"
	sql="${sql//\{now\}/$AUDIT_AT}"
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
