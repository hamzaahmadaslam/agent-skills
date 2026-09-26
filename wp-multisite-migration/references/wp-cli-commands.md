# WP-CLI commands used by this skill

What each command reads or writes on a network. Checked on 2026-09-26 against the command pages on
developer.wordpress.org and WP-CLI 2.12.0 (latest release) with the command packages it bundles: entity-command
2.8.4, db-command 2.1.3, search-replace-command 2.1.8, extension-command 2.1.24, config-command 2.3.8. Newer
command packages exist on GitHub; re-check the flags when your WP-CLI is newer (`wp cli version`).

## Global parameters

- `--url=<url>`: "Pretend request came from given URL. In multisite, this argument is how the target site is
  specified."
- `--path=<path>`: the WordPress install to use.
- `--skip-plugins` and `--skip-themes`: skip loading plugins or themes; must-use plugins still load.
  Source: [global parameters](https://make.wordpress.org/cli/handbook/references/config/)
- Without `--url`, WP-CLI uses `DOMAIN_CURRENT_SITE` plus `PATH_CURRENT_SITE`, the network's main site.
  Source: [`Runner.php`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1437)
- WP-CLI runs against archived, spammed or deleted sites and ignores maintenance mode.
  Source: [`Runner.php`](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1544)
- The `wp db` commands run after `wp-config.php` is loaded but before WordPress loads, so `export`, `import` and
  `query` work on a database whose tables are renamed. `wp db tables`, `search` and `size` load WordPress.
  Source: [`DB_Command.php`](https://github.com/wp-cli/db-command/blob/v2.1.3/src/DB_Command.php#L26)

## Read-only commands

| Command | Use here | Source |
| ------- | -------- | ------ |
| `wp core version --extra` | WordPress version and database revision | [core version](https://developer.wordpress.org/cli/commands/core/version/) |
| `wp site list --fields=... --site__in=<id> --site_user=<id>` | Sites, their `domain`, `path`, status flags; `url` comes from `home` | [site list](https://developer.wordpress.org/cli/commands/site/list/) |
| `wp site option get <key>` / `list --fields=meta_key` | Network options such as `ms_files_rewriting` | [site option](https://developer.wordpress.org/cli/commands/site/option/) |
| `wp db prefix` | The site prefix of the current site | [db prefix](https://developer.wordpress.org/cli/commands/db/prefix/) |
| `wp db tables [--scope=blog] [--all-tables-with-prefix] [--all-tables] [--format=csv]` | Which tables a selection covers; default scope includes the shared tables | [db tables](https://developer.wordpress.org/cli/commands/db/tables/) |
| `wp db size --tables [...]` | Table sizes; same selection flags | [db size](https://developer.wordpress.org/cli/commands/db/size/) |
| `wp db search <text> [--regex] [--format=csv --fields=table,column]` | Find URL forms; case-insensitive unless `--regex`; `--format=count` works for one table only | [db search](https://developer.wordpress.org/cli/commands/db/search/) |
| `wp db query "<SELECT ...>" --skip-column-names` | Previews and counts; reads SQL from STDIN when no query is given | [db query](https://developer.wordpress.org/cli/commands/db/query/) |
| `wp db export <file> [--tables=a,b] [--where=...] [--single-transaction]` | Backups and site exports; reads the database, writes a file | [db export](https://developer.wordpress.org/cli/commands/db/export/) |
| `wp user list [--network] [--role=<role>\|none] [--fields=...]` | Members of a site; `--network` lists every account | [user list](https://developer.wordpress.org/cli/commands/user/list/) |
| `wp user get <id\|login\|email> --field=<field>` | Does an account exist | [user get](https://developer.wordpress.org/cli/commands/user/get/) |
| `wp role list` | The site's role definitions | [role list](https://developer.wordpress.org/cli/commands/role/list/) |
| `wp super-admin list` | Super admins | [super-admin list](https://developer.wordpress.org/cli/commands/super-admin/list/) |
| `wp plugin list --status=<status> --skip-update-check` | `active`, `active-network`, `inactive`, `must-use`, `dropin`; without the flag it checks for updates over the network | [plugin list](https://developer.wordpress.org/cli/commands/plugin/list/) |
| `wp theme list --skip-update-check` | Themes and the active one | [theme list](https://developer.wordpress.org/cli/commands/theme/list/) |
| `wp option get <name>` | `home`, `siteurl`, `upload_path`, `stylesheet`, `template`, `permalink_structure`, `blog_public` | [option get](https://developer.wordpress.org/cli/commands/option/get/) |
| `wp config has/get <name>` | Constants in `wp-config.php`, without loading WordPress | [config has](https://developer.wordpress.org/cli/commands/config/has/), [config get](https://developer.wordpress.org/cli/commands/config/get/) |
| `wp cron event list` | Scheduled events of the site | [cron event list](https://developer.wordpress.org/cli/commands/cron/event/list/) |
| `wp eval '<php>'` | Read values such as `wp_get_upload_dir()`; runs any PHP, so only read-only code | [eval](https://developer.wordpress.org/cli/commands/eval/) |
| `wp search-replace ... --dry-run` | Counts without saving | [search-replace](https://developer.wordpress.org/cli/commands/search-replace/) |

## Commands that write

| Command | What it changes | Source |
| ------- | --------------- | ------ |
| `wp db import <file>` | Runs the file's SQL; a mysqldump file drops and recreates its tables | [db import](https://developer.wordpress.org/cli/commands/db/import/) |
| `wp db create` | Creates the database named in `wp-config.php` | [db create](https://developer.wordpress.org/cli/commands/db/create/) |
| `wp db query "<UPDATE/RENAME/DELETE ...>"` | Anything the SQL says | [db query](https://developer.wordpress.org/cli/commands/db/query/) |
| `wp search-replace` | Rows in the selected tables; see [search-replace.md](search-replace.md) | [search-replace](https://developer.wordpress.org/cli/commands/search-replace/) |
| `wp site create --slug=<slug> [--title=] [--email=] [--porcelain]` | A new site and its tables; details below | [site create](https://developer.wordpress.org/cli/commands/site/create/) |
| `wp site archive <id>` / `unarchive <id>` | `archived` flag; visitors get 410 while archived | [site archive](https://developer.wordpress.org/cli/commands/site/archive/), [site unarchive](https://developer.wordpress.org/cli/commands/site/unarchive/) |
| `wp site deactivate <id>` | `deleted = 1` | [site deactivate](https://developer.wordpress.org/cli/commands/site/deactivate/) |
| `wp site public <id>` / `private <id>` | `public` flag, and through a core hook the `blog_public` option | [site public](https://developer.wordpress.org/cli/commands/site/public/), [site private](https://developer.wordpress.org/cli/commands/site/private/), [`ms-default-filters.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-filters.php#L55) |
| `wp site delete <id> [--keep-tables]` | Details below | [site delete](https://developer.wordpress.org/cli/commands/site/delete/) |
| `wp user create <login> <email> [--role=] [--porcelain] [--send-email]` | A new account; on multisite also the signup rules | [user create](https://developer.wordpress.org/cli/commands/user/create/) |
| `wp user set-role <user> <role>` | On multisite adds the user to the site with that role | [user set-role](https://developer.wordpress.org/cli/commands/user/set-role/) |
| `wp user remove-role <user>` | With no role name, removes the user from the site; posts stay | [user remove-role](https://developer.wordpress.org/cli/commands/user/remove-role/) |
| `wp user delete <user> [--network] [--reassign=<id>]` | Details below | [user delete](https://developer.wordpress.org/cli/commands/user/delete/) |
| `wp plugin activate <slug> [--network]` | Activation and its hook | [plugin activate](https://developer.wordpress.org/cli/commands/plugin/activate/) |
| `wp theme enable <theme> [--network] [--activate]` | Allowed themes of the site or network | [theme enable](https://developer.wordpress.org/cli/commands/theme/enable/) |
| `wp option update <name> <value>` | One option of the current site | [option update](https://developer.wordpress.org/cli/commands/option/update/) |
| `wp config set/delete <name>` | `wp-config.php` | [config set](https://developer.wordpress.org/cli/commands/config/set/), [config delete](https://developer.wordpress.org/cli/commands/config/delete/) |
| `wp config create` | A new `wp-config.php` | [config create](https://developer.wordpress.org/cli/commands/config/create/) |
| `wp core download --version=<v>` | Core files into a folder | [core download](https://developer.wordpress.org/cli/commands/core/download/) |
| `wp rewrite flush` | The `rewrite_rules` option; `--hard` writes `.htaccess` on single-site installs only | [rewrite flush](https://developer.wordpress.org/cli/commands/rewrite/flush/) |
| `wp cache flush` | The object cache; on a network with a persistent cache usually every site's cache | [cache flush](https://developer.wordpress.org/cli/commands/cache/flush/) |
| `wp export` / `wp import` | WXR files; import creates content and users | [export](https://developer.wordpress.org/cli/commands/export/), [import](https://developer.wordpress.org/cli/commands/import/) |

## Details that change a plan

- `wp site create`: the slug becomes a subdomain or a path depending on the network type; on subdirectory networks
  reserved words are refused. Without a valid `--email`, the first super admin becomes the site's administrator.
  With an email that has no account, it creates the account with a random password and sends the new-user
  notification.
  Sources: [`Site_Command::create()`](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Site_Command.php#L433),
  [line 465](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Site_Command.php#L465),
  [`get_subdirectory_reserved_names()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php#L2764)
- Creating a site also emails the network admin when the network option `registrationnotification` is `yes`.
  Source: [`ms-default-filters.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-default-filters.php#L53),
  [`newblog_notify_siteadmin()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php#L1482)
- `wp site delete <id>` refuses the main site and asks for confirmation unless `--yes`. Without `--keep-tables` it
  drops the site's core tables (and any a plugin adds through the `wpmu_drop_tables` filter), deletes the files in
  its uploads folder and removes its members. With `--keep-tables`, or on a legacy network whose site has an empty
  `upload_path`, it removes the members and sets `deleted = 1` instead.
  Sources: [`Site_Command::delete()`](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Site_Command.php#L363),
  [`wpmu_delete_blog()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/ms.php#L64),
  [`wp_uninitialize_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L832)
- `wp user delete`: on multisite, without `--network` it only removes the user from the current site, but without
  `--reassign` it first deletes that user's posts on the site. With `--network` it deletes the account and the
  user's posts and links on every site they belong to.
  Sources: [user delete](https://developer.wordpress.org/cli/commands/user/delete/),
  [`wp_delete_user()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/user.php#L388),
  [`wpmu_delete_user()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/ms.php#L145)
- `wp user create` and `wp user import-csv` on multisite validate the login and email with
  `wpmu_validate_user_signup()`.
  Sources: [`User_Command.php`](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/User_Command.php#L436),
  [`wpmu_validate_user_signup()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php#L469)
- `wp db export` runs `mysqldump`; `--tables` limits it to the listed tables and `--where` is passed through, which
  exports only matching rows.
  Source: [db export examples](https://developer.wordpress.org/cli/commands/db/export/)
- `wp maintenance-mode activate` affects the whole install, every site of a network, and core ignores the file
  after ten minutes; see [wp-config-and-server.md](wp-config-and-server.md).
