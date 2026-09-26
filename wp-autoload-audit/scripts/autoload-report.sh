#!/usr/bin/env bash
# Read-only helper. Prints the autoload state of one WordPress site: versions, object cache, plugins and themes, the
# output of autoload-state.php (loaded values after filters, thresholds, callbacks on the autoload hooks, the cached
# alloptions entry against the database, the cost of the autoload query), and the SELECT blocks in
# autoload-checks.sql.
#
# It runs WP-CLI read commands only: `wp core version --extra`, `wp cache type`, `wp transient type`,
# `wp plugin list` and `wp theme list` (both skip the update check), `wp db prefix`, one `wp eval` that prints the
# loaded autoload values, `wp eval-file autoload-state.php` (reads, changes nothing), and `wp db query` with the
# SELECT blocks. It makes no network calls of its own and changes no options, cache keys or tables. Loading WordPress
# runs the site's own code, as any request does.
#
# Usage (run where WP-CLI can reach the site; every argument is passed to each wp call as a global flag):
#   bash autoload-report.sh --path=/var/www/html
#   bash autoload-report.sh --path=/var/www/html --url=example.com/blog      # one site of a multisite
#   AUTOLOAD_REPORT_SKIP_STATE=1 bash autoload-report.sh --path=/var/www/html  # skip autoload-state.php
#   AUTOLOAD_REPORT_SKIP_SQL=1 bash autoload-report.sh --path=/var/www/html    # skip the SQL section
#   AUTOLOAD_REPORT_LONG=1 bash autoload-report.sh --path=/var/www/html        # also list every loaded name and size
#
# Needs: bash, WP-CLI, and the mysql or mariadb client that `wp db query` uses.
# Blocks marked "(scan)" in autoload-checks.sql read the whole options table. On a large table run the report on a
# staging copy or a replica, or at a quiet hour. The output holds option names, sizes and counts, not option values.
# Do not pass --skip-plugins: the loaded values and the hooked callbacks depend on the site's plugins.

set -u

WP=(wp "$@")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$HERE/autoload-checks.sql"
STATE_FILE="$HERE/autoload-state.php"
DEFAULT_LOADED="yes,on,auto-on,auto"

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

section "Versions"
run "${WP[@]}" core version --extra

section "Object cache and transients"
run "${WP[@]}" cache type
run "${WP[@]}" transient type

section "Plugins, including must-use and drop-ins"
run "${WP[@]}" plugin list --skip-update-check --fields=name,status,version

section "Themes"
run "${WP[@]}" theme list --skip-update-check --fields=name,status,version

if [ "${AUTOLOAD_REPORT_SKIP_STATE:-0}" = "1" ]; then
	section "Autoload state (autoload-state.php)"
	printf 'Skipped (AUTOLOAD_REPORT_SKIP_STATE=1).\n'
elif [ -r "$STATE_FILE" ]; then
	section "Autoload state (autoload-state.php)"
	run "${WP[@]}" eval-file "$STATE_FILE"
else
	section "Autoload state (autoload-state.php)"
	printf 'Cannot read %s\n' "$STATE_FILE"
fi

if [ "${AUTOLOAD_REPORT_SKIP_SQL:-0}" = "1" ]; then
	section "SQL checks"
	printf 'Skipped (AUTOLOAD_REPORT_SKIP_SQL=1).\n'
	exit 0
fi

section "SQL checks ($SQL_FILE)"
if [ ! -r "$SQL_FILE" ]; then
	printf 'Cannot read %s\n' "$SQL_FILE"
	exit 0
fi

PREFIX="$("${WP[@]}" db prefix 2>/dev/null | tr -d '\r')"
if ! printf '%s' "$PREFIX" | grep -Eq '^[A-Za-z0-9_]+$'; then
	printf 'Unexpected table prefix "%s"; skipping SQL.\n' "$PREFIX"
	exit 0
fi

# The values WordPress loads, after filters (WordPress 6.6 and later); 'yes' only on older releases.
LOADED="$("${WP[@]}" eval 'echo implode( ",", function_exists( "wp_autoload_values_to_autoload" ) ? wp_autoload_values_to_autoload() : array( "yes" ) );' 2>/dev/null | tr -d '\r')"
if ! printf '%s' "$LOADED" | grep -Eq '^[a-z-]+(,[a-z-]+)*$'; then
	printf 'Could not read the loaded autoload values (got "%s"); using the default list %s.\n' "$LOADED" "$DEFAULT_LOADED"
	LOADED="$DEFAULT_LOADED"
fi
LOADED_SQL="'$(printf '%s' "$LOADED" | sed "s/,/', '/g")'"
printf 'Table prefix: %s   Loaded autoload values: %s\n' "$PREFIX" "$LOADED_SQL"

# Run one block: substitute the placeholders, print its name, send it to wp db query.
run_block() {
	local name="$1" sql="$2"
	[ -z "$name" ] && return 0
	case "$name" in
		*"(long)"*)
			if [ "${AUTOLOAD_REPORT_LONG:-0}" != "1" ]; then
				printf '\n-- %s\n(skipped; set AUTOLOAD_REPORT_LONG=1 to print it)\n' "$name"
				return 0
			fi
			;;
	esac
	sql="${sql//\{prefix\}/$PREFIX}"
	sql="${sql//\{loaded_values\}/$LOADED_SQL}"
	name="${name//\{loaded_values\}/$LOADED_SQL}"
	printf '\n-- %s\n' "$name"
	printf '%s\n' "$sql" | "${WP[@]}" db query 2>&1 || printf '(query failed with exit code %s)\n' "$?"
}

block_name=""
block_sql=""
while IFS= read -r line || [ -n "$line" ]; do
	line="${line%$'\r'}"
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
