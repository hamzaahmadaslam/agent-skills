# INP on WordPress: causes by phase, checks and fixes

Read this in step 5 when INP fails. Start from the phase that dominates the slow interactions in RUM (input delay,
processing duration, presentation delay) and from the Long Animation Frame script owners that
`scripts/rum-summary.mjs` prints. CrUX alone cannot tell you the phase or the script
([web.dev: INP](https://web.dev/articles/inp#field-measurement)). Every fix changes the site: staging first, owner's
approval, undo step ready.

| Dominant phase | What it means | Candidate WordPress causes |
| --- | --- | --- |
| Input delay | the main thread was busy when the visitor clicked | plugin and theme scripts evaluating during load, tag manager tags, timers, earlier interactions |
| Processing duration | the event handlers themselves ran long | a plugin's or theme's click, submit or key handler; third-party listeners; forced layout |
| Presentation delay | rendering the result took long | large DOM from builders or menus, expensive CSS, `requestAnimationFrame` work, HTML built in JavaScript |

Phase definitions: [web.dev: Optimize INP](https://web.dev/articles/optimize-inp#optimize_interactions).

## Input delay

- Input delay comes from other work on the main thread: scripts loading, parsing and compiling, fetch handling,
  timers, or other interactions ([web.dev: Optimize INP](https://web.dev/articles/optimize-inp#identify_and_reduce_input_delay)).
- Read `loadState` and the LoAF `invokerType`: `classic-script` or `module-script` during `loading` or
  `dom-interactive` means script evaluation during load; `user-callback` a timer or `requestAnimationFrame`;
  `event-listener` an earlier input still running; `resolve-promise` or `reject-promise` async work finishing
  ([web.dev: Find slow interactions](https://web.dev/articles/find-slow-interactions-in-the-field#long_input_delays)).
- A very large classic script is evaluated in one long task; splitting code into more, smaller scripts, loading
  unused code later, and shipping less JavaScript reduce the blocking
  ([web.dev: Script evaluation and long tasks](https://web.dev/articles/script-evaluation-and-long-tasks#conclusion)).
  Optimization plugins that combine every script into one file can make this worse and hide the owner; compare with
  combining off on staging.
- Tag managers compete for the main thread; web.dev reports a correlation between tag manager size and poorer INP
  ([web.dev: Tag best practices](https://web.dev/articles/tag-best-practices#impact_on_core_web_vitals)).

Fixes:

1. Remove scripts from pages that do not use them (the dequeue pattern in `lcp-wordpress.md`). `defer` alone moves
   execution after parsing but the script still runs during load.
2. Fire non-essential tags after Window Loaded, prefer custom templates or pixels over Custom HTML tags, remove
   duplicate and unused tags, and use one container per page
   ([web.dev: Tag best practices](https://web.dev/articles/tag-best-practices)).
3. Remove or replace a third-party script that adds no clear value; otherwise load it with `async` or `defer` and
   lazy-load embeds ([web.dev: Efficiently load third-party JavaScript](https://web.dev/articles/efficiently-load-third-party-javascript)).

## Processing duration

- The LoAF entry of the slow interaction names the script (`sourceURL`), the function (`sourceFunctionName`) and the
  element and event (`invoker`, for example `BUTTON#update.onclick`)
  ([web.dev: Find slow interactions](https://web.dev/articles/find-slow-interactions-in-the-field#long_processing_durations)).
  Map `sourceURL` to its owner with `scripts/wp-owner.mjs`.
- The reported source is the entry point: a theme handler that calls a slow plugin library is reported as the theme
  ([Chrome: LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames#better-attribution)).
  Confirm in a lab trace before blaming either.
- `forcedStyleAndLayoutDuration` above zero means the handler forced layout (layout thrashing: writing styles, then
  reading layout in the same task) ([web.dev: Optimize INP](https://web.dev/articles/optimize-inp#avoid_layout_thrashing),
  [Chrome: LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames#better-attribution)).

Fixes depend on who owns the code:

- Code the site owns (child theme, custom plugin): do only the visual update in the handler and move the rest to a
  later task, for example `requestAnimationFrame` plus `setTimeout`, or yield with `scheduler.yield()`
  ([web.dev: Optimize INP](https://web.dev/articles/optimize-inp#yield_to_allow_rendering_work_to_occur_sooner),
  [web.dev: Optimize long tasks](https://web.dev/articles/optimize-long-tasks)).
- A plugin or theme from someone else: send the vendor the field evidence (interaction target, function, file, time
  per interaction), check for an update, and on staging compare with the feature turned off or with an alternative.
- Blocks using the Interactivity API: the project is moving store actions toward running asynchronously by default to
  avoid long tasks. Since 6.8, an action that reads the event synchronously (for example `event.preventDefault()`)
  should be wrapped in `withSyncEvent()`, and unwrapped ones log a deprecation warning
  ([Make WordPress Core: Interactivity API best practices in 6.8](https://make.wordpress.org/core/2025/03/24/interactivity-api-best-practices-in-6-8/)).

## Presentation delay

- Large DOMs make rendering after an interaction expensive; content built with JavaScript, heavy
  `requestAnimationFrame` callbacks and complex style work add to it; `content-visibility` can skip rendering of
  off-screen sections ([web.dev: Optimize INP](https://web.dev/articles/optimize-inp#minimize_presentation_delay),
  [web.dev: DOM size and interactivity](https://web.dev/articles/dom-size-and-interactivity)).
- LoAF timings split the frame: from `renderStart` to `styleAndLayoutStart` is `requestAnimationFrame` and observer
  work, and from `styleAndLayoutStart` to the frame end is style and layout
  ([web.dev: Find slow interactions](https://web.dev/articles/find-slow-interactions-in-the-field#long_presentation_delays)).
  The beacon's `totalStyleAndLayoutDuration` sums this for you
  ([web-vitals README](https://github.com/GoogleChrome/web-vitals#inpattribution)).
- The Optimize DOM size insight reports total elements, depth and the element with most children, and fails when a
  style recalculation or layout takes over 40 ms ([Optimize DOM size](https://developer.chrome.com/docs/performance/insights/dom-size)).
  `scripts/scan-html.mjs` prints an approximate element count of the server HTML for a quick comparison between
  templates.

## Page builders and heavy themes

Treat a page builder like any other plugin and let the evidence decide:

1. Compare a page built with the builder and a similar page without it, on the same template and device settings: INP
   breakdown, DOM size, and the scripts in the flame chart.
2. Sum field LoAF time by owner (`rum-summary.mjs`); a builder shows up as `plugin:<slug>` for its scripts and as
   `uploads:<folder>` for generated CSS.
3. Use the builder's own performance settings (vendor documentation) before custom code, and re-measure.

## What RUM cannot see

- Interactions inside iframes (video players, maps, ads, chat widgets in frames) count toward the page's INP in CrUX,
  but web APIs cannot see them; each iframe also has its own main thread
  ([web.dev: INP](https://web.dev/articles/inp#whats_in_an_interaction),
  [web.dev: Optimize INP](https://web.dev/articles/optimize-inp#optimize_interactions)).
- Script attribution is missing for cross-origin iframes, workers and extension code
  ([Chrome: LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames#better-attribution)).
- LoAF is available in Chromium only (Chrome 123 and later), so INP records from other browsers have phases but no
  script owner ([web.dev: Find slow interactions](https://web.dev/articles/find-slow-interactions-in-the-field#the_long_animation_frames_api_loaf)).

If CrUX INP is poor but RUM INP looks fine, suspect iframes or a RUM sample that is not Chrome-only
([web.dev: CrUX and RUM differences](https://web.dev/articles/crux-and-rum-differences)).
