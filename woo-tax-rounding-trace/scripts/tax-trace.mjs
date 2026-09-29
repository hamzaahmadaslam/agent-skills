#!/usr/bin/env node
// Read-only helper. Rebuilds the tax of one WooCommerce order step by step, the way WooCommerce 11.1.2 computes it,
// and prints where the numbers part ways: the cart replay (WC_Cart_Totals), what checkout stores, a recalculation
// (WC_Abstract_Order::calculate_totals), and what the REST API, the order emails, the admin refund form and a payment
// gateway show. It runs both rounding settings (per line and at subtotal) and compares the store's own setting with the
// stored figures.
//
// It reads one local JSON file (see references/helper-script.md for the format; scripts/export-order.sh or the REST
// and WP-CLI steps in SKILL.md produce the values). It writes nothing and makes no network requests.
//
// Arithmetic: exact rational numbers on BigInt (no floating point). Every rounding step applies the PHP rounding mode
// WooCommerce passes at that step. PHP itself works in floating point, so on an exact half-way value PHP can land on
// either side; the helper lists every half-way value it met under "Half-way values" so you can check those by hand.
//
// Usage:
//   node tax-trace.mjs order.json
//   node tax-trace.mjs order.json --json        # machine-readable output
//
// Needs Node.js 20 or later. No dependencies.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------------------------------------------
// Exact rationals.

const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

