# VIP platform rules: cron, redirects, roles, email, plugins, CLI

Read this for the manual pass when a change schedules work, redirects, changes roles, sends email, loads plugins,
adds WP-CLI commands or REST routes, or is large. Facts checked on 2026-09-26; the source is beside each one.

## Cron

Look for: `cron_schedules` filters and their `interval`, `wp_schedule_event()`, `wp_schedule_single_event()`,
`WP_CLI::runcommand()` inside a cron callback, requests to `wp-cron.php`, callbacks that write options.

| Rule | Source |
| ---- | ------ |
| `/wp-cron.php` is disabled on VIP. Cron Control runs events from its own table (`wp_a8c_cron_control_jobs`), polls for due jobs every 30 seconds, runs them in separate containers, and can run several in parallel. | [wordpress-on-vip/cron-control](https://docs.wpvip.com/wordpress-on-vip/cron-control/) |
| Cron suits heavy processing, work that need not happen in real time, and tasks that may take longer than 300 seconds. | [wordpress-on-vip/cron-control](https://docs.wpvip.com/wordpress-on-vip/cron-control/) |
| Events scheduled less than 15 minutes apart, or expensive events, hurt performance. The VIP ruleset flags cron intervals under 900 seconds. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/), [WordPressVIPMinimum ruleset](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/WordPressVIPMinimum/ruleset.xml) |
| Do not create a recurring event by calling `wp_schedule_single_event()` again and again; use `wp_schedule_event()`. | [wordpress-on-vip/cron-control](https://docs.wpvip.com/wordpress-on-vip/cron-control/) |
| `WP_CLI::runcommand()` does not work inside a cron action; move the command's logic into a function and schedule that. | [wordpress-on-vip/cron-control](https://docs.wpvip.com/wordpress-on-vip/cron-control/) |
| By default only one event per action runs at a time. The `a8c_cron_control_concurrent_event_whitelist` filter raises that, but not for events that write an autoloaded option, and there is no gain when fewer than 5 events are expected at once. | [wordpress-on-vip/cron-control](https://docs.wpvip.com/wordpress-on-vip/cron-control/) |

## Redirects

Look for: `wp_redirect()`, `wp_safe_redirect()`, the `allowed_redirect_hosts` filter, redirect targets built from
request data, `vip_regex_redirects()`, `vip_substr_redirects()`, `.htaccess` files.

| Rule | Source |
| ---- | ------ |
| VIP runs NGINX, so `.htaccess` files do nothing. Redirects go in a plugin, in `vip-config.php` (for domains) or in theme code. | [redirects](https://docs.wpvip.com/redirects/) |
| The page cache keeps 302 redirects for 1 minute and 301 redirects for 30 minutes, so a wrong 301 lingers. | [redirects](https://docs.wpvip.com/redirects/) |
| `vip_regex_redirects()` runs its regular expressions on every uncached page load; `vip_substr_redirects()` is the alternative when only a path prefix such as `/foo/bar/*` needs redirecting. | [redirects/redirects-in-theme-code](https://docs.wpvip.com/redirects/redirects-in-theme-code/) |
| Safe Redirect Manager suits a small number of redirects (up to 1,000 by default); WPCOM Legacy Redirector suits large numbers (over 300) of legacy URLs that now return 404. | [redirects/wordpress-plugins](https://docs.wpvip.com/redirects/wordpress-plugins/) |
| Use `wp_safe_redirect()` with the `allowed_redirect_hosts` filter instead of `wp_redirect()`, and call `exit()` after the redirect. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| `wp_safe_redirect()` sends a host that is not allowed to `wp-admin` on the site URL instead, and it does not exit by itself. | [wp_safe_redirect()](https://developer.wordpress.org/reference/functions/wp_safe_redirect/) |

## Roles and capabilities (platform side)

Security checks on capabilities are in `security-checks.md`.

| Rule | Source |
| ---- | ------ |
| Create or change roles with VIP's helpers: `wpcom_vip_add_role()`, `wpcom_vip_merge_role_caps()`, `wpcom_vip_duplicate_role()`, `wpcom_vip_add_role_caps()`, `wpcom_vip_remove_role_caps()`. | [wordpress-on-vip/customize-user-roles](https://docs.wpvip.com/wordpress-on-vip/customize-user-roles/) |
| Run the helpers on `admin_init`, guarded by a version number stored in an option so the database update runs only when the definitions change, with one option per plugin. On busy sites, trigger the update from an admin button or a CLI command instead. | [wordpress-on-vip/customize-user-roles](https://docs.wpvip.com/wordpress-on-vip/customize-user-roles/) |
| Removing the admin toolbar is strongly discouraged, and it must not be removed for administrators or the `vip_support` role. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |

## Sessions, cookies and email

| Rule | Source |
| ---- | ------ |
| PHP sessions are supported and stored in Memcached, but every request from a user with a session bypasses the page cache. Start a session only when needed, destroy it as soon as possible, and limit it to specific URLs with the `path` of `session_set_cookie_params()`. Session cookies are `httponly` and `secure` by default; do not weaken that. | [wordpress-on-vip/php/php-sessions](https://docs.wpvip.com/wordpress-on-vip/php/php-sessions/) |
| Setting cookies for many visitors at once sends their requests to the origin faster than autoscaling may absorb; stagger such releases. | [page-cache/cookies](https://docs.wpvip.com/caching/page-cache/cookies/) |
| `wp_mail()` is for small amounts of email to admins or specific addresses. Code must not send email to site users or user-supplied addresses; bulk mail goes through a third-party SMTP or email service provider. Messages are limited to 100 MB after encoding. | [wordpress-on-vip/email](https://docs.wpvip.com/wordpress-on-vip/email/), [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Attaching a file from the uploads directory needs `USE_VIP_PHPMAILER` set to `true` in `vip-config.php`. | [wordpress-on-vip/email](https://docs.wpvip.com/wordpress-on-vip/email/) |
| A custom sender built from user data goes through the `wp_mail_from` and `wp_mail_from_name` filters, not raw headers. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |

## Plugins and code loading

| Rule | Source |
| ---- | ------ |
| There is no FTP and no plugin installation through WP Admin: plugins, themes and custom code live in the application's GitHub repository. | [guidebooks/develop-on-wpvip/wordpress-apps](https://docs.wpvip.com/guidebooks/develop-on-wpvip/wordpress-apps/) |
| Code-activate plugins with `wpcom_vip_load_plugin()` in `client-mu-plugins/plugin-loader.php`. `register_activation_hook()` does not fire for code-activated plugins, and VIP lists activation and deactivation hooks as unsupported. | [plugins/activate-plugins-through-code](https://docs.wpvip.com/plugins/activate-plugins-through-code/), [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Single-file plugins in the root of `/client-mu-plugins` load automatically; adding them to the plugin loader loads them twice. | [plugins/activate-plugins-through-code](https://docs.wpvip.com/plugins/activate-plugins-through-code/) |
| VIP already provides page caching, JS and CSS concatenation, compression and security protections. Caching, security, backup and image-optimization plugins that duplicate them are known to conflict (examples VIP names: W3 Total Cache, WP Rocket, WP Super Cache, Wordfence, Sucuri, Smush, All-in-One WP Migration). | [plugins/incompatibilities](https://docs.wpvip.com/plugins/incompatibilities/) |
| Commit minified JavaScript together with its unminified source. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |

## WP-CLI commands

| Rule | Source |
| ---- | ------ |
| WP-CLI runs in its own container but shares Memcached and the database with the site. | [cli-commands-at-scale](https://docs.wpvip.com/vip-cli/wp-cli-with-vip-cli/cli-commands-at-scale/) |
| Commands over large data extend `WPCOM_VIP_CLI_Command`, call `vip_inmemory_cleanup()` every 50 to 100 posts, wrap many writes in `start_bulk_operation()` and `end_bulk_operation()`, `sleep()` between batches, page through results instead of a no-limit query, and default to a dry run. | [cli-commands-at-scale](https://docs.wpvip.com/vip-cli/wp-cli-with-vip-cli/cli-commands-at-scale/) |
| Register commands only inside `if ( defined( 'WP_CLI' ) && WP_CLI )`. | [write-custom-wp-cli-commands](https://docs.wpvip.com/vip-cli/wp-cli-with-vip-cli/write-custom-wp-cli-commands/) |

## REST routes, multisite, time, robots.txt, 404 pages

| Rule | Source |
| ---- | ------ |
| Keep the REST prefix `wp-json`. Responses to front-end API requests should never write to the database. Authenticated requests bypass the page cache. The default cache time for REST responses is 1 minute (`wpcom_vip_rest_read_response_ttl` filter); do not lower it. | [wordpress-on-vip/wordpress-rest-api](https://docs.wpvip.com/wordpress-on-vip/wordpress-rest-api/) |
| On multisite, `switch_to_blog()` switches only the database context, not the code (filters) of the other site. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Never call `date_default_timezone_set()`: WordPress needs PHP's timezone at GMT+0. Use `current_datetime()` and `wp_date()`; `current_time( 'timestamp' )` is not recommended since WordPress 5.3. | [wordpress-on-vip/local-time](https://docs.wpvip.com/wordpress-on-vip/local-time/) |
| Change `robots.txt` through the `do_robotstxt` action or the `robots_txt` filter. Environments reached by their convenience domain serve a disallow-all `robots.txt`; non-production environments, and production ones without a custom primary domain, send `x-robots-tag: noindex, nofollow`. | [security-controls/robots-txt](https://docs.wpvip.com/security-controls/robots-txt/) |
| The 404 page must be one of the fastest on the site: it is cached for only 10 seconds, so a burst of broken links hits the origin. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |

## Pull request hygiene

| Rule | Source |
| ---- | ------ |
| Scan with PHPCS and the VIP standards before opening the pull request, and remove code that does not need review. | [prepare-code-for-review](https://docs.wpvip.com/guidebooks/developer-best-practices/prepare-code-for-review/) |
| Split changes that touch more than 1,000 lines. Give whitespace-only changes, style-only changes, each added or removed plugin, and build output (minified or compiled JS and CSS) their own pull requests. | [prepare-code-for-review](https://docs.wpvip.com/guidebooks/developer-best-practices/prepare-code-for-review/) |
| Check `.gitignore` changes, avoid changing an already approved pull request, and keep follow-up commits few. | [prepare-code-for-review](https://docs.wpvip.com/guidebooks/developer-best-practices/prepare-code-for-review/) |
