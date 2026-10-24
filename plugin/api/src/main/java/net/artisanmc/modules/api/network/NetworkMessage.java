package net.artisanmc.modules.api.network;

import net.artisanmc.modules.api.annotations.Beta;

import java.util.Objects;

/** A message received on a channel: who sent it, and its payload as published. */
@Beta
public final class NetworkMessage {
    private final String channel;
    private final String sourceServer;
    private final String payload;

    public NetworkMessage(String channel, String sourceServer, String payload) {
        this.channel = Objects.requireNonNull(channel, "channel");
        this.sourceServer = Objects.requireNonNull(sourceServer, "sourceServer");
        this.payload = Objects.requireNonNull(payload, "payload");
    }

    public String getChannel() { return channel; }

    /** The name of the server that published it. */
    public String getSourceServer() { return sourceServer; }

    public String getPayload() { return payload; }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof NetworkMessage m)) return false;
        return channel.equals(m.channel) && sourceServer.equals(m.sourceServer) && payload.equals(m.payload);
    }

    @Override
    public int hashCode() { return Objects.hash(channel, sourceServer, payload); }

    @Override
    public String toString() { return "NetworkMessage(" + channel + " from " + sourceServer + ")"; }
}
