# LCP on WordPress: causes by subpart, checks and fixes

Read this in step 5 when LCP fails. Start from the subpart that dominates in the field (CrUX image subparts or RUM
`attribution`), not from a list of tips: an optimization in one subpart can simply move the time into another
([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#lcp-breakdown)). Source links point at WordPress 7.1.2
unless noted. Every fix below changes the site: apply it on staging first, with the owner's approval, and keep the undo
step at hand.

| Dominant subpart | Candidate WordPress causes | Section |
| --- | --- | --- |
| Time to first byte | no page cache or cache bypassed, redirects, slow PHP or database, a far-away origin | [TTFB](#time-to-first-byte) |
| Resource load delay | LCP image lazy-loaded, set as a CSS background, injected by a slider or lazy-load script, or competing with other requests | [Load delay](#resource-load-delay) |
| Resource load duration | a large image, no CDN, no browser cache | [Load duration](#resource-load-duration) |
| Element render delay | render-blocking CSS and JavaScript in `<head>`, content hidden until a script runs, long tasks, web fonts | [Render delay](#element-render-delay) |

What each subpart points to, per Chrome: TTFB to server, network or redirects; load delay to an image discovered
late; load duration to download size; render delay to an image that is ready but not shown, often waiting on
JavaScript ([CrUX 2025-02](https://developer.chrome.com/blog/crux-2025-02#lcp_image_subparts)).

## Time to first byte

- Causes named by web.dev: multiple redirects, visitors far from the server, poor networks, and cached content that
  cannot be used because of unique URL parameters, for example analytics parameters
  ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#reduce-ttfb)). On WordPress, server
  time depends on the number and quality of plugins and on the theme
  ([web.dev: Optimize TTFB](https://web.dev/articles/optimize-ttfb#platform-specific_guidance)).
- Field TTFB much higher than lab TTFB points at redirects, caching or network differences that a lab run of the final
  URL does not see ([web.dev: Optimize TTFB](https://web.dev/articles/optimize-ttfb)).
- Server-Timing headers split server time into named parts and reach the field through the Navigation Timing API
  ([web.dev: Optimize TTFB](https://web.dev/articles/optimize-ttfb#debug_high_ttfb_in_the_field_with_server-timing)),
  which the web-vitals attribution exposes as `navigationEntry.serverTiming`
  ([web-vitals README](https://github.com/GoogleChrome/web-vitals#lcpattribution)). The Performance Lab plugin can
  send Server-Timing headers for template generation
  ([6.9 frontend performance field guide](https://make.wordpress.org/core/2025/11/18/wordpress-6-9-frontend-performance-field-guide/#introduce-the-template-enhancement-output-buffer)).
- WordPress 6.9 changes that move TTFB
  ([6.9 field guide](https://make.wordpress.org/core/2025/11/18/wordpress-6-9-frontend-performance-field-guide/)):
  classic themes now buffer the template to load block styles on demand, which raises TTFB but lowers LCP (about 4%
  on the Sample Page in core's tests); WP-Cron is spawned at `shutdown` instead of `init` because the loopback request
  could add about a second.
- Slow database queries and PHP are a separate investigation: hand them to the collection's
  `wp-slow-query-investigation` skill once field data shows TTFB is the dominant subpart.

## Resource load delay

The LCP resource should start loading at about the same time as the first resource the page loads
([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#1_eliminate_resource_load_delay)). Check with
`node scripts/scan-html.mjs page.html --lcp=<part of the LCP image URL>`.

### The LCP image is lazy-loaded

- Never lazy-load the LCP image: lazy loading waits for layout to confirm the image is in the viewport, which always
  adds resource load delay ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#optimize_the_priority_the_resource_is_given)).
- How WordPress decides, in `wp_get_loading_optimization_attributes()`
  ([media.php L6150-L6396](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/media.php#L6150-L6396)):
  - Images without both `width` and `height` get no `loading` or `fetchpriority` at all (L6214).
  - An image that already has `loading` or `fetchpriority` keeps it; `loading="lazy"` marks it out of the viewport,
    any other value in it. `fetchpriority="low"` is never lazy-loaded (7.0 and later).
  - Header template parts (block themes) and `get_header_image_tag()` count as in the viewport (L6296).
  - In the main query loop, the first images up to the threshold are not lazy-loaded; the threshold is 3 by default
    since 6.3 (filter `wp_omit_loading_attr_threshold`) ([hook reference](https://developer.wordpress.org/reference/hooks/wp_omit_loading_attr_threshold/)).
  - Images in the main query before the loop, after `get_header` and before `get_footer`, count as in the viewport
    (classic themes, since 6.3) (L6335).
  - Everything else, including images in contexts WordPress cannot place, gets `loading="lazy"` (L6350-L6361).
  A hero image printed by custom theme code or a page builder outside these contexts can therefore end up lazy.
- Page builders and lazy-load plugins can add their own `loading="lazy"` or a JavaScript `data-src` loader; those
  never pass through the function above. A `data-src` image cannot be found by the browser's preload scanner
  ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#optimize-when-the-resource-is-discovered)).

Fixes, in order of preference:

1. Output the hero image with the attributes it needs. The function never overrides attributes that are passed in,
   and never combines `fetchpriority="high"` with `loading="lazy"`
   ([Make WordPress Core: image performance in 6.3](https://make.wordpress.org/core/2023/07/13/image-performance-enhancements-in-wordpress-6-3/)):
   `wp_get_attachment_image( $id, 'full', false, array( 'loading' => false, 'fetchpriority' => 'high' ) )`, where
   `false` omits the `loading` attribute ([wp_get_attachment_image](https://developer.wordpress.org/reference/functions/wp_get_attachment_image/)).
2. Or adjust the automatic result with the `wp_get_loading_optimization_attributes` filter (6.4 and later)
   ([Make WordPress Core: 6.4](https://make.wordpress.org/core/2023/10/18/image-loading-optimization-enhancements-in-6-4/)):

   ```php
   <?php
   /**
    * Plugin Name: CWV fix: hero image priority
    * Description: Removes lazy loading from the hero image and gives it high priority. Delete this file to undo.
    */
   add_filter(
   	'wp_get_loading_optimization_attributes',
   	static function ( $loading_attrs, $tag_name, $attr, $context ) {
   		if ( 'img' === $tag_name && isset( $attr['src'] ) && str_contains( $attr['src'], '/hero-' ) ) {
   			unset( $loading_attrs['loading'] );
   			$loading_attrs['fetchpriority'] = 'high';
   		}
   		return $loading_attrs;
   	},
   	10,
   	4
   );
   ```

3. For multi-column layouts where the LCP image is not among the first three content images, raise the threshold on
   those templates with `wp_omit_loading_attr_threshold`
   ([Make WordPress Core: 5.9](https://make.wordpress.org/core/2021/12/29/enhanced-lazy-loading-performance-in-5-9/)).
4. For a lazy-load plugin or page builder, exclude the hero image in its settings (vendor documentation) or turn its
   lazy loading off; WordPress has lazy-loaded images natively since 5.5
   ([Make WordPress Core: 5.5](https://make.wordpress.org/core/2020/07/14/lazy-loading-images-in-5-5/)).
5. Optimization Detective, part of the Performance Lab plugins, lets its Image Prioritizer extension add
   `fetchpriority="high"` to the actual LCP image
   ([6.9 field guide](https://make.wordpress.org/core/2025/11/18/wordpress-6-9-frontend-performance-field-guide/#introduce-the-template-enhancement-output-buffer)).

Check: the saved HTML shows the image without `loading="lazy"` and with `fetchpriority="high"`; in the lab the image
starts with the first resources. Undo: delete the snippet file or revert the template change.

### The LCP image is found late or competes

- A CSS background image, an image added by JavaScript (sliders), or an image whose `src` is hidden in `data-src` is
  discovered late. Put the image in the HTML, or preload it with `<link rel="preload" as="image" fetchpriority="high">`
  ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#optimize-when-the-resource-is-discovered),
  [web.dev: Fetch Priority](https://web.dev/articles/fetch-priority)).
- WordPress adds `fetchpriority="high"` automatically only to an image it places in the viewport that is at least
  50,000 square pixels (`wp_min_priority_img_pixels`)
  ([Make WordPress Core: 6.3](https://make.wordpress.org/core/2023/07/13/image-performance-enhancements-in-wordpress-6-3/)).
- High priority on more than one or two images makes the hint useless
  ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#optimize_the_priority_the_resource_is_given)).
- An LCP image on another host (an image CDN) needs a new connection first; same-origin hosting or a proxied CDN avoids
  it ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#reduce_the_distance_the_resource_has_to_travel)).
- Scripts compete for bandwidth. Since 6.9, script modules of interactive blocks and `comment-reply` default to
  `fetchpriority="low"`, and a script's priority can be lowered with `wp_script_add_data( $handle, 'fetchpriority',
  'low' )` ([6.9 field guide](https://make.wordpress.org/core/2025/11/18/wordpress-6-9-frontend-performance-field-guide/#support-specifying-fetchpriority-for-scripts-and-script-modules);
  [script-loader.php L1059-L1062](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/script-loader.php#L1059-L1062)).

## Resource load duration

- Reduce the file size (responsive sizes, modern formats, compression), shorten the distance (a CDN), and cache it
  ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#reduce-resource-load-duration)). WordPress prints
  `srcset` and `sizes` for attachment images; since 6.7 lazy-loaded images get `sizes="auto"`, which does not apply to
  a correctly eager LCP image ([Make WordPress Core: 6.7](https://make.wordpress.org/core/2024/10/18/auto-sizes-for-lazy-loaded-images-in-wordpress-6-7/)).
- web.dev's research found load duration is usually not the main bottleneck; check the field breakdown before
  spending time here ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#reduce-resource-load-duration)).

## Element render delay

### Render-blocking CSS and JavaScript in `<head>`

- Stylesheets block rendering unless their `media` does not apply (for example `media="print"`); scripts without
  `async` or `defer` block the parser, and parser-blocking resources in `<head>` block rendering too
  ([web.dev: Critical path](https://web.dev/learn/performance/understanding-the-critical-path#render-blocking_resources)).
  Inline classic scripts also stop the parser while they run
  ([6.9 field guide](https://make.wordpress.org/core/2025/11/18/wordpress-6-9-frontend-performance-field-guide/#convert-emoji-detection-script-to-script-module-and-move-to-footer)).
- WordPress prints enqueued stylesheets as `<link rel="stylesheet">`, and since 6.9 classic themes move stylesheets
  enqueued late (while blocks render) up into `<head>` as well
  ([6.9 field guide](https://make.wordpress.org/core/2025/11/18/wordpress-6-9-frontend-performance-field-guide/#load-block-styles-on-demand-in-classic-themes)).
- Core registers `jquery-core` and `jquery-migrate` for the head group with no strategy
  ([script-loader.php L907-L909](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/script-loader.php#L907-L909)),
  and a dependency keeps its own group ([class-wp-scripts.php L693-L703](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-scripts.php#L693-L703)).
  So when anything enqueued before `wp_head` depends on `jquery`, both print in `<head>` as blocking scripts, even if
  the dependent script itself prints in the footer.
- A script registered with `strategy` gets `defer` or `async` only if its dependency tree allows it; otherwise
  WordPress falls back to a more conservative strategy, never a less conservative one (`async` can become `defer` or
  blocking, `defer` can become blocking, never `async`), keeps the intended one in `data-wp-strategy`, and treats a
  script with an inline `after` script as blocking ([Make WordPress Core: 6.3 strategies](https://make.wordpress.org/core/2023/07/14/registering-scripts-with-async-and-defer-attributes-in-wordpress-6-3/);
  [class-wp-scripts.php L1044-L1066, L1115-L1123](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-scripts.php#L1044-L1123)).

Check: `scripts/scan-html.mjs` lists head stylesheets and blocking scripts by owner and flags downgraded strategies;
the Render-blocking requests insight shows which of them delayed the first paint in a trace.

Fixes, one at a time on staging:

1. The plugin's own setting to load its assets only where used (vendor documentation).
2. Dequeue where unused. Dequeue after the plugin enqueues, with a later priority
   ([wp_dequeue_style, user notes](https://developer.wordpress.org/reference/functions/wp_dequeue_style/#user-contributed-notes)).
   `has_block()` and `has_shortcode()` check post content only
   ([has_block](https://developer.wordpress.org/reference/functions/has_block/),
   [has_shortcode](https://developer.wordpress.org/reference/functions/has_shortcode/)); forms in widgets, template
   parts or builder layouts are not seen, so test every template that shows the feature:

   ```php
   <?php
   /**
    * Plugin Name: CWV fix: contact form assets only where used
    * Description: Removes the contact-form-x stylesheet and script where the form is not in the content. Delete this file to undo.
    */
   add_action(
   	'wp_enqueue_scripts',
   	static function () {
   		$post = get_post();
   		if ( is_singular() && $post && ( has_shortcode( $post->post_content, 'contact-form-x' ) || has_block( 'contact-form-x/form', $post ) ) ) {
   			return;
   		}
   		wp_dequeue_style( 'contact-form-x' );
   		wp_dequeue_script( 'contact-form-x' );
   	},
   	100
   );
   ```

3. Ask WordPress to defer a plugin script (6.3 and later). `wp_script_add_data()` works only after the script is
   registered ([wp_script_add_data](https://developer.wordpress.org/reference/functions/wp_script_add_data/)). Check that
   the saved HTML shows `defer`; if it shows only `data-wp-strategy="defer"`, find the inline `after` script or the
   blocking dependent that prevents it:

   ```php
   <?php
   /**
    * Plugin Name: CWV fix: defer slider-x
    * Description: Asks WordPress to defer the slider-x script. Delete this file to undo.
    */
   add_action(
   	'wp_enqueue_scripts',
   	static function () {
   		wp_script_add_data( 'slider-x', 'strategy', 'defer' );
   	},
   	100
   );
   ```

4. Inline small stylesheets. Any enqueued stylesheet with `path` data can be inlined, smallest first, until the total
   reaches the limit: 40,000 bytes since 6.9 (20,000 before), filter `styles_inline_size_limit`
   ([Make WordPress Core: 5.8](https://make.wordpress.org/core/2021/07/01/block-styles-loading-enhancements-in-wordpress-5-8/);
   [script-loader.php L3095-L3150](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/script-loader.php#L3095-L3150)):
   `wp_style_add_data( 'contact-form-x', 'path', WP_PLUGIN_DIR . '/contact-form-x/assets/css/style.css' )` in the same
   kind of `wp_enqueue_scripts` callback. The path must be the file the handle's URL points to.
5. Block CSS on demand: block themes are opted in by core to load only the styles of blocks on the page; classic
   themes are opted in by default since 6.9, through the template enhancement output buffer
   ([script-loader.php L3690-L3720](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/script-loader.php#L3690-L3720)).
   A theme or plugin that returns false from `should_load_separate_core_block_assets` brings back the large combined
   stylesheet; the 6.9 guide asks sites to remove such code
   ([6.9 field guide](https://make.wordpress.org/core/2025/11/18/wordpress-6-9-frontend-performance-field-guide/#load-block-styles-on-demand-in-classic-themes)).
6. Emoji detection: since 6.9 it is an inline module printed in the footer; unhooking
   `print_emoji_detection_script` from `wp_head` still removes it
   ([6.9 field guide](https://make.wordpress.org/core/2025/11/18/wordpress-6-9-frontend-performance-field-guide/#convert-emoji-detection-script-to-script-module-and-move-to-footer)).

For every snippet: Backup: record the new file (nothing else changes). Check: save the HTML again and run
`scan-html.mjs`; test the plugin's feature on each template that uses it. Undo: delete the file.

### The LCP element is hidden until a script runs

- Rendering waits when the LCP element is added by JavaScript, hidden by an A/B testing script, or blocked by long
  tasks ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#2_eliminate_element_render_delay)).
- Elements at opacity 0 are not LCP candidates
  ([web.dev: LCP](https://web.dev/articles/lcp#what-elements-are-considered)), so a builder entrance animation on the
  hero delays LCP until it becomes visible. Turn such animations off above the fold (builder settings).
- Tag managers are not the place for hero images or other visible features; resources they load arrive later
  ([web.dev: Tag best practices](https://web.dev/articles/tag-best-practices#not_all_scripts_should_be_loaded_with_a_tag_manager)).

### Text LCP and web fonts

- With a `font-display` other than `auto` or `block`, text stays visible while the font loads, so LCP does not wait
  for the font ([web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp#eliminate_the_network_time_entirely)).
- For mostly-text LCP pages, CrUX image subparts do not apply; use TTFB and FCP as the breakdown
  ([CrUX metrics](https://developer.chrome.com/docs/crux/methodology/metrics#lcp-image-subparts)).

## Faster next pages: speculative loading (6.8 and later)

- WordPress prints speculation rules on the front end for logged-out visitors on sites with pretty permalinks.
  The default resolves to `prefetch` with `conservative` eagerness (on pointer or touch down). Excluded: URLs with
  query strings (on sites with pretty permalinks), `wp-*.php`, `wp-admin`, files in the uploads, content, plugins and
  theme folders, links with `rel="nofollow"`, and links inside an element with the class `no-prefetch` (and also
  `no-prerender` when prerendering) ([Make WordPress Core: 6.8](https://make.wordpress.org/core/2025/03/06/speculative-loading-in-6-8/);
  [speculative-loading.php L204-L296](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/speculative-loading.php#L204-L296)).
- Filters: `wp_speculation_rules_configuration` (`mode` prefetch or prerender, `eagerness` conservative, moderate or
  eager, or `null` to turn it off), `wp_speculation_rules_href_exclude_paths`, and the `wp_load_speculation_rules`
  action for extra rules ([Make WordPress Core: 6.8](https://make.wordpress.org/core/2025/03/06/speculative-loading-in-6-8/)).
- Since 7.1, hosts can change what `auto` resolves to with the `WP_SPECULATIVE_LOADING_DEFAULT_MODE` and
  `WP_SPECULATIVE_LOADING_DEFAULT_EAGERNESS` constants or environment variables; a filter still wins
  ([wp_get_speculation_rules_configuration](https://developer.wordpress.org/reference/functions/wp_get_speculation_rules_configuration/)).
  Read the actual rules from the saved HTML (`scan-html.mjs` prints them) rather than from settings.
- It only speeds up navigations from one page of the site to another, not landing pages
  ([Make WordPress Core: 6.8 performance](https://make.wordpress.org/core/2025/04/16/wordpress-6-8-performance-improvements/)).
  A prerendered page can have a near-zero LCP ([Chrome: Prerender pages](https://developer.chrome.com/docs/web-platform/prerender-pages#impact));
  CrUX shows the share of `prerender` navigations in `navigation_types`.
- `moderate` starts the speculation when the pointer rests on a link for 200 ms on desktop, or on pointer down if that
  comes first; on mobile Chrome uses viewport heuristics
  ([Chrome: Prerender pages](https://developer.chrome.com/docs/web-platform/prerender-pages#eagerness)). Prerendering runs
  the page's scripts, so analytics and other code that should run only on a real visit must check for prerendering
  first ([Make WordPress Core: 6.8](https://make.wordpress.org/core/2025/03/06/speculative-loading-in-6-8/)).

```php
<?php
/**
 * Plugin Name: CWV fix: moderate speculative loading
 * Description: Starts prefetching earlier (after a short hover on desktop) instead of on pointer down. Delete this file to undo.
 */
add_filter(
	'wp_speculation_rules_configuration',
	static function ( $config ) {
		if ( is_array( $config ) ) {
			$config['eagerness'] = 'moderate';
		}
		return $config;
	}
);
```

## Back/forward cache

Pages restored from the back/forward cache appear instantly. Pages with an `unload` listener, or served with
`Cache-Control: no-store`, may not be eligible; use `pagehide` instead of `unload`
([web.dev: bfcache](https://web.dev/articles/bfcache)). Many `back_forward` but few `back_forward_cache` navigations in
CrUX point here ([CrUX metrics](https://developer.chrome.com/docs/crux/methodology/metrics#navigation-types)).
