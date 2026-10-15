package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.Location;
import org.bukkit.entity.Entity;

/**
 * Delays are in ticks (20 per second); 0 runs as soon as possible. Tasks cannot be
 * cancelled once scheduled: check your own state when they run.
 */
@Beta
public interface TaskScheduler {
    /** Runs every task at once on the calling thread. */
    TaskScheduler DIRECT = new TaskScheduler() {
        @Override
        public void runGlobal(Runnable task) {
            task.run();
        }

        @Override
        public void runGlobalLater(long delayTicks, Runnable task) {
            task.run();
        }

        @Override
        public void runAt(Location location, Runnable task) {
            task.run();
        }

        @Override
        public void runAtLater(Location location, long delayTicks, Runnable task) {
            task.run();
        }

        @Override
        public void runFor(Entity entity, Runnable task) {
            task.run();
        }

        @Override
        public void runForLater(Entity entity, long delayTicks, Runnable task) {
            task.run();
        }

        @Override
        public void runAsync(Runnable task) {
            task.run();
        }

        @Override
        public void runAsyncLater(long delayTicks, Runnable task) {
            task.run();
        }

        @Override
        public boolean isOwnedByCurrentThread(Entity entity) {
            return true;
        }

        @Override
        public boolean isGlobalThread() {
            return true;
        }
    };

    /** Server-wide state: console commands, worlds, the scoreboard. */
    void runGlobal(Runnable task);

    void runGlobalLater(long delayTicks, Runnable task);

    /** The region owning {@code location}: blocks and what stands there. */
    void runAt(Location location, Runnable task);

    void runAtLater(Location location, long delayTicks, Runnable task);

    /** The thread owning {@code entity} (a player: their region); skipped if it is removed first. */
    void runFor(Entity entity, Runnable task);

    void runForLater(Entity entity, long delayTicks, Runnable task);

    /** Off the game threads: I/O, SQL, HTTP. Never touch the world from here. */
    void runAsync(Runnable task);

    void runAsyncLater(long delayTicks, Runnable task);

    /** True if the calling thread may touch {@code entity} right now. */
    boolean isOwnedByCurrentThread(Entity entity);

    /** True on the global thread (Paper: the main thread). */
    boolean isGlobalThread();
}
