# Traps that waste hours

Read this before writing any script or query for a scan. Most of these have broken scans in investigations, usually
silently: the command runs, prints nothing, and the site looks clean when it is not.

| Trap | What goes wrong | What to do |
| --- | --- | --- |
| Backslashes eaten on the way in | A pattern or string arrives with one backslash fewer than you wrote | Write patterns without backslashes: `[.]`, `[(]`, `String.fromCharCode(92)` |
| MySQL 8 regular expression limits | `Timeout exceeded in regular expression match`, then every later statement is skipped | Raise the limits on the throwaway server; run query files with `--force` |
| Windows lowercases table names | `Ab3_options` comes back as `ab3_options`; a Linux server then shows the install screen | Fix the identifiers in the dump with `scripts/fix-export.mjs` |
| Escaped quotes and slashes in dumps | `src=\"https:\/\/...` does not match a pattern written for `src="https://...` | Allow optional backslashes, or search for the host name alone |
| `tar` and Windows drive letters | `D:/backup.tar` is read as host `D`, file `/backup.tar` | GNU tar: add `--force-local` |
| Serialized PHP data | A string replace changes a length and PHP can no longer read the value | Use `wp search-replace`, or unserialize, change, serialize |
| Windows file names are case-insensitive | Two files differing only by case overwrite each other on extraction | Extract into a case-sensitive folder, or inside WSL or Linux |
| WP-CLI runs the site's code | Must-use plugins, drop-ins and `wp-config.php` load even with `--skip-plugins` | Query the throwaway database with SQL; on a live site, compare WP-CLI answers with SQL |
| File times lie | Malware resets modification times to match the files around it | Use times as one source among several, never as proof of absence |

## Backslashes eaten on the way in

When an agent writes a script or a query through a tool call, a doubled backslash often arrives as a single one, and a
single one can vanish. `'\\'` becomes `'\'` (a syntax error, or a different string), and a regex `\\x[0-9a-f]{2}`
becomes `\x[0-9a-f]{2}` (a different pattern that quietly matches nothing). A person pasting through some chat tools
and editors meets the same thing.

