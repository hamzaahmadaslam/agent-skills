---
name: wp-cwv-field-triage
description: "Trace poor Core Web Vitals on a WordPress site from real-user field data to the plugin, theme, setting or third-party tag responsible. Reads CrUX (CrUX API, History API, BigQuery, PageSpeed Insights field data, Search Console's Core Web Vitals report: URL groups, 28-day windows, 75th percentile), applies the LCP, INP and CLS thresholds, collects attribution with the web-vitals attribution build (LCP subparts, INP phases, Long Animation Frame scripts, CLS shift targets), maps script URLs, handles and elements to wp-content/plugins/<slug>, themes, mu-plugins, core or third parties, and checks WordPress causes: render-blocking plugin assets, a lazy-loaded LCP image, fetchpriority, script loading strategies (6.3+), speculative loading (6.8+), page builders, tag managers. Use when a WordPress site fails Core Web Vitals in PageSpeed Insights or Search Console, when a metric regressed, or to decide which plugin to fix, replace or remove. Read-only by default; the report keeps field evidence apart from lab guesses."
license: MIT
compatibility: "Helper scripts need Node.js 20 or later and no packages. CrUX API queries need a Google Cloud API key that the user exports as CRUX_API_KEY; BigQuery needs a Google Cloud project. Confirming a cause needs WP-CLI read access and a staging copy. Written against WordPress 7.1.2 and web-vitals 6.2.2; references/wordpress-version-notes.md covers older WordPress releases."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.0"
  last_verified: "2026-09-26"
---

# Core Web Vitals field triage for WordPress

This skill starts from what real visitors experienced (CrUX and the site's own real-user data) and ends with named
WordPress components: a plugin, the theme, a core setting or a third-party tag, each with the evidence that points at
it and how strong that evidence is. It reads and measures; it changes a site only when the user approves a specific
step. It does not rewrite plugin code, and it does not chase lab scores: a Lighthouse number is a lab guess until field
data agrees.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
are sourced in `references/`, next to each fact: web.dev, developer.chrome.com, Google's Search and PageSpeed Insights
documentation, the GoogleChrome/web-vitals and GoogleChrome/CrUX repositories, make.wordpress.org/core,
developer.wordpress.org, and the WordPress source at 7.1.2.

## When to use

- PageSpeed Insights or Search Console shows poor or needs-improvement LCP, INP or CLS for a WordPress site, and the
  question is which plugin, theme, setting or tag causes it.
- A metric regressed (a Search Console status change, a CrUX History trend) and the question is what changed.
- Deciding whether to configure, replace or remove a plugin (page builder, slider, form, chat, analytics) based on its
  measured cost to visitors.
- Checking whether a fix worked for real visitors.

Not the right tool for: a lab score with no field data at all (use lab tools and call every finding a hypothesis), or
the server side once TTFB is shown to be the problem (hand that to the collection's `wp-slow-query-investigation`
skill).

## What you need

- The site URL and the pages or Search Console URL groups in question.
- PageSpeed Insights (no setup). Optional: a CrUX API key the user exports as `CRUX_API_KEY`, access to the Search
  Console property, a Google Cloud project for BigQuery.
- The HTML of affected pages as a logged-out visitor.
- For attribution: an export from the site's RUM, or the owner's approval to add the beacon in
  `references/rum-attribution.md`.
- For confirmation: WP-CLI read access and a staging copy of the site.

## Safety rules

1. Read-only by default. Reading field data, saving HTML, `grep`, and WP-CLI read commands (`wp core version`,
   `wp plugin list`, `wp theme list`, `wp config get <NAME>`) need no approval. Anything that changes a site (the
   beacon, a snippet, deactivating a plugin, a setting, a tag) needs the user's approval for that step, with its
   backup, check and undo stated first. One approval covers one step.
2. Staging first. Never deactivate plugins or change settings on production to test a guess.
3. Keys stay with the user. Never ask for the CrUX API key, print it, or write it to a file; commands read
   `$CRUX_API_KEY` from the user's own shell. Never run `wp config list` (it prints database credentials).
4. Real-user collection sends no personal data, follows the site's consent setup, is sampled, and is removed (or kept
   on purpose) when the investigation ends.
