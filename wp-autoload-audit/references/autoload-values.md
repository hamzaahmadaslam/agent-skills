# Autoload values and how WordPress sets them

Read this in step 1, and whenever a value in the `autoload` column needs explaining. WordPress links point at the
7.1.2 tag; `option.php` means
[src/wp-includes/option.php](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php).

## The values in the `autoload` column

| Value | How a row gets it | Loaded on every request (7.1.2 default) |
| --- | --- | --- |
| `yes` | Written before WordPress 6.6, by custom SQL, or by `wp option set-autoload <name> yes` | yes |
| `no` | Same, for "do not autoload" | no |
| `on` | Explicit `true` (or `'yes'`, `'on'`) passed since 6.6; `wp_set_option_autoload_values()` since 6.6; core defaults on new installs since 6.6 | yes |
| `off` | Explicit `false` (or `'no'`, `'off'`) since 6.6 | no |
| `auto` | No explicit value, and no filter made a decision | yes |
| `auto-on` | No explicit value; a `wp_default_autoload_value` callback returned `true` | yes |
| `auto-off` | No explicit value; a callback returned `false` (by default: the serialized value is over 150,000 bytes) | no |
| anything else | Custom SQL or a plugin writing its own value | no |

- The loaded set is `yes`, `on`, `auto-on` and `auto`, returned by `wp_autoload_values_to_autoload()`. Its filter can
  only remove values from that list, because the result is intersected with the default list
  ([option.php L3259-L3275](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L3259-L3275)).
- `wp_load_alloptions()` loads rows whose value is in that list
  ([option.php L625-L631](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L625-L631)).
  If no row matches, it loads every row of the options table instead (same lines). Never switch every option off.
