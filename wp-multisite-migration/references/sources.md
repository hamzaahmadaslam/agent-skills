# Sources

Every page and file this skill relies on, read on 2026-09-26. The other reference files link each fact to the exact
page or line. Versions checked: WordPress 7.1.2 (tag `7.1.2` of `wordpress-develop`); WP-CLI 2.12.0 with
entity-command 2.8.4, db-command 2.1.3, search-replace-command 2.1.8, extension-command 2.1.24 and config-command
2.3.8.

## WordPress documentation

- [WordPress Multisite / Network](https://developer.wordpress.org/advanced-administration/multisite/)
- [Create A Network](https://developer.wordpress.org/advanced-administration/multisite/create-network/)
- [WordPress Multisite Domain Mapping](https://developer.wordpress.org/advanced-administration/multisite/domain-mapping/)
- [Multisite Network Administration](https://developer.wordpress.org/advanced-administration/multisite/administration/)
  (uploads path, plugins, themes, switching network types, URL rewrites; last updated 2026-09-24)
- [Migrate WordPress sites into WordPress Multisite](https://developer.wordpress.org/advanced-administration/multisite/sites-multisite/)
- [Migrating WordPress](https://developer.wordpress.org/advanced-administration/upgrade/migrating/) (GUID note,
  table prefixes, moving a network)
- [wp-config.php](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/)
- [Apache HTTPD / .htaccess](https://developer.wordpress.org/advanced-administration/server/web-server/httpd/)
- [Nginx](https://developer.wordpress.org/advanced-administration/server/web-server/nginx/)
- [Must Use Plugins](https://developer.wordpress.org/advanced-administration/plugins/mu-plugins/)
- [Plugin header requirements](https://developer.wordpress.org/plugins/plugin-basics/header-requirements/)
- [Multisite Focused Changes in 4.3](https://make.wordpress.org/core/2015/07/24/multisite-focused-changes-in-4-3/)
- [Multisite Focused Changes in 4.5](https://make.wordpress.org/core/2016/03/09/multisite-focused-changes-in-4-5/)
- [WordPress 6.8 will use bcrypt for password hashing](https://make.wordpress.org/core/2025/02/17/wordpress-6-8-will-use-bcrypt-for-password-hashing/)

## WordPress source (tag 7.1.2)

- [`wp-includes/class-wpdb.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php):
  table lists, `get_blog_prefix()`, `tables()`, `set_blog_id()`
- [`wp-includes/functions.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php):
  `_wp_upload_dir()`, `wp_get_upload_dir()`, `wp_upload_dir()`
- [`wp-includes/ms-settings.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-settings.php):
  `sunrise.php` loading and site lookup
- [`wp-includes/ms-load.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-load.php):
  `ms_site_check()`
- [`wp-includes/ms-site.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php):
  `wp_update_site()`, `wp_initialize_site()`, `wp_uninitialize_site()`, site meta
- [`wp-includes/ms-functions.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php):
  `add_user_to_blog()`, `wpmu_validate_user_signup()`, `wpmu_create_user()`, `maybe_redirect_404()`,
  `get_subdirectory_reserved_names()`, `newblog_notify_siteadmin()`
- [`wp-includes/ms-default-constants.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-constants.php)
  and [`ms-default-filters.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-filters.php)
- [`wp-includes/ms-blogs.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-blogs.php):
  `update_blog_details()`
- [`wp-includes/load.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php):
  `is_multisite()`, `wp_is_maintenance_mode()`, `wp_get_active_and_valid_plugins()`
- [`wp-includes/class-wp-user.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user.php),
  [`class-wp-roles.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-roles.php),
  [`class-wp-user-query.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user-query.php),
  [`user.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/user.php),
  [`capabilities.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/capabilities.php),
  [`option.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php)
- [`wp-includes/class-wp-theme.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-theme.php),
  [`theme.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/theme.php),
  [`post.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php),
  [`cron.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php),
  [`blocks.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/blocks.php),
  [`default-constants.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-constants.php),
  [`wp-settings.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-settings.php),
  [`wp-config-sample.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/wp-config-sample.php)
- [`wp-admin/includes/schema.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php),
  [`network.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/network.php),
  [`ms.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/ms.php),
  [`plugin.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php),
  [`user.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/user.php),
  [`misc.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/misc.php),
  [`post.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/post.php),
  [`network/site-info.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/network/site-info.php),
  [`options-permalink.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/options-permalink.php)

## WP-CLI

- [Global parameters](https://make.wordpress.org/cli/handbook/references/config/) and the command pages linked in
  [wp-cli-commands.md](wp-cli-commands.md)
- [`php/utils-wp.php`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/utils-wp.php) (`wp_get_table_names()`) and
  [`php/WP_CLI/Runner.php`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php)
- [`Search_Replace_Command.php`](https://github.com/wp-cli/search-replace-command/blob/v2.1.8/src/Search_Replace_Command.php)
  and [`SearchReplacer.php`](https://github.com/wp-cli/search-replace-command/blob/v2.1.8/src/WP_CLI/SearchReplacer.php)
- [`Site_Command.php`](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Site_Command.php) and
  [`User_Command.php`](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/User_Command.php)
- [`DB_Command.php`](https://github.com/wp-cli/db-command/blob/v2.1.3/src/DB_Command.php)

## Databases

- MySQL 8.4: [RENAME TABLE](https://dev.mysql.com/doc/refman/8.4/en/rename-table.html),
  [UPDATE](https://dev.mysql.com/doc/refman/8.4/en/update.html),
  [LIKE](https://dev.mysql.com/doc/refman/8.4/en/string-comparison-functions.html#operator_like),
  [mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)
- MariaDB: [RENAME TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/rename-table),
  [LIKE](https://mariadb.com/docs/server/reference/sql-functions/string-functions/like),
  [regular expressions](https://mariadb.com/docs/server/reference/sql-functions/string-functions/regular-expressions-functions/regular-expressions-overview),
  [mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)

dev.mysql.com answered some automated requests with HTTP 403 during this check while serving the same pages to
others; the MariaDB pages cover the same statements.

## Web servers, search and PHP

- Apache: [mod_rewrite](https://httpd.apache.org/docs/2.4/mod/mod_rewrite.html),
  [RewriteRule flags](https://httpd.apache.org/docs/2.4/rewrite/flags.html)
- Nginx: [ngx_http_rewrite_module](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html),
  [server names](https://nginx.org/en/docs/http/server_names.html)
- Google: [site moves with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes),
  [Change of Address tool](https://support.google.com/webmasters/answer/9370220?hl=en)
- PHP: [JSON constants](https://www.php.net/manual/en/json.constants.php)
- Shell: [POSIX 2.7.4 Here-Document](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#tag_19_07_04)

## Plugin example

- WordPress MU Domain Mapping: [readme](https://plugins.svn.wordpress.org/wordpress-mu-domain-mapping/trunk/readme.txt),
  [`sunrise.php`](https://plugins.svn.wordpress.org/wordpress-mu-domain-mapping/trunk/sunrise.php),
  [plugin directory page](https://wordpress.org/plugins/wordpress-mu-domain-mapping/) (closure notice)

## Format

- [Agent Skills specification](https://agentskills.io/specification)

## Re-check first at each review

1. The default table selection of `wp search-replace` and `wp db search` (`wp_get_table_names()`), and the
   command pages' own wording.
2. `_wp_upload_dir()` and the handbook's uploaded file path.
3. The domain mapping handbook page and `site-info.php`.
4. `wpmu_validate_user_signup()` rules and `wp user create` on multisite.
5. Password hash formats in the current WordPress release.
