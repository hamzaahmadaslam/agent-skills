# Finding the owner of an option, and deciding what to do with it

Read this in steps 2 and 3. Work from the largest autoloaded options down; the SQL report prints each option's share
of the loaded total, so you can see how much the first rows account for. WordPress links point at the 7.1.2 tag.

## Who can own an option

Check in this order and stop at the first match.

### 1. WordPress core

- The default options of a new install are listed in `populate_options()`
  ([schema.php L411-L566](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L411-L566)).
  Core adds more as it runs; their names appear as string literals in `wp-includes/` and `wp-admin/`, which is where
  `scripts/find-option-owner.sh` looks first.
- Names core builds from a variable, which a literal search cannot find:

| Pattern | Built in |
| --- | --- |
| `theme_mods_<theme>` | [theme.php L818-L823, L1026-L1028](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/theme.php#L1026-L1028) |
| `widget_<id_base>` | [class-wp-widget.php L172](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-widget.php#L172) |
| `<prefix>user_roles` (for example `wp_user_roles`, `wp_2_user_roles`) | [class-wp-roles.php L342](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-roles.php#L342) |
| `<taxonomy>_children` (for example `category_children`) | [taxonomy.php L3966-L3990](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/taxonomy.php#L3966-L3990) |
| `_transient_<name>`, `_transient_timeout_<name>` | [option.php L1543-L1576](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1543-L1576) |
| `_site_transient_<name>`, `_site_transient_timeout_<name>` (in the options table on a single site) | [option.php L2641-L2675](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L2641-L2675) |

  `widget_<id_base>` and `<taxonomy>_children` are core storage, but the widget or taxonomy itself can come from a
  plugin or theme; a transient belongs to whatever code sets it (search for the part after `_transient_`).
- Never delete a core option. Leave core autoload values as they are, except for the options that the 6.5 and 6.7
  upgrades switch off (`autoload-values.md`): on a site still on an older release, switching those off matches what
  the upgrade will do; on a site whose database upgrade is pending, run the upgrade instead
  ([wp core update-db](https://developer.wordpress.org/cli/commands/core/update-db/), a change). For large core
  options, fix what feeds them: scheduled events for `cron`, plugins adding rewrite rules for `rewrite_rules`, roles and
  capabilities for `<prefix>user_roles`.

### 2. A plugin, theme or must-use plugin with the name in its code

- The plugin handbook asks plugins to prefix options and transients, like all global code, with an identifier
  unique to the plugin, at least four characters long, and not `wp_`, `__` or `_`
  ([Plugin handbook: prefix everything](https://developer.wordpress.org/plugins/plugin-basics/best-practices/#prefix-everything)).
  The prefix is often the plugin's slug or an abbreviation of it; older and badly behaved plugins may not follow it.
- Search the code for the exact name, in quotes, read-only:
  `bash scripts/find-option-owner.sh --path=/var/www/html option_one option_two`. It prints each match with the
  plugin, theme or must-use plugin folder, the file and the line.
- An exact match inside quotes is strong evidence. A match on the name's prefix only (the script tries shorter
  prefixes when the full name is not found) is weaker: read the code around it to see how the name is built.
- A top-level serialized object names its class (`O:<length>:"<Class>"`); the SQL report prints that class for the
  largest options. `grep -rn "class <Class>" wp-content` finds the file that defines it.
- Check whether the owner is active: `wp plugin list --fields=name,status,version --skip-update-check`, with
  `--status=must-use` and `--status=dropin` for the other two kinds
  ([wp plugin list](https://developer.wordpress.org/cli/commands/plugin/list/)); `wp theme list` for themes.

### 3. A plugin or theme that is no longer installed

- The plugin handbook says to remove options on uninstall, through `uninstall.php` or `register_uninstall_hook()`,
  and not on deactivation
  ([Uninstall methods](https://developer.wordpress.org/plugins/plugin-basics/uninstall-methods/)). A plugin that
  skips this leaves its rows behind with whatever autoload value they had.
- A name that no installed code references, with a prefix that matches no installed plugin or theme, is an orphan
  candidate. Before deleting, check the site's own history (a plugin removed last month), search the web for the
  prefix only when needed, and keep the export.

### 4. Unknown

Leave it. Record it in the report with its size and value type (the SQL report shows whether it is a serialized
array, a serialized object and its class, or a plain string), and ask the site owner.

## Which requests read the option

Before switching an option off, find out where it is read:

- In the owner's code: the files that call `get_option( '<name>' )`. Calls only under `admin/`, in settings screens,
  in `is_admin()` branches, in cron or in CLI code point at an option that most front-end requests do not need.
- On staging, the temporary read logger in `changes-and-rollback.md` records which kinds of request read each listed
  option. It hooks `option_<name>`, which runs on every read of an existing option, `alloptions` hits included
  ([option.php L243-L256](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L243-L256)).

## Decide per option

Core's guidance on the `$autoload` parameter: autoload options read in several places on the front end; do not
autoload options read only on a few URLs
([option.php L837-L841](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L837-L841)).
VIP adds: options that are large, rarely used or changed often should not autoload
([Autoloaded options](https://docs.wpvip.com/wordpress-on-vip/autoloaded-options/)).

| Finding | Decision |
| --- | --- |
| Core option | Keep. Fix what makes it grow |
| Owner active; read on most front-end requests; small | Keep |
| Owner active; read only in admin, cron or on a few URLs | Switch autoload off; ask the owner to save it with `false`; check it stays off after the owner's next save |
| Owner active; changes on many requests (counters, timestamps, logs, queues) | Switch off, and report it to the owner; on a site with a persistent cache this comes first (`object-cache.md`) |
| Owner active; very large and read on every request | Keep for now; ask the owner to split or shrink it. Switching it off only moves the same bytes to a separate query or cache read |
| Owner installed but inactive | Switch off. Delete only when the plugin is removed for good, preferably through its own uninstall |
| Owner no longer installed; no code references the name | Delete, with the export first |
| Autoloaded transient (saved without an expiration) | Delete; if it comes back autoloaded, report it to the owner |
| Transient rows left from before a persistent object cache | Delete (they are never read; `object-cache.md`) |
| Unknown | Leave; ask |

Do not decide from size alone: the 150,000-byte figure is the threshold core uses for new options saved without an
explicit choice, not a rule for existing ones, and the 800,000-byte Site Health figure is a total. A 300 KB option
read on every request may be right where it is; a 20 KB option read once a day is not.
