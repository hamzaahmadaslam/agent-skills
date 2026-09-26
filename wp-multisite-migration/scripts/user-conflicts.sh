#!/usr/bin/env bash
# user-conflicts.sh: compares a standalone site's users with a network's accounts before an import.
#
# Read-only. The script runs `wp user list` on both installs and `wp eval` to read three network
# options (illegal_names, limited_email_domains, banned_email_domains). It changes nothing.
# Emails are compared in a temporary folder that is deleted on exit; the report prints user IDs
# and logins only, never emails. Loading WordPress through WP-CLI works like a page view: if
# WP-Cron tasks are due, core may start them. Define DISABLE_WP_CRON on copies that must stay quiet.
#
# Usage:
#   bash user-conflicts.sh --standalone-path=/srv/shop --network-path=/srv/network
#
# Report sections:
#   SAME EMAIL     an account with this email exists on the network: reuse it (old ID -> network ID)
#   LOGIN TAKEN    the login exists on the network with another email: decide before the import
#   LOGIN REFUSED  multisite would refuse the login (lowercase letters and digits only, 4 to 60
#                  characters, not digits only, not in illegal_names): choose a new login
#   EMAIL REFUSED  the email domain is banned, or outside limited_email_domains when that is set
#   NEW            create the account on the network
#
# Requires bash, awk and WP-CLI (`wp`) on PATH.

set -euo pipefail

SA_PATH=""
NET_PATH=""

for arg in "$@"; do
  case "$arg" in
    --standalone-path=*) SA_PATH="${arg#--standalone-path=}" ;;
    --network-path=*) NET_PATH="${arg#--network-path=}" ;;
    -h | --help)
      echo "Usage: bash user-conflicts.sh --standalone-path=<path> --network-path=<path>"
      exit 0
      ;;
    *) echo "Unknown argument: $arg (see --help)" >&2; exit 2 ;;
  esac
done

if [ -z "$SA_PATH" ] || [ -z "$NET_PATH" ]; then
  echo "Both --standalone-path and --network-path are required." >&2
  exit 2
fi
if ! command -v wp >/dev/null 2>&1; then
  echo "WP-CLI (wp) is not on PATH." >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"

wp --path="$SA_PATH" --skip-plugins --skip-themes user list \
  --fields=ID,user_login,user_email --format=csv > "$TMP/standalone.csv"
wp --path="$NET_PATH" --skip-plugins --skip-themes user list --network \
  --fields=ID,user_login,user_email --format=csv > "$TMP/network.csv"

# One value per line. When illegal_names is not set, core falls back to this default list.
wp --path="$NET_PATH" --skip-plugins --skip-themes eval '
$names = get_site_option( "illegal_names" );
if ( ! is_array( $names ) ) { $names = array( "www", "web", "root", "admin", "main", "invite", "administrator" ); }
echo implode( PHP_EOL, $names ), PHP_EOL;' > "$TMP/illegal.txt"
wp --path="$NET_PATH" --skip-plugins --skip-themes eval '
$d = get_site_option( "limited_email_domains" );
if ( is_array( $d ) ) { echo implode( PHP_EOL, $d ), PHP_EOL; }' > "$TMP/limited.txt"
wp --path="$NET_PATH" --skip-plugins --skip-themes eval '
$d = get_site_option( "banned_email_domains" );
if ( $d && ! is_array( $d ) ) { $d = explode( "\n", $d ); }
if ( is_array( $d ) ) { echo implode( PHP_EOL, $d ), PHP_EOL; }' > "$TMP/banned.txt"

LC_ALL=C awk -F',' \
  -v ILLEGAL="$TMP/illegal.txt" -v LIMITED="$TMP/limited.txt" -v BANNED="$TMP/banned.txt" \
  -v NETWORK="$TMP/network.csv" '
function unq(s) {
  sub(/\r$/, "", s)
  if (s ~ /^".*"$/) { s = substr(s, 2, length(s) - 2); gsub(/""/, "\"", s) }
  return s
}
function trim(s) { sub(/\r$/, "", s); gsub(/^[ \t]+|[ \t]+$/, "", s); return tolower(s) }
function domain_of(e,   at) { at = index(e, "@"); return at ? substr(e, at + 1) : "" }
function banned_domain(d,   b) {
  for (b in banned) { if (d == b || (length(d) > length(b) && substr(d, length(d) - length(b)) == "." b)) return 1 }
  return 0
}
FILENAME == ILLEGAL { v = trim($0); if (v != "") illegal[v] = 1; next }
FILENAME == LIMITED { v = trim($0); if (v != "") { limited[v] = 1; has_limited = 1 }; next }
FILENAME == BANNED  { v = trim($0); if (v != "") banned[v] = 1; next }
FILENAME == NETWORK {
  if (FNR == 1) next
  id = unq($1); login = unq($2); email = tolower(unq($3))
  by_email[email] = id "\t" login
  by_login[tolower(login)] = id
  next
}
FNR == 1 { next }
{
  id = unq($1); login = unq($2); email = tolower(unq($3))
  total++
  if (email in by_email) { same[++n_same] = id "\t" login "\t" by_email[email]; map[n_same] = id "," substr(by_email[email], 1, index(by_email[email], "\t") - 1); next }
  if (tolower(login) in by_login) { taken[++n_taken] = id "\t" login "\t" by_login[tolower(login)]; next }
  why = ""
  if (login !~ /^[a-z0-9]+$/) why = "only lowercase letters and digits are allowed"
  else if (length(login) < 4) why = "shorter than 4 characters"
  else if (length(login) > 60) why = "longer than 60 characters"
  else if (login ~ /^[0-9]+$/) why = "digits only"
  else if (login in illegal) why = "listed in illegal_names"
  if (why != "") { refused[++n_refused] = id "\t" login "\t" why; next }
  d = domain_of(email)
  if (banned_domain(d)) { erefused[++n_erefused] = id "\t" login "\tdomain is in banned_email_domains"; next }
  if (has_limited && !(d in limited)) { erefused[++n_erefused] = id "\t" login "\tdomain is not in limited_email_domains"; next }
  fresh[++n_new] = id "\t" login
}
END {
  printf "Standalone users: %d\n", total
  printf "\nSAME EMAIL (%d): standalone ID, login -> network ID, login\n", n_same
  for (i = 1; i <= n_same; i++) { split(same[i], a, "\t"); printf "  %s\t%s\t-> %s\t%s\n", a[1], a[2], a[3], a[4] }
  printf "\nLOGIN TAKEN (%d): standalone ID, login, network ID with that login and another email\n", n_taken
  for (i = 1; i <= n_taken; i++) printf "  %s\n", taken[i]
  printf "\nLOGIN REFUSED (%d): standalone ID, login, reason\n", n_refused
  for (i = 1; i <= n_refused; i++) printf "  %s\n", refused[i]
  printf "\nEMAIL REFUSED (%d): standalone ID, login, reason\n", n_erefused
  for (i = 1; i <= n_erefused; i++) printf "  %s\n", erefused[i]
  printf "\nNEW (%d): standalone ID, login\n", n_new
  for (i = 1; i <= n_new; i++) printf "  %s\n", fresh[i]
  printf "\nMapping lines for SAME EMAIL (old_id,new_id):\n"
  for (i = 1; i <= n_same; i++) printf "%s\n", map[i]
  printf "\nNothing was changed.\n"
}
' "$TMP/illegal.txt" "$TMP/limited.txt" "$TMP/banned.txt" "$TMP/network.csv" "$TMP/standalone.csv"
