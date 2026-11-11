package net.artisanmc.modules.api.network;

import net.artisanmc.modules.api.annotations.Beta;

import java.util.Objects;
import java.util.UUID;

/** A player online somewhere on the network. */
@Beta
public final class NetworkPlayer {
    private final UUID id;
    private final String name;
    private final String server;

    public NetworkPlayer(UUID id, String name, String server) {
        this.id = Objects.requireNonNull(id, "id");
        this.name = Objects.requireNonNull(name, "name");
        this.server = Objects.requireNonNull(server, "server");
    }

    public UUID getId() { return id; }

    public String getName() { return name; }

    /** The name of the server the player is on. */
    public String getServer() { return server; }

    @Override
    public boolean equals(Object o) {
        return o instanceof NetworkPlayer p && id.equals(p.id) && name.equals(p.name) && server.equals(p.server);
    }

    @Override
    public int hashCode() { return Objects.hash(id, name, server); }

    @Override
    public String toString() { return "NetworkPlayer(" + name + " on " + server + ")"; }
}
