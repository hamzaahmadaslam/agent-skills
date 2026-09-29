#!/usr/bin/env bash
# Read-only helper. Prints the state of WooCommerce's product lookup tables for one site and runs the row checks in
# lookup-checks.sql: versions and lookup settings, the attribute lookup table summary from WooCommerce's own CLI,
# pending and failed lookup actions in Action Scheduler, then every SELECT block, with a complete count for each
# "Detail" block and up to LOOKUP_DETAIL_LIMIT listed rows.
#
# It runs WP-CLI read commands only: `wp plugin get woocommerce --field=version`, `wp core version`, `wp db prefix`,
# `wp wc palt info` (reads options and counts rows, WooCommerce 9.1 and later), `wp action-scheduler action list`
# with --format=count, and `wp db query` with the SELECT blocks. It makes no network calls of its own and changes no
# settings, products or tables. Loading WordPress runs the site's own code, as any request does. WordPress loads with
# WP-Cron spawning turned off (a spawn writes the doing_cron lock and sends a loopback request) and without WP-CLI's
# own update check.
#
# Usage (run where WP-CLI can reach the site; any arguments are passed to every wp call as global flags):
#   bash lookup-readonly-report.sh --path=/var/www/html > lookup-report-before.txt
#   bash lookup-readonly-report.sh --path=/var/www/html --url=example.com/shop        # one site of a multisite
#   LOOKUP_DETAIL_LIMIT=1000 bash lookup-readonly-report.sh --path=/var/www/html      # list more rows per class
#   LOOKUP_REPORT_MODE=counts bash lookup-readonly-report.sh --path=/var/www/html     # counts only, no listed rows
#   LOOKUP_REPORT_MODE=details bash lookup-readonly-report.sh --path=/var/www/html    # listed rows only, no counts
#   LOOKUP_REPORT_SKIP_SQL=1 bash lookup-readonly-report.sh --path=/var/www/html      # versions and CLI summaries only
#
# Needs: bash, WP-CLI with WooCommerce active, and the mysql or mariadb client that `wp db query` uses.
# Blocks marked "(scan)" in lookup-checks.sql read whole tables. On a big store run the report against a replica or a
# staging copy, or at a quiet hour. The output holds product IDs, SKUs, prices, stock values and attribute term IDs:
# catalog data, no customer data. Redirecting the output to a file is your choice; the script itself writes nothing.

set -u

export WP_CLI_DISABLE_AUTO_CHECK_UPDATE=1
NO_SPAWN='--exec=WP_CLI::add_wp_hook( "init", static function () { remove_action( "init", "wp_cron" ); }, 0 );'
WP=(wp "$NO_SPAWN" "$@")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$HERE/lookup-checks.sql"
LIMIT="${LOOKUP_DETAIL_LIMIT:-200}"
MODE="${LOOKUP_REPORT_MODE:-both}"
# LIMIT value used inside the count wrapper, so a Detail block counts every row of its class.
NO_LIMIT="18446744073709551615"

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]] || [ "$LIMIT" -lt 1 ]; then
	printf 'LOOKUP_DETAIL_LIMIT must be a whole number above 0, not "%s".\n' "$LIMIT"
	exit 2
fi
case "$MODE" in
	both | counts | details) ;;
	*)
		printf 'LOOKUP_REPORT_MODE must be both, counts or details, not "%s".\n' "$MODE"
		exit 2
		;;
esac

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

section "Report time (UTC)"
date -u '+%Y-%m-%d %H:%M:%S'

section "Versions"
run "${WP[@]}" core version
run "${WP[@]}" plugin get woocommerce --field=version

section "Product attributes lookup table (wp wc palt info, WooCommerce 9.1 and later)"
run "${WP[@]}" wc palt info

section "Lookup actions waiting in Action Scheduler (counts)"
for hook in woocommerce_run_product_attribute_lookup_update_callback \
	woocommerce_run_product_attribute_lookup_regeneration_callback \
	wc_update_product_lookup_tables_column \
	wc_update_product_lookup_tables_rating_count_batch; do
	for status in pending failed; do
		printf '%s %s: ' "$hook" "$status"
		# --per_page=0 lifts Action Scheduler's default page size of 5, which would cap the count.
		"${WP[@]}" action-scheduler action list --hook="$hook" --status="$status" --per_page=0 --format=count 2>/dev/null ||
			printf '(action-scheduler command unavailable)\n'
	done
done

if [ "${LOOKUP_REPORT_SKIP_SQL:-0}" = "1" ]; then
	section "SQL checks"
	printf 'Skipped (LOOKUP_REPORT_SKIP_SQL=1).\n'
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
printf 'Table prefix: %s   Mode: %s   Rows listed per Detail block: %s\n' "$PREFIX" "$MODE" "$LIMIT"
printf 'A Detail block lists at most %s rows; its count line gives the full number in that class.\n' "$LIMIT"

# Send one statement to wp db query.
send() {
	printf '%s\n' "$1" | "${WP[@]}" db query 2>&1 || printf '(query failed with exit code %s)\n' "$?"
}

# Run one block: substitute the placeholders, print its name, and for Detail blocks also a full count.
run_block() {
	local name="$1" sql="$2" counted
	[ -z "$name" ] && return 0
	sql="${sql//\{prefix\}/$PREFIX}"
	case "$name" in
		Detail*)
			if [ "$MODE" != "details" ]; then
				counted="${sql//\{limit\}/$NO_LIMIT}"
				# Drop trailing whitespace and the final semicolon, then count the rows the block would list.
				counted="${counted%"${counted##*[![:space:]]}"}"
				counted="${counted%;}"
				printf '\n-- count %s\n' "$name"
				send "SELECT COUNT(*) AS in_class FROM ( $counted ) AS counted;"
			fi
			if [ "$MODE" != "counts" ]; then
				printf '\n-- %s\n' "$name"
				send "${sql//\{limit\}/$LIMIT}"
			fi
			;;
		*)
			printf '\n-- %s\n' "$name"
			send "${sql//\{limit\}/$LIMIT}"
			;;
	esac
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
