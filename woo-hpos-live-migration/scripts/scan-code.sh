#!/usr/bin/env bash
# Read-only helper. Scans plugin, must-use plugin, drop-in and theme code in a wp-content folder for HPOS risks and
# prints one row per component. It only reads files: it changes nothing, loads no WordPress code and makes no network
# calls. Run it on the server or on a copy of wp-content.
#
# Columns:
#   wc_aware     yes when the main plugin file has a "WC tested up to" header. WooCommerce's own compatibility check
#                counts a plugin that declares nothing only when it has that header; themes, must-use plugins and
#                drop-ins are never checked by WooCommerce.
#   declaration  what the code declares for HPOS (feature id custom_order_tables) through
#                FeaturesUtil::declare_compatibility: compatible, incompatible, found (value not read), other features
#                only, or none.
#   api_lines    lines matching the recipe book's direct-access pattern (many false positives).
#   shop_order   lines containing shop_order (post type checks, admin hooks, SQL): fewer false positives.
#   admin_lines  lines matching the recipe book's order admin screen pattern.
# Both patterns come from WooCommerce's HPOS recipe book:
# https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/recipe-book/
# Code that snippet plugins keep in the database, and systems outside WordPress, are not files, so this scan cannot
# see them.
#
# Usage:
#   bash scan-code.sh /var/www/html/wp-content
#   bash scan-code.sh /var/www/html/wp-content --details   # also list matching lines that mention "order"
# Needs: bash, grep, awk and head (GNU or BSD versions).

set -u

CONTENT_DIR=""
DETAILS=0
for arg in "$@"; do
	case "$arg" in
		--details) DETAILS=1 ;;
		-h | --help)
			awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "$0"
			exit 0
			;;
		*) CONTENT_DIR="$arg" ;;
	esac
done
CONTENT_DIR="${CONTENT_DIR:-wp-content}"
CONTENT_DIR="${CONTENT_DIR%/}"

if [ ! -d "$CONTENT_DIR" ]; then
	printf 'No such directory: %s\n' "$CONTENT_DIR" >&2
	exit 1
fi

API_RE='wpdb|get_post|get_post_field|get_post_status|get_post_type|get_post_type_object|get_posts|metadata_exists|get_post_meta|get_metadata|get_metadata_raw|get_metadata_default|get_metadata_by_mid|wp_insert_post|add_metadata|add_post_meta|wp_update_post|update_post_meta|update_metadata|update_metadata_by_mid|delete_metadata|delete_post_meta|delete_metadata_by_mid|delete_post_meta_by_key|wp_delete_post|wp_trash_post|wp_untrash_post|wp_transition_post_status|clean_post_cache|update_post_caches|update_postmeta_cache|post_exists|wp_count_post|shop_order'
ADMIN_RE='post_updated_messages|do_meta_boxes|enter_title_here|edit_form_before_permalink|edit_form_after_title|edit_form_after_editor|submitpage_box|submitpost_box|edit_form_advanced|dbx_post_sidebar|manage_shop_order_posts_columns|manage_shop_order_posts_custom_column'
DETAIL_LIMIT=40

# grep over PHP files in a folder, or over one file. Extra arguments go to grep before the target.
php_grep() {
	local target="$1"
	shift
	if [ -d "$target" ]; then
		grep -r --include='*.php' --exclude-dir=node_modules --exclude-dir=.git "$@" "$target" 2>/dev/null
	else
		grep "$@" "$target" 2>/dev/null
	fi
}

# Number of lines matching a pattern.
count_lines() {
	php_grep "$2" -hE -e "$1" | awk 'END { print NR + 0 }'
}

# Whether a PHP file has a "Plugin Name" header (WordPress reads headers from the first 8 KB).
has_plugin_header() {
	head -c 8192 "$1" | grep -Eiq '^[[:space:]]*(<\?php)?[[:space:]/*#@]*Plugin Name:'
}

