# Review template

Read this before writing the review. The review goes to the person who asked, or into the pull request as a
review comment if they ask for that. Levels are defined in `severity-levels.md`.

## Rules for the write-up

- Lead with the verdict and the counts, so a reader who stops after three lines knows whether the change can merge.
- One finding per row: where (`path:line`), the rule (the PHPCS source code, or `manual` with the topic), what goes
  wrong on VIP in one sentence, and the fix in one sentence. Name the reference file that backs a manual finding.
- Keep the Bot's view separate from yours: PHPCS findings on changed lines, manual findings, and pre-existing
  findings on untouched lines each get their own place.
- Say what was not checked: PHPCS not run, files skipped, third-party code only skimmed, runtime behaviour not
  tested.
- Quote at most the one or two lines of code a finding needs. Never paste credentials, personal data or long code
  blocks.
- Plain words and exact names. Say what to change, not what someone "might want to consider".

## Template

```markdown
# VIP code review: <pull request title or branch> (<base>...<head>)

**Verdict:** <Blocked | Changes requested | Ready to merge>, <N> blockers, <N> to fix before merge,
<N> should fix, <N> cleanup.

**Scope:** <N> files changed (+<added>/-<removed> lines). Reviewed: <custom code paths>. Skimmed: <third-party
plugins added or updated>. Skipped: <vendor/, built assets, other>.

**Tooling:** PHPCS <version> with VIPCS <version> and WPCS <version>, standard `WordPress-VIP-Go`, severity 1;
`PHPCompatibilityWP` with testVersion <x.y->; `php -l` on PHP <versions>. Or: "PHPCS not run: <reason>. Manual
review only."

## Blockers

| # | Where | Rule | What happens on VIP | Fix |
| - | ----- | ---- | ------------------- | --- |
| B1 | `path/to/file.php:42` | `Sniff.Code` (error, severity 5) | ... | ... |

## Fix before merge

| # | Where | Rule | What happens on VIP | Fix |
| - | ----- | ---- | ------------------- | --- |

## Should fix

| # | Where | Rule | Why | Fix |
| - | ----- | ---- | --- | --- |

## Cleanup

<Short list, or "none".>

## False positives and ignore annotations

<Each false positive with the exact `// phpcs:ignore <code> -- <reason>` line to add, and each annotation the
change adds, with whether its reason holds.>

## Settings that change the Bot's checks

<Changes to `.vipgoci_options`, `.vipgoci_*_skip_folders`, skip labels or `.phpcs.xml.dist`, or "none".>

## Pre-existing issues (not introduced by this change)

<Counts by level and the worst few, or "not listed".>

## Not checked

<What the review could not cover and why.>
```

Verdict rule: **Blocked** when there is at least one blocker; **Changes requested** when there are none but at
least one "fix before merge"; otherwise **Ready to merge**, with the should-fix and cleanup items as notes.

## Example (synthetic)

A made-up change to a made-up theme, to show the level of detail expected.

```markdown
# VIP code review: Add partner feed widget (origin/production...feature/partner-feed)

**Verdict:** Blocked, 2 blockers, 1 to fix before merge, 1 should fix, 1 cleanup.

**Scope:** 3 files changed (+118/-4 lines). Reviewed: themes/example-news/inc/partner-feed.php,
themes/example-news/template-parts/partner-feed.php. Skipped: themes/example-news/build/ (compiled assets).

**Tooling:** PHPCS 3.13.5 with VIPCS 3.1.0 and WPCS 3.4.1, standard WordPress-VIP-Go, severity 1;
php -l on PHP 8.2.

## Blockers

| # | Where | Rule | What happens on VIP | Fix |
| - | ----- | ---- | ------------------- | --- |
| B1 | `inc/partner-feed.php:31` | `WordPress.Security.EscapeOutput.OutputNotEscaped` (error, 5) | The feed title from the remote API is printed raw: script injection from a third party | `echo esc_html( $item['title'] );` |
| B2 | `inc/partner-feed.php:18` | manual: files (platform-rules.md) | Reported as warning `file_ops_file_put_contents` (severity 6), but the path is `get_stylesheet_directory()`, which is read-only on VIP, so every write fails | Cache the response with `wpcom_vip_file_get_contents()` instead of writing a file |

## Fix before merge

| # | Where | Rule | What happens on VIP | Fix |
| - | ----- | ---- | ------------------- | --- |
| F1 | `inc/partner-feed.php:12` | manual: remote requests (platform-rules.md) | `wp_remote_get()` with a 10 second timeout on every uncached page view; a slow partner API slows the page | `wpcom_vip_file_get_contents( $url, 3, 900 )` |

## Should fix

| # | Where | Rule | Why | Fix |
| - | ----- | ---- | --- | --- |
| S1 | `inc/partner-feed.php:12` | `WordPressVIPMinimum.Functions.RestrictedFunctions.wp_remote_get_wp_remote_get` (warning, 5) | Same line as F1 | Fixed by F1 |

## Cleanup

- `template-parts/partner-feed.php:7`: `Universal.Operators.StrictComparisons.LooseEqual` (warning, 3); use `===`.

## False positives and ignore annotations

None.

## Settings that change the Bot's checks

None.

## Pre-existing issues (not introduced by this change)

None: the change adds new files only.

## Not checked

Runtime behaviour on a VIP environment; the compiled files in build/.
```

In this example the 10 second timeout would also trip `WordPressVIPMinimum.Performance.RemoteRequestTimeout`
(an error) if it were written as a literal `'timeout' => 10`; here it arrives through a variable, so only the
manual pass catches it.
