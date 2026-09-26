# The object cache: alloptions, notoptions and persistent caches

Read this in steps 1 and 5, and before any change on a site with a persistent object cache. WordPress links point at
the 7.1.2 tag.

## The keys WordPress uses

All in the cache group `options`:

| Key | Holds | Source |
| --- | --- | --- |
| `alloptions` | One array: every autoloaded option name and its raw value | [option.php L600-L661](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L600-L661) |
| `notoptions` | One array of names known not to exist, so a missing option costs no query | [option.php L176-L219](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L176-L219) |
| `<option name>` | The raw value of one option that is not autoloaded, after its first read | [option.php L202-L211](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L202-L211) |

- `get_option()` looks in `alloptions` first, then `notoptions`, then the option's own key, then the database
  ([option.php L163-L219](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L163-L219)).
  Before 6.8 it read the option's own key before `notoptions`
  ([6.7.0 option.php](https://github.com/WordPress/wordpress-develop/blob/6.7.0/src/wp-includes/option.php)).
- An option taken out of the autoload set therefore costs one cache read, and on a cache miss one query, in each
  request that reads it. Switch off only options that most requests do not read.
- The `options` group is per site on multisite; `site-options` (network options) is global
  ([load.php L900-L929](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L900-L929)).

## Persistent or not

- The default object cache keeps data in memory for one request only
  ([WP_Object_Cache](https://developer.wordpress.org/reference/classes/wp_object_cache/)). Without a persistent
  cache, every request runs the autoload query.
- A drop-in at `wp-content/object-cache.php` that defines `wp_cache_init()` replaces it, and
  `wp_using_ext_object_cache()` then returns `true`
  ([load.php L860-L865, L810-L820](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L860-L865)).
  `wp cache type` names the implementation ([wp cache type](https://developer.wordpress.org/cli/commands/cache/type/)).
- With one, `alloptions` survives between requests: the whole array is fetched from the cache backend on every
  request, and every write to an autoloaded option writes the whole array back (next section).

## How writes keep the cache in step

| Change | What happens to the cache | Source |
| --- | --- | --- |
| `add_option()` | Autoloaded: the name is added to `alloptions`; otherwise the option's own key is set | [option.php L1147-L1163](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1147-L1163) |
| `update_option()` | `alloptions` is re-read from the cache (forced), changed and written back when the option is or becomes autoloaded; otherwise the option's own key is set and the name removed from `alloptions` | [option.php L968-L1005](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L968-L1005) |
| `delete_option()` | Removed from `alloptions` or its own key deleted; since 6.7 the name is also added to `notoptions` | [option.php L1231-L1251](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1231-L1251) |
| `wp_set_option_autoload_values()` and wrappers | To `on`: the options' own keys and the whole `alloptions` key are deleted. To `off` only: the names are removed from `alloptions` | [option.php L482-L502](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L482-L502) |
| `wp option set-autoload` (WP-CLI) | Writes the column with SQL, then puts the value back where the cache had it: an option that was in `alloptions` stays there, even after switching it off | [Option_Command.php L501-L547 at 2.8.4](https://github.com/wp-cli/entity-command/blob/v2.8.4/src/Option_Command.php#L501-L547), unchanged in [3.0.2](https://github.com/wp-cli/entity-command/blob/v3.0.2/src/Option_Command.php#L525-L571) |
| SQL (`UPDATE`, `DELETE`, `wp db import`) | Nothing: the cache keeps the old state until its keys are deleted or expire | |

After `wp option set-autoload <name> off` on a site with a persistent cache, delete `alloptions` so it is rebuilt
without the option; otherwise requests keep loading it from the cache. After any SQL change or import, delete
`alloptions`, `notoptions` and the option's own key. WordPress VIP gives the same advice for options changed directly
in the database ([Autoloaded options](https://docs.wpvip.com/wordpress-on-vip/autoloaded-options/)).

## Size limits for the alloptions entry

- Memcached stores items up to 1 MB (1,048,576 bytes) by default (`-I` or `--max-item-size`, default `1m`)
  ([memcached.1 at 1.6.45](https://github.com/memcached/memcached/blob/1.6.45/doc/memcached.1#L141-L143),
  [memcached.c L240](https://github.com/memcached/memcached/blob/1.6.45/memcached.c#L240)). Whether a larger
  `alloptions` array fits depends on the drop-in (serializer, compression) and the server setting.
- On WordPress VIP every Memcached object is limited to 1 MB compressed and the limit is enforced for `alloptions`.
  VIP reports that performance degrades as `alloptions` nears that size, and that a site blocked for it returns HTTP
  503 with "Error 1024 (alloptions)" until the cause is fixed
  ([Autoloaded options](https://docs.wpvip.com/wordpress-on-vip/autoloaded-options/)).
- What core does when the cache will not store the array: `wp_cache_add( 'alloptions', ... )` fails, the next
  request finds no key, and the autoload query runs again, on every request
  ([option.php L619-L650](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L619-L650)).
  How the failure is reported depends on the drop-in; check its log or statistics.
- The state helper prints `strlen( serialize( $alloptions ) )` as an estimate of the stored size and adds a note from
  900,000 bytes, near the 1 MB limits above. Other backends have their own limits; read the drop-in's documentation.

## Frequent writes and lost updates

- Every save of an autoloaded option rewrites the whole `alloptions` entry: read it from the cache, change one
  name, write it back ([option.php L975-L1004](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L975-L1004)).
  When two requests save different autoloaded options at the same moment, the second write can put back an array
  without the first change. The database is right; the cache serves the old value until `alloptions` is rebuilt.
- The 6.4 dev note names autoloading too many options as a common cause of slow responses and of bugs with a
  persistent object cache
  ([New option functions in 6.4](https://make.wordpress.org/core/2023/10/17/new-option-functions-in-6-4/)); VIP
  advises `autoload = no` for options that are large, rarely used or changed often
  ([Autoloaded options](https://docs.wpvip.com/wordpress-on-vip/autoloaded-options/)).
- Options that change on many requests (counters, timestamps, logs, queues) are the first to take out of the
  autoload set on a cached site.

## Clearing keys (changes)

- `wp cache delete alloptions options`, `wp cache delete notoptions options` and `wp cache delete <name> options`,
  with `--url=<site>` on multisite. The command fails with "The object was not deleted." when the key is not there,
  which is harmless ([Cache_Command.php L111-L142 at 2.2.0](https://github.com/wp-cli/cache-command/blob/v2.2.0/src/Cache_Command.php#L111-L142)).
- Do not run `wp cache flush` on production for this: it empties the whole cache, and on multisite usually every
  site's cache; WP-CLI's own help warns about the performance impact
  ([Cache_Command.php L144-L172 at 2.2.0](https://github.com/wp-cli/cache-command/blob/v2.2.0/src/Cache_Command.php#L144-L172)).
- `wp cache flush-group options` works only when the drop-in supports group flushing
  ([Cache_Command.php L384-L411 at 2.2.0](https://github.com/wp-cli/cache-command/blob/v2.2.0/src/Cache_Command.php#L384-L411));
  deleting the three keys above is narrower.

## Transients with a persistent cache

- `set_transient()`, `get_transient()` and `delete_transient()` use the cache group `transient` and never touch the
  table while a persistent cache is in use
  ([option.php L1393-L1394, L1455, L1541-L1542](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1541-L1542)).
  `_transient_*` rows written before the cache was added stay in the table, are never read, and the autoloaded ones
  are still loaded into `alloptions` on every request.
- For those rows `wp transient delete <name>` does not help, because it calls `delete_transient()`, which then deletes
  only the cache entry ([Transient_Command.php L180-L211 at 2.2.0](https://github.com/wp-cli/cache-command/blob/v2.2.0/src/Transient_Command.php#L180-L211)).
  Delete the rows with `wp option delete _transient_<name> _transient_timeout_<name>` instead (a change, with its
  export: `changes-and-rollback.md`).
- `delete_expired_transients()` does nothing while a persistent cache is in use
  ([option.php L1638-L1643](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1638-L1643)).
  `wp transient delete --expired` deletes expired rows from the table with its own SQL and warns that transients in
  the cache are untouched ([Transient_Command.php L611-L684 at 2.2.0](https://github.com/wp-cli/cache-command/blob/v2.2.0/src/Transient_Command.php#L611-L684)).
