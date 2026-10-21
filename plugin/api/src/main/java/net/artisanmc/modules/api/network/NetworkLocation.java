package net.artisanmc.modules.api.network;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.Location;

import java.util.Objects;

/**
 * A position on a server of the network. The fields are those of MSCore's {@code SLocation}
 * ({@code server, world, x, y, z, pitch, yaw}): one stored as JSON reads as this class.
 */
@Beta
public final class NetworkLocation {
    private final String server;
    private final String world;
    private final double x;
    private final double y;
    private final double z;
    private final float yaw;
    private final float pitch;

    public NetworkLocation(String server, String world, double x, double y, double z, float yaw, float pitch) {
        this.server = Objects.requireNonNull(server, "server");
        this.world = Objects.requireNonNull(world, "world");
        this.x = x;
        this.y = y;
        this.z = z;
        this.yaw = yaw;
        this.pitch = pitch;
    }

    /** {@code location} on {@code server}. */
    public static NetworkLocation of(String server, Location location) {
        return new NetworkLocation(server, Objects.requireNonNull(location.getWorld(), "world").getName(),
                location.getX(), location.getY(), location.getZ(), location.getYaw(), location.getPitch());
    }

    public String getServer() { return server; }
    public String getWorld() { return world; }
    public double getX() { return x; }
    public double getY() { return y; }
    public double getZ() { return z; }
    public float getYaw() { return yaw; }
    public float getPitch() { return pitch; }

    @Override
    public boolean equals(Object o) {
        return o instanceof NetworkLocation l && server.equals(l.server) && world.equals(l.world)
                && x == l.x && y == l.y && z == l.z && yaw == l.yaw && pitch == l.pitch;
    }

    @Override
    public int hashCode() { return Objects.hash(server, world, x, y, z, yaw, pitch); }

    @Override
    public String toString() { return "NetworkLocation(" + server + ", " + world + ", " + x + ", " + y + ", " + z + ")"; }
}
