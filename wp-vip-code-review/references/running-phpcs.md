# Running PHPCS the way VIP does

Read this when you need to install or run PHP_CodeSniffer (PHPCS) with the VIP standards, read its output, or
judge an ignore annotation. Facts checked on 2026-09-26; the source is beside each one.

## What VIP runs on a pull request

The VIP Code Analysis Bot ("the Bot") reviews pull requests made to an application's `wpcomvip` GitHub repository.

| Fact | Source |
| ---- | ------ |
| The Bot runs PHPCS on the PHP and JavaScript files a pull request alters or creates, with two standards: `WordPress-VIP-Go` and `PHPCompatibilityWP`. | [vip-code-analysis-bot/phpcs-analysis](https://docs.wpvip.com/vip-code-analysis-bot/phpcs-analysis/) |
| The Bot's PHPCS severity is `1` by default, so it reports messages of severity 1 and above. | [vip-code-analysis-bot/phpcs-analysis](https://docs.wpvip.com/vip-code-analysis-bot/phpcs-analysis/) |
| Bot feedback covers only the altered or new sections of each file; unaltered files are not analyzed. | [vip-code-analysis-bot/phpcs-analysis](https://docs.wpvip.com/vip-code-analysis-bot/phpcs-analysis/) |
| `PHPCompatibilityWP` runs with `testVersion` set to the highest PHP version among the environments the repository deploys to (environments on PHP 8.1 and 8.2 give `8.2-`). | [vip-code-analysis-bot/phpcs-analysis](https://docs.wpvip.com/vip-code-analysis-bot/phpcs-analysis/) |
| The Bot runs `php -l` on modified PHP files, once for each PHP version used by the environments the repository deploys to. | [vip-code-analysis-bot/php-linting](https://docs.wpvip.com/vip-code-analysis-bot/php-linting/) |
| Added or changed SVG files are scanned, and tags or attributes outside the scanner's allowed list are reported. | [vip-code-analysis-bot/svg-analysis](https://docs.wpvip.com/vip-code-analysis-bot/svg-analysis/) |
| Plugins and themes added or changed under `/plugins`, `/client-mu-plugins` and `/themes` are checked against the WPScan API for known vulnerabilities and newer versions. | [codebase-manager/vulnerability-and-update-scan](https://docs.wpvip.com/codebase-manager/vulnerability-and-update-scan/) |
| The status reads "No significant issues found" when nothing, or only warnings, were found. One or more `error` items make the status check fail. Informational comments do not affect it. | [vip-code-analysis-bot/build-status](https://docs.wpvip.com/vip-code-analysis-bot/build-status/) |
| The Bot stops after ten minutes; the status then shows `failure` with no message, and the pull request can still be merged. | [vip-code-analysis-bot/build-status](https://docs.wpvip.com/vip-code-analysis-bot/build-status/) |
| The Bot does not read `.phpcs.xml.dist`; that file only configures local runs. The skeleton's copy sets severity 1 "to match VIP Code Analysis Bot defaults". | [vip-go-skeleton/.phpcs.xml.dist](https://github.com/Automattic/vip-go-skeleton/blob/master/.phpcs.xml.dist) |
| Commits made straight to a deploy branch are not analyzed. The pull request must stay open during analysis and needs at least one commit from the last 7 days. | [vip-code-analysis-bot/default-behavior](https://docs.wpvip.com/vip-code-analysis-bot/default-behavior/) |
| Pull requests opened from the VIP Dashboard Plugins panel are not analyzed by default. | [vip-code-analysis-bot/default-behavior](https://docs.wpvip.com/vip-code-analysis-bot/default-behavior/) |
| The Bot posts at most 18 comments per review and keeps at most 100 active comments on a pull request. | [vip-code-analysis-bot/feedback](https://docs.wpvip.com/vip-code-analysis-bot/feedback/) |
| Automatic approval (label `[Status] VIP Auto Approved`) applies when every change is a non-functional PHP change, a file type on VIP's list (CSS, images, fonts, `.json`, `.md`, `.po`, `.yml` and others), or an SVG the scanner passes. | [vip-code-analysis-bot/auto-approvals](https://docs.wpvip.com/vip-code-analysis-bot/auto-approvals/) |

## Settings that change what the Bot checks

A pull request that adds or edits any of these changes the review itself. Report it as a finding and ask why.

| Setting | Effect | Source |
| ------- | ------ | ------ |
| `.vipgoci_options` (JSON at the repository root, read from the branch being analyzed) | `phpcs-sniffs-exclude` disables sniffs, `phpcs-severity` (1 to 10, default 1) hides lower severities, `"phpcs": false` turns PHPCS off, `"skip-execution": true` turns the Bot off, plus `svg-checks`, `wpscan-api`, `lint-modified-files-only`, `skip-draft-prs`, `autoapprove` | [customize-the-bot](https://docs.wpvip.com/vip-code-analysis-bot/customize-the-bot/) |
| `.vipgoci_phpcs_skip_folders`, `.vipgoci_lint_skip_folders` | Directories listed one per line are skipped by PHPCS or by PHP linting | [customize-phpcs](https://docs.wpvip.com/vip-code-analysis-bot/customize-phpcs/) |
| `.vipgoci_svg_skip_folders` | Directories skipped by SVG analysis | [svg-analysis](https://docs.wpvip.com/vip-code-analysis-bot/svg-analysis/) |
| `.vipgoci_wpscan_api_skip_folders`, label `skip-wpscan` | Skips the vulnerability and update scan | [vulnerability-and-update-scan](https://docs.wpvip.com/codebase-manager/vulnerability-and-update-scan/) |
| Label `skip-phpcs-scan` | No PHPCS scan for that pull request; linting still runs | [customize-phpcs](https://docs.wpvip.com/vip-code-analysis-bot/customize-phpcs/) |

## Versions

| Fact | Source |
| ---- | ------ |
| VIP Coding Standards (VIPCS) 3.1.0 was released on 2026-07-27. | [VIPCS release 3.1.0](https://github.com/Automattic/VIP-Coding-Standards/releases/tag/3.1.0) |
| VIPCS 3.1.0 requires PHP 7.4+, PHPCS 3.13.5+, PHPCSUtils 1.2.3+, PHPCSExtra 1.5.1+, WordPressCS (WPCS) 3.4.1+ and VariableAnalysis 2.13.0+. | [VIPCS README](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/README.md) |
| Its Composer constraint for PHPCS is `^3.13.5`, so it installs a PHPCS 3.x release. PHPCS 4.x releases exist; a project already on PHPCS 4 cannot use VIPCS 3.1.0. | [VIPCS composer.json](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/composer.json), [PHPCS releases](https://github.com/PHPCSStandards/PHP_CodeSniffer/releases) |
| VIPCS ships two standards: `WordPressVIPMinimum` (for the older WordPress.com VIP platform) and `WordPress-VIP-Go` (for VIP Go). `WordPress-VIP-Go` includes `WordPressVIPMinimum` and changes types, severities and messages. | [VIPCS README](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/README.md), [WordPress-VIP-Go ruleset](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/WordPress-VIP-Go/ruleset.xml) |
| The old `WordPress-VIP` standard is deprecated and should not appear in `phpcs -i`. After a correct install, `phpcs -i` lists `WordPress-VIP-Go`, `WordPressVIPMinimum`, `Modernize`, `NormalizedArrays`, `Universal`, `PHPCSUtils`, `VariableAnalysis` and the `WordPress` standards. | [php_codesniffer/installed-standards](https://docs.wpvip.com/php_codesniffer/installed-standards/) |
| VIPCS 3.1.0 hard-deprecated the JavaScript sniffs (`WordPressVIPMinimum.JS.*`) and `WordPressVIPMinimum.Functions.DynamicCalls`: both are excluded from the rulesets and are due for removal in 4.0.0. `WordPressVIPMinimum.Security.Twig` was removed. | [VIPCS release 3.1.0](https://github.com/Automattic/VIP-Coding-Standards/releases/tag/3.1.0) |

## Getting PHPCS

Ask the user before installing anything. Use the first option that applies.

1. **The repository already has it.** Look for `vendor/bin/phpcs` and run `vendor/bin/phpcs -i`.
2. **The repository's `composer.json` requires it.** The VIP skeleton requires `automattic/vipwpcs` `^3` and
   `phpcompatibility/phpcompatibility-wp` `^2`, and ignores `/vendor/` in git, so `composer install --no-scripts`
   from the repository root adds the tools without changing tracked files. `--no-scripts` stops the repository's own
   Composer scripts (`post-install-cmd` and the rest), which are code from the change, from running; Composer
   plugins still run, the standards installer among them, so when the change edits `composer.json` or
   `composer.lock`, use option 3 instead. If the repository has no `composer.lock`, Composer writes one: tell the
   user, and keep it out of the change under review.
   Sources: [skeleton composer.json](https://github.com/Automattic/vip-go-skeleton/blob/master/composer.json),
   [skeleton .gitignore](https://github.com/Automattic/vip-go-skeleton/blob/master/.gitignore),
   [php_codesniffer/phpcs-xml-dist](https://docs.wpvip.com/php_codesniffer/phpcs-xml-dist/),
   [Composer scripts](https://github.com/composer/composer/blob/main/doc/articles/scripts.md),
   [Composer CLI, global options](https://github.com/composer/composer/blob/main/doc/03-cli.md).
3. **Global install**, as VIP documents it. It changes the user's global Composer setup, so ask first:

   ```sh
   composer global config allow-plugins.dealerdirect/phpcodesniffer-composer-installer true
   composer global require --dev automattic/vipwpcs -W
   composer global require --dev phpcompatibility/phpcompatibility-wp:"*"
   ```

   The `phpcs` binary lands in `~/.composer/vendor/bin` (on some Linux systems `~/.config/composer/vendor/bin`),
   which must be on `PATH`. Composer 2.2 and later needs the `allow-plugins` permission for the installer plugin
   that registers the standards.
   Sources: [VIPCS README](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/README.md),
   [php_codesniffer/install-globally](https://docs.wpvip.com/php_codesniffer/install-globally/),
   [PHP version scans](https://docs.wpvip.com/wordpress-on-vip/php/versions/phpcs-scans/).
4. **Project-level install** (`composer config allow-plugins.dealerdirect/phpcodesniffer-composer-installer true`
   then `composer require --dev automattic/vipwpcs`) edits `composer.json` and `composer.lock`. Only with the
   owner's agreement, and not as part of the change under review.
   Sources: [VIPCS README](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/README.md),
   [php_codesniffer/install-at-project-level](https://docs.wpvip.com/php_codesniffer/install-at-project-level/).

If PHPCS cannot be installed, do the manual review only and say in the report that PHPCS was not run.

## Commands for a change

Scan only the files the change touches, the way the Bot does, then keep only the changed lines with
`scripts/filter-report.php`. `BASE` is the branch the pull request targets; `OUT` is a scratch folder outside the
repository, so nothing lands in the working tree.

```sh
BASE=origin/production   # or origin/main, origin/develop: the pull request's target branch
OUT="$(mktemp -d)"
git fetch origin
git -c core.quotePath=false diff --name-only --diff-filter=d "$BASE...HEAD" -- '*.php' '*.inc' '*.js' > "$OUT/files.txt"
git diff "$BASE...HEAD" > "$OUT/change.diff"
vendor/bin/phpcs --standard=WordPress-VIP-Go --severity=1 -s --basepath=. \
  --report=json --report-file="$OUT/phpcs.json" --file-list="$OUT/files.txt"
php <skill folder>/scripts/filter-report.php --report="$OUT/phpcs.json" --diff="$OUT/change.diff"
```

Passing `--standard` on the command line also means PHPCS does not load the repository's `.phpcs.xml.dist`, which
matches the Bot: only when no standard is given does PHPCS look for a `[.]phpcs.xml[.dist]` file and use it
([PHPCS Usage](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Usage),
[PHPCS 3.13.5 Config.php](https://github.com/PHPCSStandards/PHP_CodeSniffer/blob/3.13.5/src/Config.php)).

| Fact | Source |
| ---- | ------ |
| `git diff A...B` shows the changes on B since the common ancestor of A and B, the same range a pull request shows. `--diff-filter=d` drops deleted files. | [git-diff](https://git-scm.com/docs/git-diff) |
| PHPCS shows errors and warnings of severity 5 and above unless told otherwise (`--severity`, `--error-severity`, `--warning-severity`). Without `--severity=1` a local run hides the severity 1 to 4 messages the Bot reports. | [PHPCS Usage](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Usage), [PHPCS 3.13.5 Config.php](https://github.com/PHPCSStandards/PHP_CodeSniffer/blob/3.13.5/src/Config.php) |
| `-s` adds the sniff code to each message; `--basepath=.` shortens paths; `--ignore=vendor` skips a folder; `-p` shows progress. VIP's own example: `phpcs --standard=WordPress-VIP-Go -sp --basepath=. --ignore=vendor path/to/code`. | [php_codesniffer/run-against-code](https://docs.wpvip.com/php_codesniffer/run-against-code/) |
| `--file-list=<file>` reads the paths to check from a file, one per line (PHPCS 3.13.5). | [PHPCS 3.13.5 Config.php](https://github.com/PHPCSStandards/PHP_CodeSniffer/blob/3.13.5/src/Config.php) |
| `--filter=GitModified` checks only untracked and modified files in the working tree (`git ls-files -o -m`), and `--filter=GitStaged` only staged files. Use them for uncommitted work, not for a branch range. | [PHPCS Usage](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Usage), [GitModified.php](https://github.com/PHPCSStandards/PHP_CodeSniffer/blob/3.13.5/src/Filters/GitModified.php) |
| To mirror the Bot's second standard, run `phpcs --standard=PHPCompatibilityWP --severity=1 --runtime-set testVersion 8.2- --extensions=php <path>` with the highest PHP version the environments run. | [PHP version scans](https://docs.wpvip.com/wordpress-on-vip/php/versions/phpcs-scans/) |
| `phpcs --standard=WordPress-VIP-Go,PHPCompatibilityWP -e` lists every sniff the two standards enable. | [customize-the-bot](https://docs.wpvip.com/vip-code-analysis-bot/customize-the-bot/) |
| A large scan can run out of memory; scan smaller parts, such as one plugin directory at a time. | [php_codesniffer/run-against-code](https://docs.wpvip.com/php_codesniffer/run-against-code/) |
| On Windows, VIP notes that PHPCS commands may need different formatting from its examples. | [php_codesniffer/install-globally](https://docs.wpvip.com/php_codesniffer/install-globally/) |
| Lint each changed PHP file with `php -l <file>`, as the Bot does; syntax errors are often fatal. | [vip-code-analysis-bot/php-linting](https://docs.wpvip.com/vip-code-analysis-bot/php-linting/) |

Write the JSON to a file with `--report-file`: anything else PHPCS prints then stays out of the JSON.

## Reading the output

| Fact | Source |
| ---- | ------ |
| The default "full" report lists, per file, the line, `ERROR` or `WARNING`, `[x]` when `phpcbf` can fix it, and the message; with `-s` the sniff code follows in brackets. It does not show severity. | [PHPCS Reporting](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Reporting) |
| The JSON report has `totals` (`errors`, `warnings`, `fixable`) and `files`, keyed by path, each with `errors`, `warnings` and `messages`. Each message has `message`, `source`, `severity`, `fixable`, `type` (`ERROR` or `WARNING`), `line` and `column`. | [PHPCS Reporting](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Reporting), [Json.php](https://github.com/PHPCSStandards/PHP_CodeSniffer/blob/3.13.5/src/Reports/Json.php) |
| The CSV report's columns are `File,Line,Column,Type,Message,Source,Severity,Fixable`; parse the header row, as the order may change. | [PHPCS Reporting](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Reporting) |
| PHPCS gives every error and warning severity 5 unless a standard changes it. | [PHPCS Advanced Usage](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage) |
| A source code reads `Standard.Category.Sniff.Code`. For `WordPressVIPMinimum.Functions.RestrictedFunctions` the last part is the group and the function, as in `file_ops_file_put_contents`. | [RestrictedFunctionsSniff.php](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/WordPressVIPMinimum/Sniffs/Functions/RestrictedFunctionsSniff.php), [WordPress-VIP-Go ruleset](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/WordPress-VIP-Go/ruleset.xml) |
| A ruleset's type or severity change applies when it names the full code, the sniff, the category or the whole standard; PHPCS checks those four levels and nothing in between. | [PHPCS 3.13.5 File.php](https://github.com/PHPCSStandards/PHP_CodeSniffer/blob/3.13.5/src/Files/File.php) |
| PHPCS 3.x exit codes: `0` no errors found, `1` errors found, `2` fixable errors found, `3` processing error. PHPCS 4 changed them. | [PHPCS Advanced Usage](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage) |

Consequence of the last-but-one row: the `WordPress-VIP-Go` ruleset lists
`WordPressVIPMinimum.Performance.WPQueryParams.PostNotIn` at severity 3, but since VIPCS 3.0.0 that sniff emits
`PostNotIn_post__not_in` and `PostNotIn_exclude`
([CHANGELOG 3.0.0](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/CHANGELOG.md)), so those warnings
arrive at the default severity 5. Always read the severity from the JSON, not from the ruleset.

## Ignore annotations

| Fact | Source |
| ---- | ------ |
| `// phpcs:ignore <codes>` ignores its own line when it follows code, or the next line when it stands alone. `// phpcs:disable <codes>` and `// phpcs:enable` wrap a block. | [PHPCS Advanced Usage](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage) |
| Codes can be a message code, a sniff, a category or a whole standard, comma separated; a reason follows `--`. Without codes, every check is off for those lines. | [PHPCS Advanced Usage](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage) |
| The old `@codingStandardsIgnoreStart`, `@codingStandardsIgnoreEnd` and `@codingStandardsIgnoreLine` comments are deprecated since PHPCS 3.2.0 and removed in 4.0. | [PHPCS Advanced Usage](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage) |
| VIP recommends disabling only the specific sniff that applies, and shows annotations with a reason after `--`. The Bot honours the annotations; `--ignore-annotations` shows what they hide. | [customize-phpcs](https://docs.wpvip.com/vip-code-analysis-bot/customize-phpcs/) |

Review rule for this skill: an annotation added by the change must name the exact code and give a reason, and the
reason must hold when you read the code. A bare `phpcs:ignore` or `phpcs:disable`, or one on a security or
filesystem sniff without a convincing reason, is a finding at the level of the message it hides. Run once with
`--ignore-annotations` to see what the new annotations hide.
