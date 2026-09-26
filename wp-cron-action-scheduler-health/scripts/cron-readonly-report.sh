#!/usr/bin/env bash
# Read-only helper. Prints the WP-Cron and Action Scheduler state of one WordPress site: WP-CLI and PHP details, the
# cron constants as written in wp-config.php, the state script (cron-state.php), registered schedules, the next due
# events, Action Scheduler's version, sources and status, the cron entries of the current system user, systemd timers,
# and the SELECT statements in cron-checks.sql.
#
# It runs read commands only: `wp cli version`, `wp cli info`, `wp core version`, `wp config get`, `wp eval-file
# cron-state.php` (reads, changes nothing), `wp cron schedule list`, `wp cron event list`, `wp action-scheduler
# version`, `source` and `status`, `wp db prefix`, `wp db query` with the SELECT blocks, `crontab -l` and
# `systemctl list-timers`. It makes no network calls of its own: WP-CLI's update check is switched off
# (WP_CLI_DISABLE_AUTO_CHECK_UPDATE), and every wp call removes WordPress's wp_cron callback for its own process
# (through --exec), so loading WordPress here never spawns wp-cron.php the way a page view would. Loading WordPress
# still runs the site's own code, as any request does.
#
# Usage (run as the site's system user, where WP-CLI can reach the site; any arguments are passed to every wp call):
#   bash cron-readonly-report.sh --path=/var/www/html
#   bash cron-readonly-report.sh --path=/var/www/html --url=example.com/shop   # one site of a multisite network
#   CRON_REPORT_SKIP_SCANS=1 bash cron-readonly-report.sh --path=/var/www/html  # skip blocks that read whole tables
#   CRON_REPORT_SKIP_SQL=1 bash cron-readonly-report.sh --path=/var/www/html    # skip the SQL section
#
# Needs: bash, WP-CLI, and the mysql client that `wp db query` uses. The output holds versions, paths, hook names,
# counts and dates, no arguments of events or actions. Crontab lines are filtered to cron-related entries, with any
# user:password@ in a URL masked.

set -u

export WP_CLI_DISABLE_AUTO_CHECK_UPDATE=1
NO_SPAWN='--exec=WP_CLI::add_wp_hook( "init", static function () { remove_action( "init", "wp_cron" ); }, 0 );'
WP=(wp "$NO_SPAWN" "$@")
GLOBAL_ARGS="$*"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$HERE/cron-checks.sql"
STATE_FILE="$HERE/cron-state.php"

section() {
	printf '\n== %s ==\n' "$1"
}

# Print a wp command (without the --exec guard), run it, and keep going when it fails (older releases lack some
# commands).
wpr() {
	printf '$ wp %s %s\n' "$*" "$GLOBAL_ARGS"
	"${WP[@]}" "$@" 2>&1 || printf '(command failed with exit code %s)\n' "$?"
}

section "Report time (UTC)"
date -u '+%Y-%m-%d %H:%M:%S'

section "WP-CLI, PHP and WordPress"
wpr cli version
wpr cli info
wpr core version

section "Cron constants as written in wp-config.php (runtime values follow in the state section)"
for constant in DISABLE_WP_CRON ALTERNATE_WP_CRON WP_CRON_LOCK_TIMEOUT; do
	printf '%s: ' "$constant"
	"${WP[@]}" config get "$constant" --type=constant 2>/dev/null || printf '(not defined in wp-config.php)\n'
done

section "WP-Cron and Action Scheduler state (cron-state.php)"
if [ -r "$STATE_FILE" ]; then
	wpr eval-file "$STATE_FILE"
else
	printf 'Cannot read %s\n' "$STATE_FILE"
fi

section "Registered schedules"
wpr cron schedule list --fields=name,interval,display

section "Next 40 events, earliest first"
printf '$ wp cron event list --fields=hook,next_run_gmt,next_run_relative,recurrence --format=csv %s\n' "$GLOBAL_ARGS"
"${WP[@]}" cron event list --fields=hook,next_run_gmt,next_run_relative,recurrence --format=csv 2>&1 | head -n 41

section "Action Scheduler (version, sources and status need Action Scheduler 3.9.1 or later)"
wpr action-scheduler version --all
wpr action-scheduler source --all
wpr action-scheduler status

section "Cron entries of the current system user ($(id -un 2>/dev/null || printf 'unknown'))"
if command -v crontab >/dev/null 2>&1; then
	cron_lines="$(crontab -l 2>&1 | grep -i -E 'wp-cron|cron event run|action-scheduler|no crontab' | sed -E 's#://[^/@ ]+@#://***@#g')"
	if [ -n "$cron_lines" ]; then
		printf '%s\n' "$cron_lines"
	else
		printf '(no cron-related lines)\n'
	fi
	printf 'Other users, /etc/crontab and /etc/cron.d need root or the host panel to read.\n'
else
	printf '(crontab is not available here)\n'
fi

section "systemd timers (cron-related names)"
if command -v systemctl >/dev/null 2>&1; then
	timer_lines="$(systemctl list-timers --all --no-pager 2>/dev/null | grep -i -E 'wp|cron|wordpress')"
	if [ -n "$timer_lines" ]; then
		printf '%s\n' "$timer_lines"
	else
		printf '(none found)\n'
	fi
else
	printf '(systemctl is not available here)\n'
fi

if [ "${CRON_REPORT_SKIP_SQL:-0}" = "1" ]; then
	section "SQL checks"
	printf 'Skipped (CRON_REPORT_SKIP_SQL=1).\n'
	exit 0
fi

section "SQL checks ($SQL_FILE)"
if [ ! -r "$SQL_FILE" ]; then
	printf 'Cannot read %s\n' "$SQL_FILE"
	exit 0
fi

PREFIX="$("${WP[@]}" db prefix 2>/dev/null)"
if ! printf '%s' "$PREFIX" | grep -Eq '^[A-Za-z0-9_]+$'; then
	printf 'Unexpected table prefix "%s"; skipping SQL.\n' "$PREFIX"
	exit 0
fi
printf 'Table prefix: %s\n' "$PREFIX"

# Run one block: substitute the placeholder, print its name, send it to wp db query.
run_block() {
	local name="$1" sql="$2"
	[ -z "$name" ] && return 0
	if [ "${CRON_REPORT_SKIP_SCANS:-0}" = "1" ] && [[ "$name" == *"(scan)"* ]]; then
		printf '\n-- %s\n(skipped: CRON_REPORT_SKIP_SCANS=1)\n' "$name"
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
