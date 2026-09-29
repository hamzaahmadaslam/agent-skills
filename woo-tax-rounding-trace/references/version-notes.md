# Versions this skill was written against, and what changed when

Read this for step 0, and whenever the store runs a release other than the ones below. The `@since` tags quoted are in
the WooCommerce 11.1.2 source at the lines linked.

## Pinned versions (checked 2026-09-29)

| Software | Version | Source |
| --- | --- | --- |
| WooCommerce | 11.1.2, released 2026-09-22 (11.2.0 was in beta) | [release](https://github.com/woocommerce/woocommerce/releases/tag/11.1.2); [releases](https://github.com/woocommerce/woocommerce/releases) |
| WordPress | 7.1.2 | [version check API](https://api.wordpress.org/core/version-check/1.7/); [wordpress-develop 7.1.2](https://github.com/WordPress/wordpress-develop/tree/7.1.2) |
| WooCommerce Stripe Gateway (only for the gateway example) | 11.0.0 | [11.0.0 tag](https://github.com/woocommerce/woocommerce-gateway-stripe/tree/11.0.0) |

## WooCommerce

| Since | Change that matters for rounding | Source |
| --- | --- | --- |
| 2.6.3 | `wc_get_rounding_precision()`: price decimals plus 2, at least `WC_ROUNDING_PRECISION` | [wc-core-functions.php L1878-L1899](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L1878-L1899) |
| 3.2.0 | `WC_Cart_Totals` and the "cents" helpers `wc_add_number_precision()` and `wc_remove_number_precision()` | [class-wc-cart-totals.php L23-L28](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L23-L28); [wc-core-functions.php L1902-L1936](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L1902-L1936) |
| 3.2.4 | `wc_get_tax_rounding_mode()` | [wc-core-functions.php L1861-L1875](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L1861-L1875) |
| 3.2.6 | `round_line_tax()` (rounding each line's tax to cents unless rounding at subtotal) and `wc_legacy_round_half_down()` | [trait-wc-item-totals.php L76-L89](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/traits/trait-wc-item-totals.php#L76-L89); [wc-formatting-functions.php L242-L263](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L242-L263) |
| 3.9.0 | The shared trait `WC_Item_Totals` (`get_rounded_items_total()`, `round_item_subtotal()`) used by cart and order | [trait-wc-item-totals.php L15-L74](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/traits/trait-wc-item-totals.php#L15-L74) |
| 8.8.0 | Filter `woocommerce_internal_rounding_precision` | [wc-core-functions.php L1890-L1898](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L1890-L1898) |
| 10.5.0 | Filter `woocommerce_shipping_tax_class`; order item `set_taxes()` accepts legacy scalar tax values and logs a warning | [class-wc-tax.php L606-L623](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-tax.php#L606-L623); [class-wc-order-item-product.php L168-L212](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order-item-product.php#L168-L212) |
| 10.6.0 | Filter `woocommerce_shipping_prices_include_tax` (shipping costs entered with tax), used when a shipping rate is created, not in order recalculation | [class-wc-tax.php L86-L101](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-tax.php#L86-L101); [abstract-wc-shipping-method.php L315-L343](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-shipping-method.php#L315-L343) |

Public reports cited in this skill were made on older releases: #25720 on 3.9.2, #58938 on 9.9.4
([evidence.md](evidence.md)). The references describe 11.1.2; before applying a finding to an older store, open the
same file at the store's tag (replace `11.1.2` in the link) and compare the function.

## PHP

| Version | Change | Source |
| --- | --- | --- |
| 8.4.0 | `round()` gains four rounding modes and throws `ValueError` for an invalid mode (before 8.4.0 an invalid mode fell back to half up) | [PHP round()](https://www.php.net/manual/en/function.round.php) |

A source comment in `wc_add_number_precision()` says its fallback to the standard rounding precision covers rounding
changes in PHP 8.4
([wc-core-functions.php L1915](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L1915)).
When a half-way value decides the result, confirm it on staging with the store's PHP version.

## What to re-check first at the quarterly review

The functions in [rounding-functions.md](rounding-functions.md), `WC_Cart_Totals`, `calculate_totals()`,
`calculate_taxes()`, `update_taxes()` and the item `set_taxes()` methods, the REST order formatting, the refund form script
and `refund_line_items()`, the Store API order controller, and the states of issues #58938, #64668 and pull request #65732. If a function changed, update the reference, the helper,
the example outputs and [worked-examples.md](worked-examples.md) together.