SQL doubles the problem. MySQL treats the backslash as an escape character inside string literals, so a literal
backslash in a `REGEXP` pattern must be written twice: once for the SQL parser, once for the regex engine
([regular expressions](https://dev.mysql.com/doc/refman/8.4/en/regexp.html),
[string literals](https://dev.mysql.com/doc/refman/8.4/en/string-literals.html)). A pattern that needs four
backslashes after both layers is easy to break.

Avoid literal backslashes wherever possible:

- In regular expressions: `[.]` instead of an escaped dot, `[(]` instead of an escaped bracket, `[$]` instead of an
  escaped dollar sign.
- In JavaScript: `String.fromCharCode(92)` for a backslash character. In Python: `chr(92)`, or `bytes([92])` for a
  byte pattern. In PHP: `chr(92)`.
- After writing a file through a tool, read it back and check the lines that should hold backslashes. The helpers in
  `scripts/` are written this way, which is also why they read oddly in places.

## MySQL 8 regular expression limits

MySQL 8 runs `REGEXP` through ICU, and stops a match that takes too many steps or too much stack
([regular expressions](https://dev.mysql.com/doc/refman/8.4/en/regexp.html)). The limits are the global, dynamic
variables `regexp_time_limit` (default 32 steps of the match engine, maximum 2147483647) and `regexp_stack_limit`
(default 8000000 bytes, maximum 2147483647)
([server system variables](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html)). Large option
values, such as a payload of several hundred kilobytes, hit them, and the query fails with error 3699,
`Timeout exceeded in regular expression match`
([error reference](https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html)).

The `mysql` client stops at the first error in a file, so every query after the failing one is skipped, and the
output simply ends. `--force` makes it continue ([mysql options](https://dev.mysql.com/doc/refman/8.4/en/mysql-command-options.html)).

On the throwaway server only, raise the limits once, then run query files with `--force`:

```sql
SET GLOBAL regexp_time_limit=2000000000;
SET GLOBAL regexp_stack_limit=64000000;
```

Also put a cheap filter before the expensive one where you can (`WHERE option_value LIKE '%<script%' AND
option_value REGEXP ...`), and read the error output file, not only the results.

## Windows lowercases table names

MySQL's `lower_case_table_names` is 1 by default on Windows, 0 on Unix and 2 on macOS. With 1, table names are stored
in lowercase and compared without regard to case, and the value can only be set when the server is initialized
([identifier case sensitivity](https://dev.mysql.com/doc/refman/8.4/en/identifier-case-sensitivity.html)). So a dump
imported into MySQL on Windows and exported again turns a mixed-case prefix such as `Ab3_` into `ab3_`. On a Linux
server WordPress then looks for `Ab3_options`, finds nothing, and shows the installation screen while every row is
still there.

Three consequences:

- Queries on the throwaway server must use the lowercase prefix; the report and the restored site must use the
  original one. Read the original from `wp-config.php` (`$table_prefix`), never from `SHOW TABLES` on Windows.
- Fix the export before restoring: `node scripts/fix-export.mjs in.sql out.sql --prefix-from=ab3_ --prefix-to=Ab3_`.
  It rewrites identifiers only. Option names and meta keys that contain the prefix (`Ab3_user_roles`,
  `Ab3_capabilities`) are row data and were never lowercased.
- If you can choose, run the throwaway server in WSL or on Linux and the problem does not arise.

## Escaped quotes and slashes in dumps

Inside a `.sql` file, string values are escaped for MySQL: a double quote is written `\"` and a backslash `\\`
([string literals](https://dev.mysql.com/doc/refman/8.4/en/string-literals.html)). Values that were JSON before they
reached the database (page builders, block attributes, many plugin settings) also have their slashes escaped, because
PHP's `json_encode()` writes `/` as `\/` unless told not to
([JSON constants](https://www.php.net/manual/en/json.constants.php)). A script tag in a dump can therefore look like
`<script src=\"https:\/\/cdn.example.com\/x.js\">`.

A pattern written for clean HTML misses it. When you search dump files directly:

- allow an optional backslash before quotes and slashes (for example `src=.{0,3}https?:.{0,4}`), or
- search for the host name or the marker string alone, which has no quotes or slashes in it, or
- query the imported database instead, where the SQL escaping is gone (JSON escaping is not).

## `tar` and Windows drive letters

GNU tar treats an archive name that contains a colon as a file on a remote machine: the part before the colon is the
host ([tar manual](https://man7.org/linux/man-pages/man1/tar.1.html)). `tar -xf D:/backups/site.tar` therefore tries
to reach a host called `D`. `--force-local` ("archive file is local even if it has a colon") fixes it:

```sh
tar --force-local -tvf D:/backups/site.tar > WORK/evidence/archive-listing.txt
tar --force-local -xf D:/backups/site.tar -C WORK/site
```

The `tar` in Git for Windows is GNU tar. Windows' own `C:\Windows\System32\tar.exe` is bsdtar (libarchive), which
reports itself as `bsdtar` in `tar --version` and has no `--force-local`; check which one runs before copying a
command.

## Serialized PHP data

WordPress stores arrays and objects in options and meta as PHP serialized strings, where every string carries its
length: `s:19:"https://example.com";`. A plain SQL `REPLACE()` or a text edit that changes the string without
changing the `19` makes the whole value unreadable, and WordPress silently treats it as missing. That can wipe a
plugin's settings, the `cron` option or the `active_plugins` list.

- For URL or text changes across the database, use `wp search-replace`, which handles serialized data, with
  `--dry-run` first ([wp search-replace](https://developer.wordpress.org/cli/commands/search-replace/)).
- For structural changes (removing one plugin from `active_plugins`, one hook from `cron`), unserialize, change and
  serialize again in code, or use the WP-CLI command for that job.
- When decoding values from a hacked database, pass `['allowed_classes' => false]` to `unserialize()` so no class is
  instantiated; PHP warns that unserializing untrusted data can load and run code
  ([unserialize()](https://www.php.net/manual/en/function.unserialize.php)). `scripts/database-deep-checks.php` does
  this.
- Deleting a whole row is safe for serialization; editing inside one is not.

## Windows file names are case-insensitive

Windows treats `FOO.txt` and `foo.txt` as the same file by default, while Linux treats them as different files
([case sensitivity](https://learn.microsoft.com/en-us/windows/wsl/case-sensitivity)). A backup from a Linux server
can hold both `index.php` and `Index.php`, or a malicious `Wp-config.php` beside the real one. Extracted into a normal
Windows folder, one silently overwrites the other, and the file you needed to see may be the one that disappeared.
Microsoft's page describes exactly this loss when mixed-case files are moved into a case-insensitive folder.

Compare the archive listing's file count with the extracted count (`01-workspace.md`). Extract into a folder marked
case-sensitive (`fsutil.exe file setCaseSensitiveInfo <path> enable`, on an empty folder, as administrator), or into
the WSL or Linux file system.

## WP-CLI runs the site's code

WP-CLI loads WordPress to run most commands, which means it runs `wp-config.php`, the drop-ins and the must-use
plugins. `--skip-plugins` and `--skip-themes` skip normal plugins and themes, but "mu-plugins are still loaded"
([WP-CLI global parameters](https://make.wordpress.org/cli/handbook/references/config/)). WordPress loads
`advanced-cache.php` (when `WP_CACHE` is on), then `db.php`, then `object-cache.php`, then the must-use plugins,
before any normal plugin ([wp-settings.php](https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-settings.php)).

So on an infected copy, WP-CLI can run the malware, and it can also report what the malware wants: a user hidden with
`pre_user_query` is hidden from `wp user list` too, because that command uses `WP_User_Query`
([wp user list](https://developer.wordpress.org/cli/commands/user/list/),
[pre_user_query](https://developer.wordpress.org/reference/hooks/pre_user_query/)).

- On the copy, during the scan and the cleanup, query the throwaway database directly with SQL and read files as
  text. The one WP-CLI command the skill runs on the copy is `wp core verify-checksums`, which runs before WordPress
  loads (`01-workspace.md`).
- On a live site, use WP-CLI read commands with `--skip-plugins --skip-themes`, and compare their answers with SQL.

## File times lie

Modification times are easy to set. The WP-VCD campaign's deployer reset the timestamps of the theme files it
injected to their values from before the injection, to avoid detection
([BleepingComputer, reporting Wordfence research](https://www.bleepingcomputer.com/news/security/wordpress-admins-infect-their-sites-with-wp-vcd-via-pirated-plugins/)).
Extraction on another machine can also reset every time to the moment of extraction, depending on the tool and its
flags. A "files changed since" search is a lead. Checksums, content and logs are the evidence
(`04-timeline-entry-point.md`).

## Smaller traps

- **Hidden files.** Shell globs such as `*` skip names that start with a dot, and so do some file managers and archive
  tools. Malware likes dot folders. Use `find`, which lists them.
- **Binary-looking text.** `grep` may print "binary file matches" and stop showing lines when a PHP file holds null
  bytes or a long encoded blob. Use `grep -a`.
- **Line endings.** A text file that differs from the official release only by CRLF line endings fails a checksum.
  Compare after normalizing line endings before you call it modified, and record that you did.
- **Hex-named options.** The regex `^[0-9a-fA-F]{6,32}$` finds malware payload rows and also some plugins' hashed
  cache keys. Read the value before deleting.
- **Personal data in output.** Query results, session lists and dumps contain email addresses, IP addresses and
  password hashes. Keep them in `WORK/evidence/`, not in chats, tickets or the report.
