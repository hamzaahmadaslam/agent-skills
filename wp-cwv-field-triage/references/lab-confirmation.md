# Confirming a suspect in the lab

Field data says where and how much; the lab says why, one controlled change at a time. Read this in step 6. When
field and lab disagree, prioritize by the field data ([web.dev: Lab and field data](https://web.dev/articles/lab-and-field-data-differences#what_to_do_when_the_results_are_different)).

## Why the lab differs from the field

From [web.dev: Lab and field data](https://web.dev/articles/lab-and-field-data-differences) unless noted:

- A lab run is one device, one network, one location. Field visits vary in screen size (a different LCP element),
  login state and personalization, A/B test variants, fonts, and cache state; lab tests usually start with a cold
  cache and the bare URL.
- INP needs real interactions; a page load alone reports none.
- Lab tools usually measure only the load, so post-load layout shifts show up in the field only
  ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#lab-field)).
- Lab scores vary from run to run with network, hardware and resource contention
  ([PageSpeed Insights FAQ](https://developers.google.com/speed/docs/insights/v5/about#faq)), so one run proves nothing.

## Make the lab look like the field

- Use the Chrome DevTools Performance panel with field data turned on (Field data > Set up). It shows CrUX values
  next to your local LCP, CLS and INP, lets you pick the device type most visitors use, and recommends CPU and network
  throttling; calibrated CPU presets can match low and mid-tier phones
  ([Chrome DevTools: Performance](https://developer.chrome.com/docs/devtools/performance/overview#live-metrics)).
- Test the URLs from the failing Search Console group or the RUM page type, as a logged-out visitor, in a profile
  without extensions (extension code affects frames but gets no script attribution:
  [Chrome: LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames#better-attribution)).
- Use a staging copy that matches production: same plugins, theme, settings, content and caching.

## What to record per metric

| Metric | Do | Read in the trace |
| --- | --- | --- |
| LCP | Reload with throttling matching the field | LCP breakdown (subparts), LCP request discovery (lazy loading, fetchpriority, discovery in the HTML), Render-blocking requests, Document request latency ([Performance insights](https://developer.chrome.com/docs/performance/insights)) |
| INP | Interact with the element from field data (`interactionTarget`), once while the page loads and once after | INP breakdown, the flame chart's script URLs, Forced reflow, Optimize DOM size |
| CLS | Load, scroll and interact while watching live metrics | Layout shift culprits, the Layout shifts track ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#identifying-load-cls-issues)) |

For LCP, a simple check in the network waterfall: the LCP resource should start loading at about the same time as the
first resource the page loads ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#1_eliminate_resource_load_delay)).

The Optimize DOM size insight fails only when a style recalculation or layout takes over 40 ms; it counts a layout
over 100 layout objects or a style recalculation over 300 elements as large
([Optimize DOM size](https://developer.chrome.com/docs/performance/insights/dom-size)).

## One change at a time, on staging

1. Baseline: run the same scenario several times and note the median of the metric part in question (for example LCP
   resource load delay, or INP processing duration), with the device and throttling settings. Use the same number of
   runs for every variant.
2. Change one thing on staging: deactivate the suspect plugin, dequeue one asset, switch one setting, or remove one
   tag. Deactivating a plugin removes its features too; note what else changed on the page.
3. Repeat the same runs and compare medians. A difference inside the run-to-run spread is not a result.
4. Undo the change on staging.
5. Write down both medians, the number of runs and the settings. This is lab evidence; the field check comes after
   the fix ships (step 8 of the procedure).

Never deactivate plugins on production to test a guess.

## When is a suspect confirmed

| Confidence | Evidence |
| --- | --- |
| Confirmed | field attribution names the owner, and the single change on staging moves the lab metric part in the expected direction beyond run-to-run spread |
| Likely | field attribution names the owner but it is not reproduced yet; or a lab trace and the code agree |
| Hypothesis | code reading or one lab run only |

After the fix ships, only field data can say whether visitors got faster: RUM within days, CrUX over the following
28 days (`field-data-sources.md`).
