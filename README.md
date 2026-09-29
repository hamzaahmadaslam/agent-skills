# Agent skills

Sixteen skills for coding agents that support the [Agent Skills format](https://agentskills.io/specification):
WordPress VIP code review, multisite and WooCommerce migrations, checkout and Core Web Vitals audits, database and
cron health, a full scan and recovery for hacked sites, two audits for AI systems, four WooCommerce investigations
(held stock, scheduled sales, product lookup tables, one order's tax) and database collation drift. Each skill covers
a task that the public skill collections did not cover, or covered in a line or two, when this collection was planned
in September 2026.

Every fact in a skill's `references/` folder has its source URL beside it, and every `SKILL.md` records the date
its facts were last checked (`metadata.last_verified`).

## The skills

| Skill                                                                       | What it does                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [wp-vip-code-review](wp-vip-code-review/SKILL.md)                           | Reviews a change against Automattic's VIP coding standards and the WordPress VIP platform rules                                            |
| [wp-multisite-migration](wp-multisite-migration/SKILL.md)                   | Moves a subsite out of or into a network: tables, users, uploads, domain mapping, search-replace                                           |
| [woo-hpos-live-migration](woo-hpos-live-migration/SKILL.md)                 | Migrates a live store to HPOS: compatibility, sync, verification, cut-over and rollback                                                    |
| [woo-checkout-performance-audit](woo-checkout-performance-audit/SKILL.md)   | Audits a running checkout: sessions, cart fragments, Action Scheduler, gateways, object cache                                              |
| [wp-cwv-field-triage](wp-cwv-field-triage/SKILL.md)                         | Traces CrUX field data and INP attribution to the plugin or theme responsible                                                              |
| [wp-slow-query-investigation](wp-slow-query-investigation/SKILL.md)         | Finds slow queries (Query Monitor, the slow query log), reads `EXPLAIN` on MySQL and MariaDB, fixes them with a rollback                   |
| [wp-cron-action-scheduler-health](wp-cron-action-scheduler-health/SKILL.md) | Moves WP-Cron to a real cron and keeps Action Scheduler healthy                                                                            |
| [wp-autoload-audit](wp-autoload-audit/SKILL.md)                             | Measures and cleans autoloaded options with the WordPress 6.6 values, with rollback                                                        |
| [agent-tool-call-audit](agent-tool-call-audit/SKILL.md)                     | Reviews the tool calls an agent made (a transcript or log) for scope, data exposure and irreversible steps                                 |
| [rag-corpus-audit](rag-corpus-audit/SKILL.md)                               | Audits a knowledge base before indexing: chunk quality, duplicates, stale claims, contradictions, coverage gaps, secrets and personal data |
| [wp-full-site-scan](wp-full-site-scan/SKILL.md)                             | Scans a hacked site from a backup and a database dump, cleans both together, restores with a rollback, finds the way in                    |
| [woo-stock-reservation-reconciliation](woo-stock-reservation-reconciliation/SKILL.md) | Explains why WooCommerce holds units back (reservations, unpaid orders) and reconciles stock with the shelf without overselling            |
| [woo-scheduled-sale-state-audit](woo-scheduled-sale-state-audit/SKILL.md)   | Finds why a scheduled sale starts, ends or shows at the wrong time, or why `_price` disagrees with the sale window                         |
| [woo-product-lookup-integrity](woo-product-lookup-integrity/SKILL.md)       | Checks the product lookup tables row by row against the products, before and after a regeneration                                          |
| [woo-tax-rounding-trace](woo-tax-rounding-trace/SKILL.md)                   | Rebuilds one order's tax to the cent and finds where the cart, the order, a refund and the gateway start to differ                         |
| [wp-database-collation-drift](wp-database-collation-drift/SKILL.md)         | Goes from an "Illegal mix of collations" error to the columns involved and the narrowest conversion, with a rollback                       |

## Install a skill

A skill is a folder. Copy the whole folder into your agent's skills folder; your agent's documentation says where
that folder is and whether it applies to one project or to every project.

```sh
git clone --depth 1 https://github.com/hamzaahmadaslam/agent-skills.git
cp -R agent-skills/wp-vip-code-review "<your agent's skills folder>/"
```

Copy the folder, not only `SKILL.md`: the instructions load files from `references/` and `scripts/` by relative
path. To update a skill, replace its folder with the new copy. The agent reads a skill's `name` and `description`
at startup and loads the rest only when a task matches.

## What a skill does and does not do

- A skill is instructions. Nothing runs until your agent picks the skill for a task and follows it.
- Helper scripts make no network requests and change nothing they read; one writes a corrected copy of a database
  dump to a new file you name ([SECURITY.md](SECURITY.md)).
- Skills that touch a live site tell the agent to take a backup first, prefer a dry run, and ask you before any
  write.
- A skill does not replace testing on a staging copy of your site. Check what the agent reports before you act.

## Request a fix

Open an issue in this repository with:

1. the skill's name and the file (for example `wp-vip-code-review/references/sniff-catalogue.md`);
2. what the skill says and what is wrong with it;
3. a link to the primary source that shows the correct fact: vendor documentation, source code or release notes.

A pull request that corrects a fact changes the reference text, its source URL and the skill's
`metadata.version` together. Security problems go through private reporting instead ([SECURITY.md](SECURITY.md)).

## Maintenance

Each skill is re-checked against its sources every quarter, and a link check runs on the first day of every month
and on every pull request. A script check parses every helper script on every pull request and push to `main`.
[MAINTENANCE.md](MAINTENANCE.md) has the procedure.

## License

MIT. Made by [Hamza Ahmad Aslam](https://hamzaahmadaslam.com), WordPress and web performance engineer.
