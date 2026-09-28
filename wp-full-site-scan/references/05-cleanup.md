# Phase 5: clean the copies

Goal: a clean file set and a clean database dump, both verified, and a written list of every change. Work on the copies
in `WORK/`, never on the live site. In SQL, `{prefix}` stands for the table prefix from `wp-config.php` (for example
`Ab3_`); keep its letter case exactly as the site uses it (`traps.md`).

## The rule that decides the order

WordPress malware often lives on both sides and repairs itself. A payload stored in the database rebuilds deleted
files, and a file rewrites the database rows it needs. Cleaning one side and restoring it puts the infection straight
back. In investigations, a loader kept a second, complete copy of itself in options whose names were random hex
strings, outside the prefix the rest of its rows used; deleting only the prefixed rows left a working rebuild kit
(`known-malware-patterns.md`, family A).

So:

1. Clean both sides in the working copies.
2. Restore both at the same time (`06-restore.md`).
3. Never restore cleaned files over a database you have not cleaned, or a cleaned database under infected files.

If the owner insists on cleaning a live site in place instead of restoring copies, remove the database payload first,
then the files, in one session with the site in maintenance or offline. Otherwise the files you are deleting rewrite
the rows behind you, or the rows rebuild the files.

## 1. Quarantine, do not delete

Move every file you remove into `WORK/quarantine/`, with its original path preserved beneath it:

```sh
mkdir -p WORK/quarantine/wp-content/mu-plugins
mv WORK/clean/site/wp-content/mu-plugins/loader.php WORK/quarantine/wp-content/mu-plugins/
```

Keep a list of what moved where, with the size and SHA-256 of each file. The quarantine is evidence for the report,
the indicator list for other sites, and the way back if a "malicious" file turns out to be something the site needed.
Keep it outside every folder you will upload, and out of the web root on any server.

## 2. Remove wholly malicious files

Everything confirmed in `02-file-scan.md`:

