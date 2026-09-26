<?php
/**
 * Read-only helper for `wp eval-file`. Prints the WP-Cron and Action Scheduler setup of one WordPress site: versions,
 * cron constants, the WP-Cron lock, custom cron storage, registered schedules, every scheduled event grouped by hook
 * (late and failed counts by Site Health's thresholds, duplicates, unknown schedules, hooks without callbacks), and
 * Action Scheduler's version, runner, effective tuning values and housekeeping actions.
 *
 * It only reads. It reads the `cron` option directly (it does not call _get_cron_array(), which can rewrite an old
 * cron array), creates no Site Health object (its constructor schedules an event), and calls no schedule, update,
 * delete or run function. It applies Action Scheduler's tuning filters to print their effective values, as Action
 * Scheduler itself does on every run. It prints hook names, counts and times, never event or action arguments.
 * Loading WordPress runs the site's own code, as any request does; cron-readonly-report.sh stops that load from
 * spawning wp-cron.php.
 *
 * Usage (from the WordPress root, or with --path=...):
 *   wp eval-file cron-state.php
 *   wp eval-file cron-state.php --url=example.com/shop      # one site of a multisite network
 *
 * WP-CLI loads WordPress without a front-end request, so a plugin that adds its cron callbacks only during cron,
 * Ajax or front-end requests shows here as "no callback": confirm before treating such an event as orphaned.
 *
 * Sources for every rule used here: references/wp-cron-internals.md and references/action-scheduler-internals.md
 * (WordPress 7.1.2, Action Scheduler 4.0.0 and 4.2.0).
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

$wcah_now = time();

$wcah_line = static function ( $label, $value ) {
	if ( is_bool( $value ) ) {
		$value = $value ? 'yes' : 'no';
	} elseif ( null === $value || '' === $value ) {
		$value = '(not set)';
	} elseif ( ! is_scalar( $value ) ) {
		$value = wp_json_encode( $value );
	}
	printf( "%-58s %s\n", $label . ':', $value );
};

$wcah_section = static function ( $title ) {
	printf( "\n== %s ==\n", $title );
};

// Seconds as a short text: 95 -> "1m 35s", 90000 -> "1d 1h".
$wcah_span = static function ( $seconds ) {
	$seconds = (int) round( abs( $seconds ) );
	if ( $seconds < 60 ) {
		return $seconds . 's';
	}
	if ( $seconds < 3600 ) {
		return floor( $seconds / 60 ) . 'm ' . ( $seconds % 60 ) . 's';
	}
	if ( $seconds < 86400 ) {
		return floor( $seconds / 3600 ) . 'h ' . floor( ( $seconds % 3600 ) / 60 ) . 'm';
	}
	return floor( $seconds / 86400 ) . 'd ' . floor( ( $seconds % 86400 ) / 3600 ) . 'h';
};

// Name the plugin, theme or core file that a path belongs to.
$wcah_component = static function ( $file ) {
	if ( ! $file ) {
		return 'unknown';
	}
	$file = wp_normalize_path( $file );
	$dirs = array(
		'mu-plugin' => defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : '',
		'plugin'    => defined( 'WP_PLUGIN_DIR' ) ? WP_PLUGIN_DIR : '',
		'theme'     => get_theme_root(),
	);
	foreach ( $dirs as $type => $dir ) {
		$dir = trailingslashit( wp_normalize_path( (string) $dir ) );
		if ( '/' !== $dir && 0 === strpos( $file, $dir ) ) {
			$first = strtok( substr( $file, strlen( $dir ) ), '/' );
			return $type . ' ' . $first;
		}
	}
	$root = trailingslashit( wp_normalize_path( ABSPATH ) );
	if ( 0 === strpos( $file, $root . 'wp-includes/' ) || 0 === strpos( $file, $root . 'wp-admin/' ) ) {
		return 'wordpress';
	}
	$content = trailingslashit( wp_normalize_path( WP_CONTENT_DIR ) );
	if ( 0 === strpos( $file, $content ) ) {
		return 'wp-content ' . strtok( substr( $file, strlen( $content ) ), '/' );
	}
	return 'other';
};

// Describe one callback: its name and the component that defines it.
$wcah_callback = static function ( $callback ) use ( $wcah_component ) {
	try {
		if ( is_string( $callback ) && false !== strpos( $callback, '::' ) ) {
			$callback = explode( '::', $callback, 2 );
		}
		if ( is_array( $callback ) && 2 === count( $callback ) ) {
			$class = is_object( $callback[0] ) ? get_class( $callback[0] ) : (string) $callback[0];
			$ref   = new ReflectionMethod( $class, (string) $callback[1] );
			$label = $class . '::' . $callback[1];
		} elseif ( $callback instanceof Closure || is_string( $callback ) ) {
			$ref   = new ReflectionFunction( $callback );
			$label = $callback instanceof Closure ? 'closure' : $callback;
		} elseif ( is_object( $callback ) && method_exists( $callback, '__invoke' ) ) {
			$ref   = new ReflectionMethod( $callback, '__invoke' );
			$label = get_class( $callback ) . '::__invoke';
		} else {
			return 'callable (unknown)';
		}
		return $label . ' [' . $wcah_component( (string) $ref->getFileName() ) . ']';
	} catch ( Throwable $e ) {
		return 'callable (unresolved)';
	}
};

// All callbacks on a hook, as "priority label [component]" strings.
$wcah_callbacks_on = static function ( $hook ) use ( $wcah_callback ) {
	global $wp_filter;
	$out = array();
	if ( empty( $wp_filter[ $hook ] ) || ! $wp_filter[ $hook ] instanceof WP_Hook ) {
		return $out;
	}
	foreach ( $wp_filter[ $hook ]->callbacks as $priority => $items ) {
		foreach ( $items as $item ) {
			$out[] = $priority . ' ' . $wcah_callback( $item['function'] );
		}
	}
	return $out;
};

// Versions.
$wcah_section( 'Versions' );
$wcah_line( 'WordPress', get_bloginfo( 'version' ) );
$wcah_line( 'PHP (this WP-CLI process; the web server may differ)', PHP_VERSION );
$wcah_line( 'WP-CLI', defined( 'WP_CLI_VERSION' ) ? WP_CLI_VERSION : null );
if ( class_exists( 'Cron_Event_Command' ) && method_exists( 'Cron_Event_Command', 'run' ) ) {
	try {
		$wcah_doc = (string) ( new ReflectionMethod( 'Cron_Event_Command', 'run' ) )->getDocComment();
		$wcah_line( 'cron-command respects the lock, has --network (2.3.5+)', false !== strpos( $wcah_doc, '[--network]' ) );
	} catch ( Throwable $e ) {
		$wcah_line( 'cron-command respects the lock, has --network (2.3.5+)', 'unknown' );
	}
}
$wcah_line( 'Action Scheduler (active copy)', class_exists( 'ActionScheduler_Versions' ) ? ActionScheduler_Versions::instance()->latest_version() : 'not loaded' );
$wcah_line( 'WooCommerce', defined( 'WC_VERSION' ) ? WC_VERSION : 'not active' );
$wcah_line( 'Multisite', is_multisite() );
if ( is_multisite() ) {
	$wcah_line( 'This site (run once per site with --url)', home_url() );
}
$wcah_line( 'Persistent object cache', wp_using_ext_object_cache() );

// Constants.
$wcah_section( 'Cron constants (runtime values)' );
foreach ( array( 'DISABLE_WP_CRON', 'ALTERNATE_WP_CRON', 'WP_CRON_LOCK_TIMEOUT', 'DOING_CRON' ) as $wcah_constant ) {
	$wcah_line( $wcah_constant, defined( $wcah_constant ) ? var_export( constant( $wcah_constant ), true ) : '(not defined)' );
}
$wcah_disabled = defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON;
// Site Health's thresholds, class-wp-site-health.php L43-L49 (WordPress 7.1.2).
$wcah_late_after   = $wcah_disabled ? 15 * MINUTE_IN_SECONDS : 0;
$wcah_failed_after = $wcah_disabled ? HOUR_IN_SECONDS : 5 * MINUTE_IN_SECONDS;
$wcah_line( 'Site Health "late" / "failed" thresholds', 'late after ' . $wcah_span( $wcah_late_after ) . ', failed after ' . $wcah_span( $wcah_failed_after ) );

// Lock. Read like wp-cron.php's _get_cron_lock(): get_transient() would delete an expired transient, which is a write.
$wcah_section( 'WP-Cron lock (doing_cron transient)' );
global $wpdb;
if ( wp_using_ext_object_cache() ) {
	$wcah_lock = wp_cache_get( 'doing_cron', 'transient', true );
} else {
	$wcah_lock = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s LIMIT 1", '_transient_doing_cron' ) );
}
if ( false === $wcah_lock || null === $wcah_lock || '' === $wcah_lock ) {
	$wcah_line( 'doing_cron', 'not set' );
} else {
	$wcah_lock_age = microtime( true ) - (float) $wcah_lock;
	$wcah_timeout  = defined( 'WP_CRON_LOCK_TIMEOUT' ) ? (int) WP_CRON_LOCK_TIMEOUT : 60;
	if ( $wcah_lock_age < -10 * MINUTE_IN_SECONDS ) {
		$state = 'more than 10 minutes in the future: page-view spawns ignore it, but a server job (wp-cron.php, cron-command 2.3.5+) waits until it passes';
	} elseif ( $wcah_lock_age < $wcah_timeout ) {
		$state = 'held: a run started ' . $wcah_span( $wcah_lock_age ) . ' ago, or is starting';
	} else {
		$state = 'expired (' . $wcah_span( $wcah_lock_age ) . ' old): the next run may take it';
	}
	$wcah_line( 'doing_cron', $state );
}

// Custom storage and request filters.
$wcah_section( 'Callbacks that change how WP-Cron stores or starts events (none is normal)' );
$wcah_filters = array( 'pre_schedule_event', 'pre_reschedule_event', 'pre_unschedule_event', 'pre_clear_scheduled_hook', 'pre_unschedule_hook', 'pre_get_scheduled_event', 'pre_get_ready_cron_jobs', 'schedule_event', 'cron_request', 'pre_option_cron', 'pre_update_option_cron' );
$wcah_any     = false;
foreach ( $wcah_filters as $wcah_filter ) {
	foreach ( $wcah_callbacks_on( $wcah_filter ) as $wcah_cb ) {
		printf( "%-26s %s\n", $wcah_filter, $wcah_cb );
		$wcah_any = true;
	}
}
if ( ! $wcah_any ) {
	echo "(none)\n";
} else {
	echo "With pre_* callbacks another system stores the events; the counts below read only the cron option.\n";
}

// Schedules.
$wcah_section( 'Registered schedules' );
$wcah_schedules = wp_get_schedules();
$wcah_core      = array( 'hourly', 'twicedaily', 'daily', 'weekly' );
uasort(
	$wcah_schedules,
	static function ( $a, $b ) {
		return (int) $a['interval'] - (int) $b['interval'];
	}
);
foreach ( $wcah_schedules as $wcah_name => $wcah_schedule ) {
	printf( "%-30s %8d s  %s\n", $wcah_name, (int) $wcah_schedule['interval'], in_array( $wcah_name, $wcah_core, true ) ? 'core' : 'added by a plugin' );
}

// Events.
$wcah_section( 'WP-Cron events (cron option)' );
$wcah_raw = get_option( 'cron' );
if ( ! is_array( $wcah_raw ) ) {
	echo "The cron option is empty or not an array.\n";
	$wcah_raw = array();
}
$wcah_line( 'Stored size of the cron option (bytes)', strlen( maybe_serialize( $wcah_raw ) ) );
if ( ! isset( $wcah_raw['version'] ) && $wcah_raw ) {
	echo "The cron array has no version key (old format). WordPress rewrites it in the current format the next time it reads it through _get_cron_array().\n";
}

$wcah_hooks = array();
$wcah_total = 0;
$wcah_due   = 0;
$wcah_late  = 0;
$wcah_fail  = 0;
$wcah_bad   = 0;
$wcah_worst = null;
foreach ( $wcah_raw as $wcah_time => $wcah_cronhooks ) {
	if ( 'version' === $wcah_time ) {
		continue;
	}
	if ( ! is_numeric( $wcah_time ) || ! is_array( $wcah_cronhooks ) ) {
		++$wcah_bad;
		continue;
	}
	$wcah_time = (int) $wcah_time;
	foreach ( $wcah_cronhooks as $wcah_hook => $wcah_events ) {
		if ( ! is_array( $wcah_events ) ) {
			continue;
		}
		if ( ! isset( $wcah_hooks[ $wcah_hook ] ) ) {
			$wcah_hooks[ $wcah_hook ] = array(
				'events'    => 0,
				'sigs'      => array(),
				'repeats'   => 0,
				'schedules' => array(),
				'unknown'   => 0,
				'next'      => PHP_INT_MAX,
				'due'       => 0,
				'late'      => 0,
				'failed'    => 0,
			);
		}
		foreach ( $wcah_events as $wcah_sig => $wcah_event ) {
			$h = &$wcah_hooks[ $wcah_hook ];
			++$h['events'];
			++$wcah_total;
			if ( isset( $h['sigs'][ $wcah_sig ] ) ) {
				++$h['repeats'];
			}
			$h['sigs'][ $wcah_sig ] = true;
			$wcah_schedule          = is_array( $wcah_event ) && isset( $wcah_event['schedule'] ) ? $wcah_event['schedule'] : false;
			$h['schedules'][ false === $wcah_schedule ? 'single' : (string) $wcah_schedule ] = true;
			if ( false !== $wcah_schedule && ! isset( $wcah_schedules[ $wcah_schedule ] ) ) {
				++$h['unknown'];
			}
			$h['next'] = min( $h['next'], $wcah_time );
			$wcah_offset = $wcah_now - $wcah_time;
			if ( $wcah_offset >= 0 ) {
				++$h['due'];
				++$wcah_due;
				if ( $wcah_offset > $wcah_failed_after ) {
					++$h['failed'];
					++$wcah_fail;
				} elseif ( $wcah_offset > $wcah_late_after ) {
					++$h['late'];
					++$wcah_late;
				}
				if ( null === $wcah_worst || $wcah_offset > $wcah_worst[1] ) {
					$wcah_worst = array( $wcah_hook, $wcah_offset );
				}
			}
			unset( $h );
		}
	}
}
$wcah_line( 'Events / distinct hooks', $wcah_total . ' / ' . count( $wcah_hooks ) );
$wcah_line( 'Due now (time passed)', $wcah_due );
$wcah_line( 'Late by Site Health threshold', $wcah_late );
$wcah_line( 'Failed by Site Health threshold', $wcah_fail );
$wcah_line( 'Most overdue event', null === $wcah_worst ? 'none' : $wcah_worst[0] . ', ' . $wcah_span( $wcah_worst[1] ) . ' past due' );
if ( $wcah_bad > 0 ) {
	$wcah_line( 'Entries with a non-numeric time (WP-CLI skips these too)', $wcah_bad );
}

// Per-hook table: flagged hooks first, then by event count.
$wcah_section( 'Events by hook (flags: DUP same arguments at several times, ARGS several argument sets, SCHED unknown schedule, NOCB no callback in this process, LATE, FAILED)' );
$wcah_rows = array();
foreach ( $wcah_hooks as $wcah_hook => $h ) {
	$flags = array();
	if ( $h['repeats'] > 0 ) {
		$flags[] = 'DUP';
	}
	if ( count( $h['sigs'] ) > 1 ) {
		$flags[] = 'ARGS';
	}
	if ( $h['unknown'] > 0 ) {
		$flags[] = 'SCHED';
	}
	if ( ! has_action( $wcah_hook ) ) {
		$flags[] = 'NOCB';
	}
	if ( $h['late'] > 0 ) {
		$flags[] = 'LATE';
	}
	if ( $h['failed'] > 0 ) {
		$flags[] = 'FAILED';
	}
	$next        = $h['next'] - $wcah_now;
	$wcah_rows[] = array(
		'flags'  => $flags,
		'weight' => count( $flags ) * 1000000 + $h['events'],
		'text'   => sprintf(
			"%-48s %6d %5d %-24s %-20s %s\n",
			strlen( $wcah_hook ) > 48 ? substr( $wcah_hook, 0, 45 ) . '...' : $wcah_hook,
			$h['events'],
			count( $h['sigs'] ),
			substr( implode( ',', array_keys( $h['schedules'] ) ), 0, 24 ),
			( $next <= 0 ? 'due ' . $wcah_span( $next ) . ' ago' : 'in ' . $wcah_span( $next ) ),
			implode( ' ', $flags )
		),
	);
}
usort(
	$wcah_rows,
	static function ( $a, $b ) {
		return $b['weight'] - $a['weight'];
	}
);
printf( "%-48s %6s %5s %-24s %-20s %s\n", 'hook', 'events', 'args', 'schedules', 'next', 'flags' );
$wcah_limit = 60;
foreach ( array_slice( $wcah_rows, 0, $wcah_limit ) as $wcah_row ) {
	echo $wcah_row['text'];
}
if ( count( $wcah_rows ) > $wcah_limit ) {
	printf( "(%d more hooks without more flags than those above)\n", count( $wcah_rows ) - $wcah_limit );
}

// Owners of flagged hooks, so the plugin behind a duplicate or orphan is named.
$wcah_section( 'Callbacks on flagged hooks (who runs them)' );
$wcah_named = 0;
foreach ( $wcah_hooks as $wcah_hook => $h ) {
	if ( $h['repeats'] > 0 || count( $h['sigs'] ) > 1 || $h['unknown'] > 0 || $h['failed'] > 0 ) {
		$cbs = $wcah_callbacks_on( $wcah_hook );
		printf( "%s: %s\n", $wcah_hook, $cbs ? implode( '; ', array_slice( $cbs, 0, 4 ) ) : 'no callback in this process' );
		if ( ++$wcah_named >= 30 ) {
			echo "(list cut at 30 hooks)\n";
			break;
		}
	}
}
if ( 0 === $wcah_named ) {
	echo "(no flagged hooks)\n";
}

// Action Scheduler.
$wcah_section( 'Action Scheduler' );
if ( ! class_exists( 'ActionScheduler' ) || ! function_exists( 'as_has_scheduled_action' ) ) {
	echo "Action Scheduler is not loaded on this site.\n";
	echo "\nDone. Nothing was changed.\n";
	return;
}
$wcah_runner = ActionScheduler::runner();
$wcah_line( 'Store class', get_class( ActionScheduler::store() ) );
$wcah_line( 'Runner class', get_class( $wcah_runner ) );
$wcah_line( 'Default runner hooked to action_scheduler_run_queue', false !== has_action( 'action_scheduler_run_queue', array( $wcah_runner, 'run' ) ) );
$wcah_extra = array_filter(
	$wcah_callbacks_on( 'action_scheduler_run_queue' ),
	static function ( $cb ) {
		return false === strpos( $cb, 'ActionScheduler_QueueRunner::run' );
	}
);
$wcah_line( 'Other callbacks on action_scheduler_run_queue', $wcah_extra ? implode( '; ', $wcah_extra ) : 'none' );
// wp_next_scheduled() reads through _get_cron_array(), which rewrites a cron array in the old format: skip it then.
if ( is_array( $wcah_raw ) && ! isset( $wcah_raw['version'] ) && $wcah_raw ) {
	$wcah_line( 'WP-Cron event action_scheduler_run_queue', 'not checked (the cron array has the old format)' );
} else {
	$wcah_next = wp_next_scheduled( 'action_scheduler_run_queue', array( 'WP Cron' ) );
	$wcah_line( 'WP-Cron event action_scheduler_run_queue', false === $wcah_next ? 'not scheduled' : ( $wcah_next <= $wcah_now ? 'due ' . $wcah_span( $wcah_now - $wcah_next ) . ' ago' : 'next in ' . $wcah_span( $wcah_next - $wcah_now ) ) );
}
try {
	$wcah_line( 'Open claims (batches running)', ActionScheduler::store()->get_claim_count() );
} catch ( Throwable $e ) {
	$wcah_line( 'Open claims (batches running)', 'could not read' );
}

$wcah_section( 'Action Scheduler effective settings (default in brackets; callbacks listed when a filter has any)' );
$wcah_time_limit = (int) apply_filters( 'action_scheduler_queue_runner_time_limit', 30 );
$wcah_settings   = array(
	array( 'action_scheduler_queue_runner_batch_size', 25, array( 25 ) ),
	array( 'action_scheduler_queue_runner_concurrent_batches', 1, array( 1 ) ),
	array( 'action_scheduler_queue_runner_time_limit', 30, array( 30 ) ),
	array( 'action_scheduler_timeout_period', 10 * $wcah_time_limit, array( 10 * $wcah_time_limit ) ),
	array( 'action_scheduler_failure_period', 10 * $wcah_time_limit, array( 10 * $wcah_time_limit ) ),
	array( 'action_scheduler_cleanup_batch_size', 20, array( 20 ) ),
	array( 'action_scheduler_retention_period', 31 * DAY_IN_SECONDS, array( 31 * DAY_IN_SECONDS ) ),
	array( 'action_scheduler_retention_period_for_failed', 93 * DAY_IN_SECONDS, array( 93 * DAY_IN_SECONDS ) ),
	array( 'action_scheduler_enable_failed_action_cleanup', true, array( true ) ),
	array( 'action_scheduler_default_cleaner_statuses', array( 'complete', 'canceled' ), array( array( 'complete', 'canceled' ) ) ),
	array( 'action_scheduler_allow_async_request_runner', true, array( true ) ),
	array( 'action_scheduler_async_request_sleep_seconds', 5, array( 5, null ) ),
	array( 'action_scheduler_lock_duration', 60, array( 60, 'async-request-runner' ) ),
	array( 'action_scheduler_run_schedule', 'every_minute', array( 'every_minute' ) ),
	array( 'action_scheduler_recurring_action_failure_threshold', 5, array( 5 ) ),
	array( 'action_scheduler_pastdue_actions_seconds', DAY_IN_SECONDS, array( DAY_IN_SECONDS ) ),
	array( 'action_scheduler_pastdue_actions_min', 1, array( 1 ) ),
);
foreach ( $wcah_settings as $wcah_setting ) {
	list( $wcah_filter, $wcah_default, $wcah_args ) = $wcah_setting;
	$wcah_cbs   = $wcah_callbacks_on( $wcah_filter );
	$wcah_value = $wcah_default;
	if ( $wcah_cbs ) {
		try {
			$wcah_value = apply_filters_ref_array( $wcah_filter, $wcah_args );
		} catch ( Throwable $e ) {
			$wcah_value = '(could not evaluate here)';
		}
	}
	$wcah_shown = is_array( $wcah_value ) ? implode( ',', $wcah_value ) : ( is_bool( $wcah_value ) ? ( $wcah_value ? 'true' : 'false' ) : (string) $wcah_value );
	$wcah_def   = is_array( $wcah_default ) ? implode( ',', $wcah_default ) : ( is_bool( $wcah_default ) ? ( $wcah_default ? 'true' : 'false' ) : (string) $wcah_default );
	$wcah_line( $wcah_filter, $wcah_shown . ' [' . $wcah_def . ']' . ( $wcah_cbs ? ' by ' . implode( '; ', $wcah_cbs ) : '' ) );
}
echo "The async runner also needs due actions and a free batch slot; this line shows only the filter.\n";

$wcah_section( 'Housekeeping and recurring actions (pending instance present?)' );
$wcah_recurring = array(
	'action_scheduler_run_recurring_actions_schedule_hook' => 'Action Scheduler 3.9.3+, daily',
	'action_scheduler_run_actions_cleanup_hook'            => 'Action Scheduler 4.0.0+, daily at 3 am',
);
if ( defined( 'WC_VERSION' ) ) {
	$wcah_recurring += array(
		'woocommerce_scheduled_sales'             => 'WooCommerce 10.1+, daily',
		'woocommerce_cleanup_sessions'            => 'WooCommerce 10.1+, every 12 hours',
		'woocommerce_cleanup_logs'                => 'WooCommerce 10.1+, daily',
		'woocommerce_cleanup_personal_data'       => 'WooCommerce 10.1+, daily',
		'woocommerce_geoip_updater'               => 'WooCommerce 10.1+, every 15 days',
		'woocommerce_cleanup_rate_limits_wrapper' => 'WooCommerce, daily',
		'wc_admin_daily_wrapper'                  => 'WooCommerce, daily',
	);
}
foreach ( $wcah_recurring as $wcah_hook => $wcah_note ) {
	try {
		$wcah_has = as_has_scheduled_action( $wcah_hook );
	} catch ( Throwable $e ) {
		$wcah_has = 'could not read';
	}
	$wcah_line( $wcah_hook . ' (' . $wcah_note . ')', $wcah_has );
}
echo "A missing instance is normal right after an install or update; plugins re-create them at the next daily check.\n";

echo "\nDone. Nothing was changed.\n";
