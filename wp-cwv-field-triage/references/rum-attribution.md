# Attribution from real users: the web-vitals attribution build

CrUX can tell you that a page group is slow, but not why; attribution collected from real visitors can
([web.dev: INP](https://web.dev/articles/inp#field-measurement)). Read this in step 3. Facts were checked on 2026-09-26.

## Use what the site already has

- A RUM product that records LCP subparts, INP phases and Long Animation Frame scripts: export its data and map the
  fields to the payload below.
- Google Analytics 4 with web-vitals events: the web-vitals README shows how to send metrics with a `debug_target`
  ([web-vitals README](https://github.com/GoogleChrome/web-vitals#send-attribution-data)), and web.dev shows the
  BigQuery export and queries ([web.dev: Web Vitals with GA4 and BigQuery](https://web.dev/articles/vitals-ga4)).
- Nothing yet: propose the beacon below. It changes the site, so it needs the owner's approval, a staging test, and
  a way to remove it.

## The library

- Current release: 6.2.2, published 2026-09-14 ([CHANGELOG](https://github.com/GoogleChrome/web-vitals/blob/main/CHANGELOG.md)).
  Version 6 added soft-navigation reporting for Chromium 151 and later and made `includeProcessedEventEntries` default
  to `false` ([upgrading to v6](https://github.com/GoogleChrome/web-vitals/blob/main/docs/upgrading-to-v6.md)).
- The attribution build adds an `attribution` object to every metric and costs about 1.5 KB (brotli) more than the
  standard build. Import from `web-vitals/attribution`, or load `dist/web-vitals.attribution.iife.js`, which exposes a
  global `webVitals` ([web-vitals README](https://github.com/GoogleChrome/web-vitals#attribution-build)).
- Self-host the file: the README says CDN copies are for examples only and self-hosting is better for security,
  reliability and performance ([web-vitals README](https://github.com/GoogleChrome/web-vitals#load-web-vitals-from-a-cdn)).
- It observes with the `buffered` flag, so it does not need to load early; the README recommends deferring it until
  other code that affects visitors has loaded ([web-vitals README](https://github.com/GoogleChrome/web-vitals#installation)).
- Support: `onCLS` in Chromium only; `onLCP`, `onINP`, `onFCP`, `onTTFB` in Chromium, Firefox and Safari
  ([web-vitals README](https://github.com/GoogleChrome/web-vitals#browser-support)).
- INP is not reported if the visitor never interacts; CLS, FCP and LCP are not reported for pages loaded in the
  background; CLS and INP are reported again whenever the page is hidden; all metrics are reported again with a new
  `id` after a back/forward cache restore ([web-vitals README](https://github.com/GoogleChrome/web-vitals#basic-usage)).
- `onINP` ignores events faster than `durationThreshold`, 40 ms by default after the library starts
  ([web-vitals README](https://github.com/GoogleChrome/web-vitals#oninp)). `reportAllChanges` is for debugging, not
  production ([web-vitals README](https://github.com/GoogleChrome/web-vitals#report-the-value-on-every-change)).
- The APIs cannot see into iframes, not even same-origin ones, so embeds (video, maps, ads) that hurt CrUX can be
  invisible to RUM ([web-vitals README](https://github.com/GoogleChrome/web-vitals#limitations)).

## Attribution fields

From the [web-vitals README](https://github.com/GoogleChrome/web-vitals#attribution).

| Metric | Field | Use it to |
| --- | --- | --- |
| LCP | `target` | find the LCP element (a CSS selector; classes are sorted since v5) |
| LCP | `url` | find the LCP image and who outputs it (empty for text) |
| LCP | `timeToFirstByte`, `resourceLoadDelay`, `resourceLoadDuration`, `elementRenderDelay` | see which subpart dominates |
| LCP | `navigationEntry` | read `serverTiming` if the server sends Server-Timing headers |
| INP | `interactionTarget`, `interactionType` (`pointer` or `keyboard`) | find the element people used |
| INP | `inputDelay`, `processingDuration`, `presentationDelay` | see which phase dominates |
| INP | `loadState` (`loading`, `dom-interactive`, `dom-content-loaded`, `complete`) | tell load-time from later interactions |
| INP | `longAnimationFrameEntries` | read script attribution (next section) |
| INP | `longestScript` (`entry`, `subpart`, `intersectingDuration`) | the single longest script and the phase it ran in |
| INP | `totalScriptDuration`, `totalStyleAndLayoutDuration`, `totalPaintDuration`, `totalUnattributedDuration` | split the time between script, style and layout, and paint |
| CLS | `largestShiftTarget`, `largestShiftValue`, `largestShiftTime` | find the element that moved most in the largest shift |
| CLS | `loadState` | tell load shifts from post-load shifts |

Classes in the selectors have been sorted since v5.0.0 to reduce the number of distinct values
([CHANGELOG](https://github.com/GoogleChrome/web-vitals/blob/main/CHANGELOG.md)). A custom `generateTarget` function
can replace the default selector ([web-vitals README](https://github.com/GoogleChrome/web-vitals#attribution)).

## Long Animation Frames: which script

From [Chrome: Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames) unless
noted.

- Shipped in Chrome 123. Each long frame lists `scripts` that ran longer than 5 ms, with `invoker`, `invokerType`,
  `sourceURL`, `sourceFunctionName`, `sourceCharPosition`, `duration`, `forcedStyleAndLayoutDuration`,
  `pauseDuration` and `windowAttribution`.
- `invokerType` values: `user-callback` (timers, `requestAnimationFrame`), `event-listener`, `resolve-promise`,
  `reject-promise`, `classic-script` and `module-script` (script evaluation).
- The source is the script's entry point, not necessarily the slow function: a theme click handler that calls a slow
  plugin library is reported as the theme handler.
- No script attribution for cross-origin iframes, workers, or extension code. For cross-origin scripts loaded without
  CORS, only `sourceURL` is given (empty function name, position -1); adding `crossorigin="anonymous"` makes it a
  CORS request. Test that change on staging and keep it only if the script still loads.
- Reading `invokerType` for a long input delay: `classic-script` or `module-script` means script evaluation during
  load; `user-callback` a timer or animation callback; `event-listener` an earlier input still being handled;
  `resolve-promise` or `reject-promise` async work finishing at the wrong moment
  ([web.dev: Find slow interactions](https://web.dev/articles/find-slow-interactions-in-the-field#long_input_delays)).

## The beacon for a WordPress site

Three files, installed only after the owner approves, on staging first:

```text
wp-content/mu-plugins/cwv-field-attribution.php            loader (below)
wp-content/mu-plugins/cwv-field-attribution/beacon.js      beacon (below)
wp-content/mu-plugins/cwv-field-attribution/web-vitals.attribution.iife.js
                                                           from the web-vitals 6.2.2 npm package, dist/ folder
```

- Must-use plugins load automatically and cannot be turned off in wp-admin; WordPress loads only PHP files directly
  inside `mu-plugins`, so the JavaScript can sit in a subfolder. To remove it, delete the file and the folder
  ([Must-use plugins](https://developer.wordpress.org/advanced-administration/plugins/mu-plugins/)).
- Get the library with `npm pack web-vitals@6.2.2` and copy `package/dist/web-vitals.attribution.iife.js`. Ask before
  downloading.
- The collector is the owner's choice: a RUM or logging service they already use, or an endpoint they run. It must
  accept a POST whose body is a JSON array, store one line per request, and be removed or emptied when the
  investigation ends. Do not create a public endpoint on the site without the owner's decision.
- Backup: none needed for new files, but record what was added. Check: the page source shows both scripts with
  `defer` (see the loader below), and the collector receives lines. Undo: delete the three files and the folder.

Loader (`cwv-field-attribution.php`):

```php
<?php
/**
 * Plugin Name: CWV field attribution (temporary)
 * Description: Sends sampled Core Web Vitals with attribution to the collector below. Delete this file and the cwv-field-attribution folder to stop.
 */

add_action(
	'wp_enqueue_scripts',
	static function () {
		$args = array(
			'in_footer'     => true,
			'strategy'      => 'defer',
			'fetchpriority' => 'low', // Read by WordPress 6.9 and later; 6.3 to 6.8 ignore it.
		);
		wp_register_script( 'cwv-web-vitals', plugins_url( 'cwv-field-attribution/web-vitals.attribution.iife.js', __FILE__ ), array(), '6.2.2', $args );
		wp_enqueue_script( 'cwv-field-beacon', plugins_url( 'cwv-field-attribution/beacon.js', __FILE__ ), array( 'cwv-web-vitals' ), '1', $args );
		wp_add_inline_script(
			'cwv-field-beacon',
			'window.cwvFieldConfig = ' . wp_json_encode(
				array(
					'endpoint'   => 'https://collector.example.com/cwv', // Replace with the owner's collector.
					'sampleRate' => 0.1,
				)
			) . ';',
			'before' // An 'after' inline script would make WordPress print the beacon as a blocking script.
		);
	}
);
```

Why these arguments: `strategy` and `in_footer` exist since 6.3 and `fetchpriority` since 6.9
([wp_enqueue_script](https://developer.wordpress.org/reference/functions/wp_enqueue_script/#changelog); 6.8 reads
only `in_footer` and `strategy`: [functions.wp-scripts.php at 6.8](https://github.com/WordPress/wordpress-develop/blob/6.8/src/wp-includes/functions.wp-scripts.php)).
An inline script in the `after` position forces the script to be blocking, while `before` does not
([Make WordPress Core: 6.3 script strategies](https://make.wordpress.org/core/2023/07/14/registering-scripts-with-async-and-defer-attributes-in-wordpress-6-3/)).
`plugins_url( ..., __FILE__ )` resolves to the mu-plugins URL for a file in `mu-plugins`
([link-template.php at 7.1.2](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/link-template.php)).

Beacon (`beacon.js`). It follows the README's queue-and-flush pattern with `navigator.sendBeacon` on
`visibilitychange` ([web-vitals README](https://github.com/GoogleChrome/web-vitals#batch-multiple-reports-together)):

```js
/*
 * Core Web Vitals field beacon for a wp-cwv-field-triage investigation.
 * Needs the web-vitals attribution build (IIFE file, global `webVitals`) loaded first.
 * Sends a sample of page views to window.cwvFieldConfig.endpoint. It sends no user IDs, cookies or query strings:
 * the page path, a page type from WordPress body classes, and three flags (mobile, Chromium, logged in).
 */
(function () {
  'use strict';
  var config = window.cwvFieldConfig || {};
  var vitals = window.webVitals;
  if (!config.endpoint || !vitals || !navigator.sendBeacon) {
    return;
  }
  var sampleRate = typeof config.sampleRate === 'number' ? config.sampleRate : 0.1;
  if (Math.random() >= sampleRate) {
    return;
  }

  var classes = (document.body && document.body.className ? document.body.className : '').split(/\s+/);
  function has(name) {
    return classes.indexOf(name) !== -1;
  }
  function pageType() {
    var i;
    var names = ['home', 'blog', 'search', 'error404'];
    for (i = 0; i < names.length; i++) {
      if (has(names[i])) {
        return names[i];
      }
    }
    for (i = 0; i < classes.length; i++) {
      var c = classes[i];
      if ((has('single') && c.indexOf('single-') === 0 && c.indexOf('single-format-') !== 0) ||
        c.indexOf('post-type-archive-') === 0 || c.indexOf('tax-') === 0) {
        return c;
      }
    }
    names = ['page', 'single', 'category', 'tag', 'author', 'date', 'archive', 'attachment'];
    for (i = 0; i < names.length; i++) {
      if (has(names[i])) {
        return names[i];
      }
    }
    return 'other';
  }

  var hints = navigator.userAgentData;
  var context = {
    page: location.pathname,
    pageType: pageType(),
    mobile: hints ? Boolean(hints.mobile) : (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : null),
    chromium: Boolean(hints && hints.brands && hints.brands.some(function (b) { return b.brand === 'Chromium'; })),
    loggedIn: has('logged-in')
  };

  function ms(n) {
    return typeof n === 'number' ? Math.round(n) : undefined;
  }
  function script(s) {
    return s ? {
      sourceURL: s.sourceURL,
      sourceFunctionName: s.sourceFunctionName,
      invoker: s.invoker,
      invokerType: s.invokerType,
      duration: ms(s.duration),
      forcedStyleAndLayoutDuration: ms(s.forcedStyleAndLayoutDuration)
    } : undefined;
  }
  function attribution(metric) {
    var a = metric.attribution || {};
    if (metric.name === 'LCP') {
      return {
        target: a.target,
        url: a.url,
        timeToFirstByte: ms(a.timeToFirstByte),
        resourceLoadDelay: ms(a.resourceLoadDelay),
        resourceLoadDuration: ms(a.resourceLoadDuration),
        elementRenderDelay: ms(a.elementRenderDelay)
      };
    }
    if (metric.name === 'INP') {
      var scripts = [];
      (a.longAnimationFrameEntries || []).forEach(function (frame) {
        (frame.scripts || []).forEach(function (s) {
          scripts.push(script(s));
        });
      });
      scripts.sort(function (x, y) {
        return (y.duration || 0) - (x.duration || 0);
      });
      return {
        interactionTarget: a.interactionTarget,
        interactionType: a.interactionType,
        loadState: a.loadState,
        inputDelay: ms(a.inputDelay),
        processingDuration: ms(a.processingDuration),
        presentationDelay: ms(a.presentationDelay),
        longestScript: a.longestScript ? {
          subpart: a.longestScript.subpart,
          intersectingDuration: ms(a.longestScript.intersectingDuration),
          entry: script(a.longestScript.entry)
        } : undefined,
        scripts: scripts.slice(0, 5),
        totalScriptDuration: ms(a.totalScriptDuration),
        totalStyleAndLayoutDuration: ms(a.totalStyleAndLayoutDuration),
        totalPaintDuration: ms(a.totalPaintDuration),
        totalUnattributedDuration: ms(a.totalUnattributedDuration)
      };
    }
    if (metric.name === 'CLS') {
      return {
        largestShiftTarget: a.largestShiftTarget,
        largestShiftValue: a.largestShiftValue,
        largestShiftTime: ms(a.largestShiftTime),
        loadState: a.loadState
      };
    }
    return {};
  }

  var queue = [];
  function add(metric) {
    queue.push({
      v: 1,
      name: metric.name,
      value: metric.name === 'CLS' ? Math.round(metric.value * 10000) / 10000 : Math.round(metric.value),
      rating: metric.rating,
      id: metric.id,
      navigationType: metric.navigationType,
      page: context.page,
      pageType: context.pageType,
      mobile: context.mobile,
      chromium: context.chromium,
      loggedIn: context.loggedIn,
      attribution: attribution(metric)
    });
  }
  function flush() {
    if (queue.length) {
      navigator.sendBeacon(config.endpoint, JSON.stringify(queue));
      queue = [];
    }
  }

  vitals.onLCP(add);
  vitals.onINP(add);
  vitals.onCLS(add);
  addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  });
})();
```

`pageType` is a best guess from WordPress body classes (`home`, `blog`, `single-{post_type}`, `page`,
`post-type-archive-{post_type}`, `tax-{taxonomy}`, `category`, `tag`, `search`, `error404`, `logged-in` and others;
[post-template.php at 7.1.2](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post-template.php)).
Themes can add their own classes, so check the values on a few pages.

## Payload (what `scripts/rum-summary.mjs` reads)

Each request body is a JSON array of these objects; store one body per line.

| Field | Meaning |
| --- | --- |
| `v` | payload version, `1` |
| `name`, `value`, `rating`, `id`, `navigationType` | from the web-vitals metric; `value` in ms, CLS unitless |
| `page` | `location.pathname`, no query string or fragment |
| `pageType` | best guess from body classes |
| `mobile` | `navigator.userAgentData.mobile` where available, else a coarse-pointer media query |
| `chromium` | the browser reports a `Chromium` brand: Chrome, and also Edge and other Chromium browsers (use it to get closer to CrUX, which is Chrome only) |
| `loggedIn` | the `logged-in` body class is present |
| `attribution` | the fields listed above, same names as web-vitals; `scripts` holds the five longest LoAF scripts |

Privacy: the payload holds no user IDs, cookies, query strings or form contents. The path itself can still point to
a person or an order (a member profile, `/my-account/view-order/123/`, `/checkout/order-received/123/`); leave such
pages out, for example with `if ( function_exists( 'is_account_page' ) && ( is_account_page() ||
is_order_received_page() ) ) { return; }` at the start of the loader's callback on a WooCommerce site
([wc-conditional-functions.php at 11.1.2](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-conditional-functions.php#L195-L249)).
The collector still sees each request's IP address, so it should not store it. Load the beacon only where the site's
consent setup allows analytics scripts, and keep the sample rate low.

## Reading the beacons

```sh
node scripts/rum-summary.mjs beacons.ndjson --site=https://www.example.com
node scripts/rum-summary.mjs beacons.ndjson --site=https://www.example.com --metric=INP --device=mobile --chromium-only
node scripts/rum-summary.mjs beacons.ndjson --site=https://www.example.com --by=page --metric=LCP --top=10
```

- The script de-duplicates repeated reports of one metric (same `name` and `id`), since CLS and INP are reported
  again when the page is hidden. It keeps the highest CLS or LCP value and the last INP report in file order: INP
  skips one interaction per 50, so it can fall as interactions add up
  ([InteractionManager.ts L79-L105 at v6.2.2](https://github.com/GoogleChrome/web-vitals/blob/v6.2.2/src/lib/InteractionManager.ts#L79-L105)).
- For slow records (above the good threshold) it prints the average share of each LCP subpart or INP phase, the LCP
  resource owners, the script owners with the time their longest script overlapped the interaction, and the CLS
  shift targets.
- It marks groups under 50 records as "low sample" (`--min-samples` changes this). Collect until the page groups that
  fail in CrUX have enough records.
- To compare with CrUX, filter to Chromium and one device type and read the 75th percentile
  ([web.dev: CrUX and RUM differences](https://web.dev/articles/crux-and-rum-differences#so_what_can_we_do_about_it)).
