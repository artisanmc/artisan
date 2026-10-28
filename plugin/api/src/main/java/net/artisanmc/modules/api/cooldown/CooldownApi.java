package net.artisanmc.modules.api.cooldown;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.artisanmc.modules.api.annotations.Beta;

/**
 * Per-player cooldowns ({@code api.getCooldowns()}, API 2.16.0): the store behind a menu's and a
 * command's {@code cooldown} and the {@code cooldown_passed} condition. Kept in the suite database
 * ({@code artisan_cooldowns}), so a cooldown survives a restart and follows its player across the
 * servers of a network. A read never waits for the database: it answers from memory, which is
 * filled when the player joins.
 *
 * <p>Ids share one namespace with the project's own {@code cooldown_id}s: a module prefixes its
 * own ({@code triggers:<project>/<id>}).
 */
@Beta
public interface CooldownApi {
    /** Whether {@code player}'s cooldown {@code id} is still running. */
    boolean isActive(String id, UUID player);

    /** Starts (or restarts) {@code player}'s cooldown {@code id} for {@code seconds}. */
    void start(String id, UUID player, long seconds);

    /** Memory only, for tests and partial wiring. */
    static CooldownApi inMemory() {
        Map<String, Long> expiries = new ConcurrentHashMap<>();
        return new CooldownApi() {
            @Override
            public boolean isActive(String id, UUID player) {
                Long expiry = expiries.get(id + "|" + player);
                return expiry != null && System.currentTimeMillis() < expiry;
            }

            @Override
            public void start(String id, UUID player, long seconds) {
                expiries.put(id + "|" + player, System.currentTimeMillis() + seconds * 1000L);
            }
        };
    }
}
