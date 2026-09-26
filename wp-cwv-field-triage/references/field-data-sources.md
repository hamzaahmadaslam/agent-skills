# Field data: CrUX, PageSpeed Insights, Search Console and BigQuery

Read this in step 1 of the procedure. It says what each source contains, how to query it, and how to read the result
without over-reading it. Facts were checked on 2026-09-26 against the linked pages.

## What CrUX measures and who is in it

- CrUX is real-user data from Chrome users who turned on usage statistics, sync their history and have no sync
  passphrase, on desktop Chrome (Windows, macOS, ChromeOS, Linux) and Android Chrome. Chrome on iOS, Android WebView
  apps and other Chromium browsers such as Edge are not included
  ([CrUX methodology](https://developer.chrome.com/docs/crux/methodology#user-eligibility)).
- A page or origin is included only when it is publicly discoverable (status 200 after redirects, no `noindex`) and
  sufficiently popular. The popularity threshold is not published and is the same for pages and origins
  ([CrUX methodology](https://developer.chrome.com/docs/crux/methodology#eligibility)).
- Query strings and fragments are stripped from page URLs, so `?utm_medium=email` visits count toward the bare URL;
  in rare cases distinct pages behind parameters merge
  ([CrUX methodology](https://developer.chrome.com/docs/crux/methodology#page-eligibility)).
- Iframes are not reported on their own; they count toward the top-level page, including their CLS
  ([CrUX methodology](https://developer.chrome.com/docs/crux/methodology#page-eligibility)).
- Origins in CrUX are lowercase. A small amount of random noise is added to protect traffic volumes, and pages or
  origins with more than 20% of traffic in ineligible dimension combinations are dropped
  ([CrUX methodology](https://developer.chrome.com/docs/crux/methodology#data_quality)).
- The values are a 28-day rolling aggregate ([CrUX API](https://developer.chrome.com/docs/crux/api#the_rolling_average)).

## Which source to use

From [CrUX tools](https://developer.chrome.com/docs/crux/methodology/tools):

| Source | Updated | Window | History | Level |
| --- | --- | --- | --- | --- |
| CrUX API | daily | rolling 28 days | none | origin and page |
| CrUX History API | weekly (Monday) | 28-day periods ending on Saturdays | previous 40 weeks | origin and page |
| CrUX Vis | weekly | as History API | previous 40 weeks | origin and page |
| PageSpeed Insights (web and API) | daily | rolling 28 days | none | origin and page |
| Search Console | daily | 28 days per group | three months | URL groups |
| CrUX on BigQuery | monthly | last 28 days of each month | since 2017 | origin only |

Start with PageSpeed Insights for a quick look, the CrUX API for exact numbers you can save, the History API or
CrUX Vis for "since when", Search Console for which groups of pages fail, and BigQuery only when you need country or
monthly origin data.

## PageSpeed Insights, field section

- The top section, "Discover what your real users are experiencing", is CrUX; the lower "Diagnose performance
  issues" section is a Lighthouse lab run ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#using_pagespeed_insights_crux_lcp_data)).
- It can show four views: this URL or the whole origin, each for mobile and desktop. When the URL has too little
  data, it shows the origin data instead, so always read which one is on screen
  ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#using_pagespeed_insights_crux_lcp_data),
  [PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/about#crux)).
- The number above each distribution bar is the 75th percentile; the bars are the good, needs improvement and poor
  shares over the previous 28-day collection period
  ([PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/about#distribution)).
- If lab and field disagree, trust the field data for the user experience and check it is page-level data, not the
  origin fallback, before acting ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#using_pagespeed_insights_lighthouse_data)).
  A field CLS much higher than the lab CLS usually means post-load shifts
  ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#lab-field)).
- The PageSpeed Insights API works without a key for occasional use; a key is recommended for frequent automated
  queries ([PSI API: get started](https://developers.google.com/speed/docs/insights/v5/get-started)). Its field data
  sits in `loadingExperience` (URL) and `originLoadingExperience` (origin)
  ([PSI API reference](https://developers.google.com/speed/docs/insights/rest/v5/pagespeedapi/runpagespeed)).
  `scripts/crux-summary.mjs` reads CrUX API responses, not PSI API responses.

## CrUX API

- Needs a Google Cloud API key enabled for the Chrome UX Report API; the key goes in the `key` query parameter
  ([CrUX API](https://developer.chrome.com/docs/crux/api#crux_api_key)). The user creates it and exports it in their
  own shell as `CRUX_API_KEY`. Do not ask for the key, print it, or write it to a file.
- `POST /v1/records:queryRecord` on the host `chromeuxreport.googleapis.com`, with a JSON body holding `origin` or `url`,
  optional `formFactor` (`PHONE`, `DESKTOP`, `TABLET`; omitted means all form factors together) and optional
  `metrics` ([CrUX API](https://developer.chrome.com/docs/crux/api#request_body)).
- Metric names: `largest_contentful_paint`, `interaction_to_next_paint`, `cumulative_layout_shift`,
  `first_contentful_paint`, `experimental_time_to_first_byte`, `largest_contentful_paint_resource_type`, the four
  `largest_contentful_paint_image_*` subparts, `navigation_types`, `round_trip_time`, and `form_factors` (only when
  no `formFactor` is sent) ([CrUX API](https://developer.chrome.com/docs/crux/api#example_queries)).
- Response: `record.key`, `record.metrics.<name>.histogram` (`start`, `end`, `density`),
  `record.metrics.<name>.percentiles.p75`, `record.collectionPeriod`, and `urlNormalizationDetails` when the URL was
  normalized. CLS values are strings with two decimals ([CrUX API](https://developer.chrome.com/docs/crux/api#response_body)).
- The p75 is computed from all data, not from the histogram bins, and no single visitor necessarily had that value
  ([CrUX API](https://developer.chrome.com/docs/crux/api#percentiles)).
- Data updates daily around 04:00 UTC, runs about two days behind, and `collectionPeriod` always shows 28 days even
  for a page younger than that ([CrUX API](https://developer.chrome.com/docs/crux/api#collection-period)).
- Quota: 150 queries per minute per Google Cloud project, free
  ([CrUX API](https://developer.chrome.com/docs/crux/api#rate_limits)).
- No data returns `404` with `"chrome ux report data not found"`. Check the exact origin (scheme, `www`) first; the
  other cause is too few samples ([Using the CrUX API](https://developer.chrome.com/blog/chrome-ux-report-api#errors)).

Commands (Git Bash, macOS or Linux; the documented quoting differs on cmd.exe,
[CrUX API](https://developer.chrome.com/docs/crux/api#example_queries)). Save each response and summarize it:

```sh
curl -s --request POST "https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=$CRUX_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"origin":"https://www.example.com","formFactor":"PHONE"}' > crux-origin-phone.json
curl -s --request POST "https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=$CRUX_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"url":"https://www.example.com/shop/","formFactor":"PHONE"}' > crux-url-phone.json
node scripts/crux-summary.mjs crux-origin-phone.json crux-url-phone.json
```

### Reading the diagnostic metrics

- `largest_contentful_paint_resource_type` gives the share of LCPs that were `image` or `text`; video first frames
  count as image ([CrUX 2025-02](https://developer.chrome.com/blog/crux-2025-02#lcp_resource_types)).
- The four image subparts are each their own 75th percentile, so they do not add up to the LCP p75. Use them for
  relative weight only. They cover image LCPs only (not video, not text) and only full page loads
  ([CrUX metrics](https://developer.chrome.com/docs/crux/methodology/metrics#lcp-image-subparts)).
- What a high subpart points to, per Chrome: TTFB to server, network or redirects; resource load delay to an image
  discovered late, for example injected by JavaScript; load duration to download size; render delay to an image
  that is available but not shown, often waiting on JavaScript
  ([CrUX 2025-02](https://developer.chrome.com/blog/crux-2025-02#lcp_image_subparts)).
- For mostly-text LCP pages, use TTFB and FCP as the breakdown instead
  ([CrUX metrics](https://developer.chrome.com/docs/crux/methodology/metrics#lcp-image-subparts)).
- `navigation_types` splits page views into `navigate`, `navigate_cache`, `reload`, `restore`, `back_forward`,
  `back_forward_cache` and `prerender` ([CrUX metrics](https://developer.chrome.com/docs/crux/methodology/metrics#navigation-types)).
  Many `back_forward` but few `back_forward_cache` views means pages miss the back/forward cache.
- `round_trip_time` describes the visitors' network, not the site; read its low, medium and high bins (0, 75 and
  275 ms edges) as context ([CrUX 2025-02](https://developer.chrome.com/blog/crux-2025-02#rtt_tri-bins)).

## CrUX History API and CrUX Vis

- `POST /v1/records:queryHistoryRecord` on the same host, same key and body as the daily API.
  Values come as arrays: `histogramTimeseries`, `percentilesTimeseries.p75s`, `fractionTimeseries`, aligned with
  `collectionPeriods` in ascending order ([History API](https://developer.chrome.com/docs/crux/history-api#data_model)).
- Updated each Monday around 04:00 UTC with data up to the previous Saturday. Up to 40 weekly periods; 25 by
  default; set `"collectionPeriodCount"` from 1 to 40
  ([History API](https://developer.chrome.com/docs/crux/history-api#collection-periods)).
- Periods overlap: each covers 28 days, and consecutive periods share three weeks. A sudden change on the site
  therefore shows as a ramp over about four periods; it began in the week before the end date of the first period
  that moved ([History API](https://developer.chrome.com/docs/crux/history-api#the_rolling_average)).
- Periods without eligible data return `"NaN"` densities and `null` percentiles
  ([History API](https://developer.chrome.com/docs/crux/history-api#metric_eligibility)).
- Form factor is the only dimension ([History API](https://developer.chrome.com/docs/crux/history-api#form_factor)).
- [CrUX Vis](https://cruxvis.withgoogle.com/) draws the same History API data
  ([CrUX tools](https://developer.chrome.com/docs/crux/methodology/tools#tool-crux-vis)). The older CrUX Dashboard
  (Looker Studio) was deprecated at the end of November 2025 ([CrUX release notes](https://developer.chrome.com/docs/crux/release-notes)).

```sh
curl -s --request POST "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord?key=$CRUX_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"url":"https://www.example.com/shop/","formFactor":"PHONE","collectionPeriodCount":40}' > crux-history-phone.json
node scripts/crux-summary.mjs crux-history-phone.json --periods=16
```

Line the weeks up with the site's change history: plugin and theme updates, new tags, settings changes. Read-only
hint for when files changed: `ls -lt wp-content/plugins wp-content/themes` (a folder's time changes when its files
are replaced; treat it as a hint, not proof).

## CrUX on BigQuery

- Origin-level only; no page URLs. Released monthly on the second Tuesday for the previous month. Percentiles come
  from coarse histograms and are approximate. LCP resource types and subparts are not in BigQuery
  ([CrUX tools](https://developer.chrome.com/docs/crux/methodology/tools#tool-bigquery)).
- Needs a Google Cloud project with billing details; querying is free within BigQuery's monthly free tier
  ([CrUX on BigQuery](https://developer.chrome.com/docs/crux/bigquery#access_the_dataset)), which the CrUX guide gives
  as 1 TB of queries per month ([BigQuery guide](https://developer.chrome.com/docs/crux/guides/bigquery#faq)). Beyond
  that, BigQuery charges per data scanned. The `materialized` tables are small: the CrUX team's example query on
  `metrics_summary` notes it scans 43 MB ([core-web-vitals.sql](https://github.com/GoogleChrome/CrUX/blob/main/sql/core-web-vitals.sql)).
- `chrome-ux-report.materialized.metrics_summary` (by month and origin), `device_summary` (adds `device`) and
  `country_summary` (adds `country_code`) hold `p75_<metric>` and the good, average and slow shares
  ([CrUX on BigQuery](https://developer.chrome.com/docs/crux/bigquery#schema-materialized)). `metrics_summary` is
  partitioned by `date` (`YYYY-MM-01`), and the CrUX team's own queries filter these tables on `date`
  ([CrUX repository query](https://github.com/GoogleChrome/CrUX/blob/main/sql/core-web-vitals.sql)).

Query adapted from the CrUX team's
[03-device-cwv.sql](https://github.com/GoogleChrome/CrUX/blob/main/sql/mastering-crux/03-device-cwv.sql):

```sql
SELECT
  yyyymm,
  device,
  fast_lcp / (fast_lcp + avg_lcp + slow_lcp) AS pct_good_lcp,
  p75_lcp,
  fast_inp / (fast_inp + avg_inp + slow_inp) AS pct_good_inp,
  p75_inp,
  small_cls / (small_cls + medium_cls + large_cls) AS pct_good_cls,
  p75_cls
FROM `chrome-ux-report.materialized.device_summary`
WHERE date >= '2026-01-01'
  AND origin = 'https://www.example.com'
  AND device IN ('desktop', 'phone')
ORDER BY yyyymm DESC, device
```

Use `country_summary` when traffic from one country could explain a regression; Search Console notes that data from
all locations is combined ([Search Console help](https://support.google.com/webmasters/answer/9205520)).

## Search Console Core Web Vitals report

All from [Search Console help](https://support.google.com/webmasters/answer/9205520) unless noted.

- Built from CrUX, split into mobile and desktop, grouped by status (Poor, Need improvement, Good), metric and URL
  group. Only indexed URLs appear, as a sample, not a full list. Data is assigned to the actual URL, not the
  canonical.
- URL groups are pages with a similar experience; the group's LCP, INP and CLS values are the 75th percentile of
  visits to the group's URLs over the last 28 days. The group status is its worst metric; groups without enough LCP
  and CLS data are left out. When a group has too little data, Search Console uses an origin group
  (`protocol://host:port`) instead.
- Example URLs are sorted by impressions, highest first; the table shows up to 200 rows, and up to 20 pages per
  group are shown ([CrUX tools](https://developer.chrome.com/docs/crux/methodology/tools#tool-gsc)).
- Unlike PageSpeed Insights, Search Console keeps URL parameters when telling pages apart, so a URL can look
  different in the two tools.
- "Start Tracking" (validate fix) starts a 28-day monitoring window; it does not trigger any crawl. Any URL with the
  issue during the window fails the validation.
- A status change without a site change can come from borderline groups tipping over, from traffic shifts, or from a
  slower image host. Check whether group values sit near a threshold.
- The report keeps three months of history ([CrUX tools](https://developer.chrome.com/docs/crux/methodology/tools#tool-gsc)).

To map a URL group to WordPress, open three example URLs, save each as a logged-out visitor, and run
`scripts/scan-html.mjs`: the body classes name the template type (see `mapping-to-wordpress.md`).

## Field data inside Chrome DevTools

- The Performance panel shows local LCP, CLS and, after you interact, INP, and can fetch the page's or origin's CrUX
  values next to them (Field data > Set up). It suggests device, CPU and network settings that match your visitors
  ([Chrome DevTools: Performance](https://developer.chrome.com/docs/devtools/performance/overview#live-metrics)).
- Traces carry insights such as LCP breakdown, LCP request discovery, Render-blocking requests, INP breakdown,
  Layout shift culprits, Third parties and Optimize DOM size
  ([Performance insights](https://developer.chrome.com/docs/performance/insights)). These are lab evidence; see
  `lab-confirmation.md`.

## When your own RUM and CrUX disagree

From [web.dev: CrUX and RUM differences](https://web.dev/articles/crux-and-rum-differences):

- CrUX is Chrome only (no iOS), opted-in users only, public and popular pages only; RUM covers every browser it runs
  in and may be sampled.
- CrUX counts back/forward cache restores as page views and includes iframe content; web APIs see neither without
  extra work. Background-tab loads are left out of CrUX.
- Compare like with like: filter RUM to Chromium browsers (the closest the beacon gets to Chrome; Edge and other
  Chromium browsers stay in), one form factor, the 75th percentile, over 28 days
  (`scripts/rum-summary.mjs --chromium-only --device=mobile`).
