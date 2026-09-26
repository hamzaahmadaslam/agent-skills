# Options and transients, where they cause slow queries

Read this when a slow or frequent query touches the options table. Links point at the WordPress 7.1.2 tag. This file
covers the query side only; measuring, cleaning and rolling back autoloaded options is the job of the
`wp-autoload-audit` skill in this collection.

## The autoload query

- On each request without a persistent object cache, `wp_load_alloptions()` runs
  `SELECT option_name, option_value FROM wp_options WHERE autoload IN ( 'yes', 'on', 'auto-on', 'auto' )` and keeps
  the result in the `alloptions` cache key of the `options` group; with a persistent object cache the query runs only
  when that key is missing
  ([option.php L600-L661](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L600-L661)).
  The four values come from `wp_autoload_values_to_autoload()`, new in WordPress 6.6
  ([L3252-L3275](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L3252-L3275)).
- If that query returns no rows at all, WordPress loads the whole options table instead
  ([L627-L631](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L627-L631)).
  A cleanup that switches every option off would turn a small query into a full read of the table.
- The query uses the `autoload` index (WordPress 5.3 and later, [wordpress-schema.md](wordpress-schema.md)); its cost
  grows with the bytes it returns. Site Health marks autoloaded options as critical from 800,000 bytes
  (filter `site_status_autoloaded_options_size_limit`)
  ([class-wp-site-health.php L2657-L2720](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L2657-L2720)),
  and suggests a persistent object cache from 500 autoloaded rows or 100,000 bytes
  ([L3760-L3829](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3760-L3829)).
- Since WordPress 6.6, an option saved without an explicit autoload value is stored as `auto`, `auto-on` or
  `auto-off`, and one larger than 150,000 bytes (filter `wp_max_autoloaded_option_size`) is not autoloaded
  ([L1290-L1370](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1290-L1370);
  [default-filters.php L299](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-filters.php#L299)).
  Rows written before 6.6, or with an explicit `yes` or `on`, are still loaded whatever their size.

Signs in this skill's evidence: the autoload query in Query Monitor's slow list or near the top of the digest by total
time; a large `autoloaded_kb` in the report. Hand the cleanup to `wp-autoload-audit`.

## One query per option

- `get_option()` looks in `alloptions`, then the `notoptions` list, then the `options` cache group, and only then runs
  `SELECT option_value FROM wp_options WHERE option_name = %s LIMIT 1`; an option that does not exist is remembered
  in `notoptions`
  ([option.php L164-L219](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L164-L219)).
- Without a persistent object cache, those caches last one request, so every request repeats one query per
  non-autoloaded option a plugin reads. Query Monitor shows them as many fast queries from one caller.
- Fixes: batch them with `wp_prime_option_caches()` (WordPress 6.4 and later), which loads a list of options in one
  query ([L264-L340](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L264-L340));
  or a persistent object cache ([object-cache.md](object-cache.md)). Do not autoload options that are read on only a
  few pages.

## Transients

- Storage: with a persistent object cache, transients live in the cache group `transient` and never touch the
  database. Without one, a transient is an option row `_transient_<name>`, plus `_transient_timeout_<name>` when it
  has an expiration; a transient without expiration is autoloaded, one with expiration is not
  ([option.php L1541-L1575](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1541-L1575)).
- Reading a transient that is not autoloaded loads its value and timeout rows in one query, and deletes both when the
  timeout has passed ([L1455-L1476](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1455-L1476)).
  A transient with a timeout shorter than the gap between requests therefore costs a read and two deletes on each
  request, plus two inserts when the code sets it again.
- Expired transients are also removed by the daily `delete_expired_transients` event, scheduled from admin page
  loads ([admin.php L112-L114](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/admin.php#L112-L114);
  [default-filters.php L469](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-filters.php#L469)).
  It runs a multi-table `DELETE a, b FROM wp_options a, wp_options b WHERE a.option_name LIKE '\_transient\_%' ...
  AND b.option_name = CONCAT( '_transient_timeout_', SUBSTRING( a.option_name, 12 ) ) AND b.option_value < <now>`,
  and the same for site transients; with a persistent object cache it does nothing
  ([L1638-L1690](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1638-L1690)).
  On an options table with hundreds of thousands of transient rows this delete appears in the slow query log once a
  day; the fix is fewer transient rows, not an index.
- `LIKE '\_transient\_%'` starts with a constant, so it can use the unique `option_name` index as a range; plugin
  code that searches `option_name LIKE '%something%'` cannot
  ([B-tree index use](https://dev.mysql.com/doc/refman/8.4/en/index-btree-hash.html)).
- The report counts transient rows, expired rows and autoloaded transients (`scripts/query-checks.sql`). Deleting
  expired transients is a change with an entry in [changes-and-rollback.md](changes-and-rollback.md#delete-expired-transients).
