# From URLs, handles and elements to the plugin, theme or setting

Read this in step 4. It turns field attribution (a script URL, an LCP image URL, an element selector) into a named
WordPress component, and says how sure you can be. Source links point at WordPress 7.1.2 unless noted.

## Inventory first (read-only)

```sh
wp core version
wp theme list --status=active --fields=name,version --skip-update-check   # the active theme (a child theme if one is used)
wp theme list --status=parent --fields=name,version --skip-update-check   # its parent, if any
wp plugin list --fields=name,status,version --skip-update-check
wp plugin list --status=must-use --fields=name,version --skip-update-check
wp plugin list --status=dropin --fields=name --skip-update-check
wp config get WP_CONTENT_URL    # set only if wp-config.php moves the content folder; otherwise it is wp-content
```

`--status` accepts `must-use` and `dropin` for plugins and `active`, `parent`, `inactive` for themes
([wp plugin list](https://developer.wordpress.org/cli/commands/plugin/list/),
[wp theme list](https://developer.wordpress.org/cli/commands/theme/list/)). `wp plugin path` prints the plugins
folder, for example `/var/www/wordpress/wp-content/plugins`
([wp plugin path](https://developer.wordpress.org/cli/commands/plugin/path/)). `wp config get` reads one constant from
wp-config.php ([wp config get](https://developer.wordpress.org/cli/commands/config/get/)). Do not run `wp config list`:
it prints every constant, including the database password and the keys
([wp config list](https://developer.wordpress.org/cli/commands/config/list/)).

## Where WordPress files live

| Path in the URL | Owner | Source |
| --- | --- | --- |
| `wp-content/plugins/<slug>/` | the plugin in that folder (the folder is named after the plugin) | [Plugin basics](https://developer.wordpress.org/plugins/plugin-basics/) |
| `wp-content/mu-plugins/` | a must-use plugin: always on, listed separately, cannot be turned off in wp-admin; often added by hosts | [Must-use plugins](https://developer.wordpress.org/advanced-administration/plugins/mu-plugins/) |
| `wp-content/themes/<slug>/` | a theme; check whether `<slug>` is the active child theme or its parent | [Child themes](https://developer.wordpress.org/themes/advanced-topics/child-themes/) |
| `wp-content/uploads/YYYY/MM/` | a Media Library file; the owner is whatever template, block or plugin prints it | |
| `wp-content/uploads/<folder>/` | a generated file (CSS, fonts, bundles) written by a plugin or theme; search the code for `<folder>` | |
| `wp-content/cache/<folder>/` | generated files, not part of WordPress; find the plugin that writes `<folder>`; a combined bundle hides the original owners | |
| `wp-includes/js/jquery/` | core jQuery, printed because something enqueued depends on `jquery` | [script-loader.php L907-L909](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/script-loader.php#L907-L909) |
| `wp-includes/css/dist/block-library/`, `wp-includes/blocks/<name>/` | core block styles and scripts | [script-loader.php](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/script-loader.php) |
| another host | a third party, unless it is the site's CDN (then the path rules above apply) | |

The content, plugin and uploads folders can be moved with `WP_CONTENT_DIR`/`WP_CONTENT_URL`,
`WP_PLUGIN_DIR`/`WP_PLUGIN_URL` and `UPLOADS`; the themes folder always sits in the content directory, and extra
theme folders can be added with `register_theme_directory()`
([wp-config.php](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/#moving-wp-content-folder)).
Must-use plugins move with `WPMU_PLUGIN_DIR` and `WPMU_PLUGIN_URL`
([Must-use plugins](https://developer.wordpress.org/advanced-administration/plugins/mu-plugins/)).

`scripts/wp-owner.mjs` applies these rules to a list of URLs (`--content-dir` for a renamed content folder, `--cdn`
for the site's CDN hosts) and sums an optional weight per owner, for example milliseconds from LoAF.

## IDs WordPress prints, and how to find the code behind them

| Markup | Meaning | Source |
| --- | --- | --- |
| `<script src="..." id="<handle>-js">` | a script enqueued with that handle | [class-wp-scripts.php L454-L457](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-scripts.php#L454-L457) |
| `defer` or `async` on it | the strategy WordPress actually applied | same file, [L458-L460](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-scripts.php#L458-L460) |
| `data-wp-strategy="defer"` on it | the strategy the code asked for; if `defer`/`async` is missing, WordPress downgraded it | same file, [L461-L463](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-scripts.php#L461-L463) |
| `<script id="<handle>-js-extra">` | data from `wp_localize_script()` | [class-wp-scripts.php L223-L247](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-scripts.php#L223-L247) |
| `<script id="<handle>-js-before">`, `<handle>-js-after` | code from `wp_add_inline_script()` | [class-wp-scripts.php L604-L610](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-scripts.php#L604-L610) |
| `<link rel='stylesheet' id='<handle>-css'>` | a stylesheet enqueued with that handle | [class-wp-styles.php L205](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-styles.php#L205) |
| `<style id='<handle>-inline-css'>` | inline CSS added to that handle, or a small stylesheet WordPress inlined | [class-wp-styles.php L163](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-styles.php#L163) |
| `<script type="module" id="<id>-js-module">`, `<link rel="modulepreload" id="<id>-js-modulepreload">` | a script module | [class-wp-script-modules.php L562, L603](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-script-modules.php#L562) |

Since WordPress 6.9, inline scripts end with a `//# sourceURL=<handle>-js-extra` (or `-js-before`, `-js-after`,
`-js-translations`) comment and inline styles with `/*# sourceURL=<handle>-inline-css */`, which developer tools use
as the script's name (Trac ticket 63887, [pull request 9628](https://github.com/WordPress/wordpress-develop/pull/9628); present in the 6.9
branch, not in 6.8: [class-wp-scripts.php at 6.9](https://github.com/WordPress/wordpress-develop/blob/6.9/src/wp-includes/class-wp-scripts.php)).
`scripts/wp-owner.mjs` reads such names as `inline:<handle>`.

Find the code that registers a handle (read-only):

```sh
grep -rn --include='*.php' -e "'my-handle'" -e '"my-handle"' wp-content/plugins wp-content/themes wp-content/mu-plugins
```

Block assets follow fixed names: `core/<name>` becomes `wp-block-<name>` (with `-view` for view scripts), and
`<namespace>/<name>` becomes `<namespace>-<name>-style`, `-script`, `-view-script`, `-view-script-module` or
`-view-style` ([blocks.php L52-L80](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/blocks.php#L52-L80)).
Blocks with the default class name support carry the class `wp-block-<namespace>-<name>` (core blocks drop `core-`)
([generated-classname.php](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/block-supports/generated-classname.php)).
To find the plugin behind a block: `grep -rln --include=block.json '"name": "<namespace>/<name>"' wp-content`.

## From a field element selector to its owner

LCP `target`, INP `interactionTarget` and CLS `largestShiftTarget` are CSS selectors.

1. Save the page as a logged-out visitor and search it for the element's ID or classes.
2. Classes such as `wp-block-...` name a block (above). Other classes and IDs usually come from the theme or a plugin:
   search their templates and scripts (`grep -rn 'class-name' wp-content/themes wp-content/plugins`).
3. Body classes name the template type (`single-product`, `page`, `category` and so on;
   [post-template.php](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post-template.php)),
   which is how a Search Console URL group maps to a WordPress template.
4. For INP, the LoAF `invoker` (for example `BUTTON#save.onclick`) and `sourceFunctionName` point at the handler;
   search the owner's JavaScript for the function name.
5. An empty INP `interactionTarget` generally means the element was removed from the DOM after the interaction
   ([web-vitals README](https://github.com/GoogleChrome/web-vitals#inpattribution)).

## Owners that bundling hides

- Generated files in `wp-content/cache/` or in `uploads` folders can combine code from several plugins. Turn combining
  off on staging, or read the bundle for the original file names, before naming an owner.
- Large bundles also cost responsiveness: evaluating one very large classic script is one long main-thread task,
  while several smaller scripts split that work
  ([web.dev: Script evaluation and long tasks](https://web.dev/articles/script-evaluation-and-long-tasks#conclusion)).
- A LoAF entry names the script's entry point, not the slow function it called, so a theme handler that calls a
  plugin library is reported as the theme ([Chrome: LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames#better-attribution)).

## Third parties

- A script on another host is a third party unless it is the site's CDN. Tag managers inject other vendors' scripts,
  so list the container's tags before blaming the container itself.
- Cross-origin scripts loaded without CORS give only a `sourceURL` in LoAF
  ([Chrome: LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames#no-script-location)).
- Iframes (video embeds, maps, ads) are invisible to RUM but count in CrUX, so their cost shows only as a gap between
  the two ([web-vitals README](https://github.com/GoogleChrome/web-vitals#limitations)).

## How sure are you

Label every owner in the report with its evidence:

| Confidence | Evidence needed |
| --- | --- |
| Confirmed | field attribution points at the owner, and removing or changing only that owner on staging moves the lab metric in the same direction (`lab-confirmation.md`) |
| Likely | field attribution points at the owner, not yet reproduced; or a lab trace and the code both point at it |
| Hypothesis | code reading or a single lab run only; no field attribution |

Never name a plugin as the cause on code reading alone. A render-blocking stylesheet is a fact about the HTML; whether
it moves the field LCP is a separate question.
