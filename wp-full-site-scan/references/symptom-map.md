# Symptom map

Start here. Find the reported symptom, look first where the table points, and then run the full phases anyway: a
symptom tells you where the attacker made money, not everything they left. Family letters refer to
`known-malware-patterns.md`. Phase files are `00-intake.md` to `08-report-template.md`.

Nothing on this page needs a particular tool. Where a command is shown, it is one way to do the step; a person with a
file manager, a database tool and a browser can do the same.

## At a glance

| Symptom | Look first | Settled by |
| --- | --- | --- |
| Every visitor redirected | `siteurl` and `home` options, `WP_HOME` and `WP_SITEURL` in `wp-config.php`, `.htaccess`, `index.php`, DNS and CDN rules | `03-database-scan.md` core settings; `02-file-scan.md` configuration files; visitor tests below |
| Redirects on mobile only, or only from search, or only once | Snippet plugins and their execution cache, header and footer settings, theme JavaScript, page-builder HTML, conditional redirect rules, tag manager (family C) | `scripts/scan-js.mjs`; `scripts/database-hunt.sql`; visitor tests below |
| Japanese, pharma or gibberish pages in Google, not visible to you | `.htaccess` rewrites, `index.php` and theme templates, sitemaps, unknown Search Console owners (family E) | Googlebot test below; URL Inspection live test; `02-file-scan.md` |
| "This site may be hacked" in Google results | Search Console Security Issues report: it names the issue type and sample URLs | The report's type decides the row to follow in this table |
| "Deceptive site ahead" in the browser | Phishing kits and deceptive content, including third-party ads and embeds (family F) | Folders WordPress does not manage; Security Issues report |
| Administrators nobody created, or one that keeps coming back | The users table read directly, user-hiding hooks, code that creates users, roles with extra capabilities (family J) | `03-database-scan.md` users, roles and sessions; `scripts/scan-php.mjs` |
| A backdoor or web shell suspected, or the host reported one | PHP in uploads, PHP in odd places, recently added must-use plugins and drop-ins (family D) | `02-file-scan.md` executable code where it does not belong |
| Files clean, symptom still there | Options, posts, postmeta, widgets, snippet and redirect stores, cron | `03-database-scan.md`; outward checks below |
| Core files modified | Checksum mismatches and extra files in `wp-admin`, `wp-includes` and the root | `scripts/verify-core-checksums.mjs`; replace core (`05-cleanup.md`) |
| A premium plugin or theme of unknown origin | License checks patched out, extra files, outbound requests to non-vendor hosts (family I) | Compare with the vendor's copy; `scripts/external-hosts.mjs` |
| A plugin with a known vulnerability | Its version, its public disclosures, and requests to its endpoints in the access log | `scripts/list-plugin-versions.mjs`; `04-timeline-entry-point.md` |
| Card fraud reported by customers of a store | Scripts on checkout, plugin settings that accept scripts, the options table, SVG files (family H) | `scripts/scan-js.mjs`; `scripts/external-hosts.mjs`; test checkout |
| The site sends spam, or the mail IP is blocklisted | Standalone mailer scripts (family G), open registration (family B), contact form abuse | `scripts/scan-php.mjs`; registration settings; host mail logs |
| Malware comes back after cleaning | WP-Cron, server cron, must-use plugins, drop-ins, `auto_prepend_file`, payload options, other sites on the account | "Malware that keeps coming back" below |
| Host suspended the account | The host's report: the files it flagged and why | `00-intake.md`; every row above that the report matches |
| Several sites affected, multisite or shared hosting | Shared users table, network-activated plugins, sibling document roots under the same account | "Multisite and shared hosting" below; `04-timeline-entry-point.md` blast radius |

## Testing the site the way visitors see it