5. Evidence before blame. Never name a component as the cause from code reading or a single lab run. Label every
   owner Confirmed, Likely or Hypothesis (`references/lab-confirmation.md`).
6. Compare like with like: the 75th percentile, one device type, the same page or URL group, 28-day windows. Say when
   PageSpeed Insights shows origin data because the URL has too little.
7. Test as a logged-out visitor: WordPress turns speculative loading off for logged-in users, and logged-in pages can
   differ in other ways (for example the admin toolbar).

## Thresholds (75th percentile, mobile and desktop separately)

| Metric | Good | Needs improvement | Poor |
| --- | --- | --- | --- |
| LCP | up to 2,500 ms | up to 4,000 ms | over 4,000 ms |
| INP | up to 200 ms | up to 500 ms | over 500 ms |
| CLS | up to 0.1 | up to 0.25 | over 0.25 |
| FCP (diagnostic) | up to 1,800 ms | up to 3,000 ms | over 3,000 ms |
| TTFB (diagnostic) | up to 800 ms | up to 1,800 ms | over 1,800 ms |

A page or origin passes when LCP, INP and CLS are all good at the 75th percentile; without INP data it passes on LCP
and CLS. Details and what each metric counts: `references/metrics-and-thresholds.md`.

## Procedure

### 1. Establish the field evidence (read-only)

- PageSpeed Insights, top section ("Discover what your real users are experiencing"): the affected URL and the origin,
  mobile and desktop. Write down which view is shown (URL or origin fallback), the collection period and each p75.
- CrUX API, if the user has a key. Save the JSON and summarize it:

  ```sh
  curl -s --request POST "https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=$CRUX_API_KEY" \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://www.example.com/shop/","formFactor":"PHONE"}' > crux-url-phone.json
  node scripts/crux-summary.mjs crux-url-phone.json
  ```

  Query the origin too, and both form factors. A `404` means no data for that exact key: check the scheme and `www`,
  then fall back to the origin.
- Since when: the CrUX History API (`queryHistoryRecord`, up to 40 weekly periods) or CrUX Vis. A step change shows as
  a ramp over about four weekly periods; it began in the week before the end of the first period that moved. Line that
  week up with plugin and theme updates, new tags and settings changes.
- Search Console, Core Web Vitals report: which URL groups fail, on which device, with which example URLs. Group values
  are the 75th percentile over 28 days. Open three example URLs per failing group; their body classes name the
  template (step 4).
- BigQuery only for monthly origin trends or a country breakdown.

Output of this step, one line per failing combination, for example: "INP needs improvement on mobile for product pages
(single-product), since the period ending 2026-07-18; LCP poor on mobile origin-wide". If CrUX has no data for the
site, say so and go to step 3. Sources, commands and caveats: `references/field-data-sources.md`.

### 2. Split the failing metric into its parts (read-only)

- LCP: CrUX `largest_contentful_paint_resource_type` (image or text) and the four image subparts. The subparts are each
  their own p75 and do not add up; use them to rank. The largest one picks the section of `references/lcp-wordpress.md`.
  For text LCP use TTFB and FCP instead.
