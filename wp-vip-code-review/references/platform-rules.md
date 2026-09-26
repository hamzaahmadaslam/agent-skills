# VIP platform rules: caching, remote data, files, queries, options

Read this for the manual pass over a change that renders pages, reads or writes data, calls other servers, or
touches files. PHPCS catches some of these patterns by name; this file covers what the sniffs cannot judge, such as
the path a write goes to or whether a response varies per visitor. Facts checked on 2026-09-26; the source is
beside each one.

## Caching layers

Look in the diff for: `setcookie`, `$_COOKIE`, `$_SERVER['HTTP_USER_AGENT']`, `REMOTE_ADDR`, geolocation or
per-user logic in templates, `header( 'Vary`, `nocache_headers()`, `wp_cache_*`, transients, checks for `HEAD`.

| Rule | Source |
| ---- | ------ |
| Responses with status 200 are cached at VIP's edge for 30 minutes by default and sent to browsers with `max-age=300, must-revalidate`. | [page-cache/default-responses](https://docs.wpvip.com/caching/page-cache/default-responses/) |
| 301 redirects are cached for 30 minutes, 302 and 307 for 1 minute, 404 responses for 10 seconds, 410 for 1 minute, and unauthenticated successful `GET`/`HEAD` requests to the REST API for 1 minute. | [page-cache/default-responses](https://docs.wpvip.com/caching/page-cache/default-responses/) |
| A response becomes uncacheable for 10 seconds when it has a `Set-Cookie` header (`setcookie()`), `Cache-Control: private`, `Vary: *`, or a TTL of 0 or less with a status below 500. | [page-cache/default-responses](https://docs.wpvip.com/caching/page-cache/default-responses/) |
| Requests bypass the page cache when they carry an `Authorization` header, use `POST`, `PUT` or `DELETE`, come from logged-in WordPress users or users with a PHP session, or hit an environment with Basic Authentication. | [page-cache/default-responses](https://docs.wpvip.com/caching/page-cache/default-responses/) |
| `HEAD` requests reach the origin as `GET`, so `$_SERVER['REQUEST_METHOD']` reads `GET`; do not branch on `HEAD`. | [page-cache/default-responses](https://docs.wpvip.com/caching/page-cache/default-responses/) |
| The page cache keys on the full URL including query parameters, and caches every variant separately. | [caching/page-cache](https://docs.wpvip.com/caching/page-cache/) |
| Only these cookies bypass the cache: WordPress comment, test, post-password and authentication cookies, the WooCommerce session cookie, a PHP session cookie, and `vip-go-cb` set to exactly `1`. Content personalized on any other cookie is cached and served to the next visitor. | [page-cache/cookies](https://docs.wpvip.com/caching/page-cache/cookies/) |
| The `Vary` header is respected only for `origin`, `RSC`, `x-vip-go-segmentation`, `x-vip-go-auth`, `x-country-code`, `x-continent`, `x-region`, `x-metro-code`, `x-city` and `x-postal-code`. | [vary-http-response-header](https://docs.wpvip.com/caching/page-cache/customize-behavior/vary-http-response-header/) |
| For device-specific output, read the `x-mobile-class` request header (`desktop`, `tablet`, `smart`, `dumb`); each class gets its own cache bucket. | [vary-http-response-header](https://docs.wpvip.com/caching/page-cache/customize-behavior/vary-http-response-header/) |
| Server-side logic based on the visitor is cached at the edge and can leak data to other visitors; put it in client-side JavaScript. Sensitive data read through `wp_cache_*` into a page that is cached at the edge leaks the same way. | [php_codesniffer/errors](https://docs.wpvip.com/php_codesniffer/errors/) |
| Pages that set cookies or bypass the cache run PHP and SQL on the origin for every request; during a traffic spike that can overload the database and produce 503s. | [page-cache/cookies](https://docs.wpvip.com/caching/page-cache/cookies/) |
| After changing enqueued JS or CSS, bump the version argument so VIP serves the new concatenated file; cached HTML can reference old assets for up to 30 minutes. | [page-cache/default-responses](https://docs.wpvip.com/caching/page-cache/default-responses/) |
| Each environment has its own Memcached cluster behind the object cache. Entries must stay under 1 MB. `wp_cache_add()` and `wp_cache_set()` default to no expiration, and Memcached evicts least recently used entries. | [caching/object-cache](https://docs.wpvip.com/caching/object-cache/) |
| Transients are stored in the object cache, not in `wp_options`; code that reads transients straight from the database finds nothing. | [caching/object-cache](https://docs.wpvip.com/caching/object-cache/) |
| `wp_cache_flush_group()` and `wp cache flush-group` are not supported on VIP. | [flush-the-object-cache](https://docs.wpvip.com/caching/object-cache/flush-the-object-cache/) |
| The query cache speeds up `WP_Query` automatically, but most writes flush it; cache expensive queries in the object cache. | [caching/query-cache](https://docs.wpvip.com/caching/query-cache/) |

## Uncached functions

| Rule | Source |
| ---- | ------ |
| Some core functions are uncached on purpose and always run an SQL query; under heavy traffic many of them can overload the primary database and cause 503 responses. | [caching/uncached-functions](https://docs.wpvip.com/caching/uncached-functions/) |
| Cached replacements from VIP MU plugins: `wpcom_vip_attachment_url_to_postid()` for `attachment_url_to_postid()`; `wpcom_vip_count_user_posts()` for `count_user_posts()`; `wpcom_vip_get_adjacent_post()` for `get_adjacent_post()`, `get_previous_post()`, `get_next_post()`, `previous_post_link()`, `next_post_link()`; `wpcom_vip_wp_oembed_get()` for `wp_oembed_get()`; `wpcom_vip_url_to_postid()` for `url_to_postid()`; `wpcom_vip_old_slug_redirect()` for `wp_old_slug_redirect()`. | [caching/uncached-functions](https://docs.wpvip.com/caching/uncached-functions/) |

## Remote requests

Look for: `wp_remote_*`, `wp_safe_remote_*`, `curl_*`, `file_get_contents( 'http`, `fopen` on a URL,
`download_url()`, HTTP client libraries, `timeout` arguments, filters on `http_request_args`.

| Rule | Source |
| ---- | ------ |
| Remote calls go through the WordPress HTTP API (not cURL) and should be cached. | [retrieving-remote-data](https://docs.wpvip.com/databases/optimize-queries/retrieving-remote-data/) |
| `wpcom_vip_file_get_contents( $url, $timeout, $cache_time, $extra_args )` caches the result and returns the last cached data when a new request fails. `$timeout` accepts 1 to 10 seconds (default 3); `$cache_time` accepts 60 seconds or more (default 900). VIP recommends it for any request that does not need up-to-the-second data, which covers the front end. | [retrieving-remote-data](https://docs.wpvip.com/databases/optimize-queries/retrieving-remote-data/) |
| `vip_safe_wp_remote_get( $url, $fallback_value, $threshold, $timeout, $retry, $args )` does not cache. After `$threshold` failures (1 to 10, default 3) it returns the fallback for `$retry` seconds (10 or more, default 20). `$timeout` accepts 1 to 5 seconds (default 1). | [retrieving-remote-data](https://docs.wpvip.com/databases/optimize-queries/retrieving-remote-data/) |
| A timeout above 3 seconds is strongly discouraged, because the page waits for the request. | [retrieving-remote-data](https://docs.wpvip.com/databases/optimize-queries/retrieving-remote-data/) |
| `fetch_feed()` caches for 43200 seconds (12 hours) by default; the `wp_feed_cache_transient_lifetime` filter changes it. | [retrieving-remote-data](https://docs.wpvip.com/databases/optimize-queries/retrieving-remote-data/) |
| An uncached remote request, when one is needed (a ping on publish, for example), still goes through the HTTP API and must never run on the front end. | [retrieving-remote-data](https://docs.wpvip.com/databases/optimize-queries/retrieving-remote-data/) |
| REST API responses should avoid external HTTP requests. | [wordpress-on-vip/wordpress-rest-api](https://docs.wpvip.com/wordpress-on-vip/wordpress-rest-api/) |

## Files

Look for: `file_put_contents`, `fopen( ..., 'w'`, `mkdir`, `unlink`, `rename`, `copy`, writes under `WP_CONTENT_DIR`,
`ABSPATH`, `__DIR__` or a plugin directory, hard-coded `wp-content/uploads` paths, `scandir`, `glob`, `opendir`,
`ZipArchive`, `file_exists` in loops, plugins that create cache folders or resized image files.

| Rule | Source |
| ---- | ------ |
| Web servers run read-only. File writes work only in `/tmp`, plus limited programmatic access to media on the VIP File System. | [php_codesniffer/errors](https://docs.wpvip.com/php_codesniffer/errors/) |
| In `/tmp` every filesystem function works. Get the path with `get_temp_dir()`, create temporary files with `wp_tempnam()`, and `unlink()` them before the process ends. Files last only for the current request; each request may run in a different, short-lived container. | [vip-file-system/local-file-operations](https://docs.wpvip.com/vip-file-system/local-file-operations/) |
| `/wp-content/uploads/` is mapped to the VIP File System, an object store. Paths must start with `/wp-content/uploads/`; build them with `wp_get_upload_dir()` or `wp_upload_dir()`, since a hard-coded path does not work. | [vip-file-system/media-uploads](https://docs.wpvip.com/vip-file-system/media-uploads/) |
| A PHP stream wrapper makes `fopen()`, `fwrite()`, `file_put_contents()`, `copy()`, `rename()` and `unlink()` work for uploads. Directory functions do not: `scandir()`, `list_files()`, `glob()` and `opendir()` return an empty array or `false` with a warning, `mkdir()` returns true, `file_exists()` on a directory path is always true, and `is_dir()` is true for a file without an extension. | [vip-file-system/media-uploads](https://docs.wpvip.com/vip-file-system/media-uploads/) |
| `chmod()` and `chown()` do not work; file names are case-insensitive; a file path can be overwritten 2,000 times at most; a file written without an attachment post cannot be managed in WP Admin. | [vip-file-system/media-uploads](https://docs.wpvip.com/vip-file-system/media-uploads/) |
| Use `media_handle_sideload()`, `media_sideload_image()` or `wp_upload_bits()` for simple uploads. WP_Filesystem needs VIP's `request_filesystem_credentials()` and `wp_filesystem()` set-up code first. | [vip-file-system/media-uploads](https://docs.wpvip.com/vip-file-system/media-uploads/) |
| Every VIP File System operation goes over HTTP and takes at least 200 ms. Drop a `file_exists()` that precedes `file_get_contents()`, and read image sizes from attachment metadata instead of `wp_getimagesize()`. | [vip-file-system/media-uploads](https://docs.wpvip.com/vip-file-system/media-uploads/) |
| ZIP files can only be extracted in `/tmp`. | [vip-file-system/local-file-operations](https://docs.wpvip.com/vip-file-system/local-file-operations/) |
| No intermediate image files are created; requested sizes are generated on the fly. Code or plugins that expect files such as `my-image-300x300.jpg` fail. | [vip-file-system/image-files](https://docs.wpvip.com/vip-file-system/image-files/), [plugins/incompatibilities](https://docs.wpvip.com/plugins/incompatibilities/) |
| Plugins that write to the local filesystem, and caching plugins that write cache folders or rely on `.htaccess`, do not work as expected. | [plugins/incompatibilities](https://docs.wpvip.com/plugins/incompatibilities/) |

## Database queries

Look for: `$wpdb->`, `new WP_Query`, `get_posts(`, `posts_per_page`, `numberposts`, `nopaging`, `meta_query`,
`tax_query`, `post__not_in`, `orderby`, `CREATE TABLE`, writes (`update_post_meta`, `update_option`,
`wp_insert_post`) on front-end requests.

| Rule | Source |
| ---- | ------ |
| Prefer WordPress APIs. When a direct query is unavoidable: adjust core queries through filters such as `posts_where`; protect every query with `$wpdb->prepare()`, `esc_sql()` or `$wpdb->esc_like()`; avoid cross-table queries over large data (for example a `-cat` exclusion); keep SQL simple and do the logic in PHP; avoid `DISTINCT`, `GROUP` and anything that builds temporary tables; add defensive limits; check with `EXPLAIN` in development that indexes are used; cache results in the object cache. | [optimize-queries/database-queries](https://docs.wpvip.com/databases/optimize-queries/database-queries/) |
| Direct queries bypass WordPress's caching, and queries that change data can leave the object cache out of sync. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Never `posts_per_page => -1`, a very high number, or `nopaging => true`: ask for the smallest number that works, and rethink the page if it needs more than 100. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| `ORDER BY RAND()` is slow on large tables; fetch up to 100 posts and pick one in PHP, or use `vip_get_random_posts()`. | [php_codesniffer/errors](https://docs.wpvip.com/php_codesniffer/errors/) |
| `post__not_in` makes each page's query unique, so it misses the query cache and fills Memcached with variants. Fetch a fixed, slightly larger number of posts and skip the excluded ones in PHP. | [using-post__not_in](https://docs.wpvip.com/databases/optimize-queries/using-post__not_in/) |
| `postmeta` is indexed on `meta_key`; VIP adds `vip_meta_key_value` on `meta_key` plus `meta_value` (truncated at 191 and 100 characters), which needs both in the `WHERE` clause. Avoid queries on `meta_value` alone: use a taxonomy, or make a flag's presence the signal. | [querying-on-meta_value](https://docs.wpvip.com/databases/optimize-queries/querying-on-meta_value/) |
| Taxonomy queries include child terms by default; add `'include_children' => false` wherever possible. | [include_children false](https://docs.wpvip.com/databases/optimize-queries/term-queries-should-consider-include_children-false/) |
| Set `post_type` and `post_status` when known so MySQL can use its indexes (`type_status_date`). | [defining-post_status-or-post_type](https://docs.wpvip.com/databases/optimize-queries/defining-post_status-or-post_type/) |
| Evaluate closely: `category__and`, `tag__and`, `tax_query` with `AND`; `category__not_in`, `tag__not_in`, `tax_query` with `NOT IN`; `tax_query` across several taxonomies; `meta_query` over large result sets. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Front-end requests should not write to the database: with page caching the write does not happen as expected, and it loads the database. Do not count views or votes in meta. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Custom tables use the `$wpdb->prefix` prefix, are created or changed with `dbDelta()` in an upgrade routine, have indexes checked against the real queries, and are cached where it makes sense. | [databases/custom-tables](https://docs.wpvip.com/databases/custom-tables/) |
| Cron jobs run in separate containers but share MySQL with web requests. | [plugins/incompatibilities](https://docs.wpvip.com/plugins/incompatibilities/) |

## Options and autoload

Look for: `add_option()` and `update_option()` calls, especially without the autoload argument, large arrays saved
as options, and options written on every request.

| Rule | Source |
| ---- | ------ |
| Autoloaded options are loaded on every request through the `alloptions` cache key. Memcached objects are limited to 1 MB; near that limit the site slows down and can return `503` with `Error 1024 (alloptions)`. | [wordpress-on-vip/autoloaded-options](https://docs.wpvip.com/wordpress-on-vip/autoloaded-options/) |
| Options that are large, rarely used or changed often should not autoload. Before WordPress 6.6, `add_option()` and `update_option()` autoload by default. | [wordpress-on-vip/autoloaded-options](https://docs.wpvip.com/wordpress-on-vip/autoloaded-options/) |