class Q {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error("division by zero");
    if (d < 0n) [n, d] = [-n, -d];
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  static of(v) {
    if (v instanceof Q) return v;
    if (typeof v === "bigint") return new Q(v);
    if (v === null || v === undefined || v === "") return new Q(0n);
    const s = String(v).trim();
    const m = s.match(/^([+-])?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
    if (!m || (m[2] === "" && (m[3] === undefined || m[3] === ""))) throw new Error(`not a number: "${s}"`);
    const frac = m[3] || "";
    let n = BigInt((m[2] || "0") + frac);
    let d = 10n ** BigInt(frac.length);
    const e = Number(m[4] || 0);
    if (e > 0) n *= 10n ** BigInt(e);
    if (e < 0) d *= 10n ** BigInt(-e);
    return new Q(m[1] === "-" ? -n : n, d);
  }
  add(o) { o = Q.of(o); return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Q.of(o); return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Q.of(o); return new Q(this.n * o.n, this.d * o.d); }
  div(o) { o = Q.of(o); return new Q(this.n * o.d, this.d * o.n); }
  neg() { return new Q(-this.n, this.d); }
  cmp(o) { o = Q.of(o); const l = this.n * o.d, r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
  eq(o) { return this.cmp(o) === 0; }
  isZero() { return this.n === 0n; }
  // Decimal string: exact when the value terminates within `max` places, else `max` places followed by "...".
  toString(max = 10) {
    const neg = this.n < 0n;
    let n = neg ? -this.n : this.n;
    const int = n / this.d;
    let rem = n % this.d;
    let digits = "";
    for (let i = 0; i < max && rem; i++) {
      rem *= 10n;
      digits += String(rem / this.d);
      rem %= this.d;
    }
    return `${neg ? "-" : ""}${int}${digits ? "." + digits : ""}${rem ? "..." : ""}`;
  }
  fixed(p) {
    const r = roundQ(this, p, "HALF_UP", null);
    const s = 10n ** BigInt(p);
    const neg = r.n < 0n;
    const scaled = (neg ? -r.n : r.n) * s / r.d;
    const str = scaled.toString().padStart(p + 1, "0");
    return `${neg && scaled ? "-" : ""}${p ? str.slice(0, -p) + "." + str.slice(-p) : str}`;
  }
}

const sum = (list) => list.reduce((a, b) => a.add(b), new Q(0n));

// ---------------------------------------------------------------------------------------------------------------
// Rounding, as PHP round() with its modes (PHP_ROUND_HALF_UP = 1, HALF_DOWN = 2, HALF_EVEN = 3, HALF_ODD = 4), plus
// "JS" for Math.round (half-way values go towards +infinity), used by the admin refund form.

const MODE_NAMES = { 1: "HALF_UP", 2: "HALF_DOWN", 3: "HALF_EVEN", 4: "HALF_ODD" };
let TIES = [];

function roundQ(q, p, mode, label) {
  q = Q.of(q);
  const s = 10n ** BigInt(p);
  const x = q.mul(s);
  const fl = x.n >= 0n ? x.n / x.d : -((-x.n + x.d - 1n) / x.d); // floor
  const rem = x.sub(new Q(fl)); // 0 <= rem < 1
  const c = rem.cmp(new Q(1n, 2n));
  let r;
  if (c < 0) r = fl;
  else if (c > 0) r = fl + 1n;
  else {
    const pos = x.cmp(0) > 0;
    if (mode === "HALF_UP") r = pos ? fl + 1n : fl;
    else if (mode === "HALF_DOWN") r = pos ? fl : fl + 1n;
    else if (mode === "HALF_EVEN") r = fl % 2n === 0n ? fl : fl + 1n;
    else if (mode === "HALF_ODD") r = fl % 2n !== 0n ? fl : fl + 1n;
    else if (mode === "JS") r = fl + 1n;
    else throw new Error(`unknown rounding mode ${mode}`);
    if (label) TIES.push(`${label}: ${q.toString()} rounded to ${p} place(s) ${mode} -> ${new Q(r, s).toString()}`);
  }
  return new Q(r, s);
}

// ---------------------------------------------------------------------------------------------------------------
// WooCommerce 11.1.2 functions, each named after the PHP it models (references/rounding-functions.md has the sources).

function makeWoo(cfg) {
  const { dp, P, C6, taxMode, subtotalRounding, tag } = cfg;
  const pow = new Q(10n ** BigInt(dp));
  const ctx = { label: "" };
  const L = (what) => `[${tag}] ${ctx.label ? `${ctx.label} ` : ""}${what}`;

  // NumberUtil::round(): normalize() first rounds a float to WC_ROUNDING_PRECISION places (half up), then round().
  const NR = (x, p, mode = "HALF_UP", what = "") => roundQ(roundQ(x, C6, "HALF_UP", L(`${what} (normalize)`)), p, mode, L(what));
  const wcRoundTaxTotal = (x, p = dp, what = "wc_round_tax_total") => NR(x, p, taxMode, what);
  const roundLineTax = (x, inCents = true) => (subtotalRounding ? Q.of(x) : wcRoundTaxTotal(x, inCents ? 0 : dp, "round_line_tax"));
  const roundItemSubtotal = (x) => (subtotalRounding ? Q.of(x) : NR(x, 0, "HALF_UP", "round_item_subtotal"));
  const addPrecision = (x, round = true) => (Q.of(x).isZero() ? new Q(0n) : NR(Q.of(x).mul(pow), round ? P - dp : P, "HALF_UP", "wc_add_number_precision"));
  const removePrecision = (x) => Q.of(x).div(pow);
  const taxRound = (x) => NR(x, P, "HALF_UP", "WC_Tax::round");
  const fmtFalse = (x) => roundQ(x, P, "HALF_UP", L("wc_format_decimal(dp=false)")); // sprintf('%.Pf') on a float
  const fmtDp = (x, p = dp) => roundQ(x, p, "HALF_UP", L("number_format")); // wc_format_decimal($x, $dp), wc_price()

  function calcExclusive(price, rates) {
    price = Q.of(price);
    const raw = new Map();
    for (const r of rates) if (!r.compound) raw.set(r.id, (raw.get(r.id) || new Q(0n)).add(price.mul(r.rate).div(100)));
    let pre = sum([...raw.values()]);
    for (const r of rates) {
      if (!r.compound) continue;
      raw.set(r.id, (raw.get(r.id) || new Q(0n)).add(price.add(pre).mul(r.rate).div(100)));
      pre = sum([...raw.values()]);
    }
    const out = new Map();
    for (const r of rates) if (raw.has(r.id)) out.set(r.id, taxRound(raw.get(r.id)));
    return out;
  }

  function calcInclusive(price, rates) {
    price = Q.of(price);
    const raw = new Map(rates.map((r) => [r.id, new Q(0n)]));
    let ncp = price;
    for (const r of [...rates].filter((x) => x.compound).reverse()) {
      const t = ncp.sub(ncp.div(Q.of(1).add(r.rate.div(100))));
      raw.set(r.id, raw.get(r.id).add(t));
      ncp = ncp.sub(t);
    }
    const regular = rates.filter((x) => !x.compound);
    const regularRate = Q.of(1).add(sum(regular.map((x) => x.rate)).div(100));
    for (const r of regular) {
      const theRate = r.rate.div(100).div(regularRate);
      const net = price.sub(theRate.mul(ncp));
      raw.set(r.id, raw.get(r.id).add(price.sub(net)));
    }
    const out = new Map();
    for (const r of rates) out.set(r.id, taxRound(raw.get(r.id)));
    return out;
  }

  const calcTax = (price, rates, inclusive) => (inclusive ? calcInclusive(price, rates) : calcExclusive(price, rates));
  return { ctx, pow, NR, wcRoundTaxTotal, roundLineTax, roundItemSubtotal, addPrecision, removePrecision, fmtFalse, fmtDp, calcTax };
}

const mapSum = (m) => sum([...m.values()]);
const mergeInto = (target, m, fn = (x) => x) => {
  for (const [k, v] of m) target.set(k, (target.get(k) || new Q(0n)).add(fn(v)));
  return target;
};

// ---------------------------------------------------------------------------------------------------------------
// Input.

function readInput(data) {
  const s = data.settings || {};
  const dp = Number(s.woocommerce_price_num_decimals ?? 2);
  const incl = String(s.woocommerce_prices_include_tax ?? "no") === "yes";
  const cfg = {
    dp,
    P: Number(s.rounding_precision ?? Math.max(dp + 2, 6)),
    C6: Number(s.wc_rounding_precision_constant ?? 6),
    incl,
    taxMode: s.tax_rounding_mode ? MODE_NAMES[s.tax_rounding_mode] || s.tax_rounding_mode : incl ? "HALF_DOWN" : "HALF_UP",
    storeSubtotalRounding: String(s.woocommerce_tax_round_at_subtotal ?? "no") === "yes",
    taxDisplayCart: s.woocommerce_tax_display_cart === "incl" ? "incl" : "excl",
    taxTotalDisplay: s.woocommerce_tax_total_display === "single" ? "single" : "itemized",
    // classic: created_via "checkout"; block: "store-api"; other (admin, rest-api, ...): totals come from calculate_totals().
    checkout: s.checkout || (s.created_via === undefined || s.created_via === "checkout" ? "classic" : s.created_via === "store-api" ? "block" : "other"),
    currency: data.currency || "",
  };
  const rates = new Map();
  for (const [id, r] of Object.entries(data.rates || {})) {
    if (r.rate === null || r.rate === undefined || r.rate === "") throw new Error(`tax rate ${id} has no percentage: fill in "rate"`);
    rates.set(String(id), {
      id: String(id),
      rate: Q.of(r.rate),
      compound: r.compound === true || r.compound === "yes" || r.compound === 1 || r.compound === "1",
      priority: Number(r.priority ?? 1),
      label: r.label || `rate ${id}`,
    });
  }
  const pick = (ids, fallback) => {
    const list = (ids && ids.length ? ids : fallback).map(String);
    const found = list.map((id) => {
      if (!rates.has(id)) throw new Error(`tax rate ${id} is used but not listed under "rates"`);
      return rates.get(id);
    });
    return found.sort((a, b) => a.priority - b.priority || Number(a.id) - Number(b.id));
  };
  const taxesOf = (obj, key) => new Map(Object.entries(obj?.taxes?.[key] || {}).map(([k, v]) => [String(k), Q.of(v)]));

  const items = (data.items || []).map((it) => {
    const st = it.stored || {};
    const stT = taxesOf(st, "total");
    const stS = taxesOf(st, "subtotal");
    const itemRates = pick(it.tax_rate_ids, [...new Set([...stS.keys(), ...stT.keys()])]);
    let entered = it.entered_line_price !== undefined ? Q.of(it.entered_line_price) : null;
    let discount = it.entered_line_discount !== undefined ? Q.of(it.entered_line_discount) : null;
    let derived = false;
    if (entered === null) {
      if (st.subtotal === undefined) throw new Error(`item ${it.id}: give entered_line_price or stored.subtotal`);
      entered = roundQ(incl ? Q.of(st.subtotal).add(mapSum(stS)) : Q.of(st.subtotal), dp + 2, "HALF_UP", null);
      derived = true;
    }
    if (discount === null) {
      if (st.total === undefined) discount = new Q(0n);
      else {
        const grossTotal = roundQ(incl ? Q.of(st.total).add(mapSum(stT)) : Q.of(st.total), dp + 2, "HALF_UP", null);
        discount = entered.sub(grossTotal);
        derived = true;
      }
    }
    return { id: String(it.id), qty: Q.of(it.qty ?? 1), rates: itemRates, entered, discount, derived, stored: st, stT, stS, refundQty: it.refund_qty };
  });
  const shipping = (data.shipping || []).map((sh) => {
    const st = sh.stored || {};
    const stT = taxesOf(st, "total");
    return { id: String(sh.id), cost: Q.of(sh.cost ?? st.total ?? 0), rates: pick(sh.tax_rate_ids, [...stT.keys()]), stored: st, stT };
  });
  const fees = (data.fees || []).map((f) => {
    const st = f.stored || {};
    const stT = taxesOf(st, "total");
    const amount = Q.of(f.amount ?? st.total ?? 0);
    if (amount.cmp(0) < 0) throw new Error(`fee ${f.id}: negative fees are spread across tax classes; this helper does not model them`);
    return { id: String(f.id), amount, taxable: f.taxable !== false && stT.size + (f.tax_rate_ids || []).length > 0, rates: pick(f.tax_rate_ids, [...stT.keys()]), stored: st, stT };
  });
  return { cfg, rates, items, shipping, fees, order: data.order?.stored || {}, taxLines: data.tax_lines || [], observed: data.observed || {}, refunded: Q.of(data.order?.stored?.total_refunded ?? 0) };
}

// ---------------------------------------------------------------------------------------------------------------
// WC_Cart_Totals, then WC_Checkout::set_data_from_cart() and the order item setters.

const tagOf = (subtotalRounding) => (subtotalRounding ? "at subtotal" : "per line");

function cartReplay(inp, subtotalRounding) {
  const { cfg } = inp;
  const w = makeWoo({ ...cfg, subtotalRounding, tag: tagOf(subtotalRounding) });
  const lines = [];
  const mergedItems = new Map();
  let discountTaxC = new Q(0n);
  for (const it of inp.items) {
    w.ctx.label = `cart item ${it.id}`;
    const priceC = w.addPrecision(it.entered);
    const subT = w.calcTax(priceC, it.rates, cfg.incl);
    const subtotalC = cfg.incl ? priceC.sub(mapSum(subT)) : priceC;
    const subtotalTaxC = sum([...subT.values()].map((t) => w.roundLineTax(t)));
    const discountC = it.discount.mul(w.pow);
    const grossTotalC = priceC.sub(discountC);
    const T = w.calcTax(grossTotalC, it.rates, cfg.incl);
    const totalC = cfg.incl ? grossTotalC.sub(mapSum(T)) : grossTotalC;
    const lineTaxC = sum([...T.values()].map((t) => w.roundLineTax(t)));
    if (!discountC.isZero()) discountTaxC = discountTaxC.add(mapSum(w.calcTax(discountC, it.rates, cfg.incl)));
    mergeInto(mergedItems, T, (t) => w.roundLineTax(t));
    // What checkout writes to the order item (set_props, then set_taxes() recomputes the line tax in currency units).
    const storedTaxes = new Map([...T].map(([k, v]) => [k, w.fmtFalse(w.removePrecision(v))]));
    const storedLineTax = subtotalRounding ? mapSum(storedTaxes) : sum([...storedTaxes.values()].map((t) => w.wcRoundTaxTotal(t, cfg.dp, "set_taxes")));
    const storedSubTaxes = new Map([...subT].map(([k, v]) => [k, w.fmtFalse(w.removePrecision(v))]));
    const storedSubTax = subtotalRounding ? mapSum(storedSubTaxes) : sum([...storedSubTaxes.values()].map((t) => w.wcRoundTaxTotal(t, cfg.dp, "set_taxes subtotal")));
    lines.push({
      id: it.id, derived: it.derived, entered: it.entered, discount: it.discount, priceC, subT, subtotalC, subtotalTaxC, T, totalC, lineTaxC,
      store: {
        subtotal: w.fmtFalse(w.removePrecision(subtotalC)),
        total: w.fmtFalse(w.removePrecision(totalC)),
        total_tax: storedLineTax,
        taxes: storedTaxes,
        subtotal_tax: storedSubTax,
        subtotal_taxes: storedSubTaxes,
      },
    });
  }
  const shipLines = [];
  const mergedShip = new Map();
  for (const sh of inp.shipping) {
    w.ctx.label = `cart shipping ${sh.id}`;
    const rateTaxes = w.calcTax(sh.cost, sh.rates, false); // WC_Tax::calc_shipping_tax(), in currency units
    const cost = w.fmtDp(sh.cost); // add_rate(): wc_format_decimal( $total_cost, price_decimals )
    const totalC = w.addPrecision(cost);
    const taxesC = new Map([...rateTaxes].map(([k, v]) => [k, w.roundItemSubtotal(w.addPrecision(v, false))]));
    mergeInto(mergedShip, taxesC);
    const storedTaxes = new Map([...rateTaxes].map(([k, v]) => [k, w.fmtFalse(v)]));
    const storedTax = subtotalRounding ? mapSum(storedTaxes) : sum([...storedTaxes.values()].map((t) => w.wcRoundTaxTotal(t, cfg.dp, "set_taxes")));
    shipLines.push({ id: sh.id, cost, rateTaxes, totalC, taxesC, totalTaxC: mapSum(taxesC), store: { total: cost, total_tax: storedTax, taxes: storedTaxes } });
  }
  const feeLines = [];
  const mergedFeesRounded = new Map();
  const feeTaxesRaw = new Map();
  for (const f of inp.fees) {
    w.ctx.label = `cart fee ${f.id}`;
    const totalC = w.addPrecision(f.amount);
    const taxes = f.taxable ? w.calcTax(totalC, f.rates, false) : new Map();
    const totalTaxC = sum([...taxes.values()].map((t) => w.roundLineTax(t)));
    mergeInto(mergedFeesRounded, taxes, (t) => w.roundLineTax(t));
    mergeInto(feeTaxesRaw, taxes);
    feeLines.push({ id: f.id, totalC, taxes, totalTaxC });
  }
  w.ctx.label = "cart totals";
  const itemsTotalC = sum(lines.map((l) => w.roundItemSubtotal(l.totalC)));
  const itemsSubtotalC = sum(lines.map((l) => w.roundItemSubtotal(l.subtotalC)));
  const feesTotalC = sum(feeLines.map((f) => f.totalC));
  const shippingTotalC = sum(shipLines.map((s) => s.totalC));
  const mergedAll = new Map();
  mergeInto(mergedAll, mergedItems);
  mergeInto(mergedAll, mergedFeesRounded);
  mergeInto(mergedAll, mergedShip, (t) => w.roundLineTax(t));
  const totalC = w.NR(itemsTotalC.add(feesTotalC).add(shippingTotalC).add(mapSum(mergedAll)), 0, "HALF_UP", "total");
  const itemsTax = w.removePrecision(mapSum(mergedItems));
  const shipFeeTax = w.NR(w.removePrecision(mapSum(mergedFeesRounded).add(sum([...mergedShip.values()].map((t) => w.roundLineTax(t))))), cfg.dp, "HALF_UP", "shipping and fee taxes");
  const cartTotalTax = w.wcRoundTaxTotal(itemsTax.add(shipFeeTax), cfg.dp, "set_total_tax");
  const cartTotal = w.fmtDp(w.removePrecision(totalC));
  const cartContentsTax = itemsTax;
  const feeTax = w.removePrecision(sum(feeLines.map((f) => f.totalTaxC)));
  const shippingTax = w.removePrecision(sum(shipLines.map((s) => s.totalTaxC)));
  const discountsC = sum(inp.items.map((i) => i.discount.mul(w.pow)));
  // WC_Cart::get_tax_totals(), which the cart, checkout and Store API tax rows show.
  const cartTaxes = new Map();
  mergeInto(cartTaxes, new Map([...mergedShip].map(([k, v]) => [k, w.removePrecision(v)])));
  mergeInto(cartTaxes, new Map([...mergedItems].map(([k, v]) => [k, w.removePrecision(v)])));
  mergeInto(cartTaxes, new Map([...feeTaxesRaw].map(([k, v]) => [k, w.removePrecision(v)])));
  const taxRows = new Map();
  for (const [k, tax0] of cartTaxes) {
    let tax = tax0;
    if (mergedShip.has(k)) {
      const sh = w.removePrecision(mergedShip.get(k));
      tax = w.wcRoundTaxTotal(tax.sub(sh), cfg.dp, "get_tax_totals").add(w.NR(sh, cfg.dp, "HALF_UP", "get_tax_totals shipping"));
    }
    taxRows.set(k, w.wcRoundTaxTotal(tax, cfg.dp, "get_tax_totals"));
  }
  const order = {
    total: cartTotal,
    cart_tax: w.fmtFalse(cartContentsTax.add(feeTax)),
    shipping_tax: w.fmtFalse(shippingTax),
    discount_total: w.fmtFalse(w.removePrecision(cfg.incl ? discountsC.sub(discountTaxC) : discountsC)),
    discount_tax: w.fmtFalse(w.removePrecision(discountTaxC)),
    shipping_total: w.fmtFalse(w.removePrecision(shippingTotalC)),
  };
  order.total_tax = w.NR(order.cart_tax.add(order.shipping_tax), cfg.dp, "HALF_UP", "order set_total_tax");
  const taxLines = new Map();
  for (const k of new Set([...mergedItems.keys(), ...feeTaxesRaw.keys(), ...mergedShip.keys()])) {
    taxLines.set(k, {
      tax_amount: w.fmtFalse(w.removePrecision((mergedItems.get(k) || new Q(0n)).add(feeTaxesRaw.get(k) || new Q(0n)))),
      shipping_tax_amount: w.fmtFalse(w.removePrecision(mergedShip.get(k) || new Q(0n))),
    });
  }
  return {
    lines, shipLines, feeLines, itemsTotalC, itemsSubtotalC, shippingTotalC, feesTotalC, mergedItems, mergedShip, totalC,
    cart: { subtotal: w.removePrecision(itemsSubtotalC), total: cartTotal, total_tax: cartTotalTax, tax_rows: taxRows },
    order, taxLines,
    storeApi: {
      total_items: roundQ(w.removePrecision(itemsSubtotalC).mul(w.pow), 0, "HALF_UP", null),
      total_price: roundQ(cartTotal.mul(w.pow), 0, "HALF_UP", null),
      total_tax: roundQ(cartTotalTax.mul(w.pow), 0, "HALF_UP", null),
      tax_lines: new Map([...taxRows].map(([k, v]) => [k, roundQ(v.mul(w.pow), 0, "HALF_UP", null)])),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// WC_Abstract_Order::calculate_totals( true ) on the stored items: calculate_taxes() and update_taxes().

// The lines calculate_totals() works on: the stored ones, or (block checkout) the ones checkout copied from the cart.
function sourceFromStored(inp) {
  return {
    name: "recalc",
    items: inp.items.map((it) => ({ id: it.id, rates: it.rates, subtotal: Q.of(it.stored.subtotal ?? 0), total: Q.of(it.stored.total ?? 0) })),
    shipping: inp.shipping.map((s) => ({ id: s.id, rates: s.rates, total: Q.of(s.stored.total ?? s.cost) })),
    fees: inp.fees.map((f) => ({ id: f.id, rates: f.rates, taxable: f.taxable, total: Q.of(f.stored.total ?? f.amount) })),
  };
}

function sourceFromReplay(inp, replay) {
  return {
    name: "block checkout",
    items: replay.lines.map((l) => ({ id: l.id, rates: inp.items.find((x) => x.id === l.id).rates, subtotal: l.store.subtotal, total: l.store.total })),
    shipping: replay.shipLines.map((s) => ({ id: s.id, rates: inp.shipping.find((x) => x.id === s.id).rates, total: s.store.total })),
    fees: replay.feeLines.map((f) => ({ id: f.id, rates: inp.fees.find((x) => x.id === f.id).rates, taxable: inp.fees.find((x) => x.id === f.id).taxable, total: f.totalC.div(new Q(10n ** BigInt(inp.cfg.dp))) })),
  };
}

function orderRecalc(inp, subtotalRounding, src = sourceFromStored(inp)) {
  const { cfg } = inp;
  const w = makeWoo({ ...cfg, subtotalRounding, tag: tagOf(subtotalRounding) });
  w.ctx.label = src.name;
  const cartSubtotal = w.removePrecision(sum(src.items.map((it) => w.roundItemSubtotal(w.addPrecision(it.subtotal, false)))));
  const cartTotal = w.removePrecision(sum(src.items.map((it) => w.roundItemSubtotal(w.addPrecision(it.total, false)))));
  const shippingTotal = sum(src.shipping.map((s) => w.NR(s.total, cfg.dp, "HALF_UP", "shipping total")));
  const feesTotal = sum(src.fees.map((f) => f.total));
  const cartTaxes = new Map();
  const shippingTaxes = new Map();
  const lines = [];
  let subtotalTaxRaw = new Q(0n);
  let totalTaxRaw = new Q(0n);
  for (const it of src.items) {
    w.ctx.label = `${src.name} item ${it.id}`;
    const T = w.calcTax(it.total, it.rates, false);
    const S = w.calcTax(it.subtotal, it.rates, false);
    totalTaxRaw = totalTaxRaw.add(mapSum(T));
    subtotalTaxRaw = subtotalTaxRaw.add(mapSum(S));
    const taxes = new Map([...T].map(([k, v]) => [k, w.fmtFalse(v)]));
    mergeInto(cartTaxes, taxes, (t) => w.roundLineTax(t, false));
    const lineTax = subtotalRounding ? mapSum(taxes) : sum([...taxes.values()].map((t) => w.wcRoundTaxTotal(t, cfg.dp, "set_taxes")));
    lines.push({ id: it.id, taxes, total_tax: lineTax });
  }
  for (const f of src.fees) {
    w.ctx.label = `${src.name} fee ${f.id}`;
    const T = f.taxable ? w.calcTax(f.total, f.rates, false) : new Map();
    mergeInto(cartTaxes, new Map([...T].map(([k, v]) => [k, w.fmtFalse(v)])), (t) => w.roundLineTax(t, false));
  }
  const shipLines = [];
  for (const s of src.shipping) {
    w.ctx.label = `${src.name} shipping ${s.id}`;
    const T = w.calcTax(s.total, s.rates, false);
    const taxes = new Map([...T].map(([k, v]) => [k, w.fmtFalse(v)]));
    mergeInto(shippingTaxes, taxes, (t) => (subtotalRounding ? t : w.wcRoundTaxTotal(t, cfg.dp, "update_taxes shipping")));
    shipLines.push({ id: s.id, taxes, total_tax: subtotalRounding ? mapSum(taxes) : sum([...taxes.values()].map((t) => w.wcRoundTaxTotal(t, cfg.dp, "set_taxes"))) });
  }
  w.ctx.label = `${src.name} totals`;
  const cartTax = w.fmtFalse(mapSum(cartTaxes));
  const shippingTax = w.fmtFalse(mapSum(shippingTaxes));
  const order = {
    cart_tax: cartTax,
    shipping_tax: shippingTax,
    total_tax: w.NR(cartTax.add(shippingTax), cfg.dp, "HALF_UP", "set_total_tax"),
    discount_total: w.NR(cartSubtotal.sub(cartTotal), cfg.dp, "HALF_UP", "discount_total"),
    discount_tax: w.wcRoundTaxTotal(subtotalTaxRaw.sub(totalTaxRaw), cfg.dp, "discount_tax"),
    shipping_total: shippingTotal,
    total: w.fmtDp(w.NR(cartTotal.add(feesTotal).add(shippingTotal).add(cartTax).add(shippingTax), cfg.dp, "HALF_UP", "total")),
  };
  const taxLines = new Map();
  for (const k of new Set([...cartTaxes.keys(), ...shippingTaxes.keys()])) {
    taxLines.set(k, { tax_amount: w.fmtFalse(cartTaxes.get(k) || new Q(0n)), shipping_tax_amount: w.fmtFalse(shippingTaxes.get(k) || new Q(0n)) });
  }
  return { cartSubtotal, cartTotal, lines, shipLines, order, taxLines };
}

// ---------------------------------------------------------------------------------------------------------------
// Views of the stored order: REST API, order emails, the admin refund form, gateways.

function views(inp) {
  const { cfg } = inp;
  const w = makeWoo({ ...cfg, subtotalRounding: cfg.storeSubtotalRounding, tag: "stored order" });
  w.ctx.label = "view";
  const o = inp.order;
  const f = (x) => w.fmtDp(Q.of(x ?? 0));
  const orderTotal = Q.of(o.total ?? 0);
  const orderTotalTax = o.total_tax !== undefined ? Q.of(o.total_tax) : w.NR(Q.of(o.cart_tax ?? 0).add(Q.of(o.shipping_tax ?? 0)), cfg.dp, "HALF_UP", "total_tax");

  // REST API v2/v3 (wc_format_decimal with dp = price decimals).
  const restItems = inp.items.map((it) => ({ id: it.id, total: f(it.stored.total), total_tax: f(it.stored.total_tax), subtotal: f(it.stored.subtotal), subtotal_tax: f(it.stored.subtotal_tax) }));
  const restShip = inp.shipping.map((s) => ({ id: s.id, total: f(s.stored.total ?? s.cost), total_tax: f(s.stored.total_tax) }));
  const restFees = inp.fees.map((x) => ({ id: x.id, total: f(x.stored.total ?? x.amount), total_tax: f(x.stored.total_tax) }));
  const restTaxLines = inp.taxLines.map((t) => ({ rate_id: String(t.rate_id), tax_total: f(t.tax_amount), shipping_tax_total: f(t.shipping_tax_amount) }));
  const rest = {
    total: f(o.total), total_tax: f(orderTotalTax), cart_tax: f(o.cart_tax), shipping_tax: f(o.shipping_tax),
    lines_sum: sum([...restItems, ...restShip, ...restFees].map((x) => x.total.add(x.total_tax))),
    tax_lines_sum: sum(restTaxLines.map((t) => t.tax_total.add(t.shipping_tax_total))),
    items: restItems, shipping: restShip, fees: restFees, tax_lines: restTaxLines,
  };

  // Order emails and the order-received page: get_order_item_totals() with woocommerce_tax_display_cart.
  const email = { mode: cfg.taxDisplayCart, rows: [] };
  const cartSubtotalForOrder = w.removePrecision(sum(inp.items.map((it) => w.roundItemSubtotal(w.addPrecision(it.stored.subtotal ?? 0, false)))));
  const lineRows = inp.items.map((it) => ({
    id: it.id,
    shown: w.fmtDp(w.NR(cfg.taxDisplayCart === "incl" ? Q.of(it.stored.subtotal ?? 0).add(Q.of(it.stored.subtotal_tax ?? 0)) : Q.of(it.stored.subtotal ?? 0), cfg.dp, "HALF_UP", "get_line_subtotal")),
  }));
  let subtotalRow = cartSubtotalForOrder;
  if (cfg.taxDisplayCart === "incl") {
    subtotalRow = subtotalRow.add(w.wcRoundTaxTotal(sum(inp.items.map((it) => w.roundLineTax(Q.of(it.stored.subtotal_tax ?? 0), false))), cfg.dp, "subtotal row"));
  }
  email.rows.push(["Subtotal", w.fmtDp(subtotalRow)]);
  const discount = cfg.taxDisplayCart === "excl" ? Q.of(o.discount_total ?? 0) : Q.of(o.discount_total ?? 0).add(Q.of(o.discount_tax ?? 0));
  if (Q.of(o.discount_total ?? 0).cmp(0) > 0) email.rows.push(["Discount", w.fmtDp(roundQ(discount, 6, "HALF_UP", null)).neg()]);
  if (inp.shipping.length) email.rows.push(["Shipping", w.fmtDp(cfg.taxDisplayCart === "excl" ? Q.of(o.shipping_total ?? 0) : Q.of(o.shipping_total ?? 0).add(Q.of(o.shipping_tax ?? 0)))]);
  for (const x of inp.fees) email.rows.push([`Fee ${x.id}`, w.fmtDp(cfg.taxDisplayCart === "excl" ? Q.of(x.stored.total ?? x.amount) : Q.of(x.stored.total ?? x.amount).add(Q.of(x.stored.total_tax ?? 0)))]);
  if (cfg.taxDisplayCart === "excl") {
    if (cfg.taxTotalDisplay === "itemized") for (const t of inp.taxLines) email.rows.push([`Tax rate ${t.rate_id}`, w.fmtDp(Q.of(t.tax_amount ?? 0).add(Q.of(t.shipping_tax_amount ?? 0)))]);
    else email.rows.push(["Tax", w.fmtDp(orderTotalTax)]);
  }
  email.total = w.fmtDp(orderTotal);
  email.rowsSum = sum(email.rows.map((r) => r[1]));
  email.lineRows = lineRows;
  email.lineRowsSum = sum(lineRows.map((r) => r.shown));

  // Admin refund form: refund_quantity_changed() fills each product line with unit total x qty and unit tax x qty,
  // rounded to rounding_precision; input_changed() rounds each field to price decimals (per-line rounding) or only the
  // sum (subtotal rounding), with accounting.js (Math.round). Shipping and fee rows are typed by hand.
  const fields = [];
  let refundTaxRecorded = new Q(0n);
  for (const it of inp.items) {
    const qty = it.refundQty !== undefined ? Q.of(it.refundQty) : it.qty;
    const unitTotal = Q.of(it.stored.total ?? 0).div(it.qty);
    fields.push(roundQ(unitTotal.mul(qty), cfg.P, "JS", `[refund form] item ${it.id} total`));
    for (const [k, v] of it.stT) {
      const val = roundQ(v.div(it.qty).mul(qty), cfg.P, "JS", `[refund form] item ${it.id} tax ${k}`);
      fields.push(val);
      // WC_Order_Refund::update_taxes() rounds each negative line tax on its own (round_line_tax, tax rounding mode).
      refundTaxRecorded = refundTaxRecorded.add(w.roundLineTax(val.neg(), false).neg());
    }
  }
  const refundAmount = cfg.storeSubtotalRounding
    ? roundQ(sum(fields), cfg.dp, "JS", "[refund form] amount")
    : sum(fields.map((x, i) => roundQ(x, cfg.dp, "JS", `[refund form] field ${i + 1}`)));
  const productShare = orderTotal.sub(Q.of(o.shipping_total ?? 0)).sub(Q.of(o.shipping_tax ?? 0)).sub(sum(inp.fees.map((x) => Q.of(x.stored.total ?? x.amount).add(Q.of(x.stored.total_tax ?? 0)))));
  const maxRefund = w.fmtDp(orderTotal.sub(inp.refunded));
  const refund = { amount: refundAmount, productShare, maxRefund, refused: refundAmount.cmp(maxRefund) > 0, taxRecorded: refundTaxRecorded, allItems: inp.items.every((it) => it.refundQty === undefined) };

  // Gateways: the order total in minor units (two-decimal currency: total x 100, rounded), and the PayPal Standard
  // line-item check (line_items_valid) that decides between itemised and single-line requests.
  const gateway = { minor: roundQ(orderTotal.mul(w.pow), 0, "HALF_UP", null), refundMinor: roundQ(refundAmount.mul(w.pow), 0, "HALF_UP", null) };
  const pp2 = (x) => roundQ(x, 2, "HALF_UP", null);
  let calc = new Q(0n);
  for (const it of inp.items) calc = calc.add(pp2(w.NR(Q.of(it.stored.subtotal ?? 0).div(it.qty), cfg.dp, "HALF_UP", null)).mul(it.qty));
  for (const x of inp.fees) calc = calc.add(pp2(Q.of(x.stored.total ?? x.amount)));
  const totalDiscount = roundQ(Q.of(o.discount_total ?? 0), 6, "HALF_UP", null);
  const ppSum = pp2(calc.add(orderTotalTax).add(pp2(Q.of(o.shipping_total ?? 0))).sub(pp2(totalDiscount)));
  gateway.paypal = cfg.incl ? { single: true, reason: "prices include tax: PayPal Standard always sends one line" } : { single: !ppSum.eq(pp2(orderTotal)), lineSum: ppSum, total: pp2(orderTotal) };
  return { rest, email, refund, gateway, orderTotal, orderTotalTax };
}

// ---------------------------------------------------------------------------------------------------------------
// Comparison and report.

function compare(inp, run, v) {
  const { replay, block, recalc } = run;
  const rows = [];
  const add = (stage, what, stored, computed, note = "") => {
    if (stored === undefined || stored === null || computed === undefined || computed === null) return;
    const s = Q.of(stored);
    const c = Q.of(computed);
    rows.push({ stage, what, stored: s, computed: c, diff: s.sub(c), match: roundQ(s.sub(c).mul(10n ** BigInt(inp.cfg.P)), 0, "HALF_UP", null).isZero(), note });
  };
  // What checkout stores: classic checkout copies the cart; block checkout (Store API) copies the lines and then runs
  // calculate_totals(), which recalculates line taxes, tax lines and totals.
  const mode = inp.cfg.checkout;
  const isBlock = mode !== "classic";
  const calc = mode === "block" ? block : recalc; // "other": the stored lines through calculate_totals()
  const exp = {
    lineTaxes: (id) => (isBlock ? calc.lines.find((x) => x.id === id).taxes : replay.lines.find((x) => x.id === id).store.taxes),
    lineTax: (id) => (isBlock ? calc.lines.find((x) => x.id === id).total_tax : replay.lines.find((x) => x.id === id).store.total_tax),
    shipTaxes: (id) => (isBlock ? calc.shipLines.find((x) => x.id === id).taxes : replay.shipLines.find((x) => x.id === id).store.taxes),
    shipTax: (id) => (isBlock ? calc.shipLines.find((x) => x.id === id).total_tax : replay.shipLines.find((x) => x.id === id).store.total_tax),
    taxLines: isBlock ? calc.taxLines : replay.taxLines,
    order: isBlock ? calc.order : replay.order,
  };
  const o = inp.order;
  add("0 cart page", "total shown at checkout", o.total, replay.cart.total, "cart replay against the stored order total");
  add("0 cart page", "total tax shown at checkout", o.total_tax, replay.cart.total_tax, "the cart rounds shipping and fee tax apart from item tax");
  for (const l of replay.lines) {
    const it = inp.items.find((x) => x.id === l.id);
    for (const [k, t] of exp.lineTaxes(l.id)) add("1 line tax (unrounded)", `item ${l.id} rate ${k}`, it.stT.get(k)?.toString(12), t);
    add("2 line tax (rounded)", `item ${l.id} _line_tax`, it.stored.total_tax, exp.lineTax(l.id));
    add("3 line net", `item ${l.id} _line_total`, it.stored.total, l.store.total);
    add("3 line net", `item ${l.id} _line_subtotal`, it.stored.subtotal, l.store.subtotal);
  }
  for (const s of replay.shipLines) {
    const sh = inp.shipping.find((x) => x.id === s.id);
    for (const [k, t] of exp.shipTaxes(s.id)) add("1 line tax (unrounded)", `shipping ${s.id} rate ${k}`, sh.stT.get(k)?.toString(12), t);
    add("2 line tax (rounded)", `shipping ${s.id} total_tax`, sh.stored.total_tax, exp.shipTax(s.id));
  }
  for (const t of inp.taxLines) {
    const c = exp.taxLines.get(String(t.rate_id));
    if (!c) continue;
    add("4 tax lines", `rate ${t.rate_id} tax_amount`, t.tax_amount, c.tax_amount);
    add("4 tax lines", `rate ${t.rate_id} shipping_tax_amount`, t.shipping_tax_amount, c.shipping_tax_amount);
  }
  // The stored order against its own stored lines.
  const storedLineTax = sum([...inp.items, ...inp.fees].map((x) => Q.of(x.stored.total_tax ?? 0)));
  const storedShipTax = sum(inp.shipping.map((x) => Q.of(x.stored.total_tax ?? 0)));
  add("5 stored sums", "cart_tax against item and fee _line_tax", o.cart_tax, storedLineTax, "both stored");
  if (inp.shipping.length) add("5 stored sums", "shipping_tax against shipping total_tax", o.shipping_tax, storedShipTax, "both stored");
  add("5 order totals", "cart_tax", o.cart_tax, exp.order.cart_tax);
  add("5 order totals", "shipping_tax", o.shipping_tax, exp.order.shipping_tax);
  add("5 order totals", "total_tax", o.total_tax, exp.order.total_tax);
  add("5 order totals", "discount_total", o.discount_total, isBlock ? null : exp.order.discount_total);
  add("5 order totals", "discount_tax", o.discount_tax, isBlock ? null : exp.order.discount_tax);
  add("6 order total", `total (${mode === "other" ? "calculate_totals" : `${mode} checkout`})`, o.total, exp.order.total);
  add("7 recalculation", "total after Recalculate", o.total, recalc.order.total, "what WC_Abstract_Order::calculate_totals() would store");
  add("7 recalculation", "total_tax after Recalculate", o.total_tax ?? v.orderTotalTax, recalc.order.total_tax);
  add("8 REST API", "sum of line totals and line taxes", v.rest.total, v.rest.lines_sum, "REST shows each line rounded on its own");
  add("8 REST API", "sum of tax_lines", v.rest.total_tax, v.rest.tax_lines_sum);
  add("9 emails", `sum of total rows (${v.email.mode})`, v.email.total, v.email.rowsSum);
  if (v.refund.allItems && !inp.shipping.length && !inp.fees.length) add("10 refund form", "full refund amount", v.refund.maxRefund, v.refund.amount, v.refund.refused ? "above the remaining total: refund_line_items() refuses it" : "");
  const obs = inp.observed;
  const map = {
    cart_total: replay.cart.total, cart_total_tax: replay.cart.total_tax, store_api_total_price_minor: replay.storeApi.total_price,
    rest_total: v.rest.total, rest_total_tax: v.rest.total_tax, email_total: v.email.total, gateway_amount_minor: v.gateway.minor, refund_amount: v.refund.amount,
  };
  for (const [k, val] of Object.entries(obs)) if (k in map) add("11 observed", k, val, map[k], "value seen elsewhere, against the computed view");
  const first = rows.find((r) => !r.match);
  return { rows, first };
}

function runAll(data) {
  TIES = [];
  const inp = readInput(data);
  const both = [inp.cfg.storeSubtotalRounding, !inp.cfg.storeSubtotalRounding];
  const replays = both.map((m) => {
    const replay = cartReplay(inp, m);
    return { subtotalRounding: m, replay, block: orderRecalc(inp, m, sourceFromReplay(inp, replay)), recalc: orderRecalc(inp, m) };
  });
  const v = views(inp);
  const cmp = compare(inp, replays[0], v);
  // Does either rounding setting reproduce what checkout stored (stages 0 to 6)?
  const checkoutMismatches = (rows) => rows.filter((row) => /^[0-6] /.test(row.stage) && row.stage !== "5 stored sums" && !row.match).length;
  const other = compare(inp, replays[1], v);
  cmp.checkout = { store: checkoutMismatches(cmp.rows), other: checkoutMismatches(other.rows), compared: cmp.rows.filter((row) => /^[0-6] /.test(row.stage) && row.stage !== "5 stored sums").length };
  return { inp, replays, v, cmp, ties: [...new Set(TIES)] };
}

// ---------------------------------------------------------------------------------------------------------------
// Output.

function printReport(r) {
  const { inp, replays, v, cmp } = r;
  const c = inp.cfg;
  const d = (q) => (q === null || q === undefined ? "-" : Q.of(q).toString(10));
  const m = (q) => (q === null || q === undefined ? "-" : Q.of(q).fixed(c.dp));
  const out = [];
  const p = (s = "") => out.push(s);
  p("Tax trace (read-only)");
  p(`currency ${c.currency || "-"}   decimals ${c.dp}   rounding precision ${c.P}   prices include tax ${c.incl ? "yes" : "no"}   tax rounding mode ${c.taxMode}`);
  p(`store setting: ${c.storeSubtotalRounding ? "round at subtotal" : "round per line"}   display in cart ${c.taxDisplayCart}   tax totals ${c.taxTotalDisplay}   order placed through ${c.checkout} checkout`);
  if (inp.items.some((i) => i.derived)) p("Entered prices or discounts were derived from the stored line values (rounded to decimals + 2).");

  for (const { subtotalRounding, replay, block, recalc } of replays) {
    const tag = subtotalRounding ? "round at subtotal" : "round per line";
    const isStore = subtotalRounding === c.storeSubtotalRounding;
    p("");
    p(`== Cart replay, ${tag}${isStore ? " (store setting)" : " (other setting)"} ==`);
    p("values in minor units (cents) unless marked");
    for (const l of replay.lines) {
      p(`item ${l.id}: entered ${d(l.entered)} less discount ${d(l.discount)} -> price ${d(l.priceC)}`);
      p(`  subtotal taxes ${[...l.subT].map(([k, t]) => `rate ${k} ${d(t)}`).join(", ")}   subtotal ${d(l.subtotalC)}`);
      p(`  total taxes ${[...l.T].map(([k, t]) => `rate ${k} ${d(t)}`).join(", ")}   line tax ${d(l.lineTaxC)}   net ${d(l.totalC)}`);
    }
    for (const s of replay.shipLines) p(`shipping ${s.id}: cost ${d(s.cost)} (currency)   taxes ${[...s.taxesC].map(([k, t]) => `rate ${k} ${d(t)}`).join(", ")}`);
    for (const f of replay.feeLines) p(`fee ${f.id}: ${d(f.totalC)}   taxes ${[...f.taxes].map(([k, t]) => `rate ${k} ${d(t)}`).join(", ") || "none"}`);
    p(`items total ${d(replay.itemsTotalC)}   item taxes ${[...replay.mergedItems].map(([k, t]) => `rate ${k} ${d(t)}`).join(", ") || "none"}   total ${d(replay.totalC)}`);
    p(`cart: total ${m(replay.cart.total)}   total tax ${m(replay.cart.total_tax)}   tax rows ${[...replay.cart.tax_rows].map(([k, t]) => `rate ${k} ${m(t)}`).join(", ") || "none"}`);
    p(`Store API (minor units): total_items ${d(replay.storeApi.total_items)}   total_price ${d(replay.storeApi.total_price)}   total_tax ${d(replay.storeApi.total_tax)}`);
    p(`checkout stores: total ${m(replay.order.total)}   cart_tax ${d(replay.order.cart_tax)}   shipping_tax ${d(replay.order.shipping_tax)}   total_tax ${m(replay.order.total_tax)}   discount_total ${d(replay.order.discount_total)}   discount_tax ${d(replay.order.discount_tax)}`);
    for (const l of replay.lines) p(`  item ${l.id}: _line_subtotal ${d(l.store.subtotal)}   _line_subtotal_tax ${d(l.store.subtotal_tax)}   _line_total ${d(l.store.total)}   _line_tax ${d(l.store.total_tax)}   _line_tax_data subtotal ${[...l.store.subtotal_taxes].map(([k, t]) => `${k}: ${d(t)}`).join(", ")} total ${[...l.store.taxes].map(([k, t]) => `${k}: ${d(t)}`).join(", ")}`);
    for (const s of replay.shipLines) p(`  shipping ${s.id}: cost ${d(s.store.total)}   total_tax ${d(s.store.total_tax)}`);
    p(`block checkout stores (lines copied, then calculate_totals): total ${m(block.order.total)}   cart_tax ${d(block.order.cart_tax)}   shipping_tax ${d(block.order.shipping_tax)}   total_tax ${m(block.order.total_tax)}`);
    p(`== Recalculation (calculate_totals), ${tag} ==`);
    p(`total ${m(recalc.order.total)}   cart_tax ${d(recalc.order.cart_tax)}   shipping_tax ${d(recalc.order.shipping_tax)}   total_tax ${m(recalc.order.total_tax)}   discount_total ${m(recalc.order.discount_total)}   discount_tax ${m(recalc.order.discount_tax)}`);
  }

  p("");
  p("== Views of the stored order ==");
  p(`REST API: total ${m(v.rest.total)}   total_tax ${m(v.rest.total_tax)}   sum of line totals and taxes ${m(v.rest.lines_sum)}   sum of tax_lines ${m(v.rest.tax_lines_sum)}`);
  p(`Emails (${v.email.mode}): ${v.email.rows.map(([k, val]) => `${k} ${m(val)}`).join("   ")}   Total ${m(v.email.total)}   (rows add up to ${m(v.email.rowsSum)})`);
  p(`  line rows: ${v.email.lineRows.map((l) => `item ${l.id} ${m(l.shown)}`).join("   ")}   (sum ${m(v.email.lineRowsSum)})`);
  p(`Refund form (${v.refund.allItems ? "every product line, full quantity" : "quantities from the input"}): amount ${m(v.refund.amount)}   product share of the order ${m(v.refund.productShare)}   remaining refundable ${m(v.refund.maxRefund)}${v.refund.refused ? "   REFUSED by refund_line_items()" : ""}   refund tax recorded ${m(v.refund.taxRecorded)}`);
  p(`Gateway: order total ${d(v.gateway.minor)} minor units   refund ${d(v.gateway.refundMinor)} minor units`);
  p(v.gateway.paypal.single && v.gateway.paypal.reason ? `PayPal Standard: one line (${v.gateway.paypal.reason})` : `PayPal Standard: line items add up to ${m(v.gateway.paypal.lineSum)} against total ${m(v.gateway.paypal.total)} -> ${v.gateway.paypal.single ? "mismatch, sends one line" : "itemised"}`);

  p("");
  p(`== Stored against computed (store setting, ${c.checkout} checkout) ==`);
  const w = (s, n) => String(s).padEnd(n);
  p(`${w("stage", 26)} ${w("value", 40)} ${w("stored", 16)} ${w("computed", 16)} diff`);
  for (const row of cmp.rows) p(`${w(row.stage, 26)} ${w(row.what, 40)} ${w(d(row.stored), 16)} ${w(d(row.computed), 16)} ${row.match ? "ok" : d(row.diff)}${row.note ? `   ${row.note}` : ""}`);
  p("");
  const tagStore = c.storeSubtotalRounding ? "round at subtotal" : "round per line";
  const tagOther = c.storeSubtotalRounding ? "round per line" : "round at subtotal";
  p(`Checkout stages 0 to 6: ${cmp.checkout.store} of ${cmp.checkout.compared} values differ under the store setting (${tagStore}), ${cmp.checkout.other} under the other setting (${tagOther}).`);
  p(cmp.first ? `First divergence: stage ${cmp.first.stage}, ${cmp.first.what} (stored ${d(cmp.first.stored)}, computed ${d(cmp.first.computed)}).` : "No divergence between the stored figures and the computed ones.");
  p("");
  p(`== Half-way values (${r.ties.length}) ==`);
  if (!r.ties.length) p("none");
  for (const t of r.ties) p(t);
  return out.join("\n");
}

function toJson(r) {
  const conv = (x) => {
    if (x instanceof Q) return x.toString(12);
    if (x instanceof Map) return Object.fromEntries([...x].map(([k, v]) => [k, conv(v)]));
    if (Array.isArray(x)) return x.map(conv);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).filter(([k]) => !["rates", "stored", "stT", "stS"].includes(k)).map(([k, v]) => [k, conv(v)]));
    return x;
  };
  return JSON.stringify(conv({ settings: r.inp.cfg, replays: r.replays, views: r.v, comparison: r.cmp, half_way_values: r.ties }), null, 2);
}

export { Q, roundQ, runAll };

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file || args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node tax-trace.mjs <order.json> [--json]");
    process.exit(file ? 0 : 2);
  }
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Cannot read ${file} as JSON: ${err.message}`);
    process.exit(1);
  }
  try {
    const r = runAll(data);
    console.log(args.includes("--json") ? toJson(r) : printReport(r));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