- INP: CrUX has no breakdown. The phase and the script come from real-user attribution (step 3).
- CLS: compare field and lab CLS in PageSpeed Insights. A much higher field value points at post-load shifts.
- Context: CrUX `navigation_types` (share of prerender and back/forward cache navigations) and `round_trip_time` (the
  visitors' network, not the site).

### 3. Get attribution from real visitors

- If the site has RUM with attribution (a RUM product, or GA4 with web-vitals events), export it and map the fields to
  the payload in `references/rum-attribution.md`.
- Otherwise propose the beacon from that file: three files in `mu-plugins`, the web-vitals 6.2.2 attribution build,
  sampling at 10%, an endpoint the owner chooses. Staging first, then production, each with approval. Undo: delete the
  files.
- Collect until the failing page types have enough records (the summary flags groups under 50), then run:

  ```sh
  node scripts/rum-summary.mjs beacons.ndjson --site=https://www.example.com
  node scripts/rum-summary.mjs beacons.ndjson --site=https://www.example.com --metric=INP --device=mobile --chromium-only
  ```

- Filter to Chromium and one device type when comparing with CrUX, which is Chrome only. RUM cannot see inside
  iframes, and Long Animation Frame script attribution exists in Chromium only.
- While data collects, do step 4's HTML checks and a lab reproduction guided by the field data. Label it lab evidence.

### 4. Map the evidence to WordPress owners (read-only)

```sh
wp core version
wp theme list --status=active --fields=name,version --skip-update-check
wp theme list --status=parent --fields=name,version --skip-update-check
wp plugin list --fields=name,status,version --skip-update-check
wp plugin list --status=must-use --fields=name,version
curl -sL -A "Mozilla/5.0" https://www.example.com/shop/blue-mug/ -o page.html
node scripts/scan-html.mjs page.html --site=https://www.example.com --lcp=blue-mug-1200x900
node scripts/wp-owner.mjs --site=https://www.example.com script-urls.txt
```

- `scan-html.mjs` lists render-blocking stylesheets and scripts in `<head>` by owner, scripts whose requested `defer`
  or `async` WordPress did not apply, the first images with their `loading` and `fetchpriority`, where the LCP image
  appears, preloads, speculation rules, iframes and third-party hosts.
- `wp-owner.mjs` maps URLs (LoAF `sourceURL` values with their milliseconds, LCP image URLs) to `plugin:<slug>`,
  `theme:<slug>`, `mu-plugin:<name>`, `core`, `uploads:<folder>`, `cache:<folder>`, `inline:<handle>` or
  `third-party:<host>`. Pass `--cdn` for the site's CDN host and `--content-dir` for a renamed content folder.
- Handles (`id="<handle>-js"`, `<handle>-css`), block names and element selectors lead to code with `grep`; the rules
  and commands are in `references/mapping-to-wordpress.md`.
- Bundles in `wp-content/cache/` hide their owners; a LoAF entry names a script's entry point, not the slow function
  it called. Note both in the report when they apply.

### 5. Check the WordPress causes for the failing part

| Field evidence | Check first | Read |
| --- | --- | --- |
| LCP, TTFB subpart largest | page cache hits, redirects, query-string cache misses, Server-Timing, 6.9 output buffer | `lcp-wordpress.md`, TTFB |
| LCP, load delay largest | LCP image lazy (core heuristics, builder, lazy-load plugin), `data-src`, CSS background, missing `fetchpriority`, competing requests | `lcp-wordpress.md`, load delay |
| LCP, render delay largest | render-blocking plugin CSS and JS in `<head>`, jQuery in `<head>`, downgraded `defer`, hero hidden by animation or A/B script | `lcp-wordpress.md`, render delay |
| LCP, mostly text | render-blocking CSS, web fonts, TTFB | `lcp-wordpress.md` |
| INP, input delay during load | script evaluation by owner, tag manager tags, combined bundles | `inp-wordpress.md` |
| INP, processing duration | the longest script's owner, function and `invoker`; forced layout | `inp-wordpress.md` |
| INP, presentation delay | DOM size, style and layout time, builder or menu markup | `inp-wordpress.md` |
| CLS during load | images without dimensions, injected banners, fonts, ads and embeds | `cls-wordpress.md` |
| CLS after load | content loaded on scroll, late banners, animations | `cls-wordpress.md` |
| Next page views slow | speculative loading config in the HTML, back/forward cache eligibility | `lcp-wordpress.md` |

Check which WordPress version introduced a behavior before relying on it: `references/wordpress-version-notes.md`.

### 6. Confirm on staging

Reproduce with the DevTools Performance panel set to the field's device type and throttling, then change one thing at
a time on staging (deactivate the suspect, dequeue one asset, switch one setting) and compare medians of several runs.
An owner is Confirmed only when field attribution points at it and the single change moves the lab metric part beyond
run-to-run spread. Protocol and confidence table: `references/lab-confirmation.md`.

### 7. Propose fixes (each one needs approval)

- For each fix give: the owner, the change, the metric part it should move, the backup, the check, the undo, and who
  does it (site owner, plugin or theme vendor, host).
- Prefer, in order: the plugin's or theme's own setting; an update that fixes it; not loading the feature where it is
  not used; a small must-use plugin snippet (the references include patterns: dequeue, `defer` through
  `wp_script_add_data()`, `path` data for inlining small CSS, LCP image attributes, speculative loading filters);
  asking the vendor with the field evidence; replacing the plugin.
- Every snippet is one file in `wp-content/mu-plugins/`; its undo is deleting that file. Apply on staging, repeat the
  step 6 comparison, then production.

### 8. Verify in the field

- RUM: the same page types, device and percentile before and after, within days.
- CrUX: the daily API reflects a change fully only after a whole 28-day window; the History API shows the ramp week by
  week.
- Search Console: "Start Tracking" on the issue starts a 28-day validation.
- A lab-only improvement stays a hypothesis until the field moves.

## Reference files

| File | Read it when |
| --- | --- |
| `references/metrics-and-thresholds.md` | Rating any number; what LCP, INP, CLS and TTFB count; why tools disagree |
| `references/field-data-sources.md` | Step 1: CrUX API, History API, CrUX Vis, BigQuery, PageSpeed Insights, Search Console, CrUX versus RUM |
| `references/rum-attribution.md` | Step 3: web-vitals attribution fields, LoAF script attribution, the beacon and its payload |
| `references/mapping-to-wordpress.md` | Step 4: paths, handles, block names, selectors to owners; confidence labels |
| `references/lcp-wordpress.md` | Step 5 for LCP: causes by subpart, WordPress image loading rules, script strategies, fixes, speculative loading |
| `references/inp-wordpress.md` | Step 5 for INP: causes by phase, tag managers, page builders, what RUM cannot see |
| `references/cls-wordpress.md` | Step 5 for CLS: images, injected content, fonts, animations, bfcache |
| `references/lab-confirmation.md` | Step 6: lab setup matching the field, one-change comparisons, when a suspect is confirmed |
| `references/wordpress-version-notes.md` | Any version-dependent behavior, WordPress 5.5 to 7.1 |
| `scripts/crux-summary.mjs` | Summarizing saved CrUX API and History API responses (read-only) |
| `scripts/rum-summary.mjs` | Summarizing beacon data by page type, phase and owner (read-only) |
| `scripts/scan-html.mjs` | Reading a saved page for render-blocking assets, image attributes and speculation rules (read-only) |
| `scripts/wp-owner.mjs` | Mapping URLs to plugins, themes, core and third parties (read-only) |

The helper scripts only read the files you give them and print a report; they write nothing and make no network
requests.

## Report format

End every session with this report, filled in from data and command output, never from memory. Keep the field section
and the lab section apart: a lab or code finding never goes in the field section.

```text
Core Web Vitals field triage: <site> (<date, UTC>)
WordPress <version>; theme <active> (parent <parent or none>); <n> active plugins, <n> must-use

Scope
  Failing: <metric> on <mobile|desktop> for <URL group, page type or origin>, since <period end date or unknown>
  Passing or no data: <...>

Field evidence (real visitors)
  CrUX <url|origin>, <form factor>, <collection period>: LCP p75 <v> (<rating>), INP <v>, CLS <v>; assessment <passed|not passed>
  CrUX detail: LCP image <x%> / text <y%>; largest image subpart <name>; navigation types <...>
  Search Console: group <example URL> <status> on <device>, group p75 <v>
  RUM <date range>, <n records>, <filters>: <page type> <metric> p75 <v>; slow share by part <...>
  Attribution: <owner>: <LoAF ms over n interactions | LCP resource on n views | shift target on n views>

Lab and code evidence (reproductions and reading; not proof of field impact)
  <insight, trace or scan-html finding> (<device, throttling, runs>)

Owners
  <owner> | <metric and part> | <field / lab / code evidence> | <Confirmed | Likely | Hypothesis>

Recommended changes (each needs approval)
  <n>. <change>; owner <...>; expected to move <metric part>; backup <...>; check <...>; undo <...>; done by <...>

Unknowns and limits
  <for example: no URL-level CrUX data; iframes invisible to RUM; LoAF only in Chromium; cache bundle hides owners>

Next step: <step, its backup, its check, its undo> (needs approval: yes/no)
Field re-check: RUM on <date>; CrUX after a full 28-day window on <date>
```
