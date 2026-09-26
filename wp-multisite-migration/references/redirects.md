# Redirects after the move

Old addresses have to keep working: posts, archives, feeds and media files. Checked on 2026-09-26 against the pages
linked below. Example values are synthetic.

## Rules that apply to every case

- Use server-side permanent redirects (301 or 308), redirect straight to the final URL instead of chaining, and keep
  the redirects for as long as possible, generally at least a year.
  Source: [Google Search Central, site moves with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)
- Search Console's Change of Address tool works only for properties at domain level (`example.com`,
  `m.example.com`), not for path-level properties such as `example.com/blog/`. A domain may move to a path inside
  another domain. So a subdirectory subsite that leaves a network cannot use the tool; a subdomain or mapped-domain
  site can.
  Source: [Change of Address tool](https://support.google.com/webmasters/answer/9370220?hl=en)
- The redirect has to run before WordPress. An archived site answers visitors with HTTP 410
  ([`ms_site_check()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-load.php#L122)),
  and `NOBLOGREDIRECT` acts only on sites that do not exist (subdomain networks) and on 404s of the main site, not on
  an archived site
  ([`ms-load.php`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-load.php#L420-L434),
  [`maybe_redirect_404()`](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-functions.php#L2207)).
  Put the rules in the server configuration, or in `.htaccess` above the `# BEGIN WordPress` block.
- Media rules go before the general rule: a subsite's media path changes (`uploads/sites/3/` to `uploads/`, or the
  reverse), so a general rule would send media requests to a path that does not exist.

Apache details used below: in `.htaccess` (per-directory context) the pattern is matched without the leading slash;
`[R=301]` sends a permanent redirect and belongs with `[L]`; the query string passes through unchanged by default;
a `RewriteCond` applies only to the one `RewriteRule` after it.
Sources: [RewriteRule, what is matched](https://httpd.apache.org/docs/2.4/mod/mod_rewrite.html#rewriterule),
[R flag](https://httpd.apache.org/docs/2.4/rewrite/flags.html#flag_r),
[RewriteCond](https://httpd.apache.org/docs/2.4/mod/mod_rewrite.html#rewritecond)

Nginx details used below: rewrite directives at server level run before a location is chosen; `permanent` returns
301; a replacement that starts with `https://` ends processing and redirects; the original query string is appended
unless the replacement ends with `?`; `return 301 <url>` can carry `$request_uri`; an exact `server_name` wins over
a wildcard such as `*.network.example`.
Sources: [ngx_http_rewrite_module](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html),
[server names](https://nginx.org/en/docs/http/server_names.html)

## A. Subsite moved out of the network

### Subdirectory site `network.example/blog-a/` to `blog-a.example.com`

On the network, Apache (above `# BEGIN WordPress Multisite` in the network's `.htaccess`):

```apache
RewriteEngine On
RewriteRule ^blog-a/wp-content/uploads/sites/3/(.*)$ https://blog-a.example.com/wp-content/uploads/$1 [R=301,L]
RewriteRule ^wp-content/uploads/sites/3/(.*)$ https://blog-a.example.com/wp-content/uploads/$1 [R=301,L]
RewriteRule ^blog-a(/.*)?$ https://blog-a.example.com$1 [R=301,L]
```

On the network, nginx (in the server block, before the WordPress rewrites and locations):

```nginx
rewrite ^/blog-a/wp-content/uploads/sites/3/(.*)$ https://blog-a.example.com/wp-content/uploads/$1 permanent;
rewrite ^/wp-content/uploads/sites/3/(.*)$ https://blog-a.example.com/wp-content/uploads/$1 permanent;
rewrite ^/blog-a(/.*)?$ https://blog-a.example.com$1 permanent;
```

`^blog-a(/.*)?$` matches `/blog-a`, `/blog-a/` and everything below it, but not `/blog-ab/`.

### Subdomain site `blog-a.network.example` to `blog-a.example.com`

Apache, on the network:

```apache
RewriteEngine On
RewriteCond %{HTTP_HOST} ^blog-a\.network\.example$ [NC]
RewriteRule ^wp-content/uploads/sites/3/(.*)$ https://blog-a.example.com/wp-content/uploads/$1 [R=301,L]
RewriteCond %{HTTP_HOST} ^blog-a\.network\.example$ [NC]
RewriteRule ^(.*)$ https://blog-a.example.com/$1 [R=301,L]
```

Nginx, a server block of its own (the exact name takes the host away from the network's `*.network.example` block):

```nginx
server {
    listen 443 ssl;
    server_name blog-a.network.example;
    # certificate lines as in the network's server block
    rewrite ^/wp-content/uploads/sites/3/(.*)$ https://blog-a.example.com/wp-content/uploads/$1 permanent;
    return 301 https://blog-a.example.com$request_uri;
}
```

### Mapped domain that stays

DNS moves the domain to the standalone server, so the network no longer receives its requests. On the standalone
server, catch the old media path:

```apache
RewriteRule ^wp-content/uploads/sites/3/(.*)$ /wp-content/uploads/$1 [R=301,L]
```

Legacy networks: also `RewriteRule ^files/(.*)$ /wp-content/uploads/$1 [R=301,L]` for the old `/files/` URLs.

## B. Standalone site moved into the network

### Same domain, now a mapped subsite

Pages keep their URLs. Media moved from `uploads/` to `uploads/sites/7/`; content was rewritten, but links from
elsewhere still use the old paths. On the network:

```apache
RewriteCond %{HTTP_HOST} ^shop\.example\.org$ [NC]
RewriteCond %{REQUEST_URI} !^/wp-content/uploads/sites/
RewriteRule ^wp-content/uploads/(.*)$ /wp-content/uploads/sites/7/$1 [R=301,L]
```

```nginx
if ($host = shop.example.org) {
    rewrite ^/wp-content/uploads/(?!sites/)(.*)$ /wp-content/uploads/sites/7/$1 permanent;
}
```

### New address inside the network

The old domain stays on the old server, or on a small redirect-only virtual host:

```apache
RewriteEngine On
RewriteRule ^wp-content/uploads/(.*)$ https://network.example/shop/wp-content/uploads/sites/7/$1 [R=301,L]
RewriteRule ^(.*)$ https://network.example/shop/$1 [R=301,L]
```

```nginx
server {
    listen 443 ssl;
    server_name shop.example.org;
    rewrite ^/wp-content/uploads/(.*)$ https://network.example/shop/wp-content/uploads/sites/7/$1 permanent;
    return 301 https://network.example/shop$request_uri;
}
```

Change of Address in Search Console is allowed here: a domain moving to a path inside another domain.

## Checking the redirects (read-only)

```bash
curl -sI https://network.example/blog-a/sample-post/ | grep -iE '^(HTTP|location)'
curl -sI https://network.example/blog-a/wp-content/uploads/sites/3/2024/05/photo.jpg | grep -iE '^(HTTP|location)'
curl -sIL https://network.example/blog-a/sample-post/ | grep -iE '^HTTP'      # one 301, then 200
```

Take the sample from the old sitemap or the server logs: posts, pages, categories, feeds, a few media files, and one
URL with a query string. Each should reach a 200 page with a single 301.