- dropper plugins and fake plugins (a real-looking header over obfuscated code);
- must-use plugins nobody installed (`wp-content/mu-plugins/*.php` load on every request and cannot be turned off
  from the dashboard: [must-use plugins](https://developer.wordpress.org/advanced-administration/plugins/mu-plugins/));
- malicious drop-ins (`advanced-cache.php`, `db.php`, `object-cache.php` and the rest of the list in
  [`_get_dropins()`](https://developer.wordpress.org/reference/functions/_get_dropins/)) when no installed plugin
  owns them;
- web shells, mailers and phishing kits, including whole folders that WordPress does not manage;
- payload folders (often hidden, such as a dot folder with a random suffix), staged archives, spare copies with
  extensions such as `.off`, `.bak` or `.suspected`, and data files the malware wrote;
- PHP, or files holding a PHP open tag, anywhere under `wp-content/uploads`.

If the malware kept a manifest of its own files (family A did, in an option), use it as a checklist, and then search
anyway: a manifest lists what the malware wanted to protect, not everything the attacker left.

## 3. Strip injected code from files that are otherwise legitimate

Some files are the site's own code with malware wrapped around it. Deleting them breaks the site; only the injected
block comes out. Typical shapes:

- a block between begin and end comment markers inside a theme's `functions.php`;
- malware prepended to a legitimate cache drop-in, with the plugin's original code below it;
- one or two lines added to `wp-config.php` (an `include`, an `@ini_set`, a `define( 'WP_CACHE', true )` with its
  own marker comment so the malicious `advanced-cache.php` loads: `wp-settings.php` includes that file only when
  `WP_CACHE` is true, [wp-settings.php](https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-settings.php));
- lines added to `.htaccess`, `.user.ini` or `php.ini` (`auto_prepend_file`, rewrite rules keyed on the user agent or
  referrer). Read every copy in every folder, not only the one at the root: the WordPress hacked-site FAQ calls
  `.htaccess` one of the most commonly abused files and notes it can sit in several directories
  ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).

Method:

1. Find the exact first and last line of the injected block.
2. Write the file out without those lines, to the copy in `WORK/clean/`.
3. Check the syntax: `php -l file.php`. It parses without running the code, so it is safe on suspect files
   ([PHP command line options](https://www.php.net/manual/en/features.commandline.options.php)). It does not catch
   errors that only appear when the code runs.
4. Compare the result with a known-good reference: the official release, a clean backup, or the malware's own copy of
   the file from before it was injected (family A kept one).
5. Search the whole tree again for the markers to be sure no second copy remains.

Seen in investigations: a child theme's `functions.php` had grown to many times its normal size. After the lines
between the malware's markers were cut, it matched the clean copy byte for byte. A byte-for-byte match is the result
to aim for; "the site loads" is not.

## 4. Replace rather than repair, wherever you can

For anything with an official release, do not hand-clean it. Put a fresh copy of the same version in its place:

- WordPress core: move `wp-admin/` and `wp-includes/` to quarantine as whole folders, then copy them, and the root
  files, from the official package of the same version (`https://wordpress.org/wordpress-<version>.zip`, with `.md5`
  and `.sha1` files beside it, [releases](https://wordpress.org/download/releases/)). The WordPress FAQ says these two
  folders can be replaced safely, and warns that reinstalling from the dashboard often only overwrites existing files
  while hacks add new ones ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).
  Keep `wp-config.php` and `wp-content/` from the cleaned copy.
- wordpress.org plugins and themes: move the folder to quarantine, then unzip the official package of the same version
  from `downloads.wordpress.org` in its place.
- Premium plugins and themes: download them from the vendor with the owner's license. Never from a mirror or a
  "free download" site: that is how nulled software arrives (`known-malware-patterns.md`, family I).

Do all of this with file operations and SQL. Do not run WP-CLI inside the copy (`01-workspace.md`): WP-CLI loads
WordPress, so it runs `wp-config.php`, the must-use plugins and the drop-ins, even with `--skip-plugins`
([global parameters](https://make.wordpress.org/cli/handbook/references/config/)). The WP-CLI commands named in this
file are for the case where the owner cleans a live site in place, after its files are clean.

Then run the checksum helpers again (`scripts/verify-core-checksums.mjs`, `scripts/verify-plugin-checksums.mjs`).
Replacing is faster and safer than editing, and it gives a yes or no answer afterwards.

Delete plugins and themes nobody uses. Inactive code is still on disk, and its files can still be requested directly.

## 5. Clean the database

Work on the throwaway copy. Order matters: the payload first, then the things that point to it.

1. Payload options. Both the prefixed family (for example names starting `sc_`) and the options named as bare hex
   strings. Removing one set and not the other leaves a rebuild kit. Read each row before deleting it: plugins also
   store hashed names, so a hex name is a lead to confirm, not proof.
2. Malicious cron hooks. On the copy, delete the whole `cron` option row: WP-Cron runs scheduled events on page loads
   ([WP-Cron](https://developer.wordpress.org/plugins/cron/)), and core and well-written plugins schedule their events
   again when they find them missing (core checks `wp_next_scheduled()` before scheduling,
   [wp_schedule_update_checks()](https://developer.wordpress.org/reference/functions/wp_schedule_update_checks/)).
   After the restore, check that the events the site needs came back (`wp cron event list`), and tell the owner which
   plugins to watch. On a live site cleaned in place, `wp cron event delete <hook>` removes single hooks and keeps the
   serialized option valid ([wp cron event delete](https://developer.wordpress.org/cli/commands/cron/event/delete/)).
   Never hand-edit the serialized value.
3. Backdoor users. Delete the account, not only its password. On the copy, reassign any posts the account owns
   (`UPDATE {prefix}posts SET post_author=<owner-id> WHERE post_author=<id>`), then delete its `users` row and every
   `usermeta` row with that `user_id`. On a live site, `wp user delete <id> --reassign=<owner-id>`
   ([wp user delete](https://developer.wordpress.org/cli/commands/user/delete/)): without a reassign, WordPress deletes
   every post the user owns, and it deletes the user's meta rows either way
   ([wp_delete_user()](https://developer.wordpress.org/reference/functions/wp_delete_user/)). On multisite, the users
   table is shared by the whole network ([Multisite](https://developer.wordpress.org/advanced-administration/multisite/)),
   and super admins are listed in the `site_admins` network option
   ([get_super_admins()](https://developer.wordpress.org/reference/functions/get_super_admins/)).
4. Malicious entries in `active_plugins` (and `active_sitewide_plugins` on multisite,
   [wp_get_active_network_plugins()](https://developer.wordpress.org/reference/functions/wp_get_active_network_plugins/)).
   Unserialize the value in a short script (with `allowed_classes` set to false), remove the entry, serialize it again
   and write it back. Never string-replace inside a serialized value (`traps.md`).
5. Injected content in posts, postmeta, widgets, page-builder data, theme options, header and footer injection
   settings, snippet plugins and redirect plugins. For snippet plugins, clean the execution cache as well as the
   visible snippet; the cache is what runs. Delete whole rows where the row is malicious; edit inside a value only
   when it is not serialized or JSON, or through code that decodes and encodes it. For URL changes across many rows
   on the restored site, `wp search-replace` handles serialized data and has `--dry-run` and `--export`
   ([wp search-replace](https://developer.wordpress.org/cli/commands/search-replace/)).
6. Roles and capabilities. Restore any role that gained capabilities it should not have (the `{prefix}user_roles`
   option, [WP_Roles::for_site()](https://developer.wordpress.org/reference/classes/wp_roles/for_site/)), and set
   `users_can_register` and `default_role` to what the owner wants (`default_role` should never be `administrator`).
7. Forged and stolen sessions. Delete every `session_tokens` usermeta row
   ([WP_User_Meta_Session_Tokens](https://developer.wordpress.org/reference/classes/wp_user_meta_session_tokens/)).
   Everyone signs in again, which is the point.
8. Application passwords nobody recognizes. They are separate credentials, stored in user meta under
   `_application_passwords` ([WP_Application_Passwords](https://developer.wordpress.org/reference/classes/wp_application_passwords/)),
   and they work for the REST API and XML-RPC
   ([integration guide](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)).
   On the copy, delete those meta rows; on a live site, `wp user application-password delete <user> --all`
   ([wp user application-password delete](https://developer.wordpress.org/cli/commands/user/application-password/delete/)).
9. WooCommerce keys and webhooks. List them for the restore step, then review them on the restored site: REST API
   keys under WooCommerce > Settings > Advanced > REST API, which has a "Revoke Key" link
   ([REST API](https://woocommerce.com/document/woocommerce-rest-api/)), and webhooks under WooCommerce > Settings >
   Advanced > Webhooks, whose delivery URL receives order and customer data
   ([Webhooks](https://woocommerce.com/document/webhooks/)). Remove any key or webhook the owner does not recognize.
10. Transients, so cached malicious output is discarded: on the copy, delete the `_transient_%` and
    `_site_transient_%` option rows; on a live site, `wp transient delete --all`
    ([wp transient delete](https://developer.wordpress.org/cli/commands/transient/delete/)).

Verify with counts, not impressions. With the malware's own prefix and names in place of the examples:

```sql
SELECT COUNT(*) FROM {prefix}options WHERE LEFT(option_name,3)='sc_';
SELECT COUNT(*) FROM {prefix}options WHERE option_name REGEXP '^[0-9a-fA-F]{6,32}$';
SELECT COUNT(*) FROM {prefix}usermeta WHERE meta_key='session_tokens';
SELECT COUNT(*) FROM {prefix}usermeta WHERE meta_key='_application_passwords';
SELECT u.user_login, u.user_email FROM {prefix}users u JOIN {prefix}usermeta m ON m.user_id=u.ID
  AND m.meta_key='{prefix}capabilities' WHERE m.meta_value LIKE '%administrator%';
```

Every count should be zero, except hex-named rows confirmed legitimate and application passwords the owner
recognizes, each listed in the report. The
administrator list should hold only people the owner names. Then run `scripts/database-hunt.sql` and
`scripts/database-deep-checks.php` again, and expect only rows you have already explained.

## 6. Purge caches in the copy

Empty `wp-content/cache/`, any page-cache folder, and minified asset caches. Cached HTML can keep serving the injected
script long after its source is gone. The host's cache and the CDN are purged at restore time (`06-restore.md`).

## 7. Rotate the secrets

- New authentication keys and salts in `wp-config.php`. The WordPress generator is at
  `https://api.wordpress.org/secret-key/1.1/salt/`, and changing the keys invalidates all existing cookies, so every
  user signs in again ([security keys](https://developer.wordpress.org/apis/wp-config-php/#security-keys)); that
  includes any forged cookie. On the copy, paste a fresh set into `wp-config.php`; on a live server,
  `wp config shuffle-salts` refreshes them in place
  ([wp config shuffle-salts](https://developer.wordpress.org/cli/commands/config/shuffle-salts/)). Use different
  salts on every site: shared salts mean one leaked `wp-config.php` exposes them all.
- New database password, set on the server and in `wp-config.php`.
- New passwords for every administrator, and for hosting, control panel, SFTP, SSH and the database. The WordPress
  FAQ says to change them again after the site is confirmed clean, not only when the hack is found
  ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).
- Third-party tokens found in the database or `wp-config.php`: payment gateways, mail services, CRM and marketing
  integrations, cloud storage for backups. Revoke and reissue them at the provider.

Order matters here. If you restore an older dump after changing passwords, the old hashes come back. Change WordPress
passwords after the restore, or make the change inside the dump before it is restored.

## 8. Export the cleaned database

Export from the throwaway server, then prepare it for the target server with `scripts/fix-export.mjs`, which writes a
corrected copy to a new file and never changes its input. A wrong collation or lowercased table names break the
restore (`06-restore.md`, `traps.md`).

## 9. Final verification pass

Before calling the copy clean:

- Core, plugin and theme checksums: zero modified files, zero unexpected added files.
- `scripts/scan-php.mjs` and `scripts/scan-js.mjs` again: every hit either explained or gone.
- `bash scripts/verify-clean.sh --prefix=<prefix> WORK/clean/site "<marker>" ...` with every marker found in the case:
  no matches, no executable files in uploads. Run the SQL it prints: all counts zero.
- The administrator list: only people the owner names.
- `wp-config.php`, every `.htaccess`, `.user.ini` and `php.ini` read line by line.
- The quarantine folder is outside the set you are about to upload.

## Output of this phase

- `WORK/clean/` with the cleaned file set and the cleaned, target-ready database dump.
- `WORK/quarantine/` with every removed file, paths preserved, and its list with sizes and hashes.
- A written change list (files removed, files cleaned with before and after sizes, rows removed by type, accounts
  removed, cron hooks removed, secrets rotated and secrets still to rotate) for the report.

Go to `06-restore.md`.
