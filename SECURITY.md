# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Do not open a public issue for a security problem.

You will get a reply within seven days. Fixes are released as a new version of the affected skill (the `version`
in its `SKILL.md` front matter goes up) with a note in the commit message.

## What the skills contain

The skills are documents: Markdown instructions and reference notes that a coding agent reads when a task matches.
They hold no API keys, passwords or tokens, and no skill asks you for one.

- Helper scripts live in a skill's `scripts/` folder, and every one of them is read-only. A helper reads the files
  you point it at, or runs read-only commands such as SQL `SELECT` statements or WP-CLI read commands, and prints
  the result. No helper writes to a site, a database or the files it reads, and no helper makes network requests.
- A skill may tell the agent to run a third-party tool, such as PHP_CodeSniffer or WP-CLI. Those tools come from
  their own projects and are installed only when you agree to it.
- A skill that changes a live site states a backup step and a rollback step first, prefers a dry run, and tells the
  agent to ask you before any write.

Report it as a vulnerability if a skill tells an agent to send data anywhere, to weaken a site's security, or to
run a write command without a backup and your confirmation.

## Supported versions

Only the latest version of each skill receives fixes.
