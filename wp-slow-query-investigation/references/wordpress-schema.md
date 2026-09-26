# WordPress core tables and their indexes

Read this for steps 3 and 5 of the procedure, and before proposing any index. Links point at the WordPress 7.1.2 tag.
`scripts/query-checks.sql` prints the indexes that exist on the site; compare them with this table. A missing core
index is a failed or partial database upgrade; an extra index was added by a plugin, a host or a person.

## Indexes WordPress 7.1.2 defines

`(191)` is a prefix length in characters: WordPress indexes at most 191 characters of long text columns because
`utf8mb4` uses up to 4 bytes per character and the older index limit was 767 bytes
([schema.php L47-L53](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L47-L53)).

| Table | Indexes | Columns that matter for queries | Source |
| --- | --- | --- | --- |
| `posts` | `PRIMARY (ID)`, `post_name (post_name(191))`, `type_status_date (post_type, post_status, post_date, ID)`, `post_parent`, `post_author`, `type_status_author (post_type, post_status, post_author)` | `post_type` and `post_status` are `varchar(20)`; `post_content` is `longtext` | [schema.php L159-L189](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L159-L189) |
| `postmeta` | `PRIMARY (meta_id)`, `post_id`, `meta_key (meta_key(191))` | `meta_key` is `varchar(255)`; `meta_value` is `longtext`, with no index | [schema.php L150-L158](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L150-L158) |
| `options` | `PRIMARY (option_id)`, unique `option_name`, `autoload` | `option_name` is `varchar(191)`; `option_value` is `longtext`; `autoload` is `varchar(20)` | [schema.php L141-L149](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L141-L149) |
| `terms` | `PRIMARY (term_id)`, `slug (slug(191))`, `name (name(191))` | | [schema.php L65-L73](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L65-L73) |
| `term_taxonomy` | `PRIMARY (term_taxonomy_id)`, unique `term_id_taxonomy (term_id, taxonomy)`, `taxonomy` | | [schema.php L74-L84](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L74-L84) |
| `term_relationships` | `PRIMARY (object_id, term_taxonomy_id)`, `term_taxonomy_id` | | [schema.php L85-L91](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L85-L91) |
| `termmeta` | `PRIMARY (meta_id)`, `term_id`, `meta_key (meta_key(191))` | | [schema.php L56-L64](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L56-L64) |
| `comments` | `PRIMARY (comment_ID)`, `comment_post_ID`, `comment_approved_date_gmt (comment_approved, comment_date_gmt)`, `comment_date_gmt`, `comment_parent`, `comment_author_email (comment_author_email(10))` | | [schema.php L101-L123](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L101-L123) |
| `commentmeta` | `PRIMARY (meta_id)`, `comment_id`, `meta_key (meta_key(191))` | | [schema.php L92-L100](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L92-L100) |
| `users` | `PRIMARY (ID)`, `user_login_key (user_login)`, `user_nicename`, `user_email` | | [schema.php L192-L207](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L192-L207) |
| `usermeta` | `PRIMARY (umeta_id)`, `user_id`, `meta_key (meta_key(191))` | `meta_value` is `longtext`, with no index | [schema.php L230-L238](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L230-L238) |

On multisite, the main site uses the base prefix and every other site has its own copy of the blog tables with the
prefix `{base_prefix}{blog_id}_`
([class-wpdb.php L1073-L1089](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L1073-L1089));
`users`, `usermeta` and the network tables (`blogs`, `site`, `sitemeta` and others) are shared
([schema.php L248-L316](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L248-L316)).

## What the indexes serve, and what they do not

- `postmeta.post_id` serves loading all meta of a list of posts: `update_meta_cache()` checks the object cache, then
  runs `SELECT post_id, meta_key, meta_value FROM wp_postmeta WHERE post_id IN (...) ORDER BY meta_id ASC` for the
  posts it did not find
  ([meta.php L1137-L1204](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/meta.php#L1137-L1204)).
- `postmeta.meta_key` narrows a lookup to one key, but there is no index on `meta_value`, so a condition on the value
  reads every row with that key. On a store where most products have `_price` or `_stock_status`, that is most of the
  key's rows. Sorting by a meta value cannot use an index at all ([query-patterns.md](query-patterns.md)).
- `posts.type_status_date` serves the default `WP_Query`: equality on `post_type` and `post_status`, ordered by
  `post_date`. Its leftmost-prefix rule means a query on `post_status` alone cannot use it
  ([multiple-column indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)).
- `options.autoload` serves the query that loads every autoloaded option on each uncached request
  ([options-and-transients.md](options-and-transients.md)). It exists since WordPress 5.3 (absent from the 5.2.0
  schema, present in 5.3.0)
  ([5.2.0 schema.php](https://github.com/WordPress/wordpress-develop/blob/5.2.0/src/wp-admin/includes/schema.php);
  [5.3.0 schema.php](https://github.com/WordPress/wordpress-develop/blob/5.3.0/src/wp-admin/includes/schema.php)).
- `term_relationships` is keyed by `(object_id, term_taxonomy_id)` with a second index on `term_taxonomy_id`, which
  serves the joins and subqueries of tax queries in both directions.

## How core adds indexes, and why that matters for custom ones

- WordPress 6.9.0 added `type_status_author (post_type, post_status, post_author)` to `posts` "to improve performance
  of some queries on installations with a large number of posts"
  ([commit 601ddd4](https://github.com/WordPress/wordpress-develop/commit/601ddd41b1e7a8fe8c1bca691aa3ba942949bce8);
  [6.8.0 schema without it](https://github.com/WordPress/wordpress-develop/blob/6.8.0/src/wp-admin/includes/schema.php)).
  On sites updated from 6.8 or earlier, the database upgrade adds it, which is an `ALTER TABLE` on the posts table
  during the update.
- The database upgrade (`wp_upgrade()`) calls `make_db_current_silent()`, which runs `dbDelta()` over the whole schema
  ([upgrade.php L651-L700, L3393-L3395](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L651-L700)).
- `dbDelta()` reads `SHOW INDEX FROM` each table, matches the schema's indexes by name and columns (ignoring prefix
  lengths), and runs `ALTER TABLE ... ADD` for each index the table lacks. It has no code path that drops an index
  ([upgrade.php L3268-L3345](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L3268-L3345)).
  Two consequences:
  - An index you add with a name core does not use survives WordPress updates.
  - An index with a name core later uses for different columns makes that update's `ALTER TABLE ... ADD` fail with a
    duplicate key name. Give custom indexes a distinct prefix, for example `sqi_`, and record them
    ([indexes.md](indexes.md)).
- A missing core index (the report lists the indexes) usually means an update did not finish or the database user
  lacked `ALTER`. The upgrade routine returns early when the stored `db_version` already equals the code's
  ([upgrade.php L661-L668](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L661-L668)),
  so on an up-to-date site it will not add the index again: add it by hand with core's exact definition from the table
  above, as a change with a backup ([changes-and-rollback.md](changes-and-rollback.md#restore-a-missing-core-index)).
  WooCommerce has its own tool for its tables ([woocommerce-lookup-tables.md](woocommerce-lookup-tables.md)).

## Character set and collation

- WordPress creates tables with the connection's character set and collation: `utf8` becomes `utf8mb4`, and
  `utf8mb4_unicode_ci` becomes `utf8mb4_unicode_520_ci` where the server supports it
  ([class-wpdb.php L881-L905](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L881-L905)).
- Plugin tables created with another collation, or tables converted at different times, compare strings across
  collations in joins, which can stop index use ([explain.md](explain.md#why-an-index-is-not-used)). The report lists
  the collations of the site's tables.
