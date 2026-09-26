#!/usr/bin/env bash
# Read-only helper. For each option name, searches the site's PHP code (WordPress core, plugins, must-use plugins and
# themes) for the name in quotes and prints where it appears, then a verdict: core, plugin <folder>, mu-plugin
# <file>, theme <folder>, several owners, or no code found. When the full name is not found, it tries shorter
# prefixes of the name (a name built at run time, 'prefix_' . $key, appears in code only as its prefix) and reports
# those matches as weaker evidence. Core storage names (transients, theme_mods_, widget_, user_roles, _children) get
# a note and a search for the part that names the real owner.
#
# It only reads files with grep. It does not load WordPress, run WP-CLI, connect to the database or write anything.
#
# Usage:
#   bash find-option-owner.sh --path=/var/www/html option_one option_two
#   bash find-option-owner.sh --path=/var/www/html - < names.txt          # names from a file, one per line
#   bash find-option-owner.sh --path=/srv/www --content-dir=/srv/www/app opt  # content folder moved (WP_CONTENT_DIR)
#
# Options:
#   --path=<dir>          WordPress root, the folder that holds wp-includes and wp-admin (default: .)
#   --content-dir=<dir>   the content folder, when it is not <path>/wp-content
#   --min-prefix=<n>      shortest prefix to try, in characters (default 4, the plugin handbook's minimum)
#   -                     also read names from standard input; only the first column of each line is used, so the
#                         "names and sizes" SQL output can be piped in
#
# Only *.php files are searched; node_modules folders are skipped. Run it on the server, or on a copy of the code.

set -u

WP_ROOT="."
CONTENT_DIR=""
MIN_PREFIX=4
READ_STDIN=0
NAMES=()

usage() {
	sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
	case "$arg" in
		--path=*) WP_ROOT="${arg#--path=}" ;;
		--content-dir=*) CONTENT_DIR="${arg#--content-dir=}" ;;
		--min-prefix=*) MIN_PREFIX="${arg#--min-prefix=}" ;;
		-) READ_STDIN=1 ;;
		-h | --help)
			usage
			exit 0
			;;
		--*)
			printf 'Unknown option: %s\n' "$arg" >&2
			exit 2
			;;
		*) NAMES+=("$arg") ;;
	esac
done

if [ "$READ_STDIN" = "1" ]; then
	while IFS= read -r line || [ -n "$line" ]; do
		line="${line%$'\r'}"
		first="$(printf '%s\n' "$line" | awk '{print $1}')"
		case "$first" in
			"" | option_name | "+"* | "|"*) ;;
			*) NAMES+=("$first") ;;
		esac
	done
fi

WP_ROOT="${WP_ROOT%/}"
[ -z "$WP_ROOT" ] && WP_ROOT="/"
[ -z "$CONTENT_DIR" ] && CONTENT_DIR="$WP_ROOT/wp-content"
CONTENT_DIR="${CONTENT_DIR%/}"

if [ ! -d "$WP_ROOT/wp-includes" ] || [ ! -d "$WP_ROOT/wp-admin" ]; then
	printf 'Not a WordPress root (no wp-includes and wp-admin): %s\n' "$WP_ROOT" >&2
	exit 2
fi
if [ ! -d "$CONTENT_DIR" ]; then
	printf 'Content folder not found: %s (use --content-dir)\n' "$CONTENT_DIR" >&2
	exit 2
fi
if ! printf '%s' "$MIN_PREFIX" | grep -Eq '^[0-9]+$'; then
	printf 'Invalid --min-prefix: %s\n' "$MIN_PREFIX" >&2
	exit 2
fi
if [ "${#NAMES[@]}" -eq 0 ]; then
	usage
	exit 2
fi

CORE_DIRS=("$WP_ROOT/wp-includes" "$WP_ROOT/wp-admin")
CODE_DIRS=()
for dir in "$CONTENT_DIR/plugins" "$CONTENT_DIR/mu-plugins" "$CONTENT_DIR/themes"; do
	[ -d "$dir" ] && CODE_DIRS+=("$dir")
done

# Print a path relative to the WordPress root when it is inside it.
relative() {
	case "$1" in
		"$WP_ROOT/"*) printf '%s' "${1#"$WP_ROOT/"}" ;;
		*) printf '%s' "$1" ;;
	esac
}

# Name the owner of a file: plugin <folder>, mu-plugin <file or folder>, theme <folder>, core, or other.
owner_of() {
	local rest
	case "$1" in
		"$CONTENT_DIR/plugins/"*)
			rest="${1#"$CONTENT_DIR/plugins/"}"
			printf 'plugin %s' "${rest%%/*}"
			;;
		"$CONTENT_DIR/mu-plugins/"*)
			rest="${1#"$CONTENT_DIR/mu-plugins/"}"
			printf 'mu-plugin %s' "${rest%%/*}"
			;;
		"$CONTENT_DIR/themes/"*)
			rest="${1#"$CONTENT_DIR/themes/"}"
			printf 'theme %s' "${rest%%/*}"
			;;
		"$WP_ROOT/wp-includes/"* | "$WP_ROOT/wp-admin/"*) printf 'core' ;;
		*) printf 'other' ;;
	esac
}

