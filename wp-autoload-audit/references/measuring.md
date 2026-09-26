# Measuring the autoload set

Read this in steps 0, 1 and 6. It says what WordPress loads, how to count it the same way, why common tools report
other numbers, and how to measure the cost instead of guessing it from bytes. WordPress links point at the 7.1.2 tag.

## What WordPress loads on each request

- Without a persistent object cache: one query,
  `SELECT option_name, option_value FROM <prefix>options WHERE autoload IN (<loaded values>)`, whose result is kept
  in memory for that request only
  ([option.php L619-L650](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L619-L650);
  [WP_Object_Cache](https://developer.wordpress.org/reference/classes/wp_object_cache/): the default cache lasts one
  request).
- With a persistent object cache: one fetch of the cache key `alloptions` in the group `options`, which holds every
  autoloaded name and raw value in one array; the query runs only when that key is missing (same lines).
- Values stay raw strings in that array; `get_option()` unserializes a value each time code reads it
  ([option.php L256](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L256)).
- Plugins can change the result: `pre_wp_load_alloptions` (6.2) can replace the whole load, `pre_cache_alloptions`
  changes what is cached, and `alloptions` changes what is returned
  ([option.php L603-L660](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L603-L660)).
  `scripts/autoload-state.php` lists the callbacks on these hooks and their owners.

## Counting it the way WordPress does

Use the loaded values from the site (the state helper prints them; the defaults are below) and `LENGTH()`, which
counts bytes, as `strlen()` does in Site Health:

```sql
SELECT COUNT(*) AS options, SUM(LENGTH(option_value)) AS bytes
FROM wp_options
WHERE autoload IN ('yes', 'on', 'auto-on', 'auto');
```

Replace `wp_` with the site's prefix (`wp db prefix`, and `wp db prefix --url=<site>` on multisite). The blocks in
`scripts/autoload-checks.sql` add the breakdowns: rows and bytes per value (legacy `yes` and `no` included), the largest
options, name prefixes, transients, values over 150,000 bytes and the class of top-level serialized objects.

## Why other tools report other totals

| Tool | What it counts | Source |
| --- | --- | --- |
| `wp option list --autoload=on` (entity-command 2.8.4, in WP-CLI 2.12.0) | Rows with `on` or `yes` only, so `auto` and `auto-on` rows are missing. The condition has no parentheses: `... LIKE <search> AND (autoload='on') OR (autoload='yes') AND <no transients>`, so with `--search` every `yes` row matches whatever the pattern, and `on` rows include transients | [Option_Command.php L275-L311 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L275-L311) |
| Same command, entity-command 3.0.0 to 3.0.2 (WP-CLI nightly builds) | Parentheses fixed; still only `on` and `yes` | [Option_Command.php L294-L303 at 3.0.2](https://github.com/wp-cli/entity-command/blob/v3.0.2/src/Option_Command.php#L294-L303) |
| `wp option list` without `--transients` | Leaves out every `_transient_*` and `_site_transient_*` row; with `--transients` it lists only those, so one call never shows both | [Option_Command.php L286-L295 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L286-L295) |
| `wp doctor check autoload-options-size` (doctor-command, a separate package) | Runs `wp option list --autoload=on --format=total_bytes` and warns above 900 KB (921,600 bytes). 2.3.1 (for WP-CLI 2.12) inherits both gaps; 3.0.0 needs WP-CLI 3 (nightly builds, entity-command 3.0.2), so it misses only `auto` and `auto-on` rows | [Autoload_Options_Size.php at 2.3.1](https://github.com/wp-cli/doctor-command/blob/v2.3.1/src/Check/Autoload_Options_Size.php), the same at 3.0.0; [composer.json at 3.0.0](https://github.com/wp-cli/doctor-command/blob/v3.0.0/composer.json) |
| Site Health, "Autoloaded options" (6.6+) | Every value `wp_load_alloptions()` returns, after its filters, summed with `strlen()` | [class-wp-site-health.php L2657-L2670](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L2657-L2670) |
| Site Health, "Persistent object cache" (6.1+) | `strlen( serialize( $alloptions ) )`: the values plus names and serialization overhead, so larger than the value total | [class-wp-site-health.php L3798-L3806](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3798-L3806) |
| The SQL above | The rows in the table with the default loaded values; equal to Site Health's total unless filters change the load or the cache is stale | this file |

If you need WP-CLI rather than SQL, list everything and filter yourself:
`wp option list --fields=option_name,autoload,size_bytes --format=csv` and the same with `--transients`
([wp option list](https://developer.wordpress.org/cli/commands/option/list/)).

## Site Health thresholds

- The "Autoloaded options" test (6.6+) is a direct test that runs when the Site Health screen loads
  ([class-wp-site-health.php L2924-L2927](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L2924-L2927)).
  Below the limit it reports "Autoloaded options are acceptable"; at or above it, the status is critical with the
  label "Autoloaded options could affect performance". The limit is 800,000 bytes, filter
  `site_status_autoloaded_options_size_limit`
  ([class-wp-site-health.php L2679-L2749](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L2679-L2749)).
- Its link goes to the handbook's "Autoloaded Options" section, which advises keeping the total under 800 KB
  ([Optimization](https://developer.wordpress.org/advanced-administration/performance/optimization/#autoloaded-options)).
- The persistent object cache test (6.1+) suggests an object cache on multisite, when more than 500 options are
  autoloaded, when the serialized `alloptions` array is over 100,000 bytes, or when the comments, options, posts,
  terms or users table has 1,000 rows or more (filter `site_status_persistent_object_cache_thresholds`)
  ([class-wp-site-health.php L3756-L3829](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3756-L3829)).
  In 7.1.2 it is registered only when the environment type is `production`
  ([class-wp-site-health.php L2980-L2993](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L2980-L2993)).
- Do not create the `WP_Site_Health` object from WP-CLI to read these results: its constructor schedules the weekly
  `wp_site_health_scheduled_check` event when it is missing
  ([class-wp-site-health.php L37-L38, L3343-L3347](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3343-L3347)).
  The state helper computes the same numbers without it.
- Performance Lab 4.2.0 (WordPress Performance Team) extends this test with a table of the 20 largest autoloaded
  options over 100 bytes and buttons that switch autoload off or back on through `wp_set_option_autoload()`; it keeps
  the names it switched off in the option `perflab_aao_disabled_options`, and "revert" writes `on`, not the value
  the row had before
  ([helper.php](https://github.com/WordPress/performance/blob/2026-08-25/plugins/performance-lab/includes/site-health/audit-autoloaded-options/helper.php),
  [hooks.php](https://github.com/WordPress/performance/blob/2026-08-25/plugins/performance-lab/includes/site-health/audit-autoloaded-options/hooks.php)).
  Installing a plugin is a change: staging first.

## Measuring the cost, not only the bytes

Bytes say how much WordPress moves; they do not say how long a request takes. Take these numbers before and after
each change, the same way both times:

- Query and unserialize time, and memory (read-only): `wp eval-file scripts/autoload-state.php` runs the autoload
  query once, unserializes every value, and prints the milliseconds and the memory used. It measures the WP-CLI
  process on that server, which is enough for a before and after comparison; the web server's PHP can differ.
- Persistent object cache: the same helper prints whether `alloptions` is in the cache, how many names it holds
  and its serialized size, and the names that differ from the database (a stale cache, or filters at work).
- Server response time on staging, with the page cache bypassed or off: ten requests to the same URL, median
  of `time_starttransfer` from `curl -s -o /dev/null -w '%{time_starttransfer}\n' <url>`
  ([curl -w](https://curl.se/docs/manpage.html#-w)). Compare medians only under the same conditions.

## Multisite

- Every site has its own options table (`wp_2_options` and so on) and its own `alloptions` key: the `options` cache
  group is not global, while `site-options` is
  ([load.php L900-L929](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L900-L929)).
  Audit one site at a time with `--url=<site>`.
- `wp db query` ignores `--url`; put the site's prefix in the SQL yourself
  ([DB_Command.php L478-L490 at 2.1.3](https://github.com/wp-cli/db-command/blob/v2.1.3/src/DB_Command.php#L478-L490)).
  `wp db prefix --url=<site>` prints it ([wp db prefix](https://developer.wordpress.org/cli/commands/db/prefix/)).
- Network options live in `sitemeta`, which has no autoload column; core primes a fixed list of network options on
  each request ([option.php L801-L808](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L801-L808)).
- All sites, one report each (read-only):
  `wp site list --field=url | while read -r url; do bash scripts/autoload-report.sh --path=/var/www/html --url="$url" </dev/null; done`
  ([wp site list](https://developer.wordpress.org/cli/commands/site/list/)).

## Optional helpers outside this skill

Neither is needed; the scripts in `scripts/` cover the same ground.

- [wordpress-autoload-audit](https://github.com/hamzaahmadaslam/wordpress-autoload-audit) (MIT, version 0.1.0): a
  Bash script that sends four SELECT queries through `wp db query` and prints rows and bytes per autoload value, the
  total for `yes`, `on`, `auto-on` and `auto`, the 20 largest autoloaded rows by option ID, and the autoloaded
  transient rows. It prints no option names or values, which suits output that will be shared. It takes the
  WordPress path and the exact options table name (`wp_2_options` for a subsite). Its README says testing against a
  real WordPress database is still to be done.
- [Autoloaded options analyser](https://hamzaahmadaslam.com/tools/autoload-options): a web page that reads a pasted
  list of option names and sizes and shows the total against 800,000 bytes, the largest rows, rows over 150,000
  bytes, autoloaded transients and the name prefixes behind the bytes. The page works on the text in the browser.
  Paste the output of the "names and sizes" block in `scripts/autoload-checks.sql`, which covers all four loaded
  values, rather than `wp option list --autoload=on`, which leaves out `auto` and `auto-on` rows.
