# Users and roles

How users move in each direction. The storage facts and their sources are in [data-model.md](data-model.md); the
short version: accounts live once per network in `wp_users` and `wp_usermeta`, a user's role on site N is the meta
key `{site prefix}capabilities`, and the role definitions are the option `{site prefix}user_roles` in the site's
options table.

Every write below runs on a copy that is not live, except the account steps of direction B (creating accounts,
copying password hashes, setting roles), which write to the network's user tables. Each block starts with a backup
and a SELECT preview. Save the SQL in a file and run it with `wp db query < file.sql`, or pass it through a quoted
heredoc (`<<'SQL'`); either way the shell leaves `$`, backticks and backslashes alone
([POSIX 2.7.4 Here-Document](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#tag_19_07_04)).

## Direction A: keys for the standalone install

Starting point: the new database holds the members' rows of `wp_users` and all their `wp_usermeta` rows, and the
tables are already renamed (extract runbook, step 6). Example values: site prefix `wp_3_`, base prefix `wp_`, target
prefix `wp_`.

Three kinds of per-site keys are present:

- keys of the moving site, `wp_3_...`: rename to `wp_...`;
- keys of the network's blog_id 1, `wp_...` (for users who are also members of the main site): where the same
  user has both `wp_x` and `wp_3_x`, the `wp_x` row must go before the rename, or the user ends up with two
  `wp_capabilities` rows;
- keys of other sites, `wp_5_...` and so on: delete.

Back up: `wp --path="$NEW" db export "$BK/target-before-usermeta.sql"`.

Preview (read-only):

```sql
-- keys of the moving site, to be renamed
SELECT meta_key, COUNT(*) FROM wp_usermeta WHERE meta_key LIKE 'wp\_3\_%' GROUP BY meta_key;

-- blog_id 1 keys that collide with a key of the moving site for the same user
SELECT m1.meta_key, COUNT(*)
FROM wp_usermeta m1
JOIN wp_usermeta m3
  ON m3.user_id = m1.user_id
 AND m3.meta_key = CONCAT('wp_3_', SUBSTRING(m1.meta_key, CHAR_LENGTH('wp_') + 1))
WHERE m1.meta_key LIKE 'wp\_%' AND m1.meta_key NOT LIKE 'wp\_3\_%'
GROUP BY m1.meta_key;

-- keys of other sites, to be deleted
SELECT meta_key, COUNT(*) FROM wp_usermeta
WHERE meta_key REGEXP '^wp_[0-9]+_' AND meta_key NOT LIKE 'wp\_3\_%'
GROUP BY meta_key;
```

Read the third list. A plugin key that happens to match `wp_<digits>_` would be deleted by the last statement below;
exclude it by name if you see one.

Apply, in this order (for example saved as `usermeta.sql` and run with `wp --path="$NEW" db query < usermeta.sql`):

```sql
DELETE m1
FROM wp_usermeta m1
JOIN wp_usermeta m3
  ON m3.user_id = m1.user_id
 AND m3.meta_key = CONCAT('wp_3_', SUBSTRING(m1.meta_key, CHAR_LENGTH('wp_') + 1))
WHERE m1.meta_key LIKE 'wp\_%' AND m1.meta_key NOT LIKE 'wp\_3\_%';

UPDATE wp_usermeta
SET meta_key = CONCAT('wp_', SUBSTRING(meta_key, CHAR_LENGTH('wp_3_') + 1))
WHERE meta_key LIKE 'wp\_3\_%';

DELETE FROM wp_usermeta WHERE meta_key REGEXP '^wp_[0-9]+_';
```

- The rename uses `SUBSTRING` on the start of the key instead of `REPLACE()`, which would also change a later
  occurrence of the text inside the key. The handbook's prefix-change example uses `REPLACE()`
  ([Altering Table Prefixes](https://developer.wordpress.org/advanced-administration/upgrade/migrating/#altering-table-prefixes)).
- `_` is a wildcard in `LIKE`; `\_` matches a literal underscore
  ([MySQL LIKE](https://dev.mysql.com/doc/refman/8.4/en/string-comparison-functions.html#operator_like),
  [MariaDB LIKE](https://mariadb.com/docs/server/reference/sql-functions/string-functions/like)). In `REGEXP`, `_`
  has no special meaning and matches itself; `^` anchors the start and `+` means one or more
  ([MariaDB regular expressions](https://mariadb.com/docs/server/reference/sql-functions/string-functions/regular-expressions-functions/regular-expressions-overview)).
- Optional clean-up: `primary_blog` and `source_domain` are keys that multisite sets when it adds a user to a site
  ([`add_user_to_blog()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php#L196))
  and can go. Blog_id 1 keys without a counterpart on the moving site (for example
  `wp_dashboard_quick_press_last_post_id`) are stale screen settings from the main site; they are harmless.

Verify:

```bash
wp --path="$NEW" user list --fields=ID,user_login,roles           # same members, same roles as on the network
wp --path="$NEW" user list --role=administrator --field=user_login # at least one owner
wp --path="$NEW" user list --role=none --format=count               # 0: every user has a role
wp --path="$NEW" db query "SELECT meta_key, COUNT(*) FROM wp_usermeta WHERE meta_key REGEXP '^wp_[0-9]+_' GROUP BY meta_key"
wp --path="$NEW" db query "SELECT user_id, COUNT(*) FROM wp_usermeta WHERE meta_key = 'wp_capabilities' GROUP BY user_id HAVING COUNT(*) > 1"
```

The last two queries return no rows. Password hashes came over in `wp_users` unchanged, so existing passwords keep
working on a WordPress version at least as new as the network's (see "Password hashes" below). The new install has
new keys and salts in `wp-config.php`, which invalidates existing login cookies, so everyone logs in again
([`wp-config-sample.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/wp-config-sample.php#L46)).

Main site (blog_id 1) with target prefix `wp_`: skip the collision delete and the rename; run only the last
DELETE.

## Direction B: accounts on the network

The standalone site's user IDs start at 1, like the network's, so its `wp_users` rows cannot be copied across.
Accounts are matched or created on the network, and the content in the staging copy is renumbered to the network
IDs.

### 1. Compare (read-only)

```bash
bash scripts/user-conflicts.sh --standalone-path=/srv/shop --network-path=/srv/network
```

It sorts the standalone users into four groups:

- same email on the network: reuse that network account;
- login taken on the network by another email: decide with the owner (rename one, or treat them as the same person);
- login that multisite would refuse: pick a new login;
- new: create the account.

Multisite applies its signup rules when an account is created through WP-CLI: `wp user create` and
`wp user import-csv` call `wpmu_validate_user_signup()`
([User_Command.php](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/User_Command.php#L436)). Those rules
allow only lowercase letters and digits, at least four characters, at most 60, not only digits, and no name in the
network's `illegal_names` list; the email must be valid, not banned, and inside `limited_email_domains` when that
list is set ([`wpmu_validate_user_signup()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php#L469)).
Users can sign in with their email address as well as their login, which WordPress supports since 4.5
([`wp_authenticate_email_password()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/user.php#L242)),
so a changed login is a small change for them. Tell them anyway.

### 2. WRITE: create or map accounts

The network backup from step 2 of the import runbook covers these writes. The new site exists and is archived
(import runbook, step 4); `FINAL` is its address.

```bash
wp --path=/srv/network user get person@example.net --field=ID               # read-only: existing account?
wp --path=/srv/network --url="$FINAL" user create newlogin person@example.net --role=subscriber --display_name="Display Name" --porcelain
```

- `--porcelain` prints only the new ID. The new-account email goes out only with `--send-email`
  ([User_Command.php](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/User_Command.php#L463)).
- `--role=subscriber` makes the account a member of the new site now; the real role is set after the import
  (import runbook, step 8), when the site's own role definitions, including custom roles, are in place.
  `wp user create` refuses a role that the site does not define
  ([User_Command.php](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/User_Command.php#L1304)).
- Record every pair in a file, one line per user: `old_id,new_id`. Existing network accounts go in the same file.

### Password hashes

New accounts get a random password. To keep a user's existing password, copy the hash from the standalone site to
the new account (WRITE on the network, one row per user, covered by the network backup):

```bash
wp --path=/srv/shop user get 5 --field=user_pass              # read the hash; never put it into a report
wp --path=/srv/network db query <<'SQL'
UPDATE wp_users SET user_pass = '<hash>' WHERE ID = 58;
SQL
```

Hashes contain `$` (`$P$...`, `$wp$2y$...`). Inside a double-quoted shell string the shell would expand those parts
and store a broken hash, hence the quoted heredoc. Check afterwards that the user can log in.

Only do this when the network runs a WordPress version that can check that hash format. WordPress 6.8 and later
store bcrypt hashes with the prefix `$wp$2y$`; older versions used phpass (`$P$`). Hashes saved before 6.8 keep
working after it
([WordPress 6.8 will use bcrypt](https://make.wordpress.org/core/2025/02/17/wordpress-6-8-will-use-bcrypt-for-password-hashing/)).
Otherwise ask users to reset their passwords. Do not copy hashes onto existing network accounts: those people
already have a network password.

### 3. WRITE, staging copy: renumber authors and user references

Back up the staging database first: `wp --path=/srv/shop-stage db export "$BK/stage-before-remap.sql"`. This runs
before the staging tables are renamed, so they still carry the standalone prefix (`wp_` here). Save the block as
`remap.sql`, run the two previews first, then the whole file with `wp --path=/srv/shop-stage db query < remap.sql`.

```sql
CREATE TABLE migration_user_map (old_id BIGINT UNSIGNED PRIMARY KEY, new_id BIGINT UNSIGNED NOT NULL);
INSERT INTO migration_user_map (old_id, new_id) VALUES (1, 12), (2, 57), (5, 58);

-- preview: authors without a mapping (must return 0)
SELECT COUNT(*) FROM wp_posts p
LEFT JOIN migration_user_map m ON m.old_id = p.post_author
WHERE p.post_author <> 0 AND m.old_id IS NULL;

-- preview: what changes
SELECT p.post_author, m.new_id, COUNT(*) FROM wp_posts p
JOIN migration_user_map m ON m.old_id = p.post_author GROUP BY p.post_author, m.new_id;

UPDATE wp_posts p JOIN migration_user_map m ON m.old_id = p.post_author SET p.post_author = m.new_id;
UPDATE wp_comments c JOIN migration_user_map m ON m.old_id = c.user_id SET c.user_id = m.new_id;
UPDATE wp_links l JOIN migration_user_map m ON m.old_id = l.link_owner SET l.link_owner = m.new_id;
UPDATE wp_postmeta pm JOIN migration_user_map m ON pm.meta_key = '_edit_last' AND pm.meta_value = m.old_id SET pm.meta_value = m.new_id;
```

- A multiple-table `UPDATE` updates each matching row once, even when the old and new ID ranges overlap, so ID 5
  cannot be moved twice
  ([MySQL UPDATE](https://dev.mysql.com/doc/refman/8.4/en/update.html)).
- `_edit_last` stores the ID of the last editor
  ([`wp-admin/includes/post.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/post.php#L461)).
- Plugin tables and options can hold user IDs too (orders, memberships, form entries). List candidate columns and
  handle each one as its plugin documents:
  ```sql
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND (column_name LIKE '%user%' OR column_name LIKE '%author%' OR column_name LIKE '%customer%' OR column_name LIKE '%owner%')
  ORDER BY table_name, column_name;
  ```
- `migration_user_map` has no `wp_` prefix, so it is not renamed or exported with the site tables. Drop it after the
  export.

Verify: the "authors without a mapping" query returns 0 again, and
`SELECT post_author, COUNT(*) FROM wp_posts GROUP BY post_author` shows only network IDs from the mapping file.

### 4. After the import: roles

```bash
wp --path=/srv/network --url="$FINAL" role list --fields=role              # the standalone site's roles are here now
wp --path=/srv/network --url="$FINAL" user set-role 58 editor               # WRITE, one per mapped user
wp --path=/srv/network --url="$FINAL" user list --fields=ID,user_login,roles
```

On multisite `wp user set-role` calls `add_user_to_blog()`, so it also makes an existing network account a member of
the site ([User_Command.php](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/User_Command.php#L719)).
Per-site screen settings of the standalone site (`wp_user-settings` and similar) are not carried over; users get
default screen settings.

## What not to do

- Do not copy standalone `wp_users` rows into the network table: the IDs collide with existing accounts.
- Do not run `wp user delete --network` to undo a mapping: it deletes that user's posts on every site they belong
  to ([`wpmu_delete_user()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/ms.php#L145)).
- Do not use `wp user delete <id> --url=<site>` to take someone off one site: without `--reassign` it deletes
  their posts on that site first
  ([`wp_delete_user()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/user.php#L388)).
  `wp user remove-role <id> --url=<site>` with no role name calls `remove_user_from_blog()` and keeps the posts
  ([User_Command.php](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/User_Command.php#L811)).
- Do not assign roles before the site exists: creating a site deletes every existing capability key for its prefix
  ([`wp_initialize_site()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-site.php#L749)).
