# Multisite data model

What a migration has to move, and where WordPress keeps it. Checked against WordPress 7.1.2 (tag `7.1.2` of
`wordpress-develop`) on 2026-09-26. Line links point at that tag.

## Tables

- Per-site tables: `posts`, `comments`, `links`, `options`, `postmeta`, `terms`, `term_taxonomy`,
  `term_relationships`, `termmeta`, `commentmeta`.
  Source: [`wpdb::$tables`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L291)
- Tables shared by every site: `users`, `usermeta`.
  Source: [`wpdb::$global_tables`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L324)
- Multisite-only shared tables: `blogs`, `blogmeta`, `signups`, `site`, `sitemeta`, `registration_log`.
  `sitecategories` is a deprecated multisite table.
  Source: [`wpdb::$ms_global_tables`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L334)
- Table prefix of a site: blog_id 0 or 1 uses the base prefix (`wp_`); any other ID uses base prefix + ID + `_`
  (`wp_3_`). This depends on the blog_id, not on which site is the main site.
  Source: [`wpdb::get_blog_prefix()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L1073)
- Shared tables always use the base prefix; per-site tables use the site prefix.
  Source: [`wpdb::tables()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L1122)
- `$wpdb->prefix` is set to the site prefix when WordPress switches to a site, so a plugin that names its tables with
  `$wpdb->prefix` gets one table per site (`wp_3_...`). A plugin that uses `$wpdb->base_prefix` gets one table for
  the whole network, usually with a `blog_id` column; those rows are not in the site's tables and need their own
  export and import. `scripts/inventory.sh` lists tables with a `blog_id` column.
  Source: [`wpdb::set_blog_id()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L1051)
- The handbook describes the same split: each site's content has its own tables and the user tables are shared.
  Source: [WordPress Multisite / Network](https://developer.wordpress.org/advanced-administration/multisite/)
- `wp_blogs` columns: `blog_id`, `site_id`, `domain`, `path`, `registered`, `last_updated`, `public`, `archived`,
  `mature`, `spam`, `deleted`, `lang_id`.
  Source: [`schema.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L248)
- `wp_blogmeta` holds per-site metadata; the site meta API arrived in 5.1.0.
  Source: [`add_site_meta()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L1042)
- `wp_sitemeta` holds network options (`get_site_option()`), among them `active_sitewide_plugins`,
  `allowedthemes`, `site_admins`, `ms_files_rewriting` and `illegal_names`.
  Source: [`populate_network_meta()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L1230)

## Site status flags

