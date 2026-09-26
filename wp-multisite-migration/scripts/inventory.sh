#!/usr/bin/env bash
# inventory.sh: read-only inventory of one WordPress site before a multisite migration.
#
# Read-only. The script runs WP-CLI read commands (get, list, has, prefix, size) and SELECT or
# SHOW queries, plus `wp eval` calls that only read values. It writes nothing to the database or
# to files, flushes no cache, and skips update checks, so it makes no request to wordpress.org.
# Plugins and themes are not loaded (--skip-plugins --skip-themes); must-use plugins still load.
# It prints administrator logins, never email addresses, password hashes or database credentials.
# Loading WordPress through WP-CLI works like a page view: if WP-Cron tasks are due, core may start
# them. Define DISABLE_WP_CRON in wp-config.php on copies that must stay quiet.
#
# Usage:
#   bash inventory.sh --path=/srv/network --url=https://network.example/blog-a/   # one subsite
#   bash inventory.sh --path=/srv/shop                                             # a standalone site
#
# Requires bash and WP-CLI (`wp`) on PATH, run on the server that holds the files.

set -uo pipefail

WP_PATH=""
SITE_URL=""

usage() {
  cat <<'EOF'
Read-only inventory of one WordPress site before a multisite migration.

  bash inventory.sh --path=<wordpress path> [--url=<site url>]

--url selects the subsite on a multisite network. Output is plain text on stdout.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --path=*) WP_PATH="${arg#--path=}" ;;
    --url=*) SITE_URL="${arg#--url=}" ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg (see --help)" >&2; exit 2 ;;
  esac
done

if ! command -v wp >/dev/null 2>&1; then
  echo "WP-CLI (wp) is not on PATH." >&2
  exit 1
fi

WP_ARGS=(--skip-plugins --skip-themes)
[ -n "$WP_PATH" ] && WP_ARGS+=("--path=$WP_PATH")
[ -n "$SITE_URL" ] && WP_ARGS+=("--url=$SITE_URL")

wpc() { wp "${WP_ARGS[@]}" "$@"; }

section() { printf '\n== %s ==\n' "$1"; }

# show LABEL COMMAND...: one-line value, or the first line of the error.
show() {
  local label="$1" out
  shift
  if out=$("$@" 2>&1); then
    printf '%s: %s\n' "$label" "$out"
  else
    printf '%s: (not available: %s)\n' "$label" "$(printf '%s\n' "$out" | head -n 1)"
  fi
}

# block LABEL COMMAND...: multi-line output, indented.
block() {
  local label="$1" out
  shift
  printf '%s:\n' "$label"
  if out=$("$@" 2>&1); then
    if [ -n "$out" ]; then printf '%s\n' "$out" | sed 's/^/  /'; else printf '  (none)\n'; fi
  else
    printf '  (not available: %s)\n' "$(printf '%s\n' "$out" | head -n 1)"
  fi
}

# q SQL: a read-only query through WP-CLI, tab-separated, no header.
q() { wpc db query "$1" --skip-column-names; }

# ---------------------------------------------------------------------------
section "Environment"
show "WP-CLI" wpc cli version
block "WordPress" wpc core version --extra
show "PHP" wpc eval 'echo PHP_VERSION;'
show "Database server" q "SELECT VERSION()"

# ---------------------------------------------------------------------------
section "Install"
IS_MS=$(wpc eval 'echo is_multisite() ? "yes" : "no";' 2>/dev/null || echo "unknown")
printf 'Multisite: %s\n' "$IS_MS"
show "table_prefix in wp-config.php" wpc config get table_prefix
CONTENT_DIR=$(wpc eval 'echo WP_CONTENT_DIR;' 2>/dev/null || echo "")
printf 'WP_CONTENT_DIR: %s\n' "${CONTENT_DIR:-(unknown)}"

printf 'Constants defined in wp-config.php:\n'
for c in WP_ALLOW_MULTISITE MULTISITE SUBDOMAIN_INSTALL VHOST DOMAIN_CURRENT_SITE PATH_CURRENT_SITE \
  SITE_ID_CURRENT_SITE BLOG_ID_CURRENT_SITE SUNRISE NOBLOGREDIRECT COOKIE_DOMAIN UPLOADS UPLOADBLOGSDIR \
  BLOGUPLOADDIR WP_CONTENT_DIR WP_CONTENT_URL WP_HOME WP_SITEURL CUSTOM_USER_TABLE CUSTOM_USER_META_TABLE \
  WP_CACHE DISABLE_WP_CRON; do
  if wpc config has "$c" --type=constant >/dev/null 2>&1; then
    printf '  %s = %s\n' "$c" "$(wpc config get "$c" --type=constant 2>/dev/null)"
  fi
