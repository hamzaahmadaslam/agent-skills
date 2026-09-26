# Plugins and themes

Where a network records activations, and what has to be redone when a site leaves or joins. Checked against
WordPress 7.1.2 on 2026-09-26.

## Plugins

- Site-activated plugins are listed in the site's `active_plugins` option (in `wp_N_options`); network-activated
  plugins are the keys of the network option `active_sitewide_plugins` (in `wp_sitemeta`). A plugin counts as active
  on a site when it is in either list.
  Sources: [`is_plugin_active()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php#L539),
  [`is_plugin_active_for_network()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php#L580)
- A plugin with `Network: true` in its header can only be activated network-wide: `activate_plugin()` switches to
  network activation for it even when asked to activate it on one site. Activating it on an imported subsite
  therefore activates it on every site.
  Sources: [header requirements](https://developer.wordpress.org/plugins/plugin-basics/header-requirements/),
  [`is_network_only_plugin()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php#L608),
  [`activate_plugin()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php#L647)
- When a plugin is both network-active and in a site's `active_plugins`, WordPress loads it once.
  Source: [`wp_get_active_and_valid_plugins()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L1013)
- Plugins are installed once for the network and activated per site or for the whole network; the handbook
  describes site-activated, network-activated and must-use plugins.
  Source: [Multisite Network Administration, Plugins](https://developer.wordpress.org/advanced-administration/multisite/administration/#plugins)
- Must-use plugins in `wp-content/mu-plugins` run on every site, cannot be deactivated, run no activation hooks,
  and only PHP files directly in that folder load.
  Source: [Must Use Plugins](https://developer.wordpress.org/advanced-administration/plugins/mu-plugins/)
- Drop-ins: `advanced-cache.php` (with `WP_CACHE`), `db.php`, `db-error.php`, `install.php`, `maintenance.php`,
  `object-cache.php`, `php-error.php`, `fatal-error-handler.php`; on multisite also `sunrise.php` (with `SUNRISE`),
  `blog-deleted.php`, `blog-inactive.php`, `blog-suspended.php`.
  Source: [`_get_dropins()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/plugin.php#L500)
- `wp plugin list` statuses: `active`, `active-network`, `inactive`, `must-use`, `dropin`. It checks for updates over
  the network unless `--skip-update-check` is passed.
  Source: [wp plugin list](https://developer.wordpress.org/cli/commands/plugin/list/)
- Plugins may keep settings in network options (`get_site_option()`) rather than in the site's options. List the
  keys with `wp site option list --fields=meta_key` and read the plugin's documentation to see which ones a single
  site needs.
  Source: [wp site option list](https://developer.wordpress.org/cli/commands/site/option/list/)

### Subsite to standalone

1. Copy the code of every plugin that is `active` or `active-network` for the site, at the same version.
2. The imported `active_plugins` option activates the site-level ones. Activate the formerly network-active ones
   with `wp plugin activate <slug>`; this runs their activation hooks.
3. Copy only the must-use plugins and drop-ins the site needs. `sunrise.php` and the `blog-*.php` drop-ins are for
   networks only. Install `object-cache.php` or `advanced-cache.php` fresh for the new host's cache.
4. Carry over plugin settings stored as network options, as each plugin documents.

### Standalone to subsite

1. Plugin code the network lacks goes into the network's `wp-content/plugins` with the network administrator's
   agreement; it becomes available to every site but active on none.
2. The imported `active_plugins` option activates the site's plugins once their code exists. Do not run
   `wp plugin activate` for a `Network: true` plugin on the subsite.
3. Plugins that work only when network-activated on a network, or that do not support multisite, need a decision
   before the move; the handbook notes that not every plugin works in a network.
   Source: [Multisite Network Administration, Plugins](https://developer.wordpress.org/advanced-administration/multisite/administration/#plugins)
4. Must-use plugins and drop-ins of the standalone site are not copied: on a network they would run for every site.
   Rebuild what the site needs as a normal plugin, or agree it with the network administrator.

## Themes

- A site's active theme is the `stylesheet` option and its parent the `template` option, both in the site's
  options table; Customizer settings are the option `theme_mods_{stylesheet}`.
  Sources: [`get_stylesheet()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/theme.php#L181),
  [`get_template()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/theme.php#L317),
  [`get_theme_mods()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/theme.php#L1026)
- On a network, themes allowed for every site are in the network option `allowedthemes`; themes allowed for one
  site are in that site's `allowedthemes` option.
  Sources: [`WP_Theme::get_allowed_on_network()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-theme.php#L1696),
  [`WP_Theme::get_allowed_on_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-theme.php#L1722)
- The handbook: themes are installed for the whole network; "network enabling" a theme only makes it available, it
  does not activate it anywhere; a site can also have a theme enabled on its Edit Site > Themes tab; a site keeps
  its active theme when the theme is later network-disabled. Site Editor and Customizer changes are stored in that
  site's tables.
  Source: [Multisite Network Administration, Themes](https://developer.wordpress.org/advanced-administration/multisite/administration/#themes)
- `wp theme enable <theme>` allows a theme on the current site (`--url`); `--network` allows it network-wide;
  `--activate` also switches the current site to it.
  Source: [wp theme enable](https://developer.wordpress.org/cli/commands/theme/enable/)
- A child theme needs its parent theme's folder too.
  Source: [Migrate WordPress sites into WordPress Multisite](https://developer.wordpress.org/advanced-administration/multisite/sites-multisite/#copy-theme-and-plugin-files)

Subsite to standalone: copy the theme and parent folders; the imported `stylesheet`, `template` and
`theme_mods_*` options keep the design. Standalone to subsite: copy missing theme folders into the network, then
`wp theme enable <stylesheet> --url=<new site>` (and the parent); the imported options select the theme.
