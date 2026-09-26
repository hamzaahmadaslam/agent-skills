#!/usr/bin/env bash
# Read-only helper. Prints the checkout performance state of one WooCommerce site: versions, checkout type, settings,
# features, gateways, shipping methods and hook callbacks (through checkout-state.php), the object cache, WP-Cron and
# Action Scheduler status, plugins and themes, and the SELECT statements in checkout-checks.sql.
#
# It runs WP-CLI read commands only: `wp eval-file checkout-state.php` (reads, changes nothing), `wp cache type`,
# `wp transient type`, `wp config get`, `wp cron event list`, `wp action-scheduler version` and `status`,
# `wp plugin list` and `wp theme list` (both skip the update check), `wp db prefix`, one `wp eval` that prints the base
# table prefix, and `wp db query` with the SELECT blocks. It makes no network calls of its own and changes no settings,
# orders or tables. Loading WordPress runs the site's own code, as any request does.
# WordPress loads with WP-Cron spawning turned off (a spawn writes the doing_cron lock and sends a loopback request)
# and without WP-CLI's own update check.
#
# Usage (run where WP-CLI can reach the site; any arguments are passed to every wp call as global flags):
#   bash checkout-readonly-report.sh --path=/var/www/html
#   bash checkout-readonly-report.sh --path=/var/www/html --url=example.com/shop        # one site of a multisite
#   CHECKOUT_REPORT_SKIP_SQL=1 bash checkout-readonly-report.sh --path=/var/www/html   # skip the SQL section
#
# Needs: bash, WP-CLI with WooCommerce active, and the mysql client that `wp db query` uses.
# Blocks marked "(scan)" in checkout-checks.sql read whole tables. On a big store run the report against a replica or
# a staging copy, or at a quiet hour. The output holds counts, settings and hook names, no customer data.

set -u

# Keep the report read-only: no WP-CLI update check, and no WP-Cron spawn while WordPress loads (WP-CLI removes
# wp_cron only when ALTERNATE_WP_CRON is set).
export WP_CLI_DISABLE_AUTO_CHECK_UPDATE=1
NO_SPAWN='--exec=WP_CLI::add_wp_hook( "init", static function () { remove_action( "init", "wp_cron" ); }, 0 );'
WP=(wp "$NO_SPAWN" "$@")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$HERE/checkout-checks.sql"
STATE_FILE="$HERE/checkout-state.php"

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

section "Checkout state (checkout-state.php)"
if [ -r "$STATE_FILE" ]; then
	run "${WP[@]}" eval-file "$STATE_FILE"
else
	printf 'Cannot read %s\n' "$STATE_FILE"
fi

section "Object cache and transients"
run "${WP[@]}" cache type
run "${WP[@]}" transient type

section "WP-Cron"
for constant in DISABLE_WP_CRON ALTERNATE_WP_CRON; do
	printf '%s: ' "$constant"
	"${WP[@]}" config get "$constant" --type=constant 2>/dev/null || printf '(not defined in wp-config.php)\n'
done
printf 'WooCommerce, Action Scheduler and transient cleanup events:\n'
"${WP[@]}" cron event list --fields=hook,next_run_gmt,recurrence --format=csv 2>/dev/null |
	grep -E '^hook,|woocommerce|action_scheduler|delete_expired_transients|^wc_' ||
	printf '(no matching events, or the cron command is unavailable)\n'

section "Action Scheduler (status needs Action Scheduler 3.9.1 or later)"
run "${WP[@]}" action-scheduler version
run "${WP[@]}" action-scheduler status

section "Plugins, including must-use and drop-ins"
run "${WP[@]}" plugin list --skip-update-check --fields=name,status,version

section "Themes"
run "${WP[@]}" theme list --skip-update-check --fields=name,status,version

if [ "${CHECKOUT_REPORT_SKIP_SQL:-0}" = "1" ]; then
	section "SQL checks"
	printf 'Skipped (CHECKOUT_REPORT_SKIP_SQL=1).\n'
	exit 0
fi

section "SQL checks ($SQL_FILE)"
if [ ! -r "$SQL_FILE" ]; then
	printf 'Cannot read %s\n' "$SQL_FILE"
	exit 0
fi

PREFIX="$("${WP[@]}" db prefix 2>/dev/null)"
BASE_PREFIX="$("${WP[@]}" eval 'global $wpdb; echo $wpdb->base_prefix;' 2>/dev/null)"
for value in "$PREFIX" "$BASE_PREFIX"; do
	if ! [[ "$value" =~ ^[A-Za-z0-9_]+$ ]]; then
		printf 'Unexpected table prefix "%s"; skipping SQL.\n' "$value"
		exit 0
	fi
done
printf 'Table prefix: %s   Base prefix: %s\n' "$PREFIX" "$BASE_PREFIX"
printf 'Blocks for HPOS tables fail on stores without them, and blocks for posts tables return zero on HPOS stores.\n'

# Run one block: substitute the placeholders, print its name, send it to wp db query.
run_block() {
	local name="$1" sql="$2"
	[ -z "$name" ] && return 0
	sql="${sql//\{prefix\}/$PREFIX}"
	sql="${sql//\{base_prefix\}/$BASE_PREFIX}"
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
