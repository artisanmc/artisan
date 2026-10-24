package net.artisanmc.modules.api.network;

import net.artisanmc.modules.api.annotations.Beta;

/** Receives the messages of a channel, off the main thread (see {@link NetworkApi#subscribe}). */
@Beta
@FunctionalInterface
public interface NetworkMessageHandler {
    void handle(NetworkMessage message);
}
