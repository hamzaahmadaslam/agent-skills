#!/usr/bin/env node
// Read-only helper. Reads a saved HTML page (as a logged-out visitor receives it) and lists what WordPress and its
// plugins put on the critical path: render-blocking stylesheets and scripts in <head> by owner, script loading
// strategies WordPress downgraded (data-wp-strategy without defer or async), the first images and their loading and
// fetchpriority attributes, preloads, speculation rules, iframes, and third-party hosts.
//
// It reads the file you name and prints a report. It writes no files and makes no network requests. It looks at the
// server HTML only: anything added later by JavaScript is not visible here. The HTML is tokenized without a full
// parser, so treat counts as close estimates. Node 20 or later, no dependencies.
//
// Save the page first, as a logged-out visitor (WordPress prints speculation rules only for logged-out visitors):
//   curl -sL -A "Mozilla/5.0" https://www.example.com/some-page/ -o page.html
//
// Usage:
//   node scripts/scan-html.mjs page.html
//   node scripts/scan-html.mjs page.html --site=https://www.example.com --lcp=hero-1200x630
//   node scripts/scan-html.mjs page.html --images=10 --json
//
// Options:
//   --site=<url>          The site's origin (default: taken from <link rel="canonical">).
//   --cdn=<host,host>     Hosts that serve the site's own files.
//   --content-dir=<name>  Content directory name if it is not wp-content.
//   --lcp=<text>          Part of the LCP image URL (from field attribution or PageSpeed Insights) to look up.
//   --images=<n>          How many images to list from the top of the document (default 6).
//   --json                Print JSON.
//
// Exit codes: 0 done, 1 bad arguments, 2 input not readable.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyUrl, cleanUrl } from "./wp-owner.mjs";

// WordPress's own size threshold for fetchpriority=high eligibility (wp_min_priority_img_pixels, default 50000).
const MIN_PRIORITY_PIXELS = 50000;
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "noscript", "template"]);

function decodeEntities(text) {
  return text
    .replace(/&#0*38;|&amp;/gi, "&")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;|&#0*34;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function parseAttributes(source) {
  const attrs = {};
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(source))) {
    const key = m[1].toLowerCase();
    if (!(key in attrs)) attrs[key] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

// Yields start and end tags in document order. Raw-text elements (script, style, noscript and others) return their
// text with the start tag and are not tokenized inside, which matches a browser with scripting enabled.
function* tokenize(html) {
  const lower = html.toLowerCase();
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) return;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const head = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 80));
    if (!head) {
      i = lt + 1;
      continue;
    }
    let j = lt + head[0].length;
    let quote = null;
    while (j < n) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j++;
    }
    const name = head[2].toLowerCase();
    if (head[1] === "/") {
      yield { type: "end", name };
      i = j + 1;
      continue;
    }
    const attrs = parseAttributes(html.slice(lt + head[0].length, j));
    i = j + 1;
    let text = "";
    if (RAW_TEXT.has(name)) {
      const close = lower.indexOf(`</${name}`, i);
      const stop = close === -1 ? n : close;
      text = html.slice(i, stop);
      i = stop;
    }
    yield { type: "start", name, attrs, text };
  }
}

function isJavaScript(type) {
  const t = (type || "").trim().toLowerCase();
  return t === "" || t === "text/javascript" || t === "application/javascript" || t === "module";
}

function stylesheetBlocking(attrs) {
  if ("disabled" in attrs) return "no (disabled)";
  const media = (attrs.media || "").trim().toLowerCase();
  if (media === "" || media === "all" || media === "screen") return "yes";
  if (media === "print") return "no (media=print)";
  return `when "${attrs.media}" matches`;
}

function handleFromId(id, suffix) {
  if (!id || !id.endsWith(suffix)) return "";
  return id.slice(0, -suffix.length);
}

function imageSource(attrs) {
  const src = attrs.src || "";
  const lazySrc = attrs["data-src"] || attrs["data-lazy-src"] || attrs["data-original"] || "";
  const placeholder = src === "" || src.startsWith("data:");
  return { src, lazySrc, placeholder, shown: placeholder && lazySrc ? lazySrc : src };
}

