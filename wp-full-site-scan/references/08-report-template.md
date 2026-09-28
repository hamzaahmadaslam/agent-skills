# Phase 8: the report

Write this for the site owner, not for another engineer: plain words, specific numbers, and an honest line between what
you proved and what you inferred. Fill every value from command output, file contents and query results, never from
memory.

Copy the template below and fill it in. Delete sections that do not apply, but never delete "What was checked" or
"Not checked": those two sections are what make the rest trustworthy.

## Template

```markdown
# <site>: malware scan and clean-up report

**Date:** <date, UTC>
**Scanned by:** <name>
**Inputs:** files: <archive name> (<size>), database: <dump name> (<size>)
**Method:** everything was examined on copies in an isolated workspace. The live site was not changed during the
scan. The site's code was never run.

## In short

1. <Was malware found? One sentence.>
2. <What caused the reported symptom, or what it was not.>
3. <The most serious security problem found, whether or not it relates to the symptom.>
4. <What the owner must do first.>

## What was checked

| Area | Result |
| --- | --- |
| WordPress core (<version>, <n> files) | <matches the official release / n modified, n added> |
| Plugins verified against wordpress.org (<n>) | <0 modified, 0 added / details> |
| Plugins that cannot be verified (<n> premium or custom) | <how they were checked instead> |
| Themes | <result> |
| Drop-ins and must-use plugins | <result, with the owner of each drop-in> |
| Executable code in uploads | <result> |
| Configuration files (`wp-config.php`, `.htaccess`, `.user.ini`, `php.ini`) | <result> |
| PHP files scanned (<n>) | <hits, and how each was cleared or confirmed> |
| JavaScript, HTML and SVG scanned (<n>) | <result> |
| External script hosts | <list, or "all accounted for"> |
| Folders WordPress does not manage | <result> |
| Database: options, cron, users, roles, sessions, application passwords | <result> |
| Posts, page-builder data, widgets, settings | <result> |
| Snippet, header and footer, and redirect plugin stores | <result> |
| The site as visitors and Google see it (logged out, mobile, from search, URL Inspection) | <result> |
| Logs reviewed | <which, and the period covered> |

## Not checked

- <for example: server access logs were not provided, so the request that created the account could not be found.>
- <for example: the host serves core read-only and it is not in the backup; core was checked on the live server
  instead, or not at all.>
- <for example: other sites on the same hosting account.>

## What was found

### 1. <Finding> (<high / medium / low>)

**What it is:** <plain description>
**Where:** <file paths; tables, option names and row counts>
**Evidence:** <what proves it: checksum mismatch, the code read, the query result>
**Impact:** <what it did to the site, its visitors or its data>
**Action taken:** <quarantined / stripped / replaced from the official release / removed / left alone, and why>

<Repeat per finding, most serious first.>

## How they got in

**Confidence: <confirmed / most likely / unknown>**

<The timeline that supports it, quoting evidence with timestamps and their sources.>

<If not confirmed: what evidence would settle it, and who can provide it.>

## Timeline

| When (UTC) | What happened | Source |
| --- | --- | --- |
| <timestamp> | <event> | <log, file time, database row> |

## What was changed

**Files removed:** <count>. Full list with sizes and hashes in the quarantine folder `<path>`.
**Files cleaned in place:** <list, with sizes before and after, and what they were compared with>
**Files replaced from official releases:** <core version, plugins and themes with versions>
**Database rows removed:** <counts by type>
**Accounts removed:** <list>
**Scheduled jobs removed:** <list>
**Secrets rotated:** <salts, database password, passwords, application passwords, API keys>
**Secrets the owner still has to rotate:** <list, with where each lives>

Nothing else was changed.

## Indicators of compromise

**Files:** <paths, sizes, SHA-256>
**Database:** <option names and sizes, cron hook names, usernames and email addresses of backdoor accounts>
**Markers:** <code markers, fake plugin names, hook names, hidden folder naming>
**Network:** <domains, IP addresses, blockchain RPC endpoints, and what each was seen doing>

Use these to check other sites on the same hosting account, or managed by the same team.

## Putting the site back online

<Numbered restore steps from 06-restore.md, tailored to this site: the export fixes it needs, the order, the checks.>

**Rollback:** <where the pre-restore backup is, how to use it, and how long it takes.>

## Securing the site

**Do first**
1. <...>

**Do this week**
1. <...>

**Ongoing**
1. <...>

## Still open

- <Anything unresolved, who owns it, and what it needs.>
```

## Writing notes

**Lead with the answer.** The owner wants to know whether the site is infected and what to do. Detail comes after.

**Numbers beat adjectives.** "All 24 wordpress.org plugins match the official release byte for byte" tells the reader
more than "scanned thoroughly".

**Separate proved from inferred** in every sentence that matters. If the login log keeps 30 days and the account is
older, say that, instead of implying the account was never used. If file times are the only evidence for a date, say
so: malware can reset them (`known-malware-patterns.md`, nulled software).

**Name the coverage gaps.** A report that lists only findings reads as complete even when half the evidence was
missing.

**Say what "clean" means here.** "No malware was found in the files and database provided" is a finding.
"The site is secure" is not.

**If you were wrong earlier, correct it in the report itself**, not only in conversation. A superseded finding left
standing sends people to fix the wrong thing.

**Keep personal data out.** Do not paste password hashes, customer records, full session tokens or API keys into the
report. Name where they are and that they were rotated.

**Keep the report and the quarantine folder together.** Months later, the quarantine is the only proof of what was
removed.
