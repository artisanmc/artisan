package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Beta;

/** Returned by the {@code MenuApi.on…} methods: {@link #cancel()} stops the listener. */
@Beta
@FunctionalInterface
public interface MenuSubscription {
    void cancel();
}
