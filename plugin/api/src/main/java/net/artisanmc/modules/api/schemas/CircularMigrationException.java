package net.artisanmc.modules.api.schemas;

import net.artisanmc.modules.api.annotations.Stable;

@Stable
public class CircularMigrationException extends IllegalStateException {
    public CircularMigrationException(String version) {
        super("Circular migration detected at schema version '" + version + "'");
    }
}
