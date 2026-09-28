# Phase 4: build the timeline and find the way in

Read this once the file and database findings are in. The goal is to know when the infection started, how the
attacker got in, and what else they touched. Skipping this phase is why hacked sites get hacked again a week after
cleaning.

## 1. Collect every dated source

| Source | What it gives you |
| --- | --- |
| File modification times | When each malicious file appeared (as recorded by the archive, or read on the server) |
| The malware's own state options | Its install and "last run" timestamps |
| `{prefix}users.user_registered` | When a backdoor account was created, in UTC ([user.php L2422](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/user.php#L2422)) |
| `session_tokens` in usermeta | When each session started (`login`, a Unix time), with IP and user agent ([class-wp-session-tokens.php L118-L143](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-session-tokens.php#L118-L143)) |
| Activity log plugin tables | Logins, plugin installs, settings changes and uploads, with IP |
| Wordfence tables | Successful and failed logins, scan findings, blocked requests |
| `error_log`, `debug.log` | Fatal errors and include failures around the event |
| 404 and redirect plugin logs | What attackers probed for, and their referrers |
| Server access logs | The strongest evidence. Usually not in a backup: ask the host |

Timestamps come in different clocks: file times in the server's local time, WordPress `*_gmt` columns and
`user_registered` in UTC, some plugin logs in the site's own time zone. Compare events within one source before
comparing across sources, and say which clock you are quoting.

## 2. Lay the events on one line

Write the timeline as plain rows: time, what happened, source, evidence. A made-up example:

```text
2026-05-04 14:02:32 UTC  successful login as "studio_admin" from 203.0.113.45        security plugin login log
2026-05-04 14:02:45 UTC  administrator "backup_<6 hex>" created                        users table
2026-06-21 23:31:48 UTC  plugin.zip uploaded, installed as "Site Speed Helper"       activity log
2026-06-21 23:31:52 UTC  that plugin activated, then deactivated seconds later        activity log
2026-07-02 19:52 local   malware files first appear on disk                          file timestamps
```

Patterns to look for:

- A successful login seconds before a new administrator appears: that is the entry.
- A gap between an account's creation and its first use. Attackers often come back weeks later.
- A file upload followed at once by a plugin install and activation, then a deactivation: a dropper cleaning up
  after itself.
- Malware timestamps older than every log: the infection is older than your evidence. Say so.

## 3. Work through the entry-point candidates

Check each one, and record what the evidence says.

**Compromised administrator credentials.** Look for a successful login from an unfamiliar IP just before the first
malicious action. Check whether the password appears in breach data (some hosts and security plugins block such
logins and log it). Shared agency accounts used by many people are the usual weak point.

**A session without a login.** If administrator actions appear with no matching successful login anywhere in the
logs, the attacker had a valid session without using the login form. A valid WordPress login cookie needs three
things: a hash made with the keys and salts from `wp-config.php`, four characters of the user's password hash, and a
matching session record in `session_tokens`
([pluggable.php L857-L889](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/pluggable.php#L857-L889)).
So the likely causes are:

- a stolen cookie, taken from a browser or a machine that was signed in;
- code already running on the site, which can create a session directly with `wp_set_auth_cookie()` without the
  `wp_login` action that login logs record (phase 3, step 2);
- leaked keys and salts together with access to the database, which holds the password hashes and the sessions.

Check whether the keys and salts are identical across several sites. If they are, one leaked `wp-config.php` puts
all of them at risk.

**Vulnerable plugin or theme.** Compare installed versions against published vulnerability reports. Check inactive
plugins as well as active ones: their files can still be requested directly. Plugins with a history of
unauthenticated file upload or code execution deserve particular attention, as do plugins removed from the
wordpress.org directory.

**Open registration plus a privilege escalation bug.** If bot accounts exist and any of them signed in (they have
sessions), look for what a subscriber-level account could exploit on this site.

**Server or account level.** Other sites under the same hosting account infected at the same time point to shared
file system access rather than a WordPress bug. Look for SSH or FTP traces (shell history files in the backup are a
hint) and ask the host for FTP and SSH logs.

**Supply chain.** A plugin or theme that was itself backdoored, or pirated ("nulled") software (phase 2, step 8).

## 4. Map the blast radius

- **Other sites on the same account:** check them all, with the same playbook.
- **Data exposure.** The dump holds password hashes, customer records, form entries and often live API tokens. Note
  what was exposed; the owner may have disclosure obligations.
- **Outbound abuse.** Spam sent through the site, pages injected for search engines, redirects served to visitors.
  All of them hurt the domain's reputation and may mean blocklist removal requests later.
- **Persistence not yet removed.** Backdoor users, application passwords, forged sessions, scheduled jobs, and any
  other site that shares the same credentials, keys or salts.

## 5. State conclusions with honest confidence

Use three levels, and label each conclusion:

- **Confirmed:** direct evidence, quoted. "Successful login as studio_admin from 203.0.113.45 at 14:02:32 UTC;
  backdoor administrator created at 14:02:45 UTC."
- **Most likely:** consistent evidence, alternatives less plausible. Say what would confirm it.
- **Unknown:** say so. "The activity log begins after the account was created, so how it was created cannot be
  determined from the data provided. The host's access logs would show it."

Never round "most likely" up to "confirmed". A wrong entry-point conclusion sends the owner to fix the wrong thing. If
a later finding changes a conclusion, correct it in the report and say that it changed.

## Output of this phase

- A dated timeline with its sources and clocks.
- The entry point at a stated confidence level, plus the evidence that would raise it.
- A blast radius list: other sites, exposed data, outbound abuse, persistence still to remove.

Next: [05-cleanup.md](05-cleanup.md).