# yes / no for a "WC tested up to" header in the main plugin file.
wc_aware() {
	local target="$1" file
	if [ -f "$target" ]; then
		if head -c 8192 "$target" | grep -Eiq 'WC tested up to:[[:space:]]*[^[:space:]]'; then echo yes; else echo no; fi
		return
	fi
	for file in "$target"/*.php; do
		[ -f "$file" ] || continue
		if has_plugin_header "$file"; then
			if head -c 8192 "$file" | grep -Eiq 'WC tested up to:[[:space:]]*[^[:space:]]'; then echo yes; else echo no; fi
			return
		fi
	done
	echo "no header"
}

# What the component declares for custom_order_tables.
declaration() {
	local target="$1" calls same_line
	calls="$(php_grep "$target" -hE -e 'declare_compatibility')"
	if [ -z "$calls" ]; then
		echo none
		return
	fi
	same_line="$(printf '%s\n' "$calls" | grep -E 'custom_order_tables')"
	if [ -n "$same_line" ]; then
		if printf '%s\n' "$same_line" | grep -Eq "custom_order_tables['\"][[:space:]]*,[^,]*,[[:space:]]*false"; then
			echo incompatible
		elif printf '%s\n' "$same_line" | grep -Eq "custom_order_tables['\"][[:space:]]*,[^,]*,[[:space:]]*true"; then
			echo compatible
		elif printf '%s\n' "$same_line" | grep -Eq "custom_order_tables['\"][[:space:]]*,[^,)]*\)"; then
			echo compatible
		else
			echo "found (value not read)"
		fi
		return
	fi
	# The feature id may sit on another line, for example in a loop over several feature ids.
	if php_grep "$target" -qE -e 'custom_order_tables'; then
		echo "found (value not read)"
	else
		echo "other features only"
	fi
}

ROWS=0
row() {
	local kind="$1" target="$2" name aware decl api shop admin
	name="${target#"$CONTENT_DIR"/}"
	case "$kind" in
		plugin) aware="$(wc_aware "$target")" ;;
		*) aware="n/a" ;;
	esac
	decl="$(declaration "$target")"
	api="$(count_lines "$API_RE" "$target")"
	shop="$(count_lines 'shop_order' "$target")"
	admin="$(count_lines "$ADMIN_RE" "$target")"
	printf '%-46s %-9s %-11s %-24s %9s %10s %11s\n' "$name" "$kind" "$aware" "$decl" "$api" "$shop" "$admin"
	ROWS=$((ROWS + 1))
	if [ "$DETAILS" = 1 ] && [ $((api + admin)) -gt 0 ]; then
		php_grep "$target" -HnE -e "$API_RE" -e "$ADMIN_RE" | grep -i 'order' | head -n "$DETAIL_LIMIT" | sed 's/^/      /'
	fi
}

printf 'HPOS code scan of %s (read-only)\n\n' "$CONTENT_DIR"
printf '%-46s %-9s %-11s %-24s %9s %10s %11s\n' component type wc_aware declaration api_lines shop_order admin_lines

for target in "$CONTENT_DIR"/plugins/*; do
	[ -e "$target" ] || continue
	case "$target" in
		*/plugins/woocommerce)
			printf '%-46s %-9s %s\n' "plugins/woocommerce" plugin "skipped: WooCommerce core"
			continue
			;;
	esac
	# A single file is a plugin only with a Plugin Name header, as in WordPress (index.php files are not).
	if [ -d "$target" ] || { [ "${target##*.}" = php ] && has_plugin_header "$target"; }; then
		row plugin "$target"
	fi
done

for target in "$CONTENT_DIR"/mu-plugins/*; do
	[ -e "$target" ] || continue
	if [ -d "$target" ] || [ "${target##*.}" = php ]; then
		row mu-plugin "$target"
	fi
done

# Drop-ins are the file names WordPress loads from wp-content (_get_dropins() in wp-admin/includes/plugin.php).
for target in "$CONTENT_DIR"/*.php; do
	[ -f "$target" ] || continue
	case "${target##*/}" in
		advanced-cache.php | db.php | db-error.php | install.php | maintenance.php | object-cache.php | php-error.php | \
			fatal-error-handler.php | sunrise.php | blog-deleted.php | blog-inactive.php | blog-suspended.php)
			row drop-in "$target"
			;;
	esac
done

for target in "$CONTENT_DIR"/themes/*; do
	[ -d "$target" ] || continue
	row theme "$target"
done

printf '\n%s components scanned.\n' "$ROWS"
printf 'Review every row with shop_order or admin_lines above 0, every plugin whose wc_aware is no, every theme and\n'
printf 'must-use plugin, and every plugin whose declaration is none. Most api_lines are false positives.\n'
