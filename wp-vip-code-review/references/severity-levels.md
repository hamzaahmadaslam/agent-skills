# Severity levels and what blocks a merge

Read this when you sort findings into report levels, or when someone asks whether a finding blocks deployment.
Facts checked on 2026-09-26; the source is beside each one.

## How VIP describes errors and warnings

| Fact | Source |
| ---- | ------ |
| Errors are issues that, if not fixed, may break because of platform incompatibility or open a site to serious performance and security issues. VIP strongly recommends resolving them before they are committed to an environment on the VIP Platform. | [php_codesniffer/errors](https://docs.wpvip.com/php_codesniffer/errors/) |
| Issues reported as warnings should not be pushed to a production environment unless a specific use case requires it. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Bot scans and manual scans made after VIP's install instructions use identical standards, including `WordPress-VIP-Go`. | [php_codesniffer/phpcs-report](https://docs.wpvip.com/php_codesniffer/phpcs-report/) |
| Some reported errors may be false positives, especially those about escaping; VIP says to inspect the code line by line and fix every valid one. | [php_codesniffer/phpcs-report](https://docs.wpvip.com/php_codesniffer/phpcs-report/) |
| Automated feedback has false positives and false negatives; all Bot feedback should be evaluated. | [vip-code-analysis-bot/feedback](https://docs.wpvip.com/vip-code-analysis-bot/feedback/) |
| VIP does not recommend fixing errors in third-party plugins and themes; it suggests a plugin with similar features and better code instead. | [php_codesniffer/phpcs-report](https://docs.wpvip.com/php_codesniffer/phpcs-report/) |
| The local PHPCS configuration should ignore third-party plugins, because their code cannot be changed without forking them. | [php_codesniffer/phpcs-xml-dist](https://docs.wpvip.com/php_codesniffer/phpcs-xml-dist/) |

## VIP's severity bands

From VIP's "Interpreting a PHPCS report" page ([php_codesniffer/phpcs-report](https://docs.wpvip.com/php_codesniffer/phpcs-report/)):

| Band | What VIP says | Examples VIP gives |
| ---- | ------------- | ------------------ |
| Error, severity 6 to 10 | Might carry a very high security risk or not work as expected on VIP; valid errors left in place will likely cost site functionality | Filesystem writes, caching |
| Error, severity 5 | Exposes the site to security and performance problems | Output escaped wrongly or user data not sanitized, unlimited or high posts per page, unsafe JavaScript string handling |
| Warning, severity 6 to 10 | Might expose the site to performance and security problems; should be addressed | Custom database tables, direct `$wpdb` use, `wp_mail()`, poorly performing queries |
| Warning, severity 5 | Might cause problems in some circumstances, such as high-traffic events; VIP recommends addressing all of them | Uncached functions, slow functions, `strip_tags`, tax queries |
| Warning, severity 1 to 4 | Does not follow VIP's recommended practices; address to keep the codebase clean | Includes without a full path, loose comparisons, undefined variables, scripts or styles not enqueued |

## What stops a merge (and a merge is a deploy)

| Fact | Source |
| ---- | ------ |
| With Default Deployment, commits pushed to a `wpcomvip` branch, by direct commit or by merging a pull request, always trigger an automatic deployment to the environment that branch deploys to. | [code-deployment/default-deployment](https://docs.wpvip.com/code-deployment/default-deployment/) |
| One or more `error` items make the Bot's status check fail; a run with only warnings passes as "No significant issues found". | [vip-code-analysis-bot/build-status](https://docs.wpvip.com/vip-code-analysis-bot/build-status/) |
| The status check blocks merging only when the repository requires it: a GitHub branch protection rule with "Require status checks to pass before merging" and the `VIP Code Analysis Bot` check selected. VIP strongly recommends enabling it. | [required-status-checks](https://docs.wpvip.com/code-deployment/github-repository/required-status-checks/), [github-repository](https://docs.wpvip.com/code-deployment/github-repository/) |
| Bot feedback can be addressed in code, silenced with a PHPCS annotation, or its review dismissed in GitHub. | [vip-code-analysis-bot/feedback](https://docs.wpvip.com/vip-code-analysis-bot/feedback/) |
| Code committed straight to a deploy branch is never analyzed; VIP strongly discourages it. | [vip-code-analysis-bot/default-behavior](https://docs.wpvip.com/vip-code-analysis-bot/default-behavior/) |
| Syntax errors are often fatal, and the Bot lints changed PHP files because they usually need fixing before deployment. | [vip-code-analysis-bot/php-linting](https://docs.wpvip.com/vip-code-analysis-bot/php-linting/) |
| VIP's older "Code review: blockers, warnings, notices" page (`wpvip.com/documentation/vip-go/code-review-blockers-warnings-notices/`) now redirects to the "Developing for WordPress applications" guidebook; the current documentation speaks of errors and warnings with severities. | [guidebooks/develop-on-wpvip/wordpress-apps](https://docs.wpvip.com/guidebooks/develop-on-wpvip/wordpress-apps/) |

## Review levels used by this skill

This mapping is the skill's own, built on the facts above. "Blocker" is this skill's word, not VIP's.

| Level | What goes here | Basis |
| ----- | -------------- | ----- |
| Blocker | Every PHPCS `ERROR` on a changed line at or above the severity the Bot uses (1 unless `.vipgoci_options` sets `phpcs-severity`); every `php -l` failure; a plugin or theme version the change adds that has a known vulnerability; a manual finding that fails on VIP or opens a security hole | Errors fail the Bot's status check; syntax errors are fatal; VIP's definition of errors |
| Fix before merge | `WARNING` of severity 6 to 10 on a changed line; manual findings that will hurt at scale (an uncached remote call on a front-end page, an unbounded query) | VIP: warnings of severity 6 and above should be addressed |
| Should fix | `WARNING` of severity 5 on a changed line | VIP recommends addressing all of them |
| Cleanup | `WARNING` of severity 1 to 4 on a changed line | Best-practice deviations |
| Pre-existing | Any finding on a line the change did not touch | The Bot reports only altered sections; list these separately and never block the change for them |
| False positive | The sniff fired but the code is safe; give the exact annotation to add, with its reason | VIP acknowledges false positives |

Two adjustments after reading the code:

- **Raise a warning to Blocker** when it will break on VIP or is a real vulnerability. Examples: a
  `file_ops_*` warning whose path is outside `/tmp` and the uploads directory (the write fails on a read-only
  container, [plugins/incompatibilities](https://docs.wpvip.com/plugins/incompatibilities/)); an `InputNotSanitized`
  warning where the raw value reaches SQL or output.
- **A verified false positive on an `ERROR` still fails the Bot's check.** List it under false positives with the
  annotation to add. Until the annotation is in the change, the merge stays blocked wherever the status check is
  required.

## Type and severity changes in `WordPress-VIP-Go`

What the ruleset changes on top of `WordPressVIPMinimum`
([WordPress-VIP-Go ruleset](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/WordPress-VIP-Go/ruleset.xml)).
Everything not listed keeps the type `WordPressVIPMinimum` gives it (the sniff's own, except the codes that ruleset
raises to errors or lowers to warnings, which `sniff-catalogue.md` notes) and severity 5, the PHPCS default
([PHPCS Advanced Usage](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage)). Codes below drop
the `WordPressVIPMinimum.` prefix where the sniff is VIP's own.

| Code | Type and severity in `WordPress-VIP-Go` | Ruleset's note |
| ---- | --------------------------------------- | -------------- |
| `WordPress.Security.ValidatedSanitizedInput.InputNotSanitized` | warning, 10 | Needs a manual check |
| `Hooks.RestrictedHooks.upload_mimes` | warning, 10 | |
| `Security.PHPFilterFunctions` (all codes) | warning, 10 | |
| `Functions.RestrictedFunctions.wp_mail_wp_mail` | warning, 7 | |
| `Functions.RestrictedFunctions.file_ops_*` (`file_put_contents`, `flock`, `fputcsv`, `fputs`, `fwrite`, `ftruncate`, `is_writable`, `is_writeable`, `link`, `rename`, `symlink`, `tempnam`, `touch`, `unlink`) | warning, 6 | Only `/tmp/` and `wp-content/uploads/` work; use `get_temp_dir()` or `wp_get_upload_dir()` for the path |
| `UserExperience.AdminBarRemoval.RemovalDetected`, `.HidingDetected` | warning, 6 | Can be ignored if the `administrator` and `vip_support` roles are excluded |
| `Functions.RestrictedFunctions.cookies_setcookie` | error, 6 | |
| `Variables.RestrictedVariables.cache_constraints___COOKIE` | error, 6 | |
| `Variables.RestrictedVariables.cache_constraints___SERVER__HTTP_USER_AGENT__` | error, 6 | |
| `Functions.RestrictedFunctions.attachment_url_to_postid_attachment_url_to_postid`, `url_to_postid_url_to_postid`, `wp_old_slug_redirect_wp_old_slug_redirect`, `get_adjacent_post_*` (`get_adjacent_post`, `get_previous_post`, `get_previous_post_link`, `get_next_post`, `get_next_post_link`) | warning, 5 | Uncached; the sniff itself reports these as errors |
| `Functions.RestrictedFunctions.get_posts_get_children` | warning, 3 | Uncached and a no-limit query; use `get_posts()` or `WP_Query` |
| `Functions.RestrictedFunctions.get_posts_get_posts`, `get_posts_wp_get_recent_posts` | warning, 3 | |
| `WordPress.PHP.DontExtract` | error, 3 | |
| `WordPress.PHP.DiscouragedPHPFunctions.urlencode_urlencode`, `Universal.Operators.StrictComparisons`, `WordPress.PHP.StrictInArray.MissingTrueStrict`, `Performance.LowExpiryCacheTime.LowCacheTime`, `Functions.RestrictedFunctions.switch_to_blog_switch_to_blog` | warning, 3 | |
| `WordPress.WP.EnqueuedResources.NonEnqueuedScript`, `.NonEnqueuedStylesheet` | warning, 3 | Enqueued assets can be concatenated |
| `Files.IncludingFile` (all codes) | warning, 3 | |
| `VariableAnalysis.CodeAnalysis.VariableAnalysis.UndefinedVariable` | severity 3 | |
| `WordPress.Security.EscapeOutput.UnsafePrintingFunction` | error, 1 | Translations are trusted on VIP Go |
| `Generic.PHP.NoSilencedErrors` | error, 1 | |
| `Internal.LineEndings.Mixed`, `Generic.CodeAnalysis.AssignmentInCondition`, `WordPress.CodeAnalysis.AssignmentInTernaryCondition.FoundInTernaryCondition`, `Functions.RestrictedFunctions.is_multi_author_is_multi_author` | severity 1 | |
| `VariableAnalysis.CodeAnalysis.VariableAnalysis.UnusedVariable`, `WordPress.DB.SlowDBQuery.slow_db_query_meta_key`, `Generic.PHP.DisallowShortOpenTag.EchoFound`, `WordPress.WP.AlternativeFunctions.file_system_operations_readfile`, `.file_system_operations_fclose`, `WordPress.Security.EscapeOutput.ExceptionNotEscaped` | severity 0 (never reported) | `meta_key` is silenced because VIP Go has a combined index on `meta_key` and `meta_value` |
| `WordPressVIPMinimum.JS`, `WordPressVIPMinimum.Functions.DynamicCalls` | excluded | Deprecated in 3.1.0 |

Types above come from the sniff when the ruleset does not set one: `DontExtract` is an error in WordPressCS
([DontExtractSniff.php](https://github.com/WordPress/WordPress-Coding-Standards/blob/3.4.1/WordPress/Sniffs/PHP/DontExtractSniff.php)),
`UnsafePrintingFunction` is an error
([EscapeOutputSniff.php](https://github.com/WordPress/WordPress-Coding-Standards/blob/3.4.1/WordPress/Sniffs/Security/EscapeOutputSniff.php)),
`NoSilencedErrors` is set to error in `WordPressVIPMinimum`
([WordPressVIPMinimum ruleset](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/WordPressVIPMinimum/ruleset.xml)),
and `cookies` is an error group in
[RestrictedFunctionsSniff.php](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/WordPressVIPMinimum/Sniffs/Functions/RestrictedFunctionsSniff.php).
Note that a severity 1 or 3 error still fails the Bot's status check, because the Bot reports from severity 1.
