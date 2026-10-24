package net.artisanmc.modules.api.network;

import net.artisanmc.modules.api.annotations.Beta;

import java.util.Objects;

/** A server of the network, as {@link NetworkApi#getServers()} lists it. */
@Beta
public final class NetworkServer {
    private final String name;
    private final boolean self;

    public NetworkServer(String name, boolean self) {
        this.name = Objects.requireNonNull(name, "name");
        this.self = self;
    }

    /** Its name, as in {@code velocity.toml}. */
    public String getName() { return name; }

    /** True for the server this code runs on. */
    public boolean isSelf() { return self; }

    @Override
    public boolean equals(Object o) {
        return o instanceof NetworkServer s && name.equals(s.name) && self == s.self;
    }

    @Override
    public int hashCode() { return Objects.hash(name, self); }

    @Override
    public String toString() { return "NetworkServer(" + name + (self ? ", self" : "") + ")"; }
}
