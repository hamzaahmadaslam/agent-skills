# Where an order's tax is stored

Read this for step 1 of the procedure (export) and whenever a stored value has to be read without WP-CLI. Code links
point at the WooCommerce 11.1.2 tag.

## Order lines and their meta

Every order line (product, shipping, fee, tax, coupon) is a row in `{prefix}woocommerce_order_items` (`order_item_id`,
`order_item_name`, `order_item_type`, `order_id`), with its values in `{prefix}woocommerce_order_itemmeta` (`meta_id`,
`order_item_id`, `meta_key`, `meta_value`)
([class-wc-install.php L1859-L1875](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1859-L1875)).
The item data stores read and write those two tables
([abstract-wc-order-item-type-data-store.php L75, L109, L165](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/abstract-wc-order-item-type-data-store.php#L69-L112)),
whichever order storage (HPOS or posts) holds the order itself.

| Line type | Meta keys and the property each holds | Source |
| --- | --- | --- |
| Product (`line_item`) | `_qty` quantity, `_tax_class`, `_line_subtotal` (before coupons), `_line_subtotal_tax`, `_line_total` (after coupons), `_line_tax`, `_line_tax_data` (`taxes`) | [class-wc-order-item-product-data-store.php L25, L60-L70](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-order-item-product-data-store.php#L60-L70) |
| Shipping (`shipping`) | `method_id`, `instance_id`, `cost` (total), `total_tax`, `taxes` | [class-wc-order-item-shipping-data-store.php L24, L66-L70](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-order-item-shipping-data-store.php#L66-L70) |
| Fee (`fee`) | `_fee_amount`, `_tax_class`, `_tax_status`, `_line_subtotal`, `_line_subtotal_tax`, `_line_total`, `_line_tax`, `_line_tax_data` | [class-wc-order-item-fee-data-store.php L25](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-order-item-fee-data-store.php#L25) |
| Tax (`tax`) | `rate_id`, `label`, `compound`, `tax_amount` (item and fee tax), `shipping_tax_amount`, `rate_percent` | [class-wc-order-item-tax-data-store.php L25, L61-L66](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-order-item-tax-data-store.php#L61-L66) |
| Coupon (`coupon`) | `discount_amount`, `discount_amount_tax` | [class-wc-order-item-coupon-data-store.php L25](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-order-item-coupon-data-store.php#L25) |

- `_line_tax_data` holds `array( 'total' => array( rate_id => amount ), 'subtotal' => array( rate_id => amount ) )`;
  shipping and fee `taxes` hold only `total`
  ([product set_taxes L177-L231](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order-item-product.php#L177-L231);
  [shipping L139-L179](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order-item-shipping.php#L139-L179);
  [fee L199-L236](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order-item-fee.php#L199-L236)).
  WordPress stores a non-scalar meta value serialized
  ([update_metadata()](https://developer.wordpress.org/reference/functions/update_metadata/)), so read it through
  WooCommerce (`$item->get_taxes()`) rather than by eye.
- The amounts are kept unrounded: the setters use `wc_format_decimal( $value )` without a decimal count, which keeps up
  to `wc_get_rounding_precision()` places for floats ([rounding-functions.md](rounding-functions.md)). `_line_total`
  can be 74.375 and a rate in `_line_tax_data` 14.875.
- `set_taxes()` recomputes the line's tax: per-line setting, the sum of `wc_round_tax_total()` of each rate (tax rounding
  mode, price decimals); subtotal setting, the plain sum
  ([product L224-L230](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order-item-product.php#L224-L230);
  [shipping L174-L178](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order-item-shipping.php#L174-L178);
  [fee L231-L235](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order-item-fee.php#L231-L235)).
  It reads the setting at the moment it runs, so the same tax data gives a different `_line_tax` after the setting
  changes.
- Tax lines keep the rate as it was: `rate_percent` is set from the rate table when the tax line is written
  ([abstract-wc-order.php L2273-L2346](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2273-L2346);
  [class-wc-checkout.php L690-L730](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L690-L730)).
  `export-order.php` takes rates from there and falls back to the current rate table, which may have changed since.

## Order totals

| Property | HPOS column | Posts meta key | Source |
| --- | --- | --- | --- |
| `total` | `{prefix}wc_orders.total_amount` | `_order_total` | [OrdersTableDataStore.php L296-L299](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L292-L299); [abstract-wc-order-data-store-cpt.php L474-L484](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/abstract-wc-order-data-store-cpt.php#L474-L484) |
| `cart_tax` (item and fee tax) | `wc_orders.tax_amount` | `_order_tax` | same |
| `shipping_tax` | `{prefix}wc_order_operational_data.shipping_tax_amount` | `_order_shipping_tax` | [OrdersTableDataStore.php L532-L547](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L532-L547); CPT as above |
| `shipping_total` | `wc_order_operational_data.shipping_total_amount` | `_order_shipping` | same |
| `discount_total`, `discount_tax` | `wc_order_operational_data.discount_total_amount`, `discount_tax_amount` | `_cart_discount`, `_cart_discount_tax` | same |
| `prices_include_tax` | `wc_order_operational_data.prices_include_tax` | `_prices_include_tax` | same |

- The HPOS amount columns are `decimal(26,8)`
  ([OrdersTableDataStore.php L3462-L3468, L3511-L3528](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3511-L3528)).
- `total_tax` has no column or meta key of its own: setting `cart_tax` or `shipping_tax` sets it to their sum, rounded to
  price decimals with `NumberUtil::round()` (half up)
  ([abstract-wc-order.php L1039-L1066](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L1039-L1066)).
  The cart rounds its total tax with `wc_round_tax_total()` instead (tax rounding mode), so on a half-way value a
  tax-inclusive store's cart and order can show different total tax (example 1 in
  [worked-examples.md](worked-examples.md), rounding at subtotal).
- `total` is stored with `wc_format_decimal( $value, price decimals )`, and `discount_total`, `discount_tax`,
  `shipping_total`, `shipping_tax` and `cart_tax` without a decimal count
  ([abstract-wc-order.php L1006-L1088](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L1006-L1088)).

## Analytics copy: wc_order_tax_lookup

`{prefix}wc_order_tax_lookup` has one row per order and rate: `shipping_tax`, `order_tax` and `total_tax` as `double`
([class-wc-install.php L2064-L2074](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L2064-L2074)).
Analytics fills it from the order's tax lines (`tax_amount`, `shipping_tax_amount` and their sum)
([Taxes DataStore.php L270-L315](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Admin/API/Reports/Taxes/DataStore.php#L270-L315)).
It is a copy for reports: a gap between it and the order means the import is behind or stale, not a rounding step.
Store-wide tax reporting from Analytics is the job of WooCommerce's own `tax-reconciliation` skill
([evidence.md](evidence.md#related-skills-and-how-this-one-differs)); this skill works on one order.

## Reading one order without WP-CLI's eval (read-only SQL)

Prefer `scripts/export-order.sh`, which reads through WooCommerce's own getters. Where only SQL is allowed, these SELECTs
read the same values (replace `{prefix}` with the table prefix from `wp db prefix` and `1234` with the order ID; run them
with `wp db query` or a read-only database user):

```sql
-- Lines and their tax meta (both storages).
SELECT i.order_item_id, i.order_item_type, m.meta_key, m.meta_value
FROM {prefix}woocommerce_order_items i
JOIN {prefix}woocommerce_order_itemmeta m ON m.order_item_id = i.order_item_id
WHERE i.order_id = 1234
  AND m.meta_key IN ('_qty', '_tax_class', '_line_subtotal', '_line_subtotal_tax', '_line_total', '_line_tax',
                     '_line_tax_data', 'cost', 'total_tax', 'taxes', 'method_id', '_fee_amount', '_tax_status',
                     'rate_id', 'compound', 'tax_amount', 'shipping_tax_amount', 'rate_percent',
                     'discount_amount', 'discount_amount_tax')
ORDER BY i.order_item_id, m.meta_key;

-- Order totals, HPOS.
SELECT o.id, o.currency, o.total_amount, o.tax_amount AS cart_tax, d.shipping_total_amount, d.shipping_tax_amount,
       d.discount_total_amount, d.discount_tax_amount, d.prices_include_tax
FROM {prefix}wc_orders o
LEFT JOIN {prefix}wc_order_operational_data d ON d.order_id = o.id
WHERE o.id = 1234;

-- Order totals, posts storage.
SELECT meta_key, meta_value FROM {prefix}postmeta
WHERE post_id = 1234
  AND meta_key IN ('_order_currency', '_order_total', '_order_tax', '_order_shipping', '_order_shipping_tax',
                   '_cart_discount', '_cart_discount_tax', '_prices_include_tax');
```

`wp db query` runs a query through the MySQL client ([db query](https://developer.wordpress.org/cli/commands/db/query/)).
The output holds no customer data, but it is still store data: keep it out of chats and tickets.
