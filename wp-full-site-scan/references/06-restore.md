# Phase 6: put the site back online

Goal: the cleaned site live again, checked clean the way visitors and search engines see it, with a way back if the
restore goes wrong. This is the first phase that changes the live site. Every step below is stated to the owner with
its check and its rollback, and waits for the owner's approval of that step.

`{prefix}` stands for the table prefix, `DBNAME` and `USER` for the live database and its user.

## 1. Before you touch the live site

- [ ] **Back up the live site first, as it is now**: files and database, infected and all. If the restore goes wrong
      you need somewhere to return to, and it is evidence. The WordPress FAQ recommends the same snapshot of the
      infected site before cleaning ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).
      Store it outside the web root and off the server if you can.
- [ ] Confirm the owner knows the site will be unavailable for a while, and when.
- [ ] Write the rollback plan down (step 9) before you start.
- [ ] Restore files and database together, in one window. Never one without the other (`05-cleanup.md`).
- [ ] Record the live server's WordPress version, PHP version, and database server type and version (MySQL 5.7,
      MySQL 8.0 or 8.4, MariaDB 10.x or 11.x). The dump must suit that server.
- [ ] Keep the new database password and the new salts ready for the new `wp-config.php`.

## 2. Prepare the dump for the target server

This is where restores fail. `scripts/fix-export.mjs` handles all four cases below: it reads the cleaned dump and
writes a corrected copy to a new file, changing table names and table options only, never row data and never its
input. Its header lists the options.