# search <exact|prefix> <text> <folder>...
# exact finds 'text' or "text"; prefix finds 'text... or "text... (an opening quote, then the text).
# Prints "owner<TAB>relative/path:line" for every matching PHP file, sorted.
search() {
	local mode="$1" text="$2" a b file line
	shift 2
	[ "$#" -eq 0 ] && return 0
	if [ "$mode" = "exact" ]; then
		a="'$text'"
		b="\"$text\""
	else
		a="'$text"
		b="\"$text"
	fi
	grep -rlF --include='*.php' --exclude-dir=node_modules -e "$a" -e "$b" "$@" 2>/dev/null |
		while IFS= read -r file; do
			line="$(grep -nF -m 1 -e "$a" -e "$b" "$file" 2>/dev/null | head -n 1 | cut -d: -f1)"
			printf '%s\t%s:%s\n' "$(owner_of "$file")" "$(relative "$file")" "$line"
		done | sort -u
}

# Print matches grouped by owner, at most three files per owner.
print_matches() {
	awk -F '\t' '{ count[$1]++; if (count[$1] <= 3) printf "  %-32s %s\n", $1, $2 }'
}

# The distinct owners in a list of matches, comma-separated.
owners_of() {
	cut -f1 | sort -u | paste -s -d ',' - | sed 's/,/, /g'
}

# Prefixes of a name, longest first, cut at "_" or "-", each ending with its separator.
prefixes() {
	local name="$1" cut
	while :; do
		case "$name" in
			*[_-]*) ;;
			*) break ;;
		esac
		cut="${name%[_-]*}"
		[ "${#cut}" -lt "$MIN_PREFIX" ] && break
		printf '%s\n' "${name:0:$((${#cut} + 1))}"
		name="$cut"
	done
}

report_name() {
	local name="$1" hint="" subject="$1" results="" core_results="" prefix count owners

	printf '\n== %s\n' "$name"
	if ! printf '%s' "$name" | grep -Eq '^[][A-Za-z0-9_.:@-]+$'; then
		printf 'skipped: the name has characters this helper does not search for\n'
		return
	fi

	case "$name" in
		_site_transient_timeout_* | _transient_timeout_* | _site_transient_* | _transient_*)
			subject="${name#_site_transient_timeout_}"
			subject="${subject#_transient_timeout_}"
			subject="${subject#_site_transient_}"
			subject="${subject#_transient_}"
			hint="transient row (core storage); the owner is the code that sets the transient \"$subject\""
			;;
		theme_mods_*)
			subject="${name#theme_mods_}"
			if [ -d "$CONTENT_DIR/themes/$subject" ]; then
				hint="theme mods (core storage) of the theme \"$subject\", which is installed"
			else
				hint="theme mods (core storage) of the theme \"$subject\", which is not in $(relative "$CONTENT_DIR")/themes"
			fi
			;;
		widget_*)
			subject="${name#widget_}"
			hint="widget settings (core storage) for the widget id_base \"$subject\"; the owner registers that widget"
			;;
		*user_roles)
			printf 'note: roles and capabilities (core storage, <prefix>user_roles)\nverdict: core\n'
			return
			;;
		*_children)
			subject="${name%_children}"
			hint="term hierarchy cache (core storage) for the taxonomy \"$subject\"; the owner registers that taxonomy"
			;;
	esac
	[ -n "$hint" ] && printf 'note: %s\n' "$hint"

	# 1. Core, exact.
	core_results="$(search exact "$subject" "${CORE_DIRS[@]}")"
	if [ -n "$core_results" ] && [ "$subject" = "$name" ]; then
		printf 'exact name in core:\n'
		printf '%s\n' "$core_results" | print_matches
		printf 'verdict: core (never delete it; see references/finding-owners.md)\n'
		return
	fi

	# 2. Plugins, must-use plugins and themes, exact.
	results="$(search exact "$subject" ${CODE_DIRS[@]+"${CODE_DIRS[@]}"})"
	results="$(printf '%s\n%s\n' "$core_results" "$results" | sed '/^$/d' | sort -u)"
	if [ -n "$results" ]; then
		printf 'exact "%s" in:\n' "$subject"
		printf '%s\n' "$results" | print_matches
		owners="$(printf '%s\n' "$results" | owners_of)"
		count="$(printf '%s\n' "$results" | cut -f1 | sort -u | wc -l | tr -d ' ')"
		if [ "$count" -eq 1 ]; then
			printf 'verdict: %s (exact name in its code)\n' "$owners"
		else
			printf 'verdict: several (%s); read the code to see which one saves it\n' "$owners"
		fi
		return
	fi

	# 3. Prefixes, longest first; stop at the first prefix that matches anywhere.
	while IFS= read -r prefix; do
		[ -z "$prefix" ] && continue
		results="$(search prefix "$prefix" ${CODE_DIRS[@]+"${CODE_DIRS[@]}"} "${CORE_DIRS[@]}")"
		if [ -n "$results" ]; then
			printf 'no exact match; prefix "%s" in:\n' "$prefix"
			printf '%s\n' "$results" | print_matches
			printf 'verdict: %s (prefix only, weaker; read how the name is built)\n' "$(printf '%s\n' "$results" | owners_of)"
			return
		fi
	done <<EOF
$(prefixes "$subject")
EOF

	printf 'verdict: no code found in core, plugins, must-use plugins or themes (orphan candidate; check the site history before deleting)\n'
}

printf 'WordPress root: %s\nContent folder: %s\n' "$WP_ROOT" "$CONTENT_DIR"
for name in "${NAMES[@]}"; do
	report_name "$name"
done
printf '\nDone. Nothing was changed.\n'
