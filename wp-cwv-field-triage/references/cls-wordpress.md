# CLS on WordPress: causes, checks and fixes

Read this in step 5 when CLS fails. First decide whether the shifts happen during load or after it: RUM `loadState`
at the largest shift tells you, and a field CLS much higher than the lab CLS points at post-load shifts that lab runs
never see ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#lab-field)). Every fix
changes the site: staging first, owner's approval, undo step ready.

## Reading the evidence

- `largestShiftTarget` is the first element that moved in the largest shift
  ([web-vitals README](https://github.com/GoogleChrome/web-vitals#clsattribution)). A layout-shift entry lists up to
  five moved elements; the element that caused the move (an ad, a banner, an image above them) is often not in that
  list ([web.dev: Debug layout shifts](https://web.dev/articles/debug-layout-shifts#layoutshiftattribution),
  [web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#identifying-load-cls-issues)). Look directly above the
  target in the page for what appeared or grew.
- Shifts within 500 ms of a click, tap or key press do not count; scrolling does not count as input
  ([web.dev: CLS](https://web.dev/articles/cls#expected-unexpected-layout-shifts)). Content that loads while the
  visitor scrolls and shifts the page counts, even within 500 ms
  ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#identifying-post-load-cls-issues)).
- Shifts inside iframes count in CrUX but are invisible to RUM
  ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#measure-cls-in-field)).

## Causes and fixes

The most common causes are images without dimensions; ads, embeds and iframes without dimensions; dynamically injected
content; and web fonts ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls)).

### Images and video without dimensions

- Give images and video `width` and `height` attributes, or reserve the space with CSS `aspect-ratio`; with the
  attributes set, browsers compute the aspect ratio before the image loads
  ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#images-without-dimensions)).
- WordPress adds missing `width` and `height` to images in post content since 5.5
  ([wp_img_tag_add_width_and_height_attr](https://developer.wordpress.org/reference/functions/wp_img_tag_add_width_and_height_attr/),
  [Make WordPress Core: 5.5](https://make.wordpress.org/core/2020/07/14/lazy-loading-images-in-5-5/)). Images printed by
  themes, builders or plugins with raw HTML get no such help; `scripts/scan-html.mjs` counts images without both
  attributes.
- WordPress 6.9 fixed layout shifts in the core Video block by adding `width`, `height` and an inline `aspect-ratio`
  ([6.9 field guide](https://make.wordpress.org/core/2025/11/18/wordpress-6-9-frontend-performance-field-guide/#eliminate-layout-shift-in-video-block)).

### Ads, embeds, iframes and injected content

- Reserve the space before the content arrives, with `min-height` or `aspect-ratio`; place late content lower on the
  page if space cannot be reserved; do not collapse the reserved space when no ad is returned
  ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#reserve-space)).
- Banners and notices that push the page down (cookie consent, promotions, "added to cart" bars, newsletter forms)
  should reserve space in advance or overlay the content instead of pushing it
  ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#avoid_inserting_new_content_without_a_user_interaction)).
  On WordPress, map the banner's classes to their owner (a plugin, the theme or a tag) as in
  `mapping-to-wordpress.md`.
- Tag managers can cause CLS by injecting content into the page
  ([web.dev: Tag best practices](https://web.dev/articles/tag-best-practices#impact_on_core_web_vitals)); features
  that users see should not be loaded through a tag manager
  ([web.dev: Tag best practices](https://web.dev/articles/tag-best-practices#not_all_scripts_should_be_loaded_with_a_tag_manager)).
- Content loaded as the visitor scrolls (infinite scroll, "load more" without a click, lazy sections) shifts the page
  unless its space is reserved; letting the visitor trigger the load with a button makes the shift expected
  ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#avoid_inserting_new_content_without_a_user_interaction)).

### Web fonts

- Both swapping in the web font and hiding text until it loads can shift layout. Options: `font-display: optional`,
  a close fallback font (`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`), and preloading
  critical fonts ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#web-fonts)).
- On a WordPress site, find which stylesheet (theme or plugin) declares the `@font-face` rules before changing them;
  `scripts/wp-owner.mjs` names the owner of a stylesheet or font URL.

### Animations

- Animating `top`, `left` or other layout properties causes shifts; `transform` animations do not
  ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#animation)). On WordPress, check the settings of
  page builders and sliders that animate sections.

### Back/forward cache

- Pages restored from the back/forward cache show no load shifts again, so bfcache eligibility lowers CLS on back and
  forward navigations ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#reduce_cls_by_ensuring_pages_are_eligible_for_the_bfcache)).
  `unload` listeners and `Cache-Control: no-store` on the page can make it ineligible
  ([web.dev: bfcache](https://web.dev/articles/bfcache)).

## Checks after a fix

- Lab: the Layout shift culprits insight and the Layout shifts track, while loading and while scrolling and
  interacting with live metrics on ([web.dev: Optimize CLS](https://web.dev/articles/optimize-cls#identifying-load-cls-issues)).
- Field: the share of page views above 0.1 for the page type, and the top `largestShiftTarget`, in
  `scripts/rum-summary.mjs --metric=CLS`; then CrUX over the next 28 days.