a. Table name letter case: MySQL on Windows stores table names in lowercase by default
(`lower_case_table_names` is 1 on Windows, 0 on Unix), and the setting can only be chosen when the server is
initialized ([identifier case sensitivity](https://dev.mysql.com/doc/refman/8.4/en/identifier-case-sensitivity.html)).
A dump taken there turns an `Ab3_` prefix into `ab3_`. A Linux server compares table names case-sensitively, so
WordPress finds none of its tables and shows the installation screen while all the data is still there. Fix the
dump, not the site: `--prefix-from=ab3_ --prefix-to=Ab3_`. Only identifiers change; option values and meta keys that
contain the prefix (`Ab3_user_roles`, `Ab3_capabilities`) are row data and already have the right case.

b. Collations the target does not know: MySQL 8.0 defaults to `utf8mb4_0900_ai_ci`
([server character set](https://dev.mysql.com/doc/refman/8.0/en/charset-server.html)); recent MariaDB releases
default to `utf8mb4_uca1400_ai_ci`
([MariaDB collations](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations)).
A server without the collation stops with error 1273, `Unknown collation`
([MySQL error reference](https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html)). Replace them
with what the original dump used, usually `utf8mb4_unicode_520_ci` or `utf8mb4_unicode_ci`
(`--collation-downgrade`).

c. Character set names: MySQL 8.4 shows `utf8mb3` where older releases wrote `utf8`; `utf8` was an alias for
`utf8mb3` and that alias is deprecated ([utf8mb3](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8.html)).
If the test import on an older target rejects the `utf8mb3` names, convert them back (`--utf8mb3-to-utf8`).

d. MariaDB's sandbox line: `mariadb-dump` writes a command at the start of the dump that enables sandbox mode, and
the MySQL client and older MariaDB clients throw an error on it
([mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump/)).
Remove it (`--strip-mariadb-sandbox`).

Then check the result:

```sh
grep -c 'CREATE TABLE' clean-for-server.sql                 # the expected table count
grep -c 'utf8mb3\|0900_ai_ci\|uca1400' clean-for-server.sql # 0 for an older target
head -1 clean-for-server.sql                                # no sandbox line
```

**Test the import on a throwaway database first**, on a server of the same type and version as the target where
possible. A failed import halfway through the live database leaves the site with half a database. The test import
must finish without errors, and `SHOW TABLES` must show the prefix in the right case.

## 3. Put the site into maintenance

Use a holding page at the server, host or CDN level. WordPress's own maintenance mode (`wp maintenance-mode activate`,
[wp maintenance-mode activate](https://developer.wordpress.org/cli/commands/maintenance-mode/activate/)) only covers
requests that go through WordPress: a web shell or mailer requested directly by its URL still runs. If the site is
actively redirecting visitors or serving malware, take it offline first and restore into the quiet.

## 4. Restore the files

**Do not upload over the top.** An upload adds and overwrites; malicious files that are not in your clean set stay
exactly where they are.

Preferred: rename the live document root aside (it becomes part of the rollback), upload the clean set into a fresh
folder, and switch the site to it. Otherwise, delete on the server everything you are replacing, then upload.

- Write `wp-config.php` deliberately: new salts, new database password, the correct table prefix in its correct case.
- Do not upload `WORK/quarantine/`, `WORK/evidence/` or any dump.
- Check for files outside the document root that belong to the site's PHP: `.user.ini`, `php.ini` or
  `auto_prepend_file` targets in the home folder (`symptom-map.md`, "Malware that keeps coming back").
- Restore ownership and permissions if the upload changed them (`07-hardening.md`, section 4).

## 5. Restore the database

```sh
mysqldump -u USER -p DBNAME > live-before-restore.sql      # one more safety copy, taken just before
mysql -u USER -p -e "DROP DATABASE DBNAME; CREATE DATABASE DBNAME DEFAULT CHARACTER SET utf8mb4;"
mysql -u USER -p DBNAME < clean-for-server.sql
```

Drop and recreate rather than import on top. A plain import replaces the tables the dump defines, but it does not
remove malicious tables or rows that the clean dump never mentions. On hosts where the database user cannot drop or
create databases, drop every table in the database from the control panel's database tool first, then import.

Then confirm:

```sql
SHOW TABLES;                                  -- prefix in the right case, expected count
SELECT option_name, option_value FROM {prefix}options WHERE option_name IN ('siteurl','home');
```

## 6. Bring it back and check

- Turn off maintenance.
- Load the homepage, an inner page, a post, and the login page.
- Sign in and check the dashboard, the plugin list (including the must-use and drop-in tabs) and the user list.
- Submit a contact form and confirm the email arrives.
- On a store, place a test order with each payment method the owner uses, in the gateway's test mode where it has one.
- Check a cached page and a page built with the page builder.
- Purge every cache: the caching plugin, the host's cache and the CDN. Old cached HTML keeps serving the injected
  script otherwise.

## 7. Check the live site the way visitors and search engines see it

Cloaked malware only fires for some visitors, so test as several of them (`symptom-map.md` has the curl commands):

- logged out, from a desktop user agent;
- logged out, from a mobile user agent;
- arriving from a search result (a search engine `Referer`);
- as Googlebot, with the Googlebot user agent strings Google publishes
  ([Google crawlers](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers)), and then
  with the URL Inspection tool's live test in Search Console, which fetches from Google and shows the raw HTML
  ([URL Inspection tool](https://support.google.com/webmasters/answer/9012289)). Cloaking code can check the
  visitor's IP address as well as the user agent; Google verifies its crawlers by reverse DNS and published IP ranges
  ([verifying Googlebot](https://developers.google.com/search/docs/crawling-indexing/verifying-googlebot)), so only
  Google's own fetch is conclusive.

Compare the external script hosts in each response with the inventory from `02-file-scan.md`
(`scripts/external-hosts.mjs`). Run a remote scanner as a second opinion (the WordPress FAQ lists VirusTotal and
Sucuri SiteCheck as examples, [FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).
Watch the error and 404 logs for a day: a rebuild attempt shows up as include failures naming files you removed.

## 8. Reputation cleanup

- Google Search Console: open the Security Issues report, confirm every listed issue is fixed across the whole
  site, then choose Request Review; reviews can take several days or weeks
  ([Security Issues report](https://support.google.com/webmasters/answer/9044101)). After Google confirms the fix, the
  "This site may be hacked" label is removed from results
  ([Google Search Help](https://support.google.com/websearch/answer/190597)). Remove Search Console owners and
  verification tokens nobody recognizes: attackers add themselves as owners
  ([Japanese keyword hack](https://web.dev/articles/fix-the-japanese-keyword-hack)).
- Safe Browsing: check the status at the
  [Safe Browsing site status](https://transparencyreport.google.com/safe-browsing/search) page. A "Deceptive site
  ahead" warning is cleared through the same Search Console review
  ([social engineering](https://developers.google.com/search/docs/monitor-debug/security/social-engineering)).
- Host suspension: reply to the host with what was found, what was removed, and what was changed to close the way
  in, and offer the list of removed files.
- Other blocklists and webmaster consoles: the WordPress FAQ lists Bing, Yandex and Norton alongside Google
  ([FAQ My site was hacked](https://wordpress.org/documentation/article/faq-my-site-was-hacked/)).
- Email reputation: if the site sent spam, check the sending IP and domain against the mail blocklists, and
  confirm SPF, DKIM and DMARC are in place (`07-hardening.md`, section 9).

## 9. Rollback plan

Write it before step 3:

- where the pre-restore backup lives (files and database), and the exact commands to put it back;
- who decides to roll back, and on what signal (for example: checkout broken for more than 15 minutes);
- how long a rollback takes, measured on the throwaway server during the test import.

Rolling back restores the infected site. It buys time to fix a broken restore; it is not a place to stay. If you roll
back, put maintenance back on and keep the site offline if it was redirecting visitors.

## 10. Watch for 48 hours

The single most important check: does the malware come back? Look again at the files the malware used, the options
table, the administrator list, the cron events and the drop-ins, at least twice a day. If anything returns, something
was missed: a scheduled job, a server cron entry, a second site on the same account, a password that was not changed,
or a payload option. Go back to `03-database-scan.md`, and to `04-timeline-entry-point.md` for the way in. Keep the
pre-restore backup until the owner agrees the watch is over.

## Output of this phase

- The site live and checked clean: logged out, on mobile, from search, and as Google fetches it.
- Caches and CDN purged.
- Review requests sent where the site was flagged.
- A rollback path that still exists, and a 48-hour watch with named checks.

Go to `07-hardening.md`.
