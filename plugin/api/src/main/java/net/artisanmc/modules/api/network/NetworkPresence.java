package net.artisanmc.modules.api.network;

import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * The players online on every server of the network. Read from memory, any thread: a join or a
 * quit on another server shows here within a second. The players of this server are always exact.
 */
@Beta
public interface NetworkPresence {

    /** Inert default: nobody online. */
    NetworkPresence NOOP = new NetworkPresence() {
        @Override
        public @Nullable NetworkPlayer getPlayer(UUID id) {
            return null;
        }

        @Override
        public @Nullable NetworkPlayer find(String name) {
            return null;
        }

        @Override
        public Collection<NetworkPlayer> getOnline() {
            return List.of();
        }

        @Override
        public void sendMessage(UUID id, String miniMessage) {
        }
    };

    default boolean isOnline(UUID id) {
        return getPlayer(id) != null;
    }

    /** The player if online on any server, else null. */
    @Nullable NetworkPlayer getPlayer(UUID id);

    /** An online player by name, case ignored, else null. */
    @Nullable NetworkPlayer find(String name);

    /** Every player online on the network. */
    Collection<NetworkPlayer> getOnline();

    /**
     * Sends {@code miniMessage} to the player on whichever server they are (see {@code TextApi.send});
     * nothing when they are offline.
     */
    void sendMessage(UUID id, String miniMessage);
}