done

if [ -n "$CONTENT_DIR" ]; then
  for f in sunrise.php object-cache.php advanced-cache.php db.php blog-deleted.php blog-inactive.php blog-suspended.php; do
    [ -f "$CONTENT_DIR/$f" ] && printf 'Drop-in present: %s\n' "$f"
  done
fi

# ---------------------------------------------------------------------------
BLOG_ID=""
BASE=$(wpc eval 'global $wpdb; echo $wpdb->base_prefix;' 2>/dev/null || echo "")
PREFIX=$(wpc db prefix 2>/dev/null || echo "")
IS_MAIN="no"

if [ "$IS_MS" = "yes" ]; then
  section "This site in the network"
  BLOG_ID=$(wpc eval 'echo get_current_blog_id();' 2>/dev/null || echo "")
  IS_MAIN=$(wpc eval 'echo is_main_site() ? "yes" : "no";' 2>/dev/null || echo "unknown")
  printf 'blog_id: %s\n' "${BLOG_ID:-(unknown)}"
  printf 'Main site: %s\n' "$IS_MAIN"
  printf 'Base prefix: %s\n' "${BASE:-(unknown)}"
  printf 'Site prefix: %s\n' "${PREFIX:-(unknown)}"
  show "Network type" wpc eval 'echo is_subdomain_install() ? "subdomain" : "subdirectory";'
  show "Sites in the network" wpc site list --format=count
  if [ -n "$BLOG_ID" ]; then
    block "wp_blogs row" wpc site list --site__in="$BLOG_ID" --fields=blog_id,domain,path,url,public,archived,spam,deleted,mature --format=csv
    block "Site meta keys (wp_blogmeta)" q "SELECT meta_key, COUNT(*) FROM \`${BASE}blogmeta\` WHERE blog_id = ${BLOG_ID} GROUP BY meta_key"
  fi
  show "ms_files_rewriting (network option)" wpc site option get ms_files_rewriting
  show "Super admins (count)" wpc super-admin list --format=count
else
  section "This site"
  printf 'Table prefix: %s\n' "${PREFIX:-(unknown)}"
fi

# ---------------------------------------------------------------------------
section "Options"
for o in home siteurl upload_path upload_url_path fileupload_url permalink_structure blog_public stylesheet template WPLANG; do
  show "$o" wpc option get "$o"
done
show "active_plugins" wpc option get active_plugins --format=json

# ---------------------------------------------------------------------------
section "Tables"
if [ "$IS_MS" = "yes" ] && [ "$IS_MAIN" = "yes" ]; then
  printf 'Main site: its prefix is the base prefix, so prefix selection would include every table.\n'
  block "Core tables of this site (--scope=blog)" wpc db tables --scope=blog
  if [ -n "$BASE" ]; then
    printf 'Other tables with the base prefix and no site number (candidates for this site, read each name):\n'
    q "SHOW TABLES" 2>/dev/null | awk -v base="$BASE" '
      BEGIN {
        n = split("users usermeta blogs blogmeta signups site sitemeta registration_log sitecategories posts comments links options postmeta terms term_taxonomy term_relationships termmeta commentmeta", k, " ")
        for (i = 1; i <= n; i++) skip[base k[i]] = 1
      }
      index($0, base) == 1 {
        rest = substr($0, length(base) + 1)
        if (rest ~ /^[0-9]+_/) next
        if ($0 in skip) next
        print "  " $0
      }'
  fi
  block "Table sizes (core tables of this site)" wpc db size --tables --scope=blog --format=csv
else
  block "Tables with this site's prefix" wpc db tables --all-tables-with-prefix
  block "Table sizes" wpc db size --tables --all-tables-with-prefix --format=csv