Cloaked code decides per request, so one browser visit proves nothing. Test from a network that is not the owner's
office (some malware skips whitelisted IPs, [Bitdefender, reporting Sucuri research](https://www.bitdefender.com/en-gb/blog/hotforsecurity/hidden-wordpress-backdoors-admin-accounts)),
logged out, with no cookies. `curl` is a third-party tool; run it with the owner's agreement, against the owner's own
site only. It never runs JavaScript, which makes it safe for this, and also means a JavaScript redirect shows up as
code in the HTML rather than as a redirect.

```sh
SITE=https://example.com/
DESKTOP='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
MOBILE='Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
GOOGLEBOT='Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

# Each profile: headers of every hop, the final URL, and the final page saved as text
curl -s -L --max-redirs 10 --compressed -A "$DESKTOP" -D desktop.headers -o desktop.html -w '%{url_effective}\n' "$SITE"
curl -s -L --max-redirs 10 --compressed -A "$MOBILE" -e 'https://www.google.com/' -D mobile-search.headers -o mobile-search.html -w '%{url_effective}\n' "$SITE"
curl -s -L --max-redirs 10 --compressed -A "$GOOGLEBOT" -D googlebot.headers -o googlebot.html -w '%{url_effective}\n' "$SITE"
```

`-A` sets the user agent, `-e` the referrer, `-L` follows redirects, `-D` writes the headers of every response, and
`-w '%{url_effective}'` prints where the chain ended ([curl manual](https://curl.se/docs/manpage.html)). The Googlebot
string is Google's published smartphone user agent with a current Chrome version filled in
([Google crawlers](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers)).

Then compare the three pages: `Location:` headers in each `.headers` file, `<script src=` hosts, `<a href=` hosts, the
`<title>`, and the page size. Repeat for an inner page and a URL that should return 404. Do not open the redirect
targets in a browser; record them as indicators. To check a lookalike or redirect domain, look up its registration
and mail records before calling it hostile: some turn out to be the owner's own marketing domains.

Cloaking code can also check the visitor's IP address against Google's, and Google verifies its crawlers by reverse
DNS and published IP ranges ([verifying Googlebot](https://developers.google.com/search/docs/crawling-indexing/verifying-googlebot)),
so a clean Googlebot curl result does not clear the site. The conclusive test is Search Console's URL Inspection live
test, which fetches from Google and shows the raw HTML
([URL Inspection tool](https://support.google.com/webmasters/answer/9012289)).

## Redirects

Every visitor, every time. The cause sits early in the request: the `siteurl` or `home` option,
`WP_HOME` or `WP_SITEURL` in `wp-config.php` (which override the settings screen,
[General Settings](https://wordpress.org/documentation/article/settings-general-screen/)), rewrite rules in any
`.htaccess`, an edited `index.php`, or a prepended file (below). Also check outside the server: the domain's DNS
records, the CDN's redirect and page rules, and the registrar account. Settled by `03-database-scan.md` (core
settings), `02-file-scan.md` (configuration and server files) and the desktop curl test.

Mobile only, from search only, or only once: family C. The code checks the user agent, `document.referrer`, a
cookie or the login state before redirecting, which Google's spam policies name as sneaky redirects
([spam policies](https://developers.google.com/search/docs/essentials/spam-policies)). Look in snippet plugins
(visible snippets and the execution cache), header and footer injection settings, page-builder HTML, theme custom
JavaScript fields, conditional redirect-plugin rules, `.htaccess` conditions on `HTTP_USER_AGENT` or
`HTTP_REFERER`, and tag manager containers. Settled by `scripts/scan-js.mjs` (its `referrer_gate`, `mobile_gate`
and `cookie_gate` patterns), `scripts/database-hunt.sql`, and the mobile curl test with a search referrer.

## Spam shown to Google only (Japanese keyword, pharma, gibberish pages)

Family E. The owner sees a normal site; Google indexes spam pages or spam titles. Google's guides for these hacks say
to use a `site:` search to see what is indexed, to check Search Console for owners you do not know, and to use the
URL Inspection tool because cloaking hides the pages from you
([Japanese keyword hack](https://web.dev/articles/fix-the-japanese-keyword-hack),
[cloaked keywords hack](https://web.dev/articles/fix-the-cloaked-keywords-hack)).

Look first at: every `.htaccess` (rewrite rules sending unknown paths to a PHP file), `index.php`, `wp-load.php`,
`404.php` and theme templates; sitemaps (static files in the root, and sitemap plugin settings) listing URLs the site
never had; the posts table for pages the owner did not publish; large text values in options. Remove unknown Search
Console owners and their verification tokens (HTML files in the root, meta tags, DNS records).

Settled by: the Googlebot curl test and the URL Inspection live test; `02-file-scan.md` (configuration and server
files, PHP signatures); `03-database-scan.md` (content). After cleaning, the spam URLs should return 404 or 410 to
Googlebot as well as to people.

## "This site may be hacked" and "Deceptive site ahead"

"This site may be hacked" appears in Google results when Google believes a hacker changed pages or added spam
pages; the owner fixes the cause and requests a review in Search Console
([Google Search Help](https://support.google.com/websearch/answer/190597)). The Security Issues report names the
type (malware; code injection; content injection; URL injection; deceptive pages; harmful downloads; and others) and
gives sample URLs ([Security Issues report](https://support.google.com/webmasters/answer/9044101)). Map the type to
this page: code injection to redirects or family H; content and URL injection to family E; malware to families A, C
and D.

"Deceptive site ahead" is Safe Browsing's warning for social engineering: phishing and content that tricks
visitors into dangerous actions, including deceptive third-party ads and embedded resources
([social engineering](https://developers.google.com/search/docs/monitor-debug/security/social-engineering)). Look
for phishing kits (family F) in folders WordPress does not manage, and review ads and embeds, reloading pages several
times because ad networks rotate content. Check status at the
[Safe Browsing site status](https://transparencyreport.google.com/safe-browsing/search) page.

Both are cleared by the Search Console review after the whole site is clean (`06-restore.md`, reputation cleanup).

## Unknown or hidden administrators

Family J. Read the users and capabilities from the throwaway database, never from the dashboard or WP-CLI on the
infected site: a `pre_user_query` hook hides an account from both
([pre_user_query](https://developer.wordpress.org/reference/hooks/pre_user_query/),
[wp user list](https://developer.wordpress.org/cli/commands/user/list/)). A role count above the Users list that is
higher than the rows shown is a sign, because the count comes from a direct query
([count_users()](https://developer.wordpress.org/reference/functions/count_users/)).

Look first at: administrators by registration date; `{prefix}capabilities` values that grant administrator to
unexpected users; the `{prefix}user_roles` option for roles with extra capabilities; `users_can_register` with
`default_role`; application passwords; session tokens with no user agent or bot user agents; on multisite,
`site_admins` and any `$super_admins` in `wp-config.php`
([get_super_admins()](https://developer.wordpress.org/reference/functions/get_super_admins/)). In code: user-hiding
hooks and `wp_create_user` or `wp_insert_user` with `administrator`.

Settled by: `03-database-scan.md` (users, roles and sessions), `scripts/database-deep-checks.php`, and
`scripts/scan-php.mjs`. An account that comes back after deletion means code is still recreating it: go to
"Malware that keeps coming back".

## Backdoors and web shells

Family D. Look first at: any PHP under `wp-content/uploads`; non-PHP files holding a PHP open tag; must-use plugins and
drop-ins no installed plugin explains (they load on every request,
[must-use plugins](https://developer.wordpress.org/advanced-administration/plugins/mu-plugins/),
[drop-ins](https://developer.wordpress.org/reference/functions/_get_dropins/)); PHP files in folders WordPress does not
manage; plugins or REST routes you do not recognize; files that `include` an image or text file.

Settled by: `02-file-scan.md` (drop-ins and must-use plugins; executable code where it does not belong; PHP
signatures), `scripts/scan-php.mjs`, and access logs for requests to the file (`04-timeline-entry-point.md`).

## Database-only injections

When the files pass every checksum and scan and the symptom remains, the code is in the database. Skimmers
([Sansec](https://sansec.io/what-is-magecart)) and redirect scripts
([Google Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/unc5142-etherhiding-distribute-malware))
have both been found stored in the database.

Look first at: options holding `<script`, `eval(`, `atob(`, `fromCharCode` or `document.write`; widgets and block
widgets; posts and postmeta, including page-builder data; snippet plugin posts and their execution cache; header and
footer settings; redirect rules; the `cron` option; options named as bare hex strings.

Settled by: `03-database-scan.md` and `scripts/database-hunt.sql`, then the outward checks below if that is clean too.

## Modified core files

Settled by the checksum comparison, which gives a yes or no answer (`scripts/verify-core-checksums.mjs`, or
`wp core verify-checksums --include-root` on a live site, which also warns about files in the root that are not part
of core, [wp core verify-checksums](https://developer.wordpress.org/cli/commands/core/verify-checksums/)). Look for
extra files inside `wp-admin` and `wp-includes` as well as changed ones. Do not repair core by hand: replace
`wp-admin` and `wp-includes` whole, with the same version (`05-cleanup.md`). A host that serves core read-only and
leaves it out of backups means core must be checked on the server; say so in "Not checked" if it was not.

## Nulled plugins or themes

Family I. Ask the owner where every premium plugin and theme came from. Compare each with a fresh copy from the
vendor, downloaded with the owner's license; look for license code removed, extra files, and outbound requests to hosts
that are not the vendor (`scripts/external-hosts.mjs`). Nulled copies are a delivery route for malware that spreads
to other sites on the same server and resets file times
([BleepingComputer, reporting Wordfence research](https://www.bleepingcomputer.com/news/security/wordpress-admins-infect-their-sites-with-wp-vcd-via-pirated-plugins/)),
so check sibling sites and do not rely on file dates.

Settled by: `02-file-scan.md` (code that checksums cannot cover); replacement with licensed copies (`05-cleanup.md`).

## A vulnerable plugin as the entry point

List every plugin and theme with its version (`scripts/list-plugin-versions.mjs`) and check each against public
vulnerability databases (for example [Patchstack](https://patchstack.com/database/) and
[WPScan](https://wpscan.com/wordpress-security-scanner/)). A match is a candidate, not a finding. Confirm it in the
access logs: requests to that plugin's files, `admin-ajax.php` actions or REST routes shortly before the first
malicious file or row appeared. Settled by `04-timeline-entry-point.md`. If logs are missing, the entry point stays
"most likely", and the report says which logs would settle it.

## WooCommerce checkout card skimmers

Family H. Look first at: every script that loads on the checkout and order-pay pages; plugin settings that accept
scripts (checkout builders, tag and pixel fields, header and footer injectors); theme JavaScript; widgets; options;
SVG files. One campaign stored the skimmer in a checkout plugin's "External Scripts" setting, disguised as a Google Tag
Manager loader ([Sansec](https://sansec.io/research/funnelkit-woocommerce-vulnerability-exploited)).

Settled by: `scripts/scan-js.mjs`, `scripts/external-hosts.mjs`, `scripts/database-hunt.sql`, and a test checkout on a
staging copy with the browser's network panel open, recording every host that receives data. Also review REST API
keys and webhooks (WooCommerce > Settings > Advanced), where an unknown delivery URL receives order data
([Webhooks](https://woocommerce.com/document/webhooks/)). A confirmed skimmer is a card-data incident: the owner
contacts the payment processor.

## The site sends spam email

Two common causes, which can occur together:

- A PHP mailer (family G): a standalone script sending mail through `mail()` or a bundled PHPMailer. Ask the host
  for mail logs; PHP's `mail.log` and `mail.add_x_header` record the script path of every `mail()` call
  ([mail configuration](https://www.php.net/manual/en/mail.configuration.php)). Settled by `scripts/scan-php.mjs` and
  a search for `mail(` and `PHPMailer` outside core, plugins and themes.
- Open registration abuse (family B): WordPress's own welcome mail carries the spam in the display name.
  Settled by `users_can_register` and the registrations-per-month report in `scripts/database-deep-checks.php`.

Also check contact and comment forms that email submitted text. After cleaning, check the blocklists and SPF, DKIM
and DMARC (`07-hardening.md`, email).

## Phishing kits in folders WordPress does not manage

Family F. Checksums only cover core, plugins and themes, so a kit in a new top-level folder is invisible to them. List
every folder and file under the document root that is not core, `wp-content`, or an application the owner names.
Search for other brands' names, form actions posting to other hosts, and `mail(` calls outside WordPress. Compromised
WordPress sites have hosted such pages in `wp-content` and `wp-includes` subfolders as well
([Cisco Talos](https://blog.talosintelligence.com/compromised-wordpress-blogs-phishers/)). Settled by
`02-file-scan.md` (executable code where it does not belong) and the Security Issues report's sample URLs.

## Malware that keeps coming back

Something that runs by itself was missed. Check each of these, on the files and in the database, before cleaning
again:

- WP-Cron: events run on page loads ([WP-Cron](https://developer.wordpress.org/plugins/cron/)); malicious hooks,
  often with random names, rebuild files. `scripts/database-deep-checks.php` lists every hook.
- Server cron: A crontab entry under the hosting user, or a cron job in the control panel, that downloads or
  rewrites files. Ask the host, or list it with `crontab -l` if you have a shell.
- Must-use plugins: every `.php` file directly in `wp-content/mu-plugins` loads on every request
  ([wp_get_mu_plugins()](https://developer.wordpress.org/reference/functions/wp_get_mu_plugins/)); a `wp-config.php`
  that redefines `WPMU_PLUGIN_DIR` moves that folder somewhere else (same page).
- Drop-ins: `advanced-cache.php`, `db.php` and `object-cache.php` load before any normal plugin, `sunrise.php` on
  multisite ([_get_dropins()](https://developer.wordpress.org/reference/functions/_get_dropins/),
  [wp-settings.php](https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-settings.php)).
- `auto_prepend_file`: PHP parses this file before every script, as if it were `require`d, and it can be set per
  directory ([auto_prepend_file](https://www.php.net/manual/en/ini.core.php)): in `.htaccess` under the Apache PHP
  module, or in `.user.ini` under CGI and FastCGI, where PHP reads every `.user.ini` from the script's folder up to the
  document root and caches them for 300 seconds by default
  ([.user.ini files](https://www.php.net/manual/en/configuration.file.per-user.php)). So a prepended file runs before
  WordPress and survives a clean WordPress, and a removed `.user.ini` can keep working for five minutes. Security
  plugins also use this setting legitimately; read the file it points to. `scripts/scan-php.mjs` flags it.
- Payload options: family A's two layers: a prefixed family and bare hex names.
- Processes: ask the host, or check with `ps` under the site's user, for long-running processes you cannot
  explain.
- Credentials: A password, application password, API key or SFTP account that was not rotated lets the attacker
  walk back in. So does a stolen session if the salts were not changed.
- Sibling sites: another site on the same hosting account, or a staging copy, that was not cleaned. The WordPress
  FAQ warns that on shared hosting a hack may affect more than one site
  ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).
- The entry point: if the vulnerable plugin or the weak password is still there, the site is reinfected the same
  way (`04-timeline-entry-point.md`).

Settled by: `03-database-scan.md` (scheduled jobs, options), `02-file-scan.md` (drop-ins and must-use plugins,
configuration and server files), and the 48-hour watch in `06-restore.md`.

## Host suspension

The WordPress FAQ lists a host disabling the site as a clear sign of a hack
([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)). Ask the host for
their report: the files they flagged, the signature names, when they scanned, whether they moved, renamed or changed
permissions on anything, and the access logs for the period. Their list is a starting point, not the scope. Record it
in `00-intake.md`, then follow every row of this map that the report matches. The reply to the host after the restore
is in `06-restore.md`.

## Multisite and shared hosting spread

Multisite: all sites share one users table
([Multisite](https://developer.wordpress.org/advanced-administration/multisite/)), so a backdoor administrator or a
super admin affects every site. Check `site_admins` and any `$super_admins` in `wp-config.php`
([get_super_admins()](https://developer.wordpress.org/reference/functions/get_super_admins/)), network-activated
plugins in `active_sitewide_plugins`
([wp_get_active_network_plugins()](https://developer.wordpress.org/reference/functions/wp_get_active_network_plugins/)),
the `sunrise.php` drop-in, and every site's own options, posts and cron tables (`{prefix}2_options` and so on),
not only the main site's.

Shared hosting: sites that run as the same hosting user can usually write to each other's files. Scan all of them with the
indicators from this case, and staging copies and old folders too. Malware that spreads through a hosting environment
has been documented (WP-VCD, [BleepingComputer, reporting Wordfence research](https://www.bleepingcomputer.com/news/security/wordpress-admins-infect-their-sites-with-wp-vcd-via-pirated-plugins/)).
Seen in investigations: sites that shared an account or an agency login were compromised in the same session.
Settled by `04-timeline-entry-point.md` (blast radius).

## Nothing found

A clean file set and a clean database are a finding, and not the end. Look outward and record what you ruled out:

- tag manager containers: Custom HTML tags, who can publish, the version history
  ([custom tags](https://support.google.com/tagmanager/answer/6107167),
  [user permissions](https://support.google.com/tagmanager/answer/6107011));
- third-party scripts and embeds, including domains that expired and were registered by someone else;
- ads and ad networks, which rotate content;
- DNS records, the CDN's rules and the registrar account;
- lookalike domains, after checking whether they belong to the owner;
- the reporter's own browser: extensions and adware on the reporting machine can produce redirects that no server
  scan will find. The WordPress FAQ recommends scanning the owner's computer too, for a related reason: trojans there
  steal FTP and admin logins ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).
