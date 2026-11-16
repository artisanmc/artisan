package net.artisanmc.modules.api.stats;

import java.util.Map;
import java.util.UUID;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * The server's statistics ({@code api.getStats()}, ADR {@code stats-foundation}): a module declares
 * its {@link StatEvent}s once, then records occurrences. Recording never waits for the database and
 * never throws: it adds to a buffer in memory, written off the main thread every 30 seconds. A
 * record of an undeclared event, of an undeclared dimension, or with the wrong scope is dropped,
 * with one warning per event in the log. Safe from any thread.
 *
 * <pre>{@code
 * StatsApi stats = api.getStats();
 * stats.declare(StatEvent.builder("quests:completed").storage(StatStorage.BOTH)
 *     .dimensions("group", "quest").value("duration_seconds").build());
 * // Later, on each completion:
 * stats.record("quests:completed", player.getUniqueId(), Map.of("group", "daily", "quest", "mine_stone"), 412);
 * }</pre>
 */
@Beta
public interface StatsApi {
    /**
     * Declares {@code event}. Declaring it again with the same shape does nothing (a module reloaded).
     *
     * @throws IllegalArgumentException its namespace is Artisan's ({@code core}, {@code custom}),
     *     or it is already declared with another shape
     */
    void declare(StatEvent event);

    /** Whether {@code name} is declared. */
    boolean isDeclared(String name);

    /**
     * Records one occurrence of {@code event}.
     *
     * @param player the player it is about; null for a {@link StatScope#SERVER} event
     * @param dimensions a value per declared dimension; a missing one is recorded as {@code ""}
     * @param value what the declared value measures; 1 for an event that only counts
     * @param details kept with a raw row only (any cardinality: an id, a free text); ignored by buckets
     */
    void record(String event, @Nullable UUID player, Map<String, String> dimensions, double value, Map<String, String> details);

    /** One occurrence of a counting event about {@code player}. */
    default void record(String event, UUID player, Map<String, String> dimensions) {
        record(event, player, dimensions, 1.0, Map.of());
    }

    /** One occurrence about {@code player}, with its value. */
    default void record(String event, UUID player, Map<String, String> dimensions, double value) {
        record(event, player, dimensions, value, Map.of());
    }

    /** One occurrence (or one sample of a gauge) of a {@link StatScope#SERVER} event. */
    default void recordServer(String event, Map<String, String> dimensions, double value) {
        record(event, null, dimensions, value, Map.of());
    }

    /**
     * Declares a figure computed on demand, read by the module's statistics tab in the editor.
     * Declaring {@code id} again replaces its query (a module reloaded).
     *
     * @param id {@code <namespace>:<name>}, as an event's name
     * @param cacheSeconds how long an answer is served again for the same parameters, 0 to 3600
     * @throws IllegalArgumentException a malformed id, Artisan's namespace, or a cache time out of range
     */
    void declareQuery(String id, int cacheSeconds, StatQuery query);

    /** False when the admin turned statistics off ({@code stats.enabled: false}): records are dropped. */
    boolean isEnabled();

    /** Records nothing: statistics off, or not wired. */
    StatsApi NOOP = new StatsApi() {
        @Override
        public void declare(StatEvent event) {
        }

        @Override
        public boolean isDeclared(String name) {
            return false;
        }

        @Override
        public void declareQuery(String id, int cacheSeconds, StatQuery query) {
        }

        @Override
        public void record(String event, @Nullable UUID player, Map<String, String> dimensions, double value, Map<String, String> details) {
        }

        @Override
        public boolean isEnabled() {
            return false;
        }
    };
}
