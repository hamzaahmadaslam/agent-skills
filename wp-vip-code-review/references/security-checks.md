# Security checks

Read this for the manual security pass: output escaping, input handling, nonces, capabilities, REST permissions,
SQL, redirects, JavaScript and risky PHP. Sniffs catch many of these by pattern but cannot tell whether a value is
trusted or whether a check covers the right action. Facts checked on 2026-09-26; the source is beside each one.

Look in the diff for: `echo`, `print`, `printf` and `<?=` of variables; `$_GET`, `$_POST`, `$_REQUEST`,
`$_SERVER`, `$_COOKIE`, `$_FILES`; handlers on `wp_ajax_*`, `admin_post_*`, `register_rest_route()` and settings
pages; `$wpdb` calls with variables; `wp_redirect()`; `add_query_arg()`; `.html(`, `.innerHTML`,
`insertAdjacentHTML`; `unserialize()`; `eval`, `create_function`, `extract`; `include` with a variable path;
`HTTP_X_FORWARDED_FOR`; keys or tokens in code.

## Input and output

| Rule | Source |
| ---- | ------ |
| Treat `$_GET`, `$_POST`, `$_REQUEST`, `$_SERVER` and values from the database (post meta, options) as untrusted: validate and sanitize them as early as possible, and escape them as late as possible, ideally at output. | [php_codesniffer/errors](https://docs.wpvip.com/php_codesniffer/errors/), [validating-sanitizing-and-escaping](https://docs.wpvip.com/security/validating-sanitizing-and-escaping/) |
| Validation against a list of allowed values is better than sanitizing. Accept input from a finite list where possible, checked with `in_array( $value, $allowed, true )`. | [validating-sanitizing-and-escaping](https://docs.wpvip.com/security/validating-sanitizing-and-escaping/), [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Sanitize with the `sanitize_*()` helpers, for example `sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) )`; clean HTML with `wp_kses()` and its variants. | [validating-sanitizing-and-escaping](https://docs.wpvip.com/security/validating-sanitizing-and-escaping/) |
| Escape by context: `esc_html()` for HTML, `esc_url()` for every URL including `src` and `href`, `esc_attr()` for other attributes, `esc_js()` for inline JavaScript in attributes, `wp_kses()` or `wp_kses_post()` for HTML that must keep markup. | [validating-sanitizing-and-escaping](https://docs.wpvip.com/security/validating-sanitizing-and-escaping/) |
| When escaping late is impossible, escape while building the string and name the variable with an `_escaped`, `_safe` or `_clean` suffix; a function that cannot escape late must return safe HTML. | [validating-sanitizing-and-escaping](https://docs.wpvip.com/security/validating-sanitizing-and-escaping/) |
| Encode URL parameters with `rawurlencode()` (not `urlencode()`); values passed to `add_query_arg()` must be encoded, or a value such as `somevalue&post_id=123` can hijack the URL's parameters. | [validating-sanitizing-and-escaping](https://docs.wpvip.com/security/validating-sanitizing-and-escaping/), [encode-values-add-query-arg](https://docs.wpvip.com/security/encode-values-add-query-arg/) |
| Use `$_POST` or `$_GET` explicitly, not `$_REQUEST`, which hides where the data came from. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Use `get_bloginfo()` with the right escaping function instead of `bloginfo()`. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| With Advanced Custom Fields 6.2.7 and later, `the_field()` runs values through `wp_kses()` but still renders HTML; for fields that should not hold HTML, or that go into an attribute or URL, echo `get_field()` through `esc_html()`, `esc_attr()` or `esc_url()`. | [plugins/incompatibilities](https://docs.wpvip.com/plugins/incompatibilities/) |

## Nonces, capabilities and REST permissions

| Rule | Source |
| ---- | ------ |
| Use nonces to validate every form submission, and capability checks to confirm the user may take the requested action. | [php_codesniffer/errors](https://docs.wpvip.com/php_codesniffer/errors/) |
| The save or update handler of a new admin page or section, or of an existing core admin page, must check a nonce (one added to that page's output, or the existing `_wpnonce` on core pages) and check the user's capability. | [php_codesniffer/errors](https://docs.wpvip.com/php_codesniffer/errors/) |
| Nonces help against CSRF but not against replay attacks, and must never be used for authentication, authorization or access control; protect functions with `current_user_can()`. A nonce's default lifetime is one day, and in practice it is valid for 12 to 24 hours. | [WordPress nonces](https://developer.wordpress.org/apis/security/nonces/) |
| Any plugin code that lets users submit data, in the admin or on the public side, should check capabilities, and run only when the current user has the ones needed. | [checking-user-capabilities](https://developer.wordpress.org/plugins/security/checking-user-capabilities/) |
| Every REST route needs a `permission_callback` that returns `true`, `false` or a `WP_Error`; check authorization with `current_user_can()` rather than only whether the user is logged in. Since WordPress 5.5 a missing `permission_callback` triggers a `_doing_it_wrong` notice; intentionally public routes use `__return_true`. | [adding-custom-endpoints](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/) |
| VIP: custom API routes that read or write private data must register a valid permissions callback. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Settings pages use the Settings API, with a `sanitize` callback in `register_setting()`. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| The `unfiltered_html` capability lets a user post HTML and JavaScript; on multisite only Super Admins have it by default. | [wordpress-on-vip/customize-user-roles](https://docs.wpvip.com/wordpress-on-vip/customize-user-roles/) |

## SQL, redirects, headers

| Rule | Source |
| ---- | ------ |
| Protect every query with `$wpdb->prepare()` and, where needed, `esc_sql()` or `$wpdb->esc_like()`. | [optimize-queries/database-queries](https://docs.wpvip.com/databases/optimize-queries/database-queries/) |
| Use `wp_safe_redirect()` with the `allowed_redirect_hosts` filter to avoid redirects to other hosts, and `exit` after it. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/), [wp_safe_redirect()](https://developer.wordpress.org/reference/functions/wp_safe_redirect/) |
| `HTTP_X_FORWARDED_FOR`, `HTTP_X_IP_TRAIL` and `REMOTE_ADDR` are user-controlled and must be validated before use; basic authentication must not be handled in PHP code. | [ServerVariablesSniff.php](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/WordPressVIPMinimum/Sniffs/Variables/ServerVariablesSniff.php) |
| VIP offers Basic Authentication as an environment setting in the VIP Dashboard; every request to such an environment bypasses the page cache. | [security-controls/basic-authentication](https://docs.wpvip.com/security-controls/basic-authentication/) |
| Changing PHP settings at runtime (`ini_set()`, `error_reporting()`) is strongly discouraged; error output in production can disclose full paths. | [php_codesniffer/errors](https://docs.wpvip.com/php_codesniffer/errors/) |
| Do not use `__FILE__` as a menu or page slug; it reveals system paths. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |

## JavaScript and templates

| Rule | Source |
| ---- | ------ |
| Do not insert HTML strings into the document (`.html()`, `.innerHTML`); build DOM nodes and add them with `.append()`, `.prepend()`, `.before()`, `.after()`, and set text with `.text()`. | [javascript-security-recommendations](https://docs.wpvip.com/security/javascript-security-recommendations/), [php_codesniffer/errors](https://docs.wpvip.com/php_codesniffer/errors/) |
| Stripping tags with `.html()` followed by `.text()` is still vulnerable, because setting the HTML runs attributes such as `onerror` first. | [javascript-security-recommendations](https://docs.wpvip.com/security/javascript-security-recommendations/) |
| Pass PHP values to JavaScript with `wp_json_encode()` (or `rawurlencode()` with `decodeURIComponent()`); `esc_js()` is for inline JavaScript in HTML attributes. | [javascript-security-recommendations](https://docs.wpvip.com/security/javascript-security-recommendations/) |
| VIPCS 3.1.0 deprecated its JavaScript sniffs and excludes them, so review JavaScript DOM insertion by hand. Template sniffs for Mustache, Handlebars, Underscore.js and Vue remain. | [VIPCS release 3.1.0](https://github.com/Automattic/VIP-Coding-Standards/releases/tag/3.1.0), [sniff-catalogue.md](sniff-catalogue.md) |
| SVG files are XML that can carry `<script>`, `<iframe>` and references to external files; the Bot flags tags and attributes outside its allowed list. Allowed upload types must not add insecure ones such as SVG or SWF. | [vip-code-analysis-bot/svg-analysis](https://docs.wpvip.com/vip-code-analysis-bot/svg-analysis/), [RestrictedHooksSniff.php](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/WordPressVIPMinimum/Sniffs/Hooks/RestrictedHooksSniff.php) |

## Risky PHP

| Rule | Source |
| ---- | ------ |
| `eval()` and `create_function()` run code built at runtime; use an anonymous function, and never pass user data into either. The VIP ruleset reports `eval()` as an error. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/), [WordPressVIPMinimum ruleset](https://github.com/Automattic/VIP-Coding-Standards/blob/3.1.0/WordPressVIPMinimum/ruleset.xml) |
| Never use `extract()`; it can bring unexpected variables into scope. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Serialize data as JSON; `unserialize()` has known object injection problems. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| A template, file name or path that is not static, or can be filtered, must be validated against directory traversal with `validate_file()` or by rejecting `..` before `locate_template()`, `get_template_part()`, `include` or `require`. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Use `===` rather than `==`; PHP's type juggling makes loose comparisons match unexpected values. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |
| Application code should contain no debug code or debug output (`debug_backtrace()`, `wp_debug_backtrace_summary()`) and no commented-out code. | [php_codesniffer/warnings](https://docs.wpvip.com/php_codesniffer/warnings/) |

Report rule for this skill: if the change contains what looks like a password, API key or token, report the file
and line and say it must be moved to configuration and rotated. Never copy the value into the report.