export function scanHtml(html, options = {}) {
  const report = {
    site: options.site || "",
    generator: [],
    bodyClass: "",
    elementCount: 0,
    head: { stylesheets: [], scripts: [], inlineScripts: [], inlineStyles: 0, inlineStyleBytes: 0 },
    scripts: [],
    downgraded: [],
    images: [],
    noscriptImages: 0,
    preloads: [],
    speculationRules: [],
    iframes: [],
    videos: [],
    hosts: new Map(),
  };
  let inHead = true;
  let canonical = "";
  let imageIndex = 0;

  const noteHost = (url, what) => {
    if (!url || url.startsWith("data:")) return;
    try {
      const host = new URL(url, report.site || "https://site.invalid").host.toLowerCase();
      if (host === "site.invalid") return;
      if (!report.hosts.has(host)) report.hosts.set(host, {});
      const entry = report.hosts.get(host);
      entry[what] = (entry[what] || 0) + 1;
    } catch {
      /* not a URL */
    }
  };

  const tokens = [...tokenize(html)];
  // Take the site origin from the canonical link when --site is not given.
  if (!report.site) {
    for (const t of tokens) {
      if (t.type === "start" && t.name === "link" && /(^|\s)canonical(\s|$)/i.test(t.attrs.rel || "") && t.attrs.href) {
        try {
          canonical = new URL(t.attrs.href).origin;
        } catch {
          canonical = "";
        }
        break;
      }
    }
    report.site = canonical;
  }
  const owner = (url) => classifyUrl(url, { site: report.site, cdn: options.cdn, contentDir: options.contentDir });

  for (const t of tokens) {
    if (t.type === "end") {
      if (t.name === "head") inHead = false;
      continue;
    }
    report.elementCount += 1;
    const a = t.attrs;
    switch (t.name) {
      case "body":
        inHead = false;
        report.bodyClass = a.class || "";
        break;
      case "meta":
        if ((a.name || "").toLowerCase() === "generator" && a.content) report.generator.push(a.content);
        break;
      case "link": {
        const rel = (a.rel || "").toLowerCase().split(/\s+/);
        if (rel.includes("stylesheet") && a.href) {
          noteHost(a.href, "stylesheet");
          if (inHead) {
            report.head.stylesheets.push({
              href: cleanUrl(a.href),
              id: a.id || "",
              handle: handleFromId(a.id, "-css"),
              blocking: stylesheetBlocking(a),
              owner: owner(a.href).owner,
            });
          }
        }
        if ((rel.includes("preload") || rel.includes("modulepreload")) && a.href) {
          report.preloads.push({ rel: rel.join(" "), as: a.as || "", href: cleanUrl(a.href), fetchpriority: a.fetchpriority || "", inHead });
          noteHost(a.href, "preload");
        }
        if ((rel.includes("preconnect") || rel.includes("dns-prefetch")) && a.href) noteHost(a.href, rel.includes("preconnect") ? "preconnect" : "dns-prefetch");
        break;
      }
      case "style":
        if (inHead) {
          report.head.inlineStyles += 1;
          report.head.inlineStyleBytes += Buffer.byteLength(t.text);
        }
        break;
      case "script": {
        const type = (a.type || "").trim().toLowerCase();
        if (type === "speculationrules") {
          try {
            report.speculationRules.push(JSON.parse(t.text));
          } catch {
            report.speculationRules.push({ unreadable: true });
          }
          break;
        }
        if (!isJavaScript(type)) break;
        const isModule = type === "module";
        if (a.src) {
          noteHost(a.src, "script");
          const handle = handleFromId(a.id, "-js-module") || handleFromId(a.id, "-js");
          const strategy = "async" in a ? "async" : "defer" in a ? "defer" : isModule ? "module (deferred)" : "blocking";
          const entry = {
            src: cleanUrl(a.src),
            id: a.id || "",
            handle,
            inHead,
            strategy,
            intended: a["data-wp-strategy"] || "",
            fetchpriority: a.fetchpriority || "",
            owner: owner(a.src).owner,
          };
          report.scripts.push(entry);
          if (inHead) report.head.scripts.push(entry);
          if (entry.intended && entry.strategy === "blocking") report.downgraded.push(entry);
        } else if (inHead && !isModule) {
          report.head.inlineScripts.push({ id: a.id || "", bytes: Buffer.byteLength(t.text) });
        }
        break;
      }
      case "noscript":
        report.noscriptImages += (t.text.match(/<img\b/gi) || []).length;
        break;
      case "img": {
        imageIndex += 1;
        const source = imageSource(a);
        const width = Number.parseInt(a.width, 10);
        const height = Number.parseInt(a.height, 10);
        report.images.push({
          index: imageIndex,
          src: cleanUrl(source.shown),
          srcset: a.srcset || a["data-srcset"] || "",
          jsLazy: source.placeholder && Boolean(source.lazySrc),
          loading: a.loading || "",
          fetchpriority: a.fetchpriority || "",
          decoding: a.decoding || "",
          width: Number.isFinite(width) ? width : null,
          height: Number.isFinite(height) ? height : null,
          className: a.class || "",
          owner: source.shown ? owner(source.shown).owner : "",
        });
        noteHost(source.shown, "image");
        break;
      }
      case "iframe":
        report.iframes.push({ src: cleanUrl(a.src || a["data-src"] || ""), loading: a.loading || "", width: a.width || "", height: a.height || "" });
        noteHost(a.src || a["data-src"] || "", "iframe");
        break;
      case "video":
        report.videos.push({ poster: cleanUrl(a.poster || ""), width: a.width || "", height: a.height || "", preload: a.preload || "" });
        break;
      default:
        break;
    }
  }

  // LCP lookup: where does the given URL fragment appear?
  if (options.lcp) {
    const needle = options.lcp;
    const inImages = report.images.filter((img) => img.src.includes(needle) || img.srcset.includes(needle));
    const inPreloads = report.preloads.filter((p) => p.href.includes(needle));
    const whereElse = [];
    if (!inImages.length) {
      if (new RegExp(`url\\(\\s*['"]?[^)]*${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(html)) whereElse.push("CSS url() in the HTML (background image)");
      else if (html.includes(needle)) whereElse.push("present in the HTML but not in an <img> (script, JSON or attribute)");
      else whereElse.push("not in the server HTML (added by JavaScript or by an external stylesheet)");
    }
    report.lcp = { needle, images: inImages, preloads: inPreloads, whereElse };
  }

  report.hosts = Object.fromEntries(
    [...report.hosts.entries()].filter(([host]) => {
      if (!report.site) return true;
      try {
        return host !== new URL(report.site).host.toLowerCase() && !(options.cdn || []).includes(host);
      } catch {
        return true;
      }
    }),
  );
  return report;
}

function flags(report, imagesToShow) {
  const out = [];
  const top = report.images.slice(0, imagesToShow);
  const firstLarge = report.images.find((img) => img.width && img.height && img.width * img.height >= MIN_PRIORITY_PIXELS);
  if (firstLarge && firstLarge.loading === "lazy") {
    out.push(`first large image (#${firstLarge.index}, ${firstLarge.width}x${firstLarge.height}) has loading="lazy"; if it is the LCP image this delays LCP`);
  }
  const earlyLazy = top.filter((img) => img.loading === "lazy" && img.index <= 3 && img !== firstLarge).map((img) => `#${img.index}`);
  if (earlyLazy.length) {
    out.push(`image(s) ${earlyLazy.join(", ")} among the first three have loading="lazy"; this matters only if one is the LCP image (check with --lcp)`);
  }
  for (const img of top) {
    if (img.jsLazy) out.push(`image #${img.index} has only a data-src (JavaScript lazy loading): the preload scanner cannot find it`);
  }
  if (firstLarge && !firstLarge.fetchpriority) {
    out.push(`first large image (#${firstLarge.index}, ${firstLarge.width}x${firstLarge.height}) has no fetchpriority; check whether it is the LCP image`);
  }
  const high = report.images.filter((img) => img.fetchpriority === "high").length + report.preloads.filter((p) => p.fetchpriority === "high").length;
  if (high > 2) out.push(`${high} elements have fetchpriority="high"; more than one or two makes the hint unhelpful`);
  const both = report.images.filter((img) => img.fetchpriority === "high" && img.loading === "lazy");
  for (const img of both) out.push(`image #${img.index} has both fetchpriority="high" and loading="lazy"`);
  const noSize = report.images.filter((img) => !img.jsLazy && (img.width === null || img.height === null)).length;
  if (noSize) out.push(`${noSize} image(s) without width and height attributes (layout shift risk unless CSS reserves the space)`);
  const iframesNoSize = report.iframes.filter((f) => !f.width || !f.height).length;
  if (iframesNoSize) out.push(`${iframesNoSize} iframe(s) without width and height attributes`);
  if (report.noscriptImages) out.push(`${report.noscriptImages} image(s) inside <noscript>: a sign that images are loaded by JavaScript; find the plugin that prints them`);
  if (report.downgraded.length) out.push(`${report.downgraded.length} script(s) asked for defer or async but WordPress printed them blocking (listed above)`);
  return out;
}

function printText(report, options) {
  const imagesToShow = options.images;
  const line = (text = "") => console.log(text);
  line(`Site: ${report.site || "(unknown: pass --site)"}`);
  if (report.generator.length) line(`Generator: ${report.generator.join("; ")}`);
  if (report.bodyClass) line(`Body classes: ${report.bodyClass.split(/\s+/).slice(0, 12).join(" ")}${report.bodyClass.split(/\s+/).length > 12 ? " ..." : ""}`);
  line(`Elements in the server HTML (approximate): ${report.elementCount}`);
  line();

  const blockingCss = report.head.stylesheets.filter((s) => s.blocking !== "yes" ? !s.blocking.startsWith("no") : true);
  const blockingJs = report.head.scripts.filter((s) => s.strategy === "blocking");
  line(`Render-blocking in <head>: ${blockingCss.length} stylesheet(s), ${blockingJs.length} script(s)`);
  for (const s of blockingCss) line(`  css  ${s.owner.padEnd(34)} ${(s.handle || s.id || "-").padEnd(28)} ${s.blocking === "yes" ? "" : `[${s.blocking}] `}${s.href}`);
  for (const s of blockingJs) line(`  js   ${s.owner.padEnd(34)} ${(s.handle || s.id || "-").padEnd(28)} ${s.src}`);
  const inlineBytes = report.head.inlineScripts.reduce((sum, s) => sum + s.bytes, 0);
  line(`Inline classic scripts in <head> (they block the parser while they run): ${report.head.inlineScripts.length}, ${(inlineBytes / 1024).toFixed(1)} KB`);
  const namedInline = report.head.inlineScripts.filter((s) => s.id).map((s) => s.id);
  if (namedInline.length) line(`  ids: ${namedInline.slice(0, 15).join(", ")}${namedInline.length > 15 ? " ..." : ""}`);
  line(`Inline <style> blocks in <head>: ${report.head.inlineStyles}, ${(report.head.inlineStyleBytes / 1024).toFixed(1)} KB`);
  line();

  if (report.downgraded.length) {
    line("Scripts whose requested strategy WordPress did not apply (data-wp-strategy set, printed blocking):");
    line("  (an inline 'after' script or a blocking dependent keeps a script blocking)");
    for (const s of report.downgraded) line(`  ${s.owner.padEnd(34)} ${(s.handle || "-").padEnd(28)} wanted ${s.intended}  ${s.inHead ? "head" : "footer"}`);
    line();
  }

  const byOwner = new Map();
  for (const s of report.scripts) {
    const key = s.owner;
    if (!byOwner.has(key)) byOwner.set(key, { total: 0, blocking: 0 });
    const g = byOwner.get(key);
    g.total += 1;
    if (s.strategy === "blocking") g.blocking += 1;
  }
  line("External scripts by owner (whole page):");
  for (const [key, g] of [...byOwner.entries()].sort((x, y) => y[1].total - x[1].total)) line(`  ${key.padEnd(40)} ${g.total} script(s), ${g.blocking} blocking`);
  line();

  line(`First ${Math.min(imagesToShow, report.images.length)} of ${report.images.length} image(s) in document order:`);
  line("  #   loading  fetchprio  size         owner                              src");
  for (const img of report.images.slice(0, imagesToShow)) {
    const size = img.width && img.height ? `${img.width}x${img.height}` : "no size";
    line(`  ${String(img.index).padEnd(3)} ${(img.loading || "-").padEnd(8)} ${(img.fetchpriority || "-").padEnd(10)} ${size.padEnd(12)} ${(img.owner || "-").padEnd(34)} ${img.jsLazy ? "[data-src] " : ""}${img.src}`);
  }
  line();

  if (report.lcp) {
    line(`LCP lookup for "${report.lcp.needle}":`);
    for (const img of report.lcp.images) line(`  <img> #${img.index}: loading=${img.loading || "(none)"} fetchpriority=${img.fetchpriority || "(none)"} ${img.jsLazy ? "data-src only" : ""}`);
    for (const p of report.lcp.preloads) line(`  preloaded: rel=${p.rel} as=${p.as} fetchpriority=${p.fetchpriority || "(none)"}`);
    for (const w of report.lcp.whereElse) line(`  ${w}`);
    line();
  }

  if (report.preloads.length) {
    line("Preloads:");
    for (const p of report.preloads) line(`  ${p.rel.padEnd(14)} as=${(p.as || "-").padEnd(7)} fetchpriority=${(p.fetchpriority || "-").padEnd(5)} ${p.href}`);
    line();
  }

  if (report.speculationRules.length) {
    line("Speculation rules:");
    for (const set of report.speculationRules) {
      if (set.unreadable) {
        line("  (a speculationrules script that is not valid JSON)");
        continue;
      }
      for (const mode of ["prefetch", "prerender"]) {
        for (const rule of set[mode] || []) {
          const source = rule.source || (rule.urls ? "list" : rule.where ? "document" : "?");
          const eagerness = rule.eagerness || `(default for ${source} rules)`;
          line(`  ${mode.padEnd(9)} source=${source.padEnd(8)} eagerness=${eagerness}`);
        }
      }
    }
  } else {
    line("Speculation rules: none in this HTML (WordPress 6.8+ prints them only for logged-out visitors on sites with pretty permalinks, unless a filter turns them off)");
  }
  line();

  const hosts = Object.entries(report.hosts);
  if (hosts.length) {
    line("Other hosts referenced by the page:");
    for (const [host, kinds] of hosts) line(`  ${host.padEnd(36)} ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    line();
  }
  if (report.iframes.length) {
    line(`Iframes: ${report.iframes.length}`);
    for (const f of report.iframes.slice(0, 10)) line(`  loading=${f.loading || "-"} size=${f.width && f.height ? `${f.width}x${f.height}` : "none"} ${f.src}`);
    line();
  }

  const found = flags(report, imagesToShow);
  line(found.length ? "Flags (code evidence only; confirm with field attribution or a lab trace):" : "Flags: none");
  for (const f of found) line(`  - ${f}`);
}

function parseArgs(argv) {
  const opts = { images: 6, cdn: [], json: false, files: [] };
  for (const arg of argv) {
    if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("--site=")) opts.site = arg.slice(7);
    else if (arg.startsWith("--cdn=")) opts.cdn = arg.slice(6).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (arg.startsWith("--content-dir=")) opts.contentDir = arg.slice(14).replace(/^\/+|\/+$/g, "");
    else if (arg.startsWith("--lcp=")) opts.lcp = arg.slice(6);
    else if (arg.startsWith("--images=")) {
      opts.images = Number.parseInt(arg.slice(9), 10);
      if (!Number.isFinite(opts.images) || opts.images < 1) throw new Error("--images needs a positive number");
    } else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else opts.files.push(arg);
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`scan-html: ${error.message}`);
    process.exit(1);
  }
  if (opts.help || opts.files.length !== 1) {
    console.log("Usage: node scripts/scan-html.mjs <page.html> [--site=<url>] [--cdn=<hosts>] [--lcp=<text>] [--images=<n>] [--json]");
    process.exit(opts.help ? 0 : 1);
  }
  let html;
  try {
    html = readFileSync(opts.files[0], "utf8");
  } catch (error) {
    console.error(`scan-html: ${error.message}`);
    process.exit(2);
  }
  const report = scanHtml(html, opts);
  if (opts.json) {
    console.log(JSON.stringify({ ...report, flags: flags(report, opts.images) }, null, 2));
  } else {
    printText(report, opts);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
