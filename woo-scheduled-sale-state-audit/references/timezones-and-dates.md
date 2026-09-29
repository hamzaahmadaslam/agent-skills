# Timezones, timestamps and the times a sale really starts and ends

Read this when a sale starts or ends at the wrong hour, a day early or late, or the dates in the editor look shifted.
WooCommerce links point at the 11.1.2 tag, WordPress links at the 7.1.2 tag, Action Scheduler links at the 4.0.0 tag.

## The stored value is UTC

- `_sale_price_dates_from` and `_sale_price_dates_to` hold Unix timestamps: the data store writes
  `$date->getTimestamp()`
  ([class-wc-product-data-store-cpt.php L764-L767](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L764-L767)).
  A timestamp names one instant, independent of any timezone.
- `WC_Data::set_date_prop()` turns input into that timestamp
  ([abstract-wc-data.php L974-L1009](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-data.php#L974-L1009)):
  - a number is taken as a UTC timestamp;
  - an ISO 8601 string with `Z` or a `+HH:MM` offset uses that offset;
  - any other string is read as a date and time in the site's timezone, through WordPress's `get_gmt_from_date()`,
    which parses it with `wp_timezone()` ([formatting.php L3741-L3749](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/formatting.php#L3741-L3749)).
- The setters say the same in their docblocks: "UTC timestamp, or ISO 8601 DateTime. If the DateTime string has no
  timezone or offset, WordPress site timezone will be assumed"
  ([abstract-wc-product.php L955-L971](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-product.php#L955-L971)).
- WordPress sets PHP's default timezone to UTC while it loads
  ([wp-settings.php L72-L73](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-settings.php#L72-L73)),
  so `strtotime()` of a string without a zone, as the REST `_gmt` fields use, reads it as UTC.

## The site timezone

- WordPress keeps it in two options: `timezone_string` (an IANA name such as `Europe/Lisbon`) or, when that is empty,
  `gmt_offset` (hours, for a "UTC+2" style setting). `wp_timezone_string()` returns the name, or the offset as
  `+HH:MM` ([functions.php L124-L141](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L124-L141)).
- When `timezone_string` is set, reading `gmt_offset` returns the offset of that zone right now, through the filter
  `pre_option_gmt_offset` ([default-filters.php L499](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-filters.php#L499);
  [wp_timezone_override_offset L6677-L6690](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L6677-L6690)).
  `wp option get gmt_offset` therefore shows today's offset, not a stored one.
- A named zone follows daylight saving time: a date is converted with the offset that applies on that date. A fixed
  offset never changes. A store in a zone with daylight saving time that is set to a fixed "UTC+1" has every sale
  boundary one hour off for part of the year, in site-clock terms.
- `wc_timezone_offset()` returns the offset of now, not of a given date
  ([wc-formatting-functions.php L847-L856](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L847-L856)).

## What the editor promises

- The classic product editor says: "The sale will start at 00:00:00 of "From" date and end at 23:59:59 of "To" date"
  ([html-product-data-general.php L98](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/meta-boxes/views/html-product-data-general.php#L98)).
- It saves the strings `Y-m-d 00:00:00` and `Y-m-d 23:59:59`, which `set_date_prop()` reads in the site timezone
  ([class-wc-meta-box-product-data.php L354-L371](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/meta-boxes/class-wc-meta-box-product-data.php#L354-L371)).
- It shows stored dates with `getOffsetTimestamp()` in the current site timezone, as `Y-m-d` only
  ([html-product-data-general.php L79-L83](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/meta-boxes/views/html-product-data-general.php#L79-L83)).
  The time of day is never shown in the editor.

## Consequences to check

| Situation | What happens | How to see it |
| --- | --- | --- |
| Site timezone changed after the sales were set | The stored instants stay; the editor now shows them in the new zone, and an end saved as 23:59:59 in the old zone falls at another hour, possibly on another date | End times in the SQL "UTC time of day" block, or `explain-sale-state.mjs`, which prints the site-clock time of each boundary |
| Sale dates written by the REST API in UTC, or by an importer or ERP with its own zone | Boundaries at hours other than 00:00:00 and 23:59:59 site time | Same |
| CSV import with a date-only end value | The sale ends at 00:00:00 site time of that date, a day earlier than the editor's 23:59:59 | `explain-sale-state.mjs` flags ends at 00:00:00 |
| Fixed-offset site timezone in a region with daylight saving time | Boundaries one hour off in the months the region is on the other offset | `wp option get timezone_string` is empty and `gmt_offset` is set |
| The owner reads the time in their own device's zone | Reports "an hour early" or "a day late" that are correct in site time | Compare with `wp eval 'echo wp_date( "Y-m-d H:i:s T" );'` |

## When the daily safety net runs

- WooCommerce schedules `woocommerce_scheduled_sales` as a daily Action Scheduler action, first at "00:00 tomorrow"
  moved by the site's `gmt_offset`
  ([class-woocommerce.php L1726-L1744](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L1726-L1744)).
  The offset is built with `absint()`, so the fractional part of an offset such as 5.5 or 5.75 is dropped (same
  lines).
- It is scheduled with the unique flag, and only when no pending action with that hook exists, so an action created
  at another time of day keeps that time. [Issue 63061](https://github.com/woocommerce/woocommerce/issues/63061)
  (open) reports sites whose daily action runs at 9:15 or 20:20;
  [PR 65797](https://github.com/woocommerce/woocommerce/pull/65797), which would have moved it back to midnight, was
  closed without merging.
- After a recurring action runs, Action Scheduler schedules the next one from the current time when the current time
  is past the scheduled time, plus the interval
  ([ActionScheduler_ActionFactory.php L228-L241](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_ActionFactory.php#L228-L241);
  [ActionScheduler_Abstract_Schedule.php L52-L59](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_Schedule.php#L52-L59);
  [ActionScheduler_IntervalSchedule.php L29-L32](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/schedules/ActionScheduler_IntervalSchedule.php#L29-L32)).
  A daily action that runs late moves later by that delay, day after day, and the interval is a fixed number of
  seconds, so it does not follow daylight saving time either.
- Action Scheduler stores both `scheduled_date_gmt` and `scheduled_date_local` (the local one in the site timezone at
  the time it was written)
  ([ActionScheduler_DBStore.php L95-L110](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L95-L110);
  [ActionScheduler_Store.php L320-L329](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Store.php#L320-L329)).
  The SQL block for the daily action prints the local time of day.
- Since 10.5.0 the per-product events fire at the exact boundary timestamps, so the daily time matters only for
  products without those events ([scheduled-events.md](scheduled-events.md)).

## REST API dates

`date_on_sale_from` and `date_on_sale_to` are returned in the site timezone and `date_on_sale_from_gmt` and
`date_on_sale_to_gmt` in UTC, all without an offset in the string
([class-wc-rest-products-v2-controller.php L893-L904](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-products-v2-controller.php#L893-L904);
[wc-rest-functions.php L26-L41](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-rest-functions.php#L26-L41)).
An integration that reads the non-GMT field as UTC shifts every boundary by the site's offset.
