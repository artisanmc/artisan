package net.artisanmc.modules.api.network;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * The servers of a network and what crosses between them ({@code api.getNetwork()}): messages on
 * named channels, the players online on every server, teleports to another server. A network is
 * the servers that share the suite's MySQL/MariaDB database (ADR {@code peer-servers}); on H2,
 * or alone, a server is a network of one and every call still works for it.
 *
 * <p>Server names are the {@code name} of {@code environment.yml}, which must be the server's
 * name in {@code velocity.toml}.
 *
 * @since 2.13.0
 */
@Beta
public interface NetworkApi {

    /** Inert default (tests / partial wiring): a server alone, named "". */
    NetworkApi NOOP = new NetworkApi() {
        @Override
        public String getServerName() {
            return "";
        }

        @Override
        public List<NetworkServer> getServers() {
            return List.of();
        }

        @Override
        public NetworkSubscription subscribe(Plugin owner, String channel, NetworkMessageHandler handler) {
            return () -> { };
        }

        @Override
        public void publish(String channel, String payload, boolean includeSelf) {
        }

        @Override
        public NetworkPresence getPresence() {
            return NetworkPresence.NOOP;
        }

        @Override
        public CompletableFuture<TeleportResult> teleport(Player player, NetworkLocation location, int delaySeconds) {
            return CompletableFuture.completedFuture(TeleportResult.FAILED);
        }

        @Override
        public CompletableFuture<TeleportResult> connect(Player player, String server, int delaySeconds) {
            return CompletableFuture.completedFuture(TeleportResult.FAILED);
        }
    };

    /** This server's name in the network; "" until Artisan knows it (invalid {@code name}). */
    String getServerName();

    /** The servers running now, this one included, by name. Empty on H2. */
    List<NetworkServer> getServers();

    /**
     * Calls {@code handler} for each message published on {@code channel} by another server (and
     * by this one with {@code includeSelf}), off the main thread, in the order they were published.
     * Released when {@code owner} disables. A handler that throws is logged; the others still run.
     *
     * @param channel {@code module:name}, e.g. {@code guilds:sync}
     * @throws IllegalArgumentException when the channel is not {@code module:name} (lower case, digits, {@code _})
     */
    NetworkSubscription subscribe(Plugin owner, String channel, NetworkMessageHandler handler);

    /** {@code publish(channel, payload, false)}: every other server. */
    default void publish(String channel, String payload) {
        publish(channel, payload, false);
    }

    /**
     * Sends {@code payload} to the subscribers of {@code channel} on the other servers, and on this
     * one too with {@code includeSelf}. Never blocks. A message is kept a minute: a server that
     * does not read it within that time never gets it. Payloads above 60 000 characters are refused.
     *
     * @throws IllegalArgumentException for an invalid channel or a payload too long
     */
    void publish(String channel, String payload, boolean includeSelf);

    /** The players online on every server of the network. */
    NetworkPresence getPresence();

    /**
     * Moves {@code player} to {@code location} after {@code delaySeconds}, cancelled if the player
     * moves in the meantime ({@link TeleportResult#MOVED}). On another server, the player is sent
     * there through the proxy ({@code BungeeCord} channel, which Velocity accepts by default) and
     * placed at the location on arrival. Completes once the player is placed here or sent away.
     */
    CompletableFuture<TeleportResult> teleport(Player player, NetworkLocation location, int delaySeconds);

    /** Sends {@code player} to {@code server} after {@code delaySeconds}, where the server spawns them. */
    CompletableFuture<TeleportResult> connect(Player player, String server, int delaySeconds);
}
