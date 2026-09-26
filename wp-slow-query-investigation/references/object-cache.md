# What an object cache changes, and what it hides

Read this for step 5 of the procedure, and before crediting or blaming the object cache. Links point at the
WordPress 7.1.2 tag unless noted.

## Persistent or not

- WordPress's object cache is non-persistent by default: cached data lives in memory for one request only. A
  persistent cache needs a drop-in (`wp-content/object-cache.php`) backed by a service such as Redis or Memcached
  ([WP_Object_Cache](https://developer.wordpress.org/reference/classes/wp_object_cache/)).
- `wp_using_ext_object_cache()` reports whether a persistent cache is in use
  ([load.php L800-L820](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L800-L820));
  `wp cache type` names the implementation, from a guess based on the cache class
  ([wp cache type](https://developer.wordpress.org/cli/commands/cache/type/)); `wp plugin list --status=dropin --skip-update-check` shows
  the drop-in. Query Monitor's Object Cache panel shows whether one is in use and the hit rate
  ([query-monitor.md](query-monitor.md)).
- Adding one is a hosting change. Site Health suggests it on multisite, from 500 autoloaded options or 100,000
  autoloaded bytes, or from 1,000 rows in the comments, options, posts, terms or users table
  ([class-wp-site-health.php L3760-L3829](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3760-L3829)).

## Queries a persistent cache removes

| Data | Cache group | Source |
| --- | --- | --- |
| Autoloaded options and single options | `options` (`alloptions`, `notoptions` and one key per option) | [option.php L164-L219, L600-L661](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L600-L661) |
| Post, user, term and comment meta | one group per meta type, checked before the database in `update_meta_cache()` | [meta.php L1137-L1204](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/meta.php#L1137-L1204) |
| `WP_Query` results (post IDs, found rows, page count), WordPress 6.1 and later | `post-queries` | [class-wp-query.php L3264-L3276, L5002-L5010](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L3264-L3276) |
| `WP_Term_Query` results (`cache_results` since 6.4) | `term-queries` | [class-wp-term-query.php L776-L779](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-term-query.php#L776-L779) |
| `WP_Comment_Query` results | `comment-queries` | [class-wp-comment-query.php L459-L473](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-comment-query.php#L459-L473) |
| `WP_User_Query` results (`cache_results` since 6.3) | `user-queries` | [class-wp-user-query.php L832-L833](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user-query.php#L832-L833) |
| Transients | `transient`, so they never reach the options table | [option.php L1541-L1542](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1541-L1542) |

Without a persistent cache the same groups exist but empty out at the end of each request, so only repeats within one
request are saved.

## What it does not fix

- The cold cache. After a flush, an eviction or a deploy, the first requests run every query. A query that takes
  2 s uncached still takes 2 s for those visitors; fix the query, then let the cache reduce how often it runs.
- Invalidation. Every cached post query is checked against the `last_changed` value of the `posts` group, plus the
  `terms` group when the query has a tax query
  ([class-wp-query.php L3264-L3267](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L3264-L3267)).
  `clean_post_cache()` and every add, update or delete of post meta set a new `last_changed` for `posts`
  ([post.php L7940-L7984, L8633-L8635](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php#L8633-L8635);
  [default-filters.php L125-L127](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-filters.php#L125-L127)),
  which makes every cached post query of the site stale at once. A plugin that writes post meta on page views (a view
  counter, a "last seen" stamp) or a store whose stock and sales meta change with every order keeps the post query
  cache close to empty. Term meta writes do the same for term queries
  ([default-filters.php L138-L140](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-filters.php#L138-L140)).
  In the digest this shows as the same `WP_Query` SQL running often even with a persistent cache.
- Key handling before 6.9. Up to WordPress 6.8 the query cache key contained `last_changed`, so each invalidation
  created new keys ([6.8.0 class-wp-query.php L5065-L5070](https://github.com/WordPress/wordpress-develop/blob/6.8.0/src/wp-includes/class-wp-query.php#L5065-L5070)).
  From 6.9 the key stays the same and the `last_changed` value is stored with the data ("salted"); a stale entry is
  detected and replaced under the same key
  ([class-wp-query.php L5098-L5100](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L5098-L5100);
  [cache-compat.php L203-L262](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cache-compat.php#L203-L262)).
- Queries WordPress does not cache: `ORDER BY RAND()` queries, queries whose selected fields a filter changed
  ([class-wp-query.php L3240-L3262](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L3240-L3262)),
  and any SQL a plugin runs directly through `$wpdb` unless the plugin caches it.
- Expired transient cleanup. With a persistent cache, `delete_expired_transients()` does nothing, and transient rows
  left in the options table from before the cache was added are no longer read
  ([option.php L1638-L1643](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1638-L1643)).

## Reading the evidence

- Compare the same request with the object cache warm and after a flush on staging: the queries that remain on the
  warm request are the ones the cache cannot remove, and those are the ones to `EXPLAIN`.
- A hit rate near 100% with many database queries left means the queries come from code that bypasses the cache,
  not from a missing cache.
- A low hit rate with a persistent cache often means frequent invalidation (above) or evictions; the cache service's
  own statistics (memory, evictions) belong to the host.
