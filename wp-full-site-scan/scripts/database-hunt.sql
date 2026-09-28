-- Read-only: every statement below is a SELECT. Nothing here changes data, settings or tables.
--
-- The database hunt for the wp-full-site-scan skill: the site address, administrators and their capabilities, option
-- rows that hold payloads (random hex names, one known prefixed family, large values, script and redirect code),
-- widgets, snippet plugins, posts and postmeta, external script hosts, redirect rules, registration settings,
-- application passwords, autoloaded options by size, and the size of the cron option.
--
-- Run it against the throwaway copy of the database, never against the live server.
--
-- Placeholder: replace {prefix} with the table prefix from wp-config.php ($table_prefix), for example
--   sed 's/{prefix}/wp_/g' database-hunt.sql > hunt.sql
--   mysql -h127.0.0.1 -P3307 -uroot --force scan < hunt.sql > evidence/db-hunt.txt 2>&1
-- --force keeps going when a statement fails, for example when a plugin's table (redirection_items) does not exist.
--
-- MySQL 8 can stop long regular expression matches with "Timeout exceeded in regular expression match". On the
-- throwaway server only (these change server settings, so they are not run from this file), raise the limits once:
--   SET GLOBAL regexp_time_limit=2000000000;
--   SET GLOBAL regexp_stack_limit=64000000;
-- REGEXP_SUBSTR (query 11) needs MySQL 8 or MariaDB 10.0.5 or later.
-- The patterns avoid backslashes on purpose: [.] is a literal dot and [(] a literal bracket.

-- 1. Core settings. siteurl or home pointing anywhere but the real domain redirects every visitor.
--    users_can_register = 1 with default_role = administrator is a standing backdoor.
SELECT option_name, option_value FROM {prefix}options
WHERE option_name IN ('siteurl', 'home', 'users_can_register', 'default_role', 'admin_email', 'template', 'stylesheet', 'blog_public');

-- 2. Administrators, newest first. Ask the owner about every account.
SELECT u.ID, u.user_login, u.user_email, u.user_registered, u.display_name
FROM {prefix}users u
JOIN {prefix}usermeta m ON m.user_id = u.ID AND m.meta_key = '{prefix}capabilities'
WHERE m.meta_value LIKE '%administrator%'
ORDER BY u.user_registered DESC;

-- 3. Every capabilities row that grants administrator, whatever its meta_key. A key written with a different prefix
--    or letter case (for example after a lowercased restore) shows up here and not in query 2.
SELECT m.user_id, u.user_login, m.meta_key, LEFT(m.meta_value, 200) AS capabilities
FROM {prefix}usermeta m
LEFT JOIN {prefix}users u ON u.ID = m.user_id
WHERE m.meta_key LIKE '%capabilities' AND m.meta_value LIKE '%administrator%'
ORDER BY m.user_id DESC;

-- 4. Capability rows for users that no longer exist, and users with no capabilities row at all.
SELECT m.user_id, m.meta_key, LEFT(m.meta_value, 200) AS capabilities
FROM {prefix}usermeta m
LEFT JOIN {prefix}users u ON u.ID = m.user_id
WHERE m.meta_key LIKE '%capabilities' AND u.ID IS NULL;
SELECT u.ID, u.user_login, u.user_registered
FROM {prefix}users u
LEFT JOIN {prefix}usermeta m ON m.user_id = u.ID AND m.meta_key = '{prefix}capabilities'
WHERE m.umeta_id IS NULL;

-- 5. Role definitions. Confirm subscriber still has only read, and that no extra role grants admin capabilities.
--    database-deep-checks.php prints this decoded.
SELECT option_name, LENGTH(option_value) AS bytes, LEFT(option_value, 400) AS preview
FROM {prefix}options WHERE option_name = '{prefix}user_roles';

-- 6. Options named as bare hex strings. No legitimate option is named like this; in real cases these held the
--    encoded payload that rebuilds everything else.
SELECT option_name, autoload, LENGTH(option_value) AS bytes
FROM {prefix}options
WHERE option_name REGEXP '^[0-9a-fA-F]{6,32}$'
ORDER BY bytes DESC;

-- 7. One known malware family that stores its data under the sc_ prefix. Look for other shared prefixes you do not
--    recognize in query 8 and in the full option list.
SELECT option_name, autoload, LENGTH(option_value) AS bytes
FROM {prefix}options
WHERE LEFT(option_name, 3) = 'sc_'
ORDER BY bytes DESC;

-- 8. The largest options overall. Read anything unexplained; base64-decode the big ones and check for gzip data or
--    a PHP open tag.
SELECT option_name, autoload, LENGTH(option_value) AS bytes
FROM {prefix}options
ORDER BY LENGTH(option_value) DESC
LIMIT 30;

-- 9. Autoloaded options by size (loaded on every request). WordPress 6.6 and later also use on, auto-on and auto.
SELECT option_name, autoload, LENGTH(option_value) AS bytes
FROM {prefix}options
WHERE autoload IN ('yes', 'on', 'auto-on', 'auto')
ORDER BY LENGTH(option_value) DESC
LIMIT 30;
SELECT autoload, COUNT(*) AS options, SUM(LENGTH(option_value)) AS bytes
FROM {prefix}options GROUP BY autoload ORDER BY bytes DESC;

-- 10. Size of the cron option. A cron option far larger than usual (tens of kilobytes on most sites) is worth
--     decoding; database-deep-checks.php lists every hook in it.
SELECT option_name, autoload, LENGTH(option_value) AS bytes
FROM {prefix}options WHERE option_name = 'cron';

-- 11. Any setting that carries script or redirect code. Expect analytics, chat widgets and theme options; name the
--     plugin each one belongs to.
SELECT option_name, autoload, LENGTH(option_value) AS bytes, LEFT(option_value, 300) AS preview
FROM {prefix}options
WHERE option_value REGEXP '<script|location[.](href|replace|assign)|window[.]location|atob[(]|fromCharCode|eval[(]|document[.]write|_0x[0-9a-f]{4}'
  AND option_name NOT LIKE '%transient%'
ORDER BY bytes DESC
LIMIT 100;

-- 12. Widgets with script or redirect code.
SELECT option_name, LENGTH(option_value) AS bytes, LEFT(option_value, 300) AS preview
FROM {prefix}options
WHERE option_name LIKE 'widget%'
  AND option_value REGEXP '<script|location[.]|atob[(]|eval[(]';

-- 13. Snippet plugins: the visible snippets, and the cached copy that is what executes. Compare the two.
SELECT ID, post_type, post_title, post_status, post_modified, LENGTH(post_content) AS bytes, LEFT(post_content, 400) AS preview
FROM {prefix}posts
WHERE post_type IN ('wpcode', 'elementor_snippet')
ORDER BY post_modified DESC;
SELECT option_name, LENGTH(option_value) AS bytes, LEFT(option_value, 400) AS preview
FROM {prefix}options
WHERE option_name IN ('wpcode_snippets', 'ihaf_insert_header', 'ihaf_insert_body', 'ihaf_insert_footer', 'hefo')
   OR option_name LIKE '%header_footer%'
   OR option_name LIKE '%tag_manager%';

-- 14. Content and page-builder data with script or decoder code. Page builders store HTML JSON-escaped, so these
--     patterns avoid depending on quote characters.
SELECT ID, post_type, post_status, post_modified, post_title
FROM {prefix}posts
WHERE post_content REGEXP '<script[^>]*src=|atob[(]|fromCharCode|eval[(]|document[.]write|window[.]location|_0x[0-9a-f]{4}'
ORDER BY post_modified DESC
LIMIT 100;
SELECT post_id, meta_key, LENGTH(meta_value) AS bytes
FROM {prefix}postmeta
WHERE meta_value REGEXP '<script[^>]*src=|atob[(]|fromCharCode|eval[(]|document[.]write|_0x[0-9a-f]{4}'
ORDER BY post_id DESC
LIMIT 100;

-- 15. Comments with script code or links hidden from view.
SELECT comment_ID, comment_post_ID, comment_approved, comment_date, LEFT(comment_content, 200) AS preview
FROM {prefix}comments
WHERE comment_content REGEXP '<script|<iframe|display[ ]*:[ ]*none|atob[(]|eval[(]'
ORDER BY comment_date DESC
LIMIT 50;

-- 16. Every external script host stored in the database, with counts. Classify each: the site's own domain, a known
--     vendor, or unexplained. An embed whose domain expired and was re-registered is a classic cause of ad redirects.
SELECT host, COUNT(*) AS n FROM (
  SELECT REGEXP_SUBSTR(post_content, '<script[^>]+src=.{0,3}https?:.{0,4}[a-z0-9.-]+[.][a-z]{2,}') AS host
    FROM {prefix}posts WHERE post_content LIKE '%<script%src%'
  UNION ALL
  SELECT REGEXP_SUBSTR(meta_value, '<script[^>]+src=.{0,3}https?:.{0,4}[a-z0-9.-]+[.][a-z]{2,}')
    FROM {prefix}postmeta WHERE meta_value LIKE '%<script%src%'
  UNION ALL
  SELECT REGEXP_SUBSTR(option_value, '<script[^>]+src=.{0,3}https?:.{0,4}[a-z0-9.-]+[.][a-z]{2,}')
    FROM {prefix}options WHERE option_value LIKE '%<script%src%' AND option_name NOT LIKE '%transient%'
) t
WHERE host IS NOT NULL
GROUP BY host
ORDER BY n DESC;

-- 17. Redirection plugin rules that point off-site, and rules that match on something other than the URL (referrer,
--     user agent, cookie, login state): conditional rules are how a redirect hides from the owner.
--     Fails harmlessly when the plugin is not installed.
SELECT id, url, match_type, action_type, action_code, action_data, status, last_count
FROM {prefix}redirection_items
WHERE action_data LIKE 'http%' OR match_type <> 'url'
ORDER BY id DESC;

-- 18. Application passwords: API logins that survive a password change.
SELECT u.ID, u.user_login, u.user_email, LENGTH(m.meta_value) AS bytes
FROM {prefix}usermeta m
JOIN {prefix}users u ON u.ID = m.user_id
WHERE m.meta_key = '_application_passwords';

-- 19. Users with stored sessions, and how many bytes of session data each has. database-deep-checks.php decodes them
--     and flags sessions with no user agent or a bot user agent.
SELECT u.ID, u.user_login, LENGTH(m.meta_value) AS bytes
FROM {prefix}usermeta m
JOIN {prefix}users u ON u.ID = m.user_id
WHERE m.meta_key = 'session_tokens'
ORDER BY bytes DESC;

-- 20. Registrations per month, newest first. A sudden spike is usually bot sign-ups.
SELECT DATE_FORMAT(user_registered, '%Y-%m') AS month, COUNT(*) AS registrations
FROM {prefix}users
GROUP BY month
ORDER BY month DESC
LIMIT 24;
