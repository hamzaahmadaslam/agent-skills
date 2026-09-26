# Metrics, thresholds and the 75th percentile

Everything in this file was checked on 2026-09-26 against the linked page. Read it before rating any number, and
whenever two tools seem to disagree.

## Thresholds

| Metric | Good | Needs improvement | Poor | Source |
| --- | --- | --- | --- | --- |
| Largest Contentful Paint (LCP) | 2,500 ms or less | over 2,500 ms, up to 4,000 ms | over 4,000 ms | [web.dev: LCP](https://web.dev/articles/lcp#what-is-a-good-lcp-score), [PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/about#categories) |
| Interaction to Next Paint (INP) | 200 ms or less | over 200 ms, up to 500 ms | over 500 ms | [web.dev: INP](https://web.dev/articles/inp#good-score) |
| Cumulative Layout Shift (CLS) | 0.1 or less | over 0.1, up to 0.25 | over 0.25 | [web.dev: CLS](https://web.dev/articles/cls#what-is-a-good-cls-score) |
| First Contentful Paint (FCP), diagnostic | 1,800 ms or less | up to 3,000 ms | over 3,000 ms | [PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/about#categories) |
| Time to First Byte (TTFB), experimental in CrUX | 800 ms or less | up to 1,800 ms | over 1,800 ms | [PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/about#categories), [web.dev: Optimize TTFB](https://web.dev/articles/optimize-ttfb) |

- LCP, INP and CLS are the three stable Core Web Vitals; INP became stable in 2024
  ([web.dev: Web Vitals](https://web.dev/articles/vitals)). INP replaced First Input Delay on 2024-03-12, and Chrome
  tools stopped guaranteeing FID after 2024-09-09 ([web.dev blog](https://web.dev/blog/inp-cwv-launch)). Treat any
  FID number in an old report as history, not as a current signal.
- The web-vitals library ships the same numbers as `LCPThresholds` `[2500, 4000]`, `INPThresholds` `[200, 500]` and
  `CLSThresholds` `[0.1, 0.25]`, and rates a value "good" up to and including the first number, "needs improvement"
  up to and including the second, and "poor" above it
  ([web-vitals README](https://github.com/GoogleChrome/web-vitals#rating-thresholds)). The helper scripts use this
  rule.
- CrUX histograms use the same edges as bin boundaries, for example LCP bins from 0 to 2500, from 2500 to 4000, and
  from 4000 up ([CrUX API](https://developer.chrome.com/docs/crux/api#response_body)).

## The assessment

- Measure at the 75th percentile of page loads, segmented across mobile and desktop
  ([web.dev: Web Vitals](https://web.dev/articles/vitals)). PageSpeed Insights reports the 75th percentile so that
  site owners see the most frustrating experiences on their site
  ([PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/about#distribution)).
- A page or origin passes the Core Web Vitals assessment when the 75th percentiles of LCP, INP and CLS are all good.
  Without enough INP data it passes on LCP and CLS alone. Without enough LCP or CLS data it cannot be assessed
  ([PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/about#field-data-label)).
- In Search Console, a URL group appears only with enough LCP and CLS data, and its status is its worst metric
  ([Search Console help](https://support.google.com/webmasters/answer/9205520)).
- Google Search recommends aiming for LCP within 2.5 seconds, INP under 200 ms and CLS under 0.1
  ([Google Search Central](https://developers.google.com/search/docs/appearance/core-web-vitals)).

## What each metric counts

These details decide which component can be responsible, so check them before blaming a plugin.

### LCP

- The render time of the largest image, text block or video visible in the viewport, from the start of navigation
  ([web.dev: LCP](https://web.dev/articles/lcp#what-is-lcp)).
- Candidates: `<img>`, `<image>` inside `<svg>`, `<video>` (poster or first frame), elements with a `url()`
  background image, and block-level elements with text ([web.dev: LCP](https://web.dev/articles/lcp#what-elements-are-considered)).
- Chromium excludes elements with opacity 0, elements that cover the whole viewport, and low-entropy placeholder
  images ([web.dev: LCP](https://web.dev/articles/lcp#what-elements-are-considered)). An entrance animation that starts
  the hero at opacity 0 therefore holds LCP back until the element becomes visible.
- LCP includes unload time of the previous page, redirects and connection setup, which can make field and lab LCP
  differ ([web.dev: LCP](https://web.dev/articles/lcp#what-is-lcp)).
- The browser stops reporting new candidates after the first tap, scroll or key press, and pages loaded in a
  background tab are not reported by Google's tools ([web.dev: LCP](https://web.dev/articles/lcp#when-is-lcp-reported)).
- Elements inside iframes count for the metric but are invisible to the JavaScript API, a known CrUX versus RUM
  difference; prerendered pages are measured from `activationStart`
  ([web.dev: LCP](https://web.dev/articles/lcp#differences-metric-api)).
- LCP splits into four subparts with no gap or overlap: time to first byte, resource load delay, resource load
  duration and element render delay ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#lcp-breakdown)).
  On a well-optimized page the guideline split is about 40% TTFB, under 10% load delay, about 40% load duration and
  under 10% render delay; the two "delay" parts should be close to zero
  ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#optimal_sub-part_times)).

### INP

- Observes clicks, taps and key presses for the whole visit; hovering, zooming and scrolling are not interactions
  for INP ([web.dev: INP](https://web.dev/articles/inp#whats_in_an_interaction)).
- An interaction's latency runs from the input to the next frame presented, in three phases: input delay,
  processing duration and presentation delay ([web.dev: Optimize INP](https://web.dev/articles/optimize-inp#optimize_interactions)).
- The page's INP is its slowest interaction, except that one highest interaction is ignored for every 50
  interactions ([web.dev: INP](https://web.dev/articles/inp#what-is-inp)).
- No INP is reported when the visitor never clicks, taps or types
  ([web.dev: INP](https://web.dev/articles/inp#no-inp-value)).
- Interactions inside iframes count for the page, but the API cannot see them
  ([web.dev: INP](https://web.dev/articles/inp#whats_in_an_interaction)).

### CLS

- The largest burst (session window) of unexpected layout shifts during the whole life of the page; shifts in a
  window are less than 1 second apart and a window lasts at most 5 seconds
  ([web.dev: CLS](https://web.dev/articles/cls#what-is-cls)).
- Shifts within 500 ms of a discrete input (click, tap, key press) carry `hadRecentInput` and are excluded; scrolling
  does not count as recent input ([web.dev: CLS](https://web.dev/articles/cls#expected-unexpected-layout-shifts)).
- Lab tools usually measure only the load, while CrUX measures the full life of the page, so post-load shifts show
  in the field only ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#lab-field)).
- A layout-shift entry lists up to five `sources`: the elements that moved, which are not necessarily the element
  that caused the shift ([web.dev: Debug layout shifts](https://web.dev/articles/debug-layout-shifts#layoutshiftattribution)).

### TTFB

- Starts at the page's time origin and includes DNS lookup, connection, network latency and server time
  ([web-vitals README](https://github.com/GoogleChrome/web-vitals#onttfb)); redirects show up in the attribution's
  `waitingDuration` ([web-vitals README](https://github.com/GoogleChrome/web-vitals#ttfbattribution)).
- CrUX collects TTFB only on full page loads, so its sample differs from LCP's, and it is affected by redirects and
  by whether the response came from a cache or CDN ([CrUX metrics](https://developer.chrome.com/docs/crux/methodology/metrics#ttfb-metric)).

## Long tasks and long animation frames

- A task longer than 50 ms is a long task; the time over 50 ms is its blocking period
  ([web.dev: Optimize long tasks](https://web.dev/articles/optimize-long-tasks)).
- A long animation frame's `blockingDuration` is the sum of the parts of its tasks over 50 ms, including the final
  render in the longest task ([Chrome: Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames#blocking-duration)).
- Reducing `blockingDuration` by breaking up long tasks is the lever for INP
  ([Chrome: Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames#duration-v-blocking-duration)).
