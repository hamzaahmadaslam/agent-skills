#!/usr/bin/env bash
# Read-only helper. Prints the query-related state of one WordPress site for a slow query investigation: versions,
# database server, drop-ins, object cache, core index check and query filter callbacks (through query-state.php),
# plugins, the WooCommerce attributes lookup table summary when WooCommerce is active, and the SELECT and SHOW
# statements in query-checks.sql.
#
# It runs WP-CLI read commands only: `wp eval-file query-state.php` (reads, changes nothing), `wp cache type`,
# `wp plugin list` (update check skipped), `wp plugin is-active`, `wp wc palt info` (prints table facts), `wp db prefix`,
# one `wp eval` that prints the base table prefix, and `wp db query` with the SELECT and SHOW blocks. It makes no
# network calls of its own and changes no settings, options or tables. Loading WordPress runs the site's own code, as
# any request does.
#
# Usage (run where WP-CLI can reach the site; any arguments are passed to every wp call as global flags):
#   bash slow-query-readonly-report.sh --path=/var/www/html
#   bash slow-query-readonly-report.sh --path=/var/www/html --url=example.com/shop      # one site of a multisite
#   SLOWQ_REPORT_SKIP_SCANS=1 bash slow-query-readonly-report.sh --path=/var/www/html  # skip blocks marked (scan)
#   SLOWQ_REPORT_SKIP_SQL=1 bash slow-query-readonly-report.sh --path=/var/www/html    # skip the SQL section
#
# Needs: bash, WP-CLI, and the mysql or mariadb client that `wp db query` uses. `wp db query` ignores --url, so the
# script writes this site's table prefix into each statement. Blocks marked "(scan)" read whole tables: on a big site
# run the report against a replica or a staging copy, or at a quiet hour. The output holds counts, settings and
# names, and statement texts only in normalized or masked form.

set -u

WP=(wp "$@")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$HERE/query-checks.sql"
STATE_FILE="$HERE/query-state.php"

section() {
	printf '\n== %s ==\n' "$1"
}

# Print a command, run it, and keep going when it fails (older releases lack some commands).
run() {
	printf '$ %s\n' "$*"
	"$@" 2>&1 || printf '(command failed with exit code %s)\n' "$?"
}

section "Report time (UTC)"
date -u '+%Y-%m-%d %H:%M:%S'

section "Site state (query-state.php)"
if [ -r "$STATE_FILE" ]; then
	run "${WP[@]}" eval-file "$STATE_FILE"
else
	printf 'Cannot read %s\n' "$STATE_FILE"
fi

section "Object cache"
run "${WP[@]}" cache type

section "Drop-ins, plugins and must-use plugins"
run "${WP[@]}" plugin list --status=dropin --fields=name,title,version
run "${WP[@]}" plugin list --skip-update-check --fields=name,status,version

if "${WP[@]}" plugin is-active woocommerce >/dev/null 2>&1; then
	section "WooCommerce product attributes lookup table (wp wc palt info, WooCommerce 9.1 and later)"
	run "${WP[@]}" wc palt info
fi

if [ "${SLOWQ_REPORT_SKIP_SQL:-0}" = "1" ]; then
	section "SQL checks"
	printf 'Skipped (SLOWQ_REPORT_SKIP_SQL=1).\n'
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
	if ! printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_]+$'; then
		printf 'Unexpected table prefix "%s"; skipping SQL.\n' "$value"
		exit 0
	fi
done
printf 'Table prefix: %s   Base prefix: %s\n' "$PREFIX" "$BASE_PREFIX"
printf 'Blocks for the other server type, for WooCommerce on sites without it, or needing extra privileges fail and are skipped.\n'

# Run one block: substitute the placeholders, print its name, send it to wp db query.
run_block() {
	local name="$1" sql="$2"
	[ -z "$name" ] && return 0
	if [ "${SLOWQ_REPORT_SKIP_SCANS:-0}" = "1" ] && [[ "$name" == *"(scan"* ]]; then
		printf '\n-- %s\n(skipped: SLOWQ_REPORT_SKIP_SCANS=1)\n' "$name"
		return 0
	fi
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
