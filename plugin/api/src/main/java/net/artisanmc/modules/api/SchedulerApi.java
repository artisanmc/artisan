package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.plugin.Plugin;

/**
 * Artisan's scheduler ({@code api.scheduler}), the one it uses itself: right on Paper, Folia
 * and Leaf alike. On Paper every thread but async is the main thread.
 */
@Beta
public interface SchedulerApi {
    /** Runs every task at once on the calling thread (tests / partial wiring). */
    SchedulerApi DIRECT = owner -> TaskScheduler.DIRECT;

    /** Tasks belong to {@code owner}: the server cancels them when that plugin disables. */
    TaskScheduler forPlugin(Plugin owner);
}
