# What changed by release

Read the site's version first (`wp core version --extra` prints the WordPress version and the database revision) and
apply the rows at or below it. Current releases when this skill was last verified (2026-09-26): WordPress 7.1.2
([version check API](https://api.wordpress.org/core/version-check/1.7/)) and WP-CLI 2.12.0
([release](https://github.com/wp-cli/wp-cli/releases/tag/v2.12.0)).

## WordPress

| Release | Change that matters for autoloaded options | Source |
| --- | --- | --- |
| 2.2 | `wp_load_alloptions()` and the `alloptions` cache key | [option.php L588-L600](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L588-L600) |
| 4.2 | `update_option()` gets the `$autoload` parameter | [option.php L823](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L823) |
| 4.9 | Filters `pre_cache_alloptions` and `alloptions` | [option.php L639-L660](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L639-L660) |
| 5.3.1 | `wp_load_alloptions( $force_cache )` re-reads the persistent cache | [option.php L592](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L592) |
| 6.1 | Site Health suggests a persistent object cache (500 autoloaded options, 100,000 serialized bytes, table sizes) | [class-wp-site-health.php L3756-L3829](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3756-L3829) |
| 6.2 | Filter `pre_wp_load_alloptions` can replace the whole load | [option.php L603-L617](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L603-L617) |
| 6.4 | `wp_prime_option_caches()`, `get_options()`, `wp_set_option_autoload_values()` and its two wrappers; `update_option()` with `$autoload` stops updating the wrong cache | [New option functions in 6.4](https://make.wordpress.org/core/2023/10/17/new-option-functions-in-6-4/) |
| 6.5 | Upgrade switches `theme_mods_` of inactive themes off; `switch_theme()` switches the old theme's mods off and the new theme's on | [upgrade.php L2402-L2420](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2402-L2420), [theme.php L856-L861](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/theme.php#L856-L861) |
| 6.6 | New values `on`, `off`, `auto`, `auto-on`, `auto-off`; `$autoload` defaults to `null`; new options over 150,000 bytes saved without a choice are not autoloaded (`wp_max_autoloaded_option_size`); `wp_autoload_values_to_autoload()`; `wp_default_autoload_value`; Site Health "Autoloaded options" test at 800,000 bytes; core defaults written as `on` and `off`; no upgrade of existing `yes` and `no` rows | [dev note](https://make.wordpress.org/core/2024/06/18/options-api-disabling-autoload-for-large-options/), [6.6 performance post](https://make.wordpress.org/core/2024/07/29/wordpress-6-6-performance-improvements/), [6.6.0 option.php](https://github.com/WordPress/wordpress-develop/blob/6.6.0/src/wp-includes/option.php) |
| 6.7 | `'yes'` and `'no'` as arguments deprecated in the documentation; upgrade (database 58975) switches twelve core options off; `delete_option()` records the deleted name in `notoptions` | [upgrade.php L2430-L2451](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2430-L2451), [6.7.0 option.php](https://github.com/WordPress/wordpress-develop/blob/6.7.0/src/wp-includes/option.php) |
| 6.8 | `get_option()` checks `notoptions` before the option's own cache key; new `set_transient` action | [6.8.0 option.php](https://github.com/WordPress/wordpress-develop/blob/6.8.0/src/wp-includes/option.php) |
| 6.9, 7.0, 7.1 | No change to how options are autoloaded, to the thresholds or to the two Site Health tests. Between 6.8.0 and 7.1.2 the differences in `option.php` and in those Site Health methods are documentation, code tidying, a changed handbook link and, in 6.9, a `pre_site_option` filter for network options | [6.9.0](https://github.com/WordPress/wordpress-develop/blob/6.9.0/src/wp-includes/option.php), [7.0.0](https://github.com/WordPress/wordpress-develop/blob/7.0.0/src/wp-includes/option.php), [7.1.2](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php) |

## WP-CLI

| Version | Change | Source |
| --- | --- | --- |
| entity-command 2.8.4 (WP-CLI 2.12.0) | `option list --autoload=on` matches `on` and `yes` without parentheses around them; `set-autoload` accepts `on`, `off`, `yes`, `no` | [Option_Command.php at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L275-L284) |
| entity-command 2.8.5, 2.8.6 | Same `--autoload` filter | [2.8.6](https://github.com/wp-cli/entity-command/blob/v2.8.6/src/Option_Command.php) |
| entity-command 3.0.0 (2026-08-04) | Parentheses added to the `--autoload` and `--transients` conditions; still only `on` and `yes` | [3.0.0](https://github.com/wp-cli/entity-command/blob/v3.0.0/src/Option_Command.php) |
| doctor-command 3.0.0 | `autoload-options-size` warns above 900 KB, measured with `option list --autoload=on` | [Autoload_Options_Size.php](https://github.com/wp-cli/doctor-command/blob/v3.0.0/src/Check/Autoload_Options_Size.php) |

## What this means for the audit

- Before 6.6: only `yes` loads, `add_option()` autoloads by default, and there is no size rule and no "Autoloaded
  options" test in Site Health. Count `yes` rows; the procedure is otherwise the same. If a site was downgraded from 6.6 or later, rows with `on`,
  `auto` or `auto-on` stop loading, because the query tests `autoload = 'yes'`
  ([6.5.0 option.php](https://github.com/WordPress/wordpress-develop/blob/6.5.0/src/wp-includes/option.php)).
- Before 6.6, give `wp option set-autoload` only `yes` or `no`: the command writes the value as given, and those
  releases load only `yes` rows, so an `on` row silently stops loading. `wp_set_option_autoload()`
  (6.4 and 6.5) writes `yes` and `no` by itself.
- Before 6.4: `wp_set_option_autoload()` and its relatives do not exist; use `wp option set-autoload <name> no`, then
  delete the `alloptions` cache key. Do not change autoload through `update_option()` there: before 6.4 it could update
  the wrong cache when `$autoload` changed with the value (6.4 dev note above).
- Between 6.6 and the 6.7 upgrade: twelve core options that 6.7 switches off may still be autoloaded; compare
  `db_version` with 58975 before treating them as findings.
- On every version: the loaded values come from the site, after filters. Print them with the state helper instead of
  assuming the default list.