fi
if [ -n "$BASE" ]; then
  printf 'Tables without the base prefix (other installs or tools sharing the database):\n'
  q "SHOW TABLES" 2>/dev/null | awk -v base="$BASE" 'index($0, base) != 1 { print "  " $0; found = 1 } END { if (!found) print "  (none)" }'
fi
if [ "$IS_MS" = "yes" ]; then
  block "Tables with a blog_id column (network-wide data)" q "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'blog_id' ORDER BY table_name"
  block "Tables whose name contains 'domain' (domain mapping plugins)" q "SHOW TABLES LIKE '%domain%'"
fi

# ---------------------------------------------------------------------------
section "Content"
if [ -n "$PREFIX" ]; then
  block "Posts by type and status" q "SELECT post_type, post_status, COUNT(*) FROM \`${PREFIX}posts\` GROUP BY post_type, post_status ORDER BY post_type, post_status"
  block "Comments by status" q "SELECT comment_approved, COUNT(*) FROM \`${PREFIX}comments\` GROUP BY comment_approved"
  show "Latest post change (GMT)" q "SELECT MAX(post_modified_gmt) FROM \`${PREFIX}posts\`"
  show "Latest comment (GMT)" q "SELECT MAX(comment_date_gmt) FROM \`${PREFIX}comments\`"
fi

# ---------------------------------------------------------------------------
section "Users"
show "Members of this site" wpc user list --format=count
block "Administrators (ID, login)" wpc user list --role=administrator --fields=ID,user_login --format=csv
block "Roles defined on this site" wpc role list --fields=role --format=csv
if [ "$IS_MS" = "yes" ]; then
  show "Accounts in the network" wpc user list --network --format=count
  if [ -n "$PREFIX" ] && [ -n "$BASE" ]; then
    show "Rows with ${PREFIX}capabilities" q "SELECT COUNT(*) FROM \`${BASE}usermeta\` WHERE meta_key = '${PREFIX}capabilities'"
  fi
else
  show "Users without a role" wpc user list --role=none --format=count
fi

# ---------------------------------------------------------------------------
section "Plugins and themes"
block "Plugins (name, status, version)" wpc plugin list --skip-update-check --fields=name,status,version --format=csv
block "Plugins with 'Network: true' in their header" wpc eval 'require_once ABSPATH . "wp-admin/includes/plugin.php"; foreach ( get_plugins() as $f => $d ) { if ( ! empty( $d["Network"] ) ) { echo $f, PHP_EOL; } }'
block "Themes (name, status, version)" wpc theme list --skip-update-check --fields=name,status,version --format=csv
if [ "$IS_MS" = "yes" ]; then
  show "Themes enabled for the network (allowedthemes)" wpc site option get allowedthemes --format=json
  show "Themes enabled for this site (allowedthemes)" wpc option get allowedthemes --format=json
  block "Network option keys (plugins may keep settings here)" wpc site option list --fields=meta_key --format=csv
fi

# ---------------------------------------------------------------------------
section "Uploads"
UP=$(wpc eval '$u = wp_get_upload_dir(); echo $u["basedir"], PHP_EOL, $u["baseurl"], PHP_EOL;' 2>/dev/null || echo "")
BASEDIR=$(printf '%s\n' "$UP" | sed -n 1p)
BASEURL=$(printf '%s\n' "$UP" | sed -n 2p)
printf 'basedir: %s\n' "${BASEDIR:-(unknown)}"
printf 'baseurl: %s\n' "${BASEURL:-(unknown)}"
printf '(read without plugins; a plugin that filters upload_dir can change these)\n'
if [ -n "$BASEDIR" ] && [ -d "$BASEDIR" ]; then
  if [ "$IS_MS" = "yes" ] && [ "$IS_MAIN" = "yes" ]; then
    printf 'Files (excluding sites/): %s\n' "$(find "$BASEDIR" -path "$BASEDIR/sites" -prune -o -type f -print | wc -l | tr -d ' ')"
  else
    printf 'Files: %s\n' "$(find "$BASEDIR" -type f | wc -l | tr -d ' ')"
    printf 'Size: %s\n' "$(du -sh "$BASEDIR" 2>/dev/null | cut -f1)"
  fi
else
  printf 'Folder not found on this machine.\n'
fi

# ---------------------------------------------------------------------------
section "Scheduled events"
show "Cron events of this site" wpc cron event list --format=count

printf '\nDone. Nothing was changed.\n'