- `archived = 1` or `spam = 1`: visitors get "This site has been archived or suspended." with HTTP 410, unless a
  `blog-suspended.php` drop-in exists. `deleted = 1`: "no longer available", also 410. `deleted = 2`: "not
  activated yet". Super admins still see the site.
  Source: [`ms_site_check()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-load.php#L74)
- `wp site archive` sets `archived = 1`; `wp site deactivate` sets `deleted = 1`.
  Source: [`Site_Command`](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Site_Command.php#L878)
  and [line 965](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Site_Command.php#L965)
- WP-CLI runs commands against a site in any status: it hooks `ms_site_check` to return true, and it also ignores
  maintenance mode.
  Source: [WP-CLI `Runner.php`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1544)

## Users

- Users are stored once per network in `wp_users` and `wp_usermeta`. The multisite `wp_users` table has two extra
  columns, `spam` and `deleted`.
  Source: [`schema.php`, multisite users table](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L210)
- A user's role on a site is the user meta key `{site prefix}capabilities` (a serialized array such as
  `a:1:{s:6:"editor";b:1;}`): `wp_3_capabilities` for blog_id 3, `wp_capabilities` for blog_id 1.
  Source: [`WP_User::_init_caps()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user.php#L488)
- The matching level key is `{site prefix}user_level`.
  Source: [`WP_User::update_user_level_from_caps()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user.php#L710)
- On multisite a user belongs to a site when the `{site prefix}capabilities` key exists; `WP_User_Query`, and so
  `wp user list --url=...`, lists only those users.
  Source: [`WP_User_Query::prepare_query()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user-query.php#L599)
- Role definitions live in the site's options table under `{site prefix}user_roles`: `wp_3_user_roles` in
  `wp_3_options`. This is the only core option whose name contains the table prefix.
  Source: [`WP_Roles::for_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-roles.php#L342)
- Other per-site user settings are "user options": `update_user_option()` prefixes the key with the site prefix
  unless it is global. Core stores `user-settings` this way, and the block editor's `persisted_preferences` also
  use the site prefix.
  Sources: [`update_user_option()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/user.php#L813),
  [`wp_set_all_user_settings()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1899),
  [`wp_register_persisted_preferences_meta()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/user.php#L5227)
- `add_user_to_blog()` sets the user meta `primary_blog` and `source_domain` when they are missing.
  Source: [`add_user_to_blog()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php#L196)
- Super admins are listed by login in the network option `site_admins`. A super admin without a role on a site is
  not a member of it and does not move with it.
  Source: [`get_super_admins()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/capabilities.php#L1163)
- Creating a site deletes every existing `{site prefix}user_level` and `{site prefix}capabilities` meta row for the
  new prefix, then adds the site administrator. Assign roles after the site exists.
  Source: [`wp_initialize_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L749)
- Handbook: users are created in the shared tables and need a role on a site before they can use it.
  Source: [Multisite Network Administration](https://developer.wordpress.org/advanced-administration/multisite/administration/#user-access-capabilities)

## Uploads

- The main site of the main network uses `wp-content/uploads`. Every other site, when the network option
  `ms_files_rewriting` is off, uses `wp-content/uploads/sites/N`, and its upload URL gets the same `/sites/N`
  suffix.
  Source: [`_wp_upload_dir()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L2467);
  handbook: [Uploaded File Path](https://developer.wordpress.org/advanced-administration/multisite/administration/#uploaded-file-path)
- When `ms_files_rewriting` is missing from `wp_sitemeta`, it defaults to true. A network created from a single site
  stores `0`. With it on (networks from before 3.5), a site's files live in `wp-content/blogs.dir/N/files/` and their
  URLs are `<site URL>/files/...`, served by `wp-includes/ms-files.php` through a rewrite rule.
  Sources: [`ms-default-filters.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-filters.php#L130),
  [`ms_upload_constants()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-constants.php#L18),
  [`populate_network_meta()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L1339),
  [`.htaccess` rules for 3.4 and below](https://developer.wordpress.org/advanced-administration/server/web-server/httpd/#wordpress-3-4-and-below)
- A new site's `upload_path` option is `wp-content/blogs.dir/N/files` when `ms_files_rewriting` is on, otherwise
  the main site's `upload_path` (normally empty).
  Source: [`wp_initialize_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L731)
- `WP_CONTENT_URL` defaults to `siteurl` + `/wp-content`. A subdirectory site's media URLs therefore contain the
  site path (`https://network.example/blog-a/wp-content/uploads/sites/3/...`); the multisite rewrite rules map that
  path to the real file.
  Sources: [`wp_plugin_directory_constants()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-constants.php#L176),
  [`.htaccess` for 3.5 and up](https://developer.wordpress.org/advanced-administration/server/web-server/httpd/#wordpress-3-5-and-up)
- Attachments store their file path relative to the uploads base directory in `_wp_attached_file`, and
  `wp_get_attachment_url()` builds the URL from the current `baseurl`; it falls back to `guid` only when that meta is
  missing. Moving the files with their `YYYY/MM` folders keeps attachments working without changing
  `_wp_attached_file`.
  Sources: [`_wp_relative_upload_path()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php#L919),
  [`wp_get_attachment_url()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php#L7191)
- `wp_get_upload_dir()` reads the location without creating folders; `wp_upload_dir()` creates the folder by
  default. Read-only checks use `wp_get_upload_dir()`.
  Sources: [`wp_get_upload_dir()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L2355),
  [`wp_upload_dir()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L2404)
- Deleting a site (with its tables) deletes the files in its uploads `basedir`.
  Source: [`wp_uninitialize_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L846)

## The main site

- blog_id 1 uses the base prefix, so its tables sit next to the network tables and next to every other site's
  tables. Prefix-based table selection does not isolate it.
- Its uploads folder `wp-content/uploads` also contains `sites/` with every other site's files.
- In a subdirectory network its permalink structure may start with `/blog/`, which keeps its post URLs from
  colliding with site paths.
  Sources: [`options-permalink.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/options-permalink.php#L92),
  [Permalinks in Subdirectory Installs](https://developer.wordpress.org/advanced-administration/multisite/administration/#permalinks-in-subdirectory-installs)
- Its domain and path cannot be changed on the Edit Site screen.
  Source: [`site-info.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/network/site-info.php#L50)

## Is WordPress running as multisite?

- `is_multisite()` returns `MULTISITE` when that constant is defined. Otherwise it returns true when
  `SUBDOMAIN_INSTALL`, `VHOST` or `SUNRISE` is defined. A standalone copy must lose all of them.
  Source: [`is_multisite()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L1448)
- `wp-settings.php` loads `ms-settings.php`, and with it `sunrise.php`, only when `is_multisite()` is true.
  Source: [`wp-settings.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-settings.php#L157)

## Cron

- Each site keeps its scheduled events in its own `cron` option, and WP-Cron spawns the current site's
  `wp-cron.php`. A server cron job that requests one site's `wp-cron.php` does not run the other sites' events, so
  a site that joins or leaves a network needs its own trigger.
  Sources: [`_get_cron_array()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1261),
  [`spawn_cron()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L961)
