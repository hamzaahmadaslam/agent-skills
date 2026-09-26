# Domain mapping

How a subsite gets its own domain, how to tell which method a network uses, and what moves with the site. Checked
on 2026-09-26 against WordPress 7.1.2 and the pages linked below.

## Core domain mapping (WordPress 4.5 and later)

- A subsite, subdomain or subdirectory, can be shown at an unrelated domain. Before 4.5 this needed a plugin; since
  4.5 it is built in. The handbook's steps: point the domain's DNS at the server, install a TLS certificate for every
  domain (SNI for the extra ones), then on Network Admin > Sites > Edit enter the full URL in "Site Address (URL)".
  Source: [WordPress Multisite Domain Mapping](https://developer.wordpress.org/advanced-administration/multisite/domain-mapping/)
- Saving that screen writes the new domain and path to `wp_blogs` and updates the site's `home` and `siteurl`
  options only when they still matched the old domain and path. Post content is not changed. The main site's
  domain and path cannot be changed there.
  Source: [`site-info.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/network/site-info.php#L50)
  and [line 92](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/network/site-info.php#L92)
- The screen has taken a full URL since 4.3 (domain and path in one field), and since 4.5 it shows the `home` URL
  under the label "Site Address (URL)".
  Sources: [Multisite Focused Changes in 4.3](https://make.wordpress.org/core/2015/07/24/multisite-focused-changes-in-4-3/),
  [Multisite Focused Changes in 4.5](https://make.wordpress.org/core/2016/03/09/multisite-focused-changes-in-4-5/)
- From the command line, `update_blog_details()` changes the `wp_blogs` row (through `wp_update_site()`); `home`
  and `siteurl` are then set with `wp option update`.
  Sources: [`update_blog_details()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-blogs.php#L305),
  [`wp_update_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L159)
- On each request WordPress finds the site from the host and path in `wp_blogs`, unless `sunrise.php` has already
  set `$current_blog` and `$current_site`.
  Source: [`ms-settings.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-settings.php#L51)
- In `wp site list`, `url` comes from the site's `home` option, while `domain` and `path` come from `wp_blogs`.
  Listing both shows mapped sites and mismatches.
  Source: [wp site list](https://developer.wordpress.org/cli/commands/site/list/)

### Cookies

- In a subdomain network where `COOKIE_DOMAIN` is not defined, core sets it to the network's cookie domain, or
  else its domain, with a leading dot.
  Source: [`ms_cookie_constants()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-constants.php#L84)
- For login errors about blocked cookies on a mapped subsite, or logins that fail without a message, the handbook
  adds `define( 'COOKIE_DOMAIN', $_SERVER['HTTP_HOST'] );` to `wp-config.php` after the network lines.
  Source: [Edit wp-config.php](https://developer.wordpress.org/advanced-administration/multisite/domain-mapping/#edit-wp-config-php)
- A standalone install does not need either; remove a network-specific `COOKIE_DOMAIN` from its `wp-config.php`.

## Plugin mapping through `sunrise.php`

- When `SUNRISE` is defined, with any value, `ms-settings.php` includes `wp-content/sunrise.php` before the site
  lookup, and the file can decide the site itself.
  Source: [`ms-settings.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-settings.php#L51)
- Core lists `sunrise.php` as a multisite drop-in, "Executed before Multisite is loaded".
  Source: [`_get_dropins()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php#L500)
- A defined `SUNRISE` also makes `is_multisite()` true when `MULTISITE` is not defined, so it must go from a
  standalone copy.
  Source: [`is_multisite()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L1448)
- Example: the WordPress MU Domain Mapping plugin is installed by copying its `sunrise.php` into `wp-content` and
  defining `SUNRISE`; its `sunrise.php` looks domains up in the table `{base prefix}domain_mapping`. The plugin
  directory closed it on 2025-10-05 at the author's request, so networks still using it are on unmaintained code.
  Sources: [plugin readme](https://plugins.svn.wordpress.org/wordpress-mu-domain-mapping/trunk/readme.txt),
  [plugin `sunrise.php`](https://plugins.svn.wordpress.org/wordpress-mu-domain-mapping/trunk/sunrise.php),
  [plugin directory page](https://wordpress.org/plugins/wordpress-mu-domain-mapping/)
- With plugin mapping, `wp_blogs`, `home` and `siteurl` can still hold the network address while visitors see the
  mapped domain, and content can contain both. Search for both forms before choosing replacement pairs.

## Finding the method (read-only)

```bash
wp --path=/srv/network config has SUNRISE && wp --path=/srv/network config get SUNRISE
ls -l /srv/network/wp-content/sunrise.php
wp --path=/srv/network site list --fields=blog_id,domain,path,url
wp --path=/srv/network db query "SHOW TABLES LIKE '%domain%'"
```

- `domain` in `wp_blogs` is the custom domain and no `sunrise.php`: core mapping.
- `SUNRISE` defined and `sunrise.php` present: plugin mapping; read the file and the plugin's table before planning.

## Moving a mapped site

Subsite to standalone, same domain:

1. The standalone install uses the mapped domain in `home` and `siteurl`.
2. Replace the network address forms found in the content and the uploads path; the domain itself stays.
3. At cut-over, point DNS at the standalone server and install the certificate there.
4. The network still claims the domain (in `wp_blogs`, or in the plugin's table). Archive the old site; after
   sign-off delete it, or delete the mapping row after a backup of that table.

Standalone to subsite, same domain:

1. After `wp site create`, set the Site Address (URL) to the domain (Network Admin, or `update_blog_details()` plus
   `wp option update`), then check `wp site list --site__in=<id> --fields=blog_id,domain,path,url`.
2. Test with a hosts-file entry, then move DNS at cut-over, with a certificate on the network server.
3. If the network runs a `sunrise.php`, read it first: it runs before core's lookup and can override it.
