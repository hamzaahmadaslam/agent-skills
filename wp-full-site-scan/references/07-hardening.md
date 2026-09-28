# Phase 7: close the way in

Cleaning removes the malware. This phase removes the reason it worked. Work from the top: the list is ordered by how
much each step prevents. Start with whatever `04-timeline-entry-point.md` named as the way in, even if it sits lower
in this list, because an open entry point means the site will be reinfected.

Products named below are examples to make a step concrete, not endorsements. Choose tools the owner can maintain, and
check that a plugin is still maintained on wordpress.org before recommending it.

Changes to the live site follow the same rule as `06-restore.md`: state the step, its check and its rollback, and wait
for the owner's approval.

## 1. Credentials and accounts (do this first)

Turn on two-factor authentication for every administrator, and for editors and shop managers. In investigations, most
cases started with a working password or a stolen session, so this is the change with the most value. Examples: the
[Two Factor](https://wordpress.org/plugins/two-factor/) plugin maintained by WordPress contributors, or
[WP 2FA](https://wordpress.org/plugins/wp-2fa/), which can require 2FA per role; security plugins often include a
2FA module. The WordPress FAQ recommends two-factor or multi-factor authentication after a hack
([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).

Audit the administrator list. Sites collect administrators: former staff, agencies, one-off contractors, personal
webmail addresses. For each account, ask whether that person needs administrator access today, and downgrade or
remove the rest. Seen in investigations: sites with far more administrators than people who needed them, spread
across several organizations, and 2FA on none of them. WooCommerce gives the same advice for stores: remove users who
do not belong and require 2FA for administrators
([WooCommerce security](https://woocommerce.com/posts/woocommerce-security/)).

One account per person. Shared agency logins mean nobody can tell who did what, and one leaked password gives
everyone's access away.

Use long, unique passwords everywhere, kept in a password manager: WordPress, hosting, control panel, SFTP, SSH,
database, the domain registrar and the DNS provider. The WordPress FAQ extends this to every access point and every user
with access ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).

Remove standing access nobody uses: application passwords, which work for the REST API and XML-RPC but not for
`wp-login.php` ([integration guide](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)),
WooCommerce REST API keys and webhooks ([REST API](https://woocommerce.com/document/woocommerce-rest-api/),
[Webhooks](https://woocommerce.com/document/webhooks/)), old API keys in integrations, support accounts created
months ago. If the site never uses application passwords, they can be switched off with the
`wp_is_application_passwords_available` filter
([integration guide](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)).

Unique salts per site. Identical keys in several `wp-config.php` files mean one leaked file exposes them all
([security keys](https://developer.wordpress.org/apis/wp-config-php/#security-keys)).

## 2. Close the login door

- Rate-limit or challenge the login endpoints at the CDN or web application firewall where possible, so the
  requests never reach WordPress: `/wp-login.php` and `/xmlrpc.php`. Cloudflare's rate limiting rules are one example
  ([rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)); check which plan includes
  them. A security plugin's lockout after repeated failures is the fallback.
- Remove alternative login files. A renamed copy of `wp-login.php` serves the same login and registration forms at
  another address and bypasses every protection keyed to the real filename. Seen in investigations as the route for
  mass spam registrations (`known-malware-patterns.md`, family B).
- XML-RPC: if nothing uses it, block `/xmlrpc.php` at the server or CDN. The `xmlrpc_enabled` filter is not
  enough on its own: it only turns off methods that need authentication, not pingbacks or other unauthenticated
  methods ([xmlrpc_enabled](https://developer.wordpress.org/reference/hooks/xmlrpc_enabled/)).
- Make usernames harder to collect. Attackers read usernames and then guess passwords against real names. A
  numeric `/?author=N` request redirects to that user's author archive when the user has published posts
  ([redirect_canonical()](https://developer.wordpress.org/reference/functions/redirect_canonical/)), and
  `/wp-json/wp/v2/users` lists, to logged-out visitors, users who have published posts
  ([users controller](https://developer.wordpress.org/reference/classes/wp_rest_users_controller/get_items/)). Block
  the `author` query for logged-out visitors, and restrict the users endpoint if the site does not need it public. Do
  not rely on this alone: 2FA and rate limiting do the real work.
- Turn off open registration unless the site needs it: Settings > General > Membership, "Anyone can register"
  ([General Settings](https://wordpress.org/documentation/article/settings-general-screen/)). If it must stay on,
  add a challenge to the form, keep "New User Default Role" at Subscriber (the setting offers every role, Administrator
  included), and watch the registration rate.

## 3. Reduce what can be attacked

- Update everything: WordPress, plugins, themes, and PHP. Test on staging first when the site is complex.
- Delete what is unused. Inactive plugins and themes still ship files that can be requested directly. Delete
  rather than deactivate.
- Replace abandoned plugins: anything unmaintained, or closed on wordpress.org. `wp plugin list` can print the
  `wporg_status` and `wporg_last_updated` fields ([wp plugin list](https://developer.wordpress.org/cli/commands/plugin/list/)).
- Never use nulled (pirated) plugins or themes. They are a standard malware delivery route
  (`known-malware-patterns.md`, nulled software). Replace any found with a licensed copy from the vendor.
- Watch vulnerability disclosures for what the site runs. Public databases, as examples:
  [Patchstack](https://patchstack.com/database/), [WPScan](https://wpscan.com/wordpress-security-scanner/) and
  Wordfence Intelligence; many security plugins include a feed.

## 4. Make the filesystem hostile to malware

In `wp-config.php`:

```php
define( 'DISALLOW_FILE_EDIT', true );   // no plugin or theme file editor in the dashboard
define( 'DISALLOW_FILE_MODS', true );   // no installs or updates from the dashboard (strict)
```

`DISALLOW_FILE_EDIT` removes the dashboard editor, which the WordPress hardening guide recommends because it stops an
attacker with an administrator account from editing code there
([hardening](https://developer.wordpress.org/advanced-administration/security/hardening/)).
`DISALLOW_FILE_MODS` also blocks plugin and theme installs and updates from the admin area
([wp-config.php](https://developer.wordpress.org/apis/wp-config-php/)), so use it only where updates arrive by
deployment or through the host.

Block PHP execution in uploads. Uploaded files should never run. OWASP describes how an uploaded web shell can run
commands and browse files, and lists `.phtml`, `.php5` and double extensions such as `file.php.jpg` among the ways
around a simple filter ([file upload cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html),
[unrestricted file upload](https://community.owasp.org/vulnerabilities/Unrestricted_File_Upload)).

On Apache, in `wp-content/uploads/.htaccess`:

```apache
<FilesMatch "[.]ph(p[0-9]?|tml|ar|t|ps)$">
  Require all denied
</FilesMatch>
```

`Require all denied` refuses access unconditionally, and in an `.htaccess` file it needs `AllowOverride AuthConfig`
(or `All`) for that directory ([mod_authz_core](https://httpd.apache.org/docs/2.4/mod/mod_authz_core.html)). With
`AllowOverride None`, the default since Apache 2.3.9, `.htaccess` files are ignored completely
([core](https://httpd.apache.org/docs/2.4/mod/core.html)). Where you can edit the server configuration, put the same
rule in a `<Directory>` block for the uploads folder instead: an attacker who can upload files cannot replace it,
which OWASP warns about for `.htaccess` ([unrestricted file upload](https://community.owasp.org/vulnerabilities/Unrestricted_File_Upload)).
Test it: request a harmless `test.php` placed in uploads and expect a 403.

On nginx there is no `.htaccess`; everything is server configuration
([nginx](https://developer.wordpress.org/advanced-administration/server/web-server/nginx/)). The WordPress nginx page
gives this rule for uploads, including multisite `files` paths:

```nginx
location ~* /(?:uploads|files)/.*\.php$ {
    deny all;
}
```

Place it above the block that passes `.php` to PHP-FPM: nginx checks regular-expression locations in the order they
appear and uses the first match ([location](https://nginx.org/en/docs/http/ngx_http_core_module.html#location)).

Permissions: the WordPress hardening guide gives directories `755` and files `644`, `wp-admin/` and
`wp-includes/` writable only by the owner's account, and `wp-config.php` readable only by the owner and the web
server, generally `400` or `440`
([hardening](https://developer.wordpress.org/advanced-administration/security/hardening/)). Nothing should be `777`.
The web server's user should not own more than it needs to write.

Watch the code that runs on every request. Drop-ins (`advanced-cache.php`, `db.php`, `object-cache.php` and the
others in [`_get_dropins()`](https://developer.wordpress.org/reference/functions/_get_dropins/)) and must-use plugins
([must-use plugins](https://developer.wordpress.org/advanced-administration/plugins/mu-plugins/)) load before normal
plugins and cannot be switched off from the dashboard. Know which plugin installed each drop-in, and treat any new
file in `mu-plugins` or any new drop-in as an alert.

## 5. Backups that help

- Automatic, daily, and off-site: not on the same hosting account, and not reachable with the site's own
  credentials.
- Keep at least 30 days. Infections are often found weeks after they start, and with a one-week window every
  backup is already infected.
- Test a restore, on a throwaway server, at least once a quarter. An untested backup is a guess.
- Move backup archives out of the web root. Backup plugin folders inside `wp-content` can be downloadable, and they
  hold the whole database.

## 6. Monitoring, so the next one is caught in days

- File integrity monitoring: alerts when core, plugin or theme files change, and on new files in `mu-plugins`,
  drop-ins and uploads. Many security plugins include it.
- An activity log. In investigations it was often the only record of who signed in, who installed what, and
  from which address. Examples: [WP Activity Log](https://wordpress.org/plugins/wp-security-audit-log/),
  [Simple History](https://wordpress.org/plugins/simple-history/). Install it before you need it, and keep its data
  longer than the plugin's default if the default is short.
- Alerts on new administrators and on plugin installs.
- Uptime and content monitoring from outside, including a check that fetches the homepage with a mobile user
  agent and a search-engine referrer, since that is what cloaked redirects target.
- Search Console verified for the domain, with email alerts on: Google reports security issues there first
  ([Security Issues report](https://support.google.com/webmasters/answer/9044101)).
- Review the logs monthly, not only after an incident.

## 7. The layer people forget: third-party scripts

A clean WordPress site can still redirect visitors, because scripts load from elsewhere.

- Tag manager containers inject whatever their tags hold into every page without touching WordPress. A Custom HTML
  tag can carry any HTML or JavaScript ([custom tags](https://support.google.com/tagmanager/answer/6107167)). Review
  who has Publish permission, which allows creating versions and publishing
  ([user permissions](https://support.google.com/tagmanager/answer/6107011)), read every Custom HTML tag, and check
  the container's version history ([publishing and versions](https://support.google.com/tagmanager/answer/6107163)).
  A site with several containers has several independent ways in.
- Checkout pages deserve their own list of allowed scripts. Skimmers have been planted as fake tag manager
  loaders beside a store's legitimate marketing tags
  ([Sansec, FunnelKit](https://sansec.io/research/funnelkit-woocommerce-vulnerability-exploited)).
- Analytics, chat, accessibility, testing tools and pixels: each is code you do not control. Keep the list short,
  and remove what is unused.
- Embeds on expired domains: A script embedded years ago keeps loading after its domain lapses and someone else
  registers it. Review the external hosts on the site's pages every few months (`scripts/external-hosts.mjs` on a
  copy, or the page source).

## 8. Hosting and account hygiene

- One site per hosting account where possible. Shared accounts let an infection walk from one site to the next;
  the WordPress FAQ warns that a hack on shared hosting may affect more than one site
  ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)). Seen in
  investigations: sites that shared a hosting account or an agency login were compromised in the same session.
- A web application firewall in front of the site (the CDN's or the host's), with its WordPress rules on.
- SFTP or SSH, never plain FTP:
- Remove stale staging and old copies (`/old/`, `/backup/`, `/staging/`) from the server, and keep any staging
  site out of search engines and behind a password.
- Ask the host how long they keep access logs, and how to get them. The next investigation depends on them.
- Scan the computers that hold the credentials. The WordPress FAQ notes that many infections start with a trojan
  on the owner's own machine stealing FTP or admin logins
  ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).

## 9. Email

If the site sends mail, or was used to send spam:

- Publish SPF, DKIM and DMARC records for the sending domain. Gmail requires SPF or DKIM from all senders, and SPF,
  DKIM and DMARC from bulk senders ([sender guidelines](https://support.google.com/a/answer/81126)).
- Send transactional mail through an authenticated mail provider rather than the web server's own `mail()`.
- Check the domain and the server IP against the mail blocklists after any spam incident. The WordPress FAQ warns that
  sites abused for spam get their server IPs blocklisted, which affects mail from the same server
  ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).
- Ask the host to turn on PHP's `mail.log` or `mail.add_x_header`, which record the script that called `mail()`
  ([mail configuration](https://www.php.net/manual/en/mail.configuration.php)), so the next abuse points to a file.

## 10. Write it down

- Who has access to what, reviewed every quarter.
- Where backups live and how to restore them.
- Who to call when something looks wrong.
- The incident report from this clean-up (`08-report-template.md`), so the next person starts from your timeline.

## Priority order, if there is no time for all of it

1. Close the entry point found in phase 4.
2. 2FA for every administrator; remove the administrators nobody needs.
3. Rotate salts, passwords, application passwords and API tokens.
4. Update everything; delete what is unused; replace nulled software.
5. Block PHP in uploads; `DISALLOW_FILE_EDIT`.
6. Rate-limit the login endpoints; turn off open registration.
7. An activity log and file integrity monitoring.
8. Off-site backups with a tested restore.
9. Audit tag manager containers and third-party scripts.

## Output of this phase

- The entry point closed, with how it was closed.
- A list of what was done, what the owner still has to do, and who owns each open item.

Go to `08-report-template.md`.
