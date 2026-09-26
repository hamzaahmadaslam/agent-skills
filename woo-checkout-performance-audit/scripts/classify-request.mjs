// Read-only helper module. Gives a request a short, fixed name from the checkout endpoints described in
// references/checkout-requests.md, for har-summary.mjs and access-log-timings.mjs. It reads no files, makes no network
// requests and keeps nothing: it only looks at the method and the URL it is given.
//
// Names never contain query strings, order keys or IDs: numbers and long keys in Store API routes become ":id".

const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";

const STATIC_EXTENSIONS = /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|json|txt|xml)$/i;

const CHECKOUT_AJAX = new Set(["update_order_review", "checkout", "apply_coupon", "remove_coupon"]);

/**
 * Normalise a Store API or REST route: keep the first segments, replace IDs and keys. WooCommerce registers every
 * route both with and without the version, so "/wc/store/v1/cart" and "/wc/store/cart" get the same name.
 * "/wc/store/v1/cart/items/9f86d081884c7d659a2feaa0c55ad015" -> "cart/items/:id"
 */
function storeRoute(route) {
  const parts = route
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .slice(2); // drop "wc", "store"
  if (/^v\d+$/.test(parts[0] || "")) parts.shift(); // and the version, when there is one
  const named = parts.map((p) => (/^\d+$/.test(p) || /^[a-f0-9]{16,}$/i.test(p) || p.length > 40 ? ":id" : p));
  return named.slice(0, 3).join("/") || "(root)";
}

function restNamespace(route) {
  const parts = route.replace(/^\/+/, "").split("/");
  return parts.slice(0, 2).join("/") || "(root)";
}

function startsWithPath(path, prefix) {
  if (!prefix) return false;
  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path === prefix || path === p.slice(0, -1) || path.startsWith(p);
}

/**
 * @param {string} method  HTTP method, for example "POST".
 * @param {string} target  A full URL or a request target such as "/?wc-ajax=checkout".
 * @param {object} [options]
 * @param {string} [options.checkoutPath="/checkout/"]  Path of the checkout page.
 * @param {string} [options.cartPath="/cart/"]          Path of the cart page.
 * @param {string} [options.accountPath="/my-account/"] Path of the account page.
 * @returns {{ name: string, group: string }} group is one of: checkout-ajax, cart-fragments, wc-ajax, store-api,
 *   rest, admin-ajax, gateway-callback, add-to-cart, page, cron, static, other.
 */
export function classifyRequest(method, target, options = {}) {
  const m = String(method || "GET").toUpperCase();
  let url;
  try {
    url = new URL(String(target || "/"), PLACEHOLDER_ORIGIN);
  } catch {
    return { name: "unparsable request", group: "other" };
  }
  const path = url.pathname;
  const q = url.searchParams;

  const wcAjax = q.get("wc-ajax");
  if (wcAjax) {
    const action = wcAjax.replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "(empty)";
    if (action === "get_refreshed_fragments") return { name: "wc-ajax get_refreshed_fragments", group: "cart-fragments" };
    return { name: `wc-ajax ${action}`, group: CHECKOUT_AJAX.has(action) ? "checkout-ajax" : "wc-ajax" };
  }

  const restRoute = q.get("rest_route") || (path.match(/\/wp-json(\/.*)$/) || [])[1];
  if (restRoute) {
    if (/^\/?wc\/store(?:\/|$)/.test(restRoute)) return { name: `store-api ${m} ${storeRoute(restRoute)}`, group: "store-api" };
    return { name: `rest ${restNamespace(restRoute)}`, group: "rest" };
  }

  if (path.endsWith("/admin-ajax.php")) {
    const action = (q.get("action") || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
    return { name: action ? `admin-ajax ${action}` : "admin-ajax (action in body)", group: "admin-ajax" };
  }
  if (path.endsWith("/wp-cron.php")) return { name: "wp-cron.php", group: "cron" };

  const wcApi = q.get("wc-api") || (path.match(/\/wc-api\/([^/]+)/) || [])[1];
  if (wcApi) return { name: `wc-api ${wcApi.replace(/[^a-z0-9_-]/gi, "").slice(0, 40)}`, group: "gateway-callback" };

  if (q.has("add-to-cart")) return { name: `add-to-cart ${m}`, group: "add-to-cart" };

  if (STATIC_EXTENSIONS.test(path) && !path.endsWith(".php")) return { name: "static file", group: "static" };

  // Plain permalinks put the endpoints in the query string.
  if (q.has("order-received")) return { name: `page order-received ${m}`, group: "page" };
  if (q.has("order-pay")) return { name: `page order-pay ${m}`, group: "page" };

  const checkoutPath = options.checkoutPath ?? "/checkout/";
  const cartPath = options.cartPath ?? "/cart/";
  const accountPath = options.accountPath ?? "/my-account/";
  if (startsWithPath(path, checkoutPath)) {
    if (path.includes("/order-received/")) return { name: `page order-received ${m}`, group: "page" };
    if (path.includes("/order-pay/")) return { name: `page order-pay ${m}`, group: "page" };
    return { name: `page checkout ${m}`, group: "page" };
  }
  if (startsWithPath(path, cartPath)) return { name: `page cart ${m}`, group: "page" };
  if (startsWithPath(path, accountPath)) return { name: `page my-account ${m}`, group: "page" };

  return { name: "other", group: "other" };
}

/** Nearest-rank percentile of a sorted numeric array (p between 0 and 100). */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}
