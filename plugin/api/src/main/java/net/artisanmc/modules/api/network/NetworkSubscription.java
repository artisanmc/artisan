package net.artisanmc.modules.api.network;

import net.artisanmc.modules.api.annotations.Beta;

/** Returned by {@link NetworkApi#subscribe}: {@link #cancel()} stops the handler. */
@Beta
@FunctionalInterface
public interface NetworkSubscription {
    void cancel();
}
