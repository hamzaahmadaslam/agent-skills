#!/usr/bin/env bash
# Read-only helper. Prints the character set and collation state of one WordPress site: the DB_CHARSET and DB_COLLATE
# constants, the charset and collation WordPress chose for its connection ($wpdb->charset, $wpdb->collate), the
# session variables of WordPress's own connection, then the SELECT and SHOW blocks in collation-checks.sql.
#
# It runs WP-CLI read commands only: `wp eval` with code that reads constants and $wpdb properties and runs
# SHOW SESSION VARIABLES, `wp db prefix`, `wp db query` with the SELECT and SHOW blocks, and, in the DDL mode below,
# `wp db export - --no-data=true` (table definitions to standard output, no rows). It makes no network calls of its own
# and changes no settings, options or tables. Loading WordPress runs the site's own code, as any request does.
# WordPress loads with WP-Cron spawning turned off (a spawn writes the doing_cron lock and sends a loopback request)
# and without WP-CLI's own update check.
#
# Usage (run where WP-CLI can reach the site; any arguments are passed to every wp call as global flags):
#   bash collation-report.sh --path=/var/www/html
#   bash collation-report.sh --path=/var/www/html --url=example.com/shop      # one site of a multisite
#   COLLATION_REPORT_SKIP_SQL=1 bash collation-report.sh --path=/var/www/html  # WordPress side only
#   COLLATION_REPORT_DDL_TABLES=wp_example_log,wp_posts bash collation-report.sh --path=/var/www/html > tables.sql
#       prints only the CREATE TABLE statements of those tables (for propose-alters.mjs); the dump header names the
#       database and host, so keep that file with the other private exports.
#
# Needs: bash, WP-CLI, and the mysql or mariadb client that `wp db query` uses. `wp db query` ignores --url, so the
# script writes this site's table prefix into each statement. The output holds names, collations, counts and sizes,
# no row contents.

set -u

export WP_CLI_DISABLE_AUTO_CHECK_UPDATE=1
NO_SPAWN='--exec=WP_CLI::add_wp_hook( "init", static function () { remove_action( "init", "wp_cron" ); }, 0 );'
WP=(wp "$NO_SPAWN" "$@")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$HERE/collation-checks.sql"

section() {
	printf '\n== %s ==\n' "$1"
}

# DDL mode: table definitions only, for scripts/propose-alters.mjs.
if [ -n "${COLLATION_REPORT_DDL_TABLES:-}" ]; then
	if ! [[ "$COLLATION_REPORT_DDL_TABLES" =~ ^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$ ]]; then
		printf 'COLLATION_REPORT_DDL_TABLES must be table names separated by commas.\n' >&2
		exit 1
	fi
	"${WP[@]}" db export - --no-data=true --tables="$COLLATION_REPORT_DDL_TABLES"
	exit $?
fi

# PHP for `wp eval`: constants, $wpdb's choice, and the session variables of WordPress's own connection.
read -r -d '' STATE_PHP <<'PHP'
global $wpdb, $wp_version;
$line = static function ( $label, $value ) {
	if ( is_bool( $value ) ) {
		$value = $value ? 'yes' : 'no';
	} elseif ( null === $value ) {
		$value = '(not defined)';
	} elseif ( '' === $value ) {
		$value = '(empty)';
	}
	printf( "%-44s %s\n", $label . ':', $value );
};
$line( 'WordPress version', $wp_version );
$line( 'Multisite', is_multisite() );
$line( 'Table prefix ($wpdb->prefix)', $wpdb->prefix );
$line( 'Base prefix ($wpdb->base_prefix)', $wpdb->base_prefix );
$line( 'Database server', $wpdb->db_server_info() );
$line( 'DB_CHARSET constant', defined( 'DB_CHARSET' ) ? DB_CHARSET : null );
$line( 'DB_COLLATE constant', defined( 'DB_COLLATE' ) ? DB_COLLATE : null );
$line( 'Connection charset ($wpdb->charset)', $wpdb->charset );
$line( 'Connection collation ($wpdb->collate)', $wpdb->collate );
$line( 'has_cap( utf8mb4_520 )', $wpdb->has_cap( 'utf8mb4_520' ) );
$line( 'get_charset_collate()', $wpdb->get_charset_collate() );
echo "\nSession variables of WordPress's own connection:\n";
$rows = $wpdb->get_results( "SHOW SESSION VARIABLES WHERE Variable_name IN ( 'character_set_client', 'character_set_connection', 'character_set_results', 'collation_connection', 'character_set_database', 'collation_database' )" );
foreach ( (array) $rows as $row ) {
	printf( "  %-42s %s\n", $row->Variable_name, $row->Value );
}
PHP

section "Report time (UTC)"
date -u '+%Y-%m-%d %H:%M:%S'

section "WordPress connection (wp eval, read-only)"
printf '$ wp eval <constants, $wpdb->charset and ->collate, SHOW SESSION VARIABLES>\n'
"${WP[@]}" eval "$STATE_PHP" 2>&1 || printf '(command failed with exit code %s)\n' "$?"

if [ "${COLLATION_REPORT_SKIP_SQL:-0}" = "1" ]; then
	section "SQL checks"
	printf 'Skipped (COLLATION_REPORT_SKIP_SQL=1).\n'
	exit 0
fi

section "SQL checks ($SQL_FILE)"
if [ ! -r "$SQL_FILE" ]; then
	printf 'Cannot read %s\n' "$SQL_FILE"
	exit 0
fi

PREFIX="$("${WP[@]}" db prefix 2>/dev/null)"
WP_COLLATE="$("${WP[@]}" eval 'global $wpdb; echo $wpdb->collate;' 2>/dev/null)"
if ! [[ "$PREFIX" =~ ^[A-Za-z0-9_]+$ ]]; then
	printf 'Unexpected table prefix "%s"; skipping SQL.\n' "$PREFIX"
	exit 0
fi
if ! [[ "$WP_COLLATE" =~ ^[A-Za-z0-9_]*$ ]]; then
	printf 'Unexpected collation "%s"; skipping SQL.\n' "$WP_COLLATE"
	exit 0
fi
printf 'Table prefix: %s   WordPress connection collation: %s\n' "$PREFIX" "${WP_COLLATE:-(empty)}"
printf 'Blocks for the other server type fail and are skipped.\n'

# Run one block: substitute the placeholders, print its name, send it to wp db query.
run_block() {
	local name="$1" sql="$2"
	[ -z "$name" ] && return 0
	sql="${sql//\{prefix\}/$PREFIX}"
	sql="${sql//\{wp_collate\}/$WP_COLLATE}"
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
