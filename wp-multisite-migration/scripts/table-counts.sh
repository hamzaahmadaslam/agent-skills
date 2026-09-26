#!/usr/bin/env bash
# table-counts.sh: exact row counts for every table whose name starts with a prefix.
#
# Read-only. The script runs SHOW TABLES and SELECT COUNT(*) through `wp db query` and changes
# nothing. `wp db query` loads only wp-config.php, not WordPress, so it also works while tables are
# being renamed. Counting reads whole tables; on large sites run it outside busy hours.
#
# Output: one line per table, "<name without the prefix><TAB><rows>", sorted, so two runs can be
# compared with diff:
#
#   bash table-counts.sh --path=/srv/network --prefix=wp_3_ > source.txt
#   bash table-counts.sh --path=/srv/blog-a --prefix=wp_ > target.txt
#   diff source.txt target.txt
#
# Requires bash and WP-CLI (`wp`) on PATH.

set -euo pipefail

WP_PATH=""
PREFIX=""

for arg in "$@"; do
  case "$arg" in
    --path=*) WP_PATH="${arg#--path=}" ;;
    --prefix=*) PREFIX="${arg#--prefix=}" ;;
    -h | --help)
      echo "Usage: bash table-counts.sh --prefix=<table prefix> [--path=<wordpress path>]"
      exit 0
      ;;
    *) echo "Unknown argument: $arg (see --help)" >&2; exit 2 ;;
  esac
done

if [ -z "$PREFIX" ]; then
  echo "Missing --prefix, for example --prefix=wp_3_" >&2
  exit 2
fi
case "$PREFIX" in
  *[!A-Za-z0-9_]*)
    echo "The prefix may contain only letters, digits and underscores." >&2
    exit 2
    ;;
esac
if ! command -v wp >/dev/null 2>&1; then
  echo "WP-CLI (wp) is not on PATH." >&2
  exit 1
fi

WP_ARGS=()
[ -n "$WP_PATH" ] && WP_ARGS+=("--path=$WP_PATH")

wpq() { wp ${WP_ARGS[@]+"${WP_ARGS[@]}"} db query "$1" --skip-column-names; }

# In LIKE, "_" matches any character; "\_" matches an underscore.
LIKE_PREFIX=$(printf '%s' "$PREFIX" | sed 's/_/\\_/g')

TABLES=$(wpq "SHOW TABLES LIKE '${LIKE_PREFIX}%'")
if [ -z "$TABLES" ]; then
  echo "No table starts with $PREFIX" >&2
  exit 1
fi

SQL=""
while IFS= read -r TABLE; do
  TABLE="${TABLE%$'\r'}"
  [ -z "$TABLE" ] && continue
  case "$TABLE" in
    *[!A-Za-z0-9_\$-]*)
      echo "Skipped a table with unexpected characters in its name: $TABLE" >&2
      continue
      ;;
  esac
  SHORT="${TABLE#"$PREFIX"}"
  PART="SELECT '${SHORT}', COUNT(*) FROM \`${TABLE}\`"
  if [ -z "$SQL" ]; then SQL="$PART"; else SQL="$SQL UNION ALL $PART"; fi
done <<EOF
$TABLES
EOF

wpq "$SQL" | tr -d '\r' | LC_ALL=C sort
