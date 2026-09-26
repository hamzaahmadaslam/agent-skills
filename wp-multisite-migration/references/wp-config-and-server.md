# wp-config.php and the web server

Which constants make an install a network, what to remove for a standalone copy, and the rewrite rules for each
case. Checked against WordPress 7.1.2 and the handbook pages below on 2026-09-26.

## Multisite constants

| Constant | What it does | Source |
| -------- | ------------ | ------ |
| `WP_ALLOW_MULTISITE` | Shows Tools > Network Setup; defaults to false when absent | [wp-config.php handbook](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/#enable-multisite-network-ability) |
| `MULTISITE` | Turns the network on | [`network.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/network.php#L534) |
| `SUBDOMAIN_INSTALL` | `true` for subdomain sites, `false` for subdirectory sites | same |
| `DOMAIN_CURRENT_SITE`, `PATH_CURRENT_SITE` | The network's domain and path | same |
| `SITE_ID_CURRENT_SITE`, `BLOG_ID_CURRENT_SITE` | The network ID and the main site's blog_id | same |
| `VHOST` | Deprecated since 3.0 in favour of `SUBDOMAIN_INSTALL` | [`ms_subdomain_constants()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-constants.php#L131) |
| `SUNRISE` | Loads `wp-content/sunrise.php` early | [`ms-settings.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-settings.php#L51) |
| `NOBLOGREDIRECT` | Where to send visitors who ask for a site that does not exist | [wp-config.php handbook](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/#redirect-nonexistent-blogs) |
| `COOKIE_DOMAIN` | Cookie domain; set by core for subdomain networks when undefined | [`ms_cookie_constants()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-constants.php#L84) |
| `UPLOADBLOGSDIR`, `UPLOADS`, `BLOGUPLOADDIR` | Legacy `blogs.dir` upload paths when `ms_files_rewriting` is on | [`ms_upload_constants()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-constants.php#L18) |
| `WP_DEFAULT_THEME` | Theme for new sites | [Multisite Network Administration](https://developer.wordpress.org/advanced-administration/multisite/administration/#themes) |

- Network Setup prints the `MULTISITE` to `BLOG_ID_CURRENT_SITE` lines for `wp-config.php` and the rewrite rules
  for `.htaccess` or `web.config`, and tells you to back up both files first. Nginx rules are not generated.
  Sources: [`network.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/network.php#L534),
  [Create A Network](https://developer.wordpress.org/advanced-administration/multisite/create-network/#step-4-enabling-the-network),
  [URL Rewrites](https://developer.wordpress.org/advanced-administration/multisite/administration/#url-rewrites)
- `is_multisite()` returns `MULTISITE` when defined, otherwise true when `SUBDOMAIN_INSTALL`, `VHOST` or `SUNRISE`
  is defined.
  Source: [`is_multisite()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L1448)
- `NOBLOGREDIRECT` acts in two places: on a subdomain network, a request for a site that does not exist goes to its
  value instead of the signup form; and `maybe_redirect_404()` sends 404 responses of the main site there
  (`%siteurl%` means the network home).
  Sources: [`ms_load_current_site_and_network()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-load.php#L420-L434),
  [`maybe_redirect_404()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php#L2207)
- Switching a network between subdomain and subdirectory mode takes more than `SUBDOMAIN_INSTALL` and new rewrite
  rules; the handbook calls it an advanced operation. It is outside this skill.
  Source: [Switching network types](https://developer.wordpress.org/advanced-administration/multisite/administration/#switching-network-types)

## Standalone copy of a subsite

Remove from the new install's `wp-config.php`: `WP_ALLOW_MULTISITE`, `MULTISITE`, `SUBDOMAIN_INSTALL`, `VHOST`,
`DOMAIN_CURRENT_SITE`, `PATH_CURRENT_SITE`, `SITE_ID_CURRENT_SITE`, `BLOG_ID_CURRENT_SITE`, `SUNRISE`,
`NOBLOGREDIRECT`, legacy upload constants, and a `COOKIE_DOMAIN` set for the network or for domain mapping. A file
built with `wp config create` has none of them.

Check (read-only):

```bash
for c in WP_ALLOW_MULTISITE MULTISITE SUBDOMAIN_INSTALL VHOST DOMAIN_CURRENT_SITE PATH_CURRENT_SITE SITE_ID_CURRENT_SITE BLOG_ID_CURRENT_SITE SUNRISE NOBLOGREDIRECT COOKIE_DOMAIN UPLOADBLOGSDIR UPLOADS BLOGUPLOADDIR; do
  wp --path=/srv/blog-a config has "$c" 2>/dev/null && echo "still defined: $c"
done
wp --path=/srv/blog-a eval 'var_dump( is_multisite() );'     # bool(false)
```

`wp config has`, `get`, `set` and `delete` read or edit `wp-config.php` without loading WordPress
([wp config has](https://developer.wordpress.org/cli/commands/config/has/),
[wp config delete](https://developer.wordpress.org/cli/commands/config/delete/)). Back up the file before
`wp config delete` or `set`.

## Apache rules

Single site ([Basic WP](https://developer.wordpress.org/advanced-administration/server/web-server/httpd/#basic-wp)):

```apache
# BEGIN WordPress
RewriteEngine On
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
RewriteBase /
RewriteRule ^index\.php$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.php [L]
# END WordPress
```

Networks created with WordPress 3.5 or later use the subdirectory or subdomain block from the
[Multisite section](https://developer.wordpress.org/advanced-administration/server/web-server/httpd/#multisite).
The subdirectory block maps `/<site>/wp-content/...`, `/<site>/wp-admin/...` and `/<site>/*.php` to the shared
files:

```apache
RewriteRule ^([_0-9a-zA-Z-]+/)?(wp-(content|admin|includes).*) $2 [L]
RewriteRule ^([_0-9a-zA-Z-]+/)?(.*\.php)$ $2 [L]
```

Networks created with 3.4 or earlier also have `RewriteRule ^([_0-9a-zA-Z-]+/)?files/(.+) wp-includes/ms-files.php?file=$2 [L]`
(subdomain form `^files/(.+)`), which serves the legacy `/files/` URLs
([3.4 and below](https://developer.wordpress.org/advanced-administration/server/web-server/httpd/#wordpress-3-4-and-below)).
Network Setup includes that rule only when `ms_files_rewriting` is on
([`network.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/network.php#L695)).

WordPress does not write `.htaccess` on a network, and `wp rewrite flush --hard` works only on single-site
installs; after a move, `wp rewrite flush` regenerates the rules stored in the database only.
Sources: [`save_mod_rewrite_rules()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/misc.php#L262),
[wp rewrite flush](https://developer.wordpress.org/cli/commands/rewrite/flush/)

## Nginx

There is no per-directory file; the server block holds the rules and WordPress cannot change them. The handbook has
single-site, subdirectory and subdomain examples; the subdirectory form rewrites `^(/[^/]+)?(/wp-.*)` and
`^(/[^/]+)?(/.*\.php)` to the shared files, and the subdomain form serves `server_name example.com *.example.com`.
Source: [Nginx](https://developer.wordpress.org/advanced-administration/server/web-server/nginx/#wordpress-multisite)

A standalone copy uses the single-site `location / { try_files $uri $uri/ /index.php?$args; }` pattern from the same
page ([General WordPress rules](https://developer.wordpress.org/advanced-administration/server/web-server/nginx/#general-wordpress-rules)).

## Maintenance mode is install-wide

`wp maintenance-mode activate` writes `.maintenance` in the WordPress root. Core treats the whole install as in
maintenance while that file is less than ten minutes old, so on a network it blocks every site, and it lapses after
ten minutes. It is not a way to freeze one subsite; announce a content freeze instead. WP-CLI itself ignores
maintenance mode.
Sources: [`wp_is_maintenance_mode()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L437),
[wp maintenance-mode activate](https://developer.wordpress.org/cli/commands/maintenance-mode/activate/),
[WP-CLI `Runner.php`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1547)
