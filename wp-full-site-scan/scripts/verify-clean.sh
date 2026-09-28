#!/usr/bin/env bash
# Read-only helper for the wp-full-site-scan skill: the verification pass before a cleaned site copy is called done.
#   1. Searches every file under the site copy for the markers you pass (strings from this case's malware, such as
#      its begin and end comments or option names), as fixed strings.
#   2. Searches PHP files for a default list of known web shell names.
#   3. Lists executable files under wp-content/uploads, and non-PHP files there that hold a PHP open tag.
#   4. Prints the SQL count queries to run against the cleaned database. It does not run them: it never calls mysql.
#
# It reads files with grep and find, prints the results, and writes nothing. It makes no network requests.
#
# Usage:
#   bash verify-clean.sh <site-dir> [marker ...]
#   bash verify-clean.sh site 'SC_TH_BEGIN' 'SCV:4.' '__scf_'
#   bash verify-clean.sh --prefix=ab3_ site 'SC_TH_BEGIN'     # fill the table prefix into the printed SQL
#
# Exit codes: 0 nothing found, 1 something found (read each file listed), 2 bad arguments.

set -u

usage() {
	printf 'Usage: bash verify-clean.sh [--prefix=wp_] <site-dir> [marker ...]\n' >&2
	exit 2
}

prefix='{prefix}'
site=''
markers=()
for arg in "$@"; do
	case "$arg" in
		-h | --help) usage ;;
		--prefix=*)
			prefix="${arg#--prefix=}"
			if ! [[ "$prefix" =~ ^[A-Za-z0-9_]+$ ]]; then
				printf 'verify-clean: the prefix may hold only letters, digits and underscores.\n' >&2
				usage
			fi
			;;
		-*) printf 'verify-clean: unknown option %s\n' "$arg" >&2; usage ;;
		*)
			if [ -z "$site" ]; then
				site="$arg"
			else
				markers+=("$arg")
			fi
			;;
	esac
done

[ -n "$site" ] || usage
if [ ! -d "$site" ]; then
	printf 'verify-clean: %s is not a directory.\n' "$site" >&2
	usage
fi

# Known web shell names. Extended regular expression, case-insensitive; the dot in "WSO 2." is literal.
shell_pattern='FilesMan|b374k|r57shell|c99shell|IndoXploit|Alfa-?Shell|anonymousfox|WSO[[:space:]]*[245][.]'
php_includes=(--include='*.php' --include='*.php[0-9]' --include='*.phps' --include='*.phtml' --include='*.pht' --include='*.inc' --include='*.phar' --include='*.suspected')

found=0

printf '== Site copy: %s ==\n' "$site"

printf '\n== 1. Case markers (fixed strings, every file) ==\n'
if [ "${#markers[@]}" -eq 0 ]; then
	printf 'No markers given. Pass the strings you found in this case, for example its begin and end comments.\n'
else
	for marker in "${markers[@]}"; do
		hits="$(grep -rlaF --exclude-dir=node_modules --exclude-dir=.git -e "$marker" -- "$site" 2>/dev/null)"
		if [ -n "$hits" ]; then
			found=1
			printf '%s: FOUND in\n' "$marker"
			printf '%s\n' "$hits" | sed 's/^/  /'
		else
			printf '%s: none\n' "$marker"
		fi
	done
fi

printf '\n== 2. Known web shell names (PHP files) ==\n'
hits="$(grep -rlaiE "${php_includes[@]}" --exclude-dir=node_modules --exclude-dir=.git -e "$shell_pattern" -- "$site" 2>/dev/null)"
if [ -n "$hits" ]; then
	found=1
	printf 'FOUND (read each one; a security plugin can list these names in its own signatures):\n'
	printf '%s\n' "$hits" | sed 's/^/  /'
else
	printf 'none\n'
fi

printf '\n== 3. Executable code in uploads ==\n'
uploads="$site/wp-content/uploads"
if [ ! -d "$uploads" ]; then
	printf 'No %s folder.\n' "$uploads"
else
	stubs=0
	listed=0
	while IFS= read -r -d '' file; do
		size="$(wc -c <"$file" | tr -d ' ')"
		name="$(basename "$file")"
		if [ "$name" = "index.php" ] && [ "$size" -lt 200 ]; then
			printf '  %s (%s bytes; small index.php, likely an empty guard stub: confirm by reading)\n' "$file" "$size"
			stubs=$((stubs + 1))
		else
			printf '  %s (%s bytes)   <<< FOUND\n' "$file" "$size"
			listed=$((listed + 1))
		fi
	done < <(find "$uploads" -type f \( -iname '*.php*' -o -iname '*.phtml' -o -iname '*.pht' -o -iname '*.phar' -o -iname '*.suspected' \) -print0 2>/dev/null)
	printf 'Executable files: %s, plus %s small index.php stub(s).\n' "$listed" "$stubs"
	[ "$listed" -eq 0 ] || found=1

	hidden="$(grep -rlaF --exclude='*.php' --exclude='*.php[0-9]' --exclude='*.phtml' --exclude='*.pht' --exclude='*.phar' --exclude='*.suspected' -e '<?php' -- "$uploads" 2>/dev/null)"
	if [ -n "$hidden" ]; then
		found=1
		printf 'Non-PHP files in uploads holding a PHP open tag:\n'
		printf '%s\n' "$hidden" | sed 's/^/  /'
	else
		printf 'Non-PHP files in uploads holding a PHP open tag: none\n'
	fi
fi

printf '\n== 4. SQL to run against the cleaned database (not run here) ==\n'
cat <<SQL
-- Every count must be 0, and the administrator list must hold only people the owner names.
SELECT COUNT(*) AS hex_named_options FROM ${prefix}options WHERE option_name REGEXP '^[0-9a-fA-F]{6,32}\$';
SELECT COUNT(*) AS sc_options FROM ${prefix}options WHERE LEFT(option_name, 3) = 'sc_';
SELECT COUNT(*) AS stored_sessions FROM ${prefix}usermeta WHERE meta_key = 'session_tokens';
SELECT COUNT(*) AS application_passwords FROM ${prefix}usermeta WHERE meta_key = '_application_passwords';
SELECT u.user_login, u.user_email, u.user_registered FROM ${prefix}users u
  JOIN ${prefix}usermeta m ON m.user_id = u.ID AND m.meta_key = '${prefix}capabilities'
  WHERE m.meta_value LIKE '%administrator%';
SQL
safe_marker='^[A-Za-z0-9 _.:-]+$'
for marker in ${markers[@]+"${markers[@]}"}; do
	if [[ "$marker" =~ $safe_marker ]]; then
		printf "SELECT COUNT(*) AS marker_in_options FROM %soptions WHERE LOCATE('%s', option_value) > 0;\n" "$prefix" "$marker"
		printf "SELECT COUNT(*) AS marker_in_posts FROM %sposts WHERE LOCATE('%s', post_content) > 0;\n" "$prefix" "$marker"
	else
		printf -- '-- Marker with quotes or other special characters; write its query by hand: %s\n' "$marker"
	fi
done

if [ "$found" -eq 1 ]; then
	printf '\nResult: something was found above. Read each file before calling the copy clean.\n'
	exit 1
fi
printf '\nResult: nothing found in the files. Run the SQL above too.\n'
exit 0
