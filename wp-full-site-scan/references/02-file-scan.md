# Phase 2: scan the files

Read this after the workspace is ready. The goal is a verified list of infected, modified and suspicious files. Work
through the steps in order: the early ones give yes or no answers and shrink the work for the later, noisier ones.

The helpers named below live in `scripts/`. Each one reads, prints and writes nothing, and none makes a network
request; the usage lines at the top of each file give its arguments. Downloading official checksum files is a
separate step you run with curl. Before writing any script or query of your own, read [traps.md](traps.md).

## Live site, read-only

When the requester gives SSH access instead of a backup:

- Prefer copying the files off the server and scanning the copy with the steps below. `tar` and `rsync -a` keep file
  modification times, which phase 4 needs. Scanning in place is slower, leaves traces in the server's logs, and runs
  your tools next to the attacker's.
- Run WP-CLI from a directory outside the document root (it reads `wp-cli.yml` files in the current directory and its
  parents, [01-workspace.md](01-workspace.md)), and only read commands, each with the global parameters
  `--skip-plugins --skip-themes`, so the site's plugins and themes do not run or hide results
  ([WP-CLI global parameters](https://make.wordpress.org/cli/handbook/references/config/)).
- Those flags do not stop everything. Must-use plugins still load (same page), `wp-config.php` still runs, and the
  `db.php` and `object-cache.php` drop-ins still load whenever they exist
  ([require_wp_db()](https://developer.wordpress.org/reference/functions/require_wp_db/),
  [wp_start_object_cache()](https://developer.wordpress.org/reference/functions/wp_start_object_cache/)). WP-CLI never
  loads `advanced-cache.php`
  ([Runner.php L1564-L1570 at v2.12.0](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1564-L1570)).
  Malware in any of those can still filter what WP-CLI shows, so check WP-CLI output against the files themselves.
- `wp core verify-checksums` runs before WordPress loads and needs no skip flags. `wp plugin verify-checksums --all`
  loads WordPress, so add them; it reads plugin versions from the files on disk.
- Never request a suspect PHP file over HTTP, with a browser or with curl: the server runs it.

## Step 1: verify WordPress core (a yes or no answer)

WordPress.org publishes an MD5 checksum for every file of every core release, as
`{"checksums": {"wp-login.php": "<md5>", ...}}` when you ask with a locale
([core checksums API](https://api.wordpress.org/core/checksums/1.0/?version=6.8.2&locale=en_US)). Download the list for
the version and locale you recorded in phase 1 (`en_US` when `$wp_local_package` is absent), then compare:

```sh
curl -fsS -o WORK/evidence/core-checksums.json \
  "https://api.wordpress.org/core/checksums/1.0/?version=<version>&locale=<locale>"
node scripts/verify-core-checksums.mjs WORK/site WORK/evidence/core-checksums.json
```

With WP-CLI available, `wp core verify-checksums --include-root --path=WORK/site`, run from outside `WORK/`, does the
same comparison. It runs before WordPress loads and reads the version from `wp-includes/version.php` as text, so it
runs none of the site's code
([Checksum_Core_Command.php L108, L244-L270 at v2.3.7](https://github.com/wp-cli/checksum-command/blob/v2.3.7/src/Checksum_Core_Command.php#L244-L270)).
It reports "File doesn't verify against checksum" for modified files and "File should not exist" for extra ones, and
with `--include-root` it warns about every non-WordPress item in the root
([wp core verify-checksums](https://developer.wordpress.org/cli/commands/core/verify-checksums/)). Both tools skip the
list's `wp-content/` entries (the bundled themes and plugins), because those are updated separately
([Checksum_Core_Command.php L155-L158 at v2.3.7](https://github.com/wp-cli/checksum-command/blob/v2.3.7/src/Checksum_Core_Command.php#L155-L158)).

- **Modified core file:** investigate it. Treat it as infected until you have read the difference.
- **File that should not exist:** usually harmless (`error_log`, a stray archive), but read every name. A `wp-*.php`
  file in the root that core does not ship, such as a renamed copy of `wp-login.php`, shows up here.
- **Managed hosts:** where core is a symbolic link to the host's shared copy (phase 0), the site cannot modify it. Say
  so in the report rather than listing core as unchecked.

## Step 2: verify every wordpress.org plugin (a yes or no answer)

WordPress.org publishes a checksum list for each release of each plugin in its directory, at
`https://downloads.wordpress.org/plugin-checksums/<slug>/<version>.json`, with an MD5 and a SHA-256 for every file
([example: Akismet 5.3](https://downloads.wordpress.org/plugin-checksums/akismet/5.3.json)). A value can be a single
hash or a list of accepted hashes
([Checksum_Plugin_Command.php L371-L384 at v2.3.7](https://github.com/wp-cli/checksum-command/blob/v2.3.7/src/Checksum_Plugin_Command.php#L371-L384)).
A plugin that is not in the directory returns 404. This is the highest-value check in the whole phase.

```sh
node scripts/list-plugin-versions.mjs WORK/site/wp-content/plugins --themes WORK/site/wp-content/themes
# run each curl line it prints; they save WORK/evidence/checksums/<slug>-<version>.json
node scripts/verify-plugin-checksums.mjs WORK/site/wp-content/plugins WORK/evidence/checksums
```

The version comes from each plugin's main file header, which the attacker can edit: a plugin whose files mostly
mismatch may simply claim the wrong version. On a live site, `wp plugin verify-checksums --all --skip-plugins
--skip-themes` reports "Checksum does not match" and "File was added", and ignores changes to `readme.txt` unless you
add `--strict` ([wp plugin verify-checksums](https://developer.wordpress.org/cli/commands/plugin/verify-checksums/);
[Checksum_Plugin_Command.php L150-L170, L443-L463 at v2.3.7](https://github.com/wp-cli/checksum-command/blob/v2.3.7/src/Checksum_Plugin_Command.php#L150-L170)).

Report three numbers per plugin: modified, added, missing.

- **Modified code files:** treat them as infected until proven otherwise.
- **Added code files** (`.php`, `.js`) that are not in the official release: a strong signal.
- **A mismatch in a non-code file** is usually noise. In one investigation a JSON file was flagged whose content was
  identical and differed only in Windows line endings; the helper reports that case separately.

Plugins with no checksum list are premium, custom, or removed from the directory. List them; they go to step 9.

## Step 3: verify themes

For a wordpress.org theme, download the release zip for its version (the `--themes` output of
`list-plugin-versions.mjs` prints the URL) and compare file by file:

```sh
curl -fsS -o WORK/evidence/theme-<slug>.zip "https://downloads.wordpress.org/theme/<slug>.<version>.zip"
unzip -q WORK/evidence/theme-<slug>.zip -d WORK/evidence/reference/themes
diff -rq WORK/evidence/reference/themes/<slug> WORK/site/wp-content/themes/<slug>
```

Premium themes go to step 9. Pay attention to the active theme and its child theme (the `template` and `stylesheet`
options, phase 3). A child theme's `functions.php` is a favorite place for injected code, because it runs on every
request and is rarely reviewed.

## Step 4: drop-ins and must-use plugins (they run automatically)

These execute without ever being activated, and cannot be switched off from the dashboard:

| File | When WordPress loads it | Source |
| --- | --- | --- |
| `wp-content/mu-plugins/*.php` | Every request, in alphabetical order, before normal plugins. Only files at the top level load | [Must-use plugins](https://developer.wordpress.org/advanced-administration/plugins/mu-plugins/) |
| `wp-content/db.php` | Every request, when it exists | [require_wp_db()](https://developer.wordpress.org/reference/functions/require_wp_db/) |
| `wp-content/object-cache.php` | Every request, when it exists | [wp_start_object_cache()](https://developer.wordpress.org/reference/functions/wp_start_object_cache/) |
| `wp-content/advanced-cache.php` | When `WP_CACHE` is true | [_get_dropins()](https://developer.wordpress.org/reference/functions/_get_dropins/) |
| `maintenance.php`, `db-error.php`, `php-error.php`, `fatal-error-handler.php`, `install.php` in `wp-content` | On their event: maintenance mode, a database error, a PHP error, installation | same |
| `sunrise.php`, `blog-deleted.php`, `blog-inactive.php`, `blog-suspended.php` (multisite) | `sunrise.php` when `SUNRISE` is set; the others on their event | same |

For each file present, answer: which plugin installed it, and is that plugin on this site? A cache drop-in with no
cache plugin, or a `db.php` nobody can explain, is a finding. On a live site, `wp plugin list --status=must-use` and
`--status=dropin` list them ([wp plugin list](https://developer.wordpress.org/cli/commands/plugin/list/)).

Malware uses invented plugin headers to look legitimate: names seen include "Vapor Watcher Plus" and "System
Performance Kit", with invented authors ([known-malware-patterns.md](known-malware-patterns.md)). Judge the code, not
the header.

Files in a subfolder of `mu-plugins` do not load by themselves, so `mu-plugins/dist/something.php` is inert unless a
top-level file includes it. Check which top-level files include what.

## Step 5: executable code where it does not belong

```sh
find WORK/site/wp-content/uploads -type f \
  \( -iname '*.php*' -o -iname '*.phtml' -o -iname '*.phar' -o -iname '*.suspected' \)
grep -rlaF '<?php' WORK/site/wp-content/uploads --exclude='*.php'   # PHP hidden in non-PHP files
find WORK/site/wp-content/uploads -type f -iname '*.zip'            # plugin archives that should not be public
```

`uploads` should hold no executable code apart from empty `index.php` guard files. Anything else is a finding. Check
`wp-content/cache`, backup plugin folders and the document root the same way.

## Step 6: signature scan of every PHP file

```sh
node scripts/scan-php.mjs WORK/site > WORK/evidence/scan-php.txt
```

High-risk patterns, all of which the helper looks for:

- `eval(` combined with `base64_decode`, `gzinflate`, `gzuncompress`, `str_rot13` or `hex2bin`
- `assert($...)`, `preg_replace` with the `/e` modifier, `create_function`
- a superglobal called as a function: `$_POST['x'](...)`, `$_GET['x'](...)`
- `shell_exec`, `passthru`, `system`, `popen` or `proc_open` fed from request data
- `include` or `require` of an image, text or log file
- `file_put_contents` writing request data
- `wp_insert_user` or `wp_create_user` with `administrator`
- long hex or `chr()` chains, and base64 strings thousands of characters long
- web shell names such as `FilesMan`, `b374k`, `WSO`, `IndoXploit` and `alfa`

Then read the matched region of every hit. Most are innocent: in one investigation, every match across the whole site
was `assert()` inside vendor libraries or cryptographic constants in phpseclib.

## Step 7: scan JavaScript, HTML and SVG for redirects

```sh
node scripts/scan-js.mjs WORK/site/wp-content > WORK/evidence/scan-js.txt
```

What it looks for:

- `location.href =`, `location.replace(` and `window.location =` pointing at an external address
- `eval(atob(`, `new Function(atob(` and `document.write(unescape(`
- long `String.fromCharCode(` sequences, `_0x` obfuscator names, long hex escape chains
- redirects gated on `document.referrer` containing a search engine, on a mobile user agent, or on a cookie: cloaking,
  so the owner never sees the redirect
- code appended to the end, or prepended to the start, of an otherwise normal library file

Expect false positives here. Bundlers such as webpack build script tags at run time, form plugins redirect after a
submit, and libraries carry documentation links to URL shorteners. Open each hit and read what it does.

## Step 8: inventory every external host the code talks to

```sh
node scripts/external-hosts.mjs WORK/site/wp-content > WORK/evidence/external-hosts.txt
```

It collects hosts from hard-coded `<script src="https://...">` in PHP, JavaScript and HTML; `wp_enqueue_script` and
`wp_register_script` with absolute URLs; `wp_remote_get`, `wp_remote_post`, `file_get_contents`, `curl_init` and
`fsockopen`; and `header('Location: https://...')` and `wp_redirect('https://...')`.

Then ask, host by host: is this the vendor of the plugin it sits in, a known service, or something nobody can
explain? A phone-home domain inside a premium plugin is how pirated ("nulled") copies usually show themselves.

## Step 9: code that checksums cannot cover

Premium plugins and custom themes have no official hashes. Use these instead:

- **Compare with a clean copy.** If the owner has a license, download the same version from the vendor and `diff -rq`
  it. That turns step 9 back into step 2.
- **Timestamp clustering.** Files from one release usually share a timestamp. A handful of files with a different
  date inside an otherwise uniform package are worth reading. Many different dates usually just mean the package
  ships that way.
- **Steps 6, 7 and 8** run on that folder alone, and every hit read.
- **Marker search.** Injected blocks often carry begin and end comment markers, so the malware can find and repair its
  own code later. Search for repeated comment markers you do not recognize, and note every marker you find for the
  final check (`scripts/verify-clean.sh` in [05-cleanup.md](05-cleanup.md)).

## Step 10: configuration and server files

- **`wp-config.php`:** read all of it. Look for code appended after the standard content, unexpected `define()` lines
  and injected constants. Note the table prefix and whether the keys and salts match other sites (phase 4). A caching
  constant added by malware, with its own marker comment, has been seen.
- **`.htaccess`** at every level, especially the root, `wp-content` and `uploads`. Look for injected `RewriteRule`
  lines sending traffic elsewhere, PHP handlers added to `uploads`, and `php_value auto_prepend_file`. PHP settings in
  `.htaccess` apply when PHP runs as an Apache module and the server allows overrides
  ([changing PHP configuration](https://www.php.net/manual/en/configuration.changes.php)). nginx does not read
  `.htaccess` at all ([NGINX blog](https://blog.nginx.org/blog/converting-apache-to-nginx-rewrite-rules)), so on
  nginx its contents are evidence of intent, not of effect.
- **`.user.ini` and `php.ini`:** `auto_prepend_file` names a file that PHP loads before every script it runs, as if
  by `require` ([auto_prepend_file](https://www.php.net/manual/en/ini.core.php#ini.auto-prepend-file)). Under CGI or
  FastCGI (PHP-FPM), PHP reads `.user.ini` files in the script's directory and every parent up to the document root,
  and re-reads them every 300 seconds by default
  ([.user.ini files](https://www.php.net/manual/en/configuration.file.per-user.php)). A `.user.ini` in the root
  therefore puts its prepended file in front of every request, within five minutes of being written. Security plugins
  use it too: Wordfence loads its firewall file, `wordfence-waf.php`, this way
  ([wordfenceClass.php L9027-L9035 at 9.0.1](https://plugins.svn.wordpress.org/wordfence/tags/9.0.1/lib/wordfenceClass.php),
  [wfDiagnostic.php L465-L501](https://plugins.svn.wordpress.org/wordfence/tags/9.0.1/lib/wfDiagnostic.php)).
  Identify the file it names before calling it malicious.
- Compare the root file list against stock WordPress (phase 1) and flag every extra file.

## Step 11: read the logs shipped with the backup

`error_log`, `wp-content/debug.log` and any host log in the archive. Search for:

- `include` or `require` failures naming files you have not seen: they name malware that has since been deleted, or
  that the malware expects to exist
- fatal errors inside plugin files at odd times
- repeated "headers already sent" errors, which often point at injected output
- the first and last timestamps, which bound the timeline in phase 4

## Step 12: cross-check against the database

After phase 3, come back and check every file path mentioned in database rows: advanced malware keeps a manifest of
its own files. Every path in such a manifest must be accounted for on disk, or confirmed already removed.

## Recording findings

For each finding, record the path, size, timestamp, what it is, how you confirmed it, and the action: quarantine the
whole file, strip an injected block, or leave it alone.

Keep three categories apart:

1. **Confirmed malicious:** verified by reading the code or by a checksum mismatch.
2. **Suspicious, unresolved:** say why, and what would settle it.
3. **Verified clean:** with the numbers, for example "core: `<n>` files match the 7.1.2 checksums" and "`<n>` of
   `<m>` plugins match their wordpress.org checksums".

The third category is not padding. It is what lets the owner trust the first.

## Output of this phase

- A verified file findings list, in the three categories above.
- Counts for everything checked: files scanned, plugins verified, hits reviewed and how each was cleared.
- Every coverage gap stated plainly: plugins that could not be verified, files missing from the backup, symbolic links
  to host-managed code.

Next: [03-database-scan.md](03-database-scan.md).