- The 6.6 dev note says `auto` rows load in 6.6 but that this default may change in a later release, and that no
  upgrade routine converts old rows: `yes` and `no` stay in the table and are treated as `on` and `off`
  ([Options API: disabling autoload for large options](https://make.wordpress.org/core/2024/06/18/options-api-disabling-autoload-for-large-options/)).
- The column is `varchar(20)` with the default `yes`, and it has its own index, `KEY autoload (autoload)`
  ([schema.php L141-L149](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L141-L149)).
  A row inserted by SQL without a value gets `yes`.
- Any SQL, report or dashboard that tests only `autoload = 'yes'` misses the rows written since 6.6. Count the four
  loaded values, or better, take the list from the site (`scripts/autoload-state.php` prints it after filters).

## How WordPress picks the value

### A new option: `add_option()`

- Since 6.6 the `$autoload` parameter defaults to `null`; before, it defaulted to `'yes'`
  ([option.php L1048, L1069](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1048);
  [6.5.0 option.php](https://github.com/WordPress/wordpress-develop/blob/6.5.0/src/wp-includes/option.php)).
- `wp_determine_option_autoload_value()` maps a boolean to `on` or `off`, `'yes'` or `'on'` to `on`, and `'no'` or
  `'off'` to `off`. For anything else it asks the `wp_default_autoload_value` filter (default `null`): `true` gives
  `auto-on`, `false` gives `auto-off`, `null` gives `auto`
  ([option.php L1306-L1339](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1306-L1339)).
- Core hooks `wp_filter_default_autoload_value_via_option_size()` into that filter at priority 5, so a callback at
  the default priority 10 can still override it
  ([default-filters.php L299](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-filters.php#L299)).
  It returns `false` when `strlen()` of the serialized value is over `wp_max_autoloaded_option_size`, default
  150,000 bytes; the filter receives the option name, so a site can set a threshold per option
  ([option.php L1353-L1370](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1353-L1370)).
- Result for a new option saved without a choice: 150,000 bytes or less becomes `auto` (loaded), more becomes
  `auto-off` (not loaded). The threshold never applies to an explicit `true`, `'yes'` or `'on'`: a 2 MB option saved
  that way stays autoloaded.
- The row is written with `INSERT ... ON DUPLICATE KEY UPDATE`
  ([option.php L1142](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1142)).

### An existing option: `update_option()`

- When the new value equals the old one, the function returns `false` and changes nothing, not even the autoload
  value; its documentation says `$autoload` changes only together with the value
  ([option.php L830-L843, L914-L925](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L914-L925)).
- When the option does not exist yet, it calls `add_option()` with the same `$autoload`
  ([option.php L927-L930](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L927-L930)).
- With an explicit `$autoload`, the mapped value is written. With `null`, WordPress reads the current value and
  re-decides only rows that hold `auto`, `auto-on` or `auto-off`
  ([option.php L945-L961](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L945-L961)).
  So `yes`, `on`, `no` and `off` survive later saves; an `auto` option that grows past the threshold becomes
  `auto-off`; an `auto-off` option that shrinks to the threshold or less becomes `auto` and loads again.
- Code that saves with an explicit `true` puts the option back to `on` on its next save with a changed value, whatever
  an audit set before. That is why a lasting fix sometimes has to be made in the owner's code.

### Changing only the autoload value

- `wp_set_option_autoload_values()`, `wp_set_options_autoload()` and `wp_set_option_autoload()` (since 6.4) change the
  column without touching the value, with one `UPDATE` per direction
  ([option.php L397-L551](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L397-L551);
  [New option functions in 6.4](https://make.wordpress.org/core/2023/10/17/new-option-functions-in-6-4/)).
- Since 6.6 they write only `on` or `off`: `false`, `'no'` and `'off'` mean `off`, anything else means `on`
  ([option.php L404-L422](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L404-L422)).
  In 6.4 and 6.5 they wrote `yes` and `no`
  ([6.5.0 option.php](https://github.com/WordPress/wordpress-develop/blob/6.5.0/src/wp-includes/option.php)). They
  cannot write `auto`, `auto-on` or `auto-off`.
- Passing `'yes'` or `'no'` to these functions and to `add_option()` and `update_option()` is deprecated since 6.7 in
  their documentation; the values still work
  ([option.php L387, L824, L1049](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L387)).
- `alloptions` and `notoptions` are protected names: every function above stops with `wp_die()` for them
  ([option.php L565-L575](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L565-L575)).

### What WP-CLI writes

- `wp option add` passes `'no'` to `add_option()` for `--autoload=no` or `off`, and `'yes'` for anything else,
  including a missing flag, in entity-command 2.8.4 (bundled with WP-CLI 2.12.0) and 3.0.2
  ([Option_Command.php L124-L141 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L124-L141)).
  On WordPress 6.6 and later the row therefore gets `off` or `on`, never `auto`, and the 150,000-byte rule does not
  apply to options added this way.
- `wp option set-autoload <name> <value>` writes the value you pass, one of `on`, `off`, `yes`, `no`, straight into
  the column ([Option_Command.php L476-L547 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L476-L547)).
- `wp option update --autoload=<value>` goes through `update_option()`, so the autoload value changes only when the
  value changes ([Option_Command.php L414-L439 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L414-L439)).

## Core options and their defaults

- New installs since 6.6: every default option is `on` except five that are `off`: `moderation_keys`,
  `recently_edited`, `disallowed_keys`, `uninstall_plugins` and `auto_plugin_theme_update_emails`
  ([schema.php L581-L613](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L581-L613)).
  Before 6.6 the same code wrote `yes` and `no`
  ([6.5.0 schema.php L596-L600](https://github.com/WordPress/wordpress-develop/blob/6.5.0/src/wp-admin/includes/schema.php#L596-L600)).
- The 6.5 upgrade switched `theme_mods_<theme>` off for every theme except the active one
  ([upgrade.php L2402-L2420](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2402-L2420)),
  and since 6.5 switching themes turns the new theme's mods on and the old theme's off
  ([theme.php L856-L861](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/theme.php#L856-L861);
  absent in [6.4.0 theme.php](https://github.com/WordPress/wordpress-develop/blob/6.4.0/src/wp-includes/theme.php)).
- The 6.7 upgrade (database version 58975) switched twelve core options off: `recently_activated`,
  `_wp_suggested_policy_text_has_changed`, `dashboard_widget_options`, `ftp_credentials`, `adminhash`,
  `nav_menu_options`, `wp_force_deactivated_plugins`, `delete_blog_hash`, `allowedthemes`, `recovery_keys`,
  `https_detection_errors` and `fresh_site`
  ([upgrade.php L2430-L2451, L881-L883](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/upgrade.php#L2430-L2451)).
  A site whose `db_version` is below 58975 has not run it yet.
- Core options that stay autoloaded on purpose, because they are read on most requests:
  - `cron`, always saved with `true` ([cron.php L1297-L1304](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1297-L1304)).
    A large `cron` value means too many scheduled events; fix the events (the collection's
    `wp-cron-action-scheduler-health` skill), not the autoload value.
  - `rewrite_rules`, read by `WP_Rewrite::wp_rewrite_rules()` and saved without an explicit value, so the row keeps the `on` or `yes` it was created with
    ([class-wp-rewrite.php L1493-L1524](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-rewrite.php#L1493-L1524)).
    Growth comes from plugins adding rules. Do not delete the row to reset it: the next save re-creates it through
    `add_option()` without an explicit value, so a value over 150,000 bytes comes back as `auto-off` and is then read
    on its own, with one more query per request on a site without a persistent object cache (the `add_option()` and
    size rules above). Flush rules through
    WordPress instead: loading Settings > Permalinks runs `flush_rewrite_rules()`
    ([options-permalink.php L212](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/options-permalink.php#L212)),
    and so does [`wp rewrite flush`](https://developer.wordpress.org/cli/commands/rewrite/flush/).
  - `<prefix>user_roles`, saved with `true` on install
    ([schema.php L736-L739](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L736-L739);
    name built in [class-wp-roles.php L342](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-roles.php#L342)).

## Transients stored as options

Transients are options only when no persistent object cache is in use; otherwise they live in the cache group
`transient` ([option.php L1541-L1542](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1541-L1542)).

- `set_transient()` with an expiration writes two rows, `_transient_<name>` and `_transient_timeout_<name>`, both not
  autoloaded. Without an expiration it writes one autoloaded row
  ([option.php L1543-L1576](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1543-L1576)).
  An autoloaded `_transient_` row is therefore a transient saved without an expiration.
- `get_transient()` checks the timeout only for transients that are not in the autoloaded set
  ([option.php L1455-L1470](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1455-L1470)).
- On a single site, site transients (`_site_transient_<name>`) and other network options are stored in the options
  table with autoload `off`, through `add_option( ..., false )` and `update_option( ..., false )`
  ([option.php L2188-L2189, L2445-L2446](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L2188-L2189)).
  On multisite they are in `sitemeta`, which has no autoload column.
- The Transients API documentation says a transient can disappear before its expiration (for example with an object
  cache), so code must be able to rebuild it
  ([Transients](https://developer.wordpress.org/apis/transients/)).
