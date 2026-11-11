package net.artisanmc.modules.api.schemas;

import net.artisanmc.modules.api.annotations.Stable;

@Stable
public class UnsupportedSchemaVersionException extends RuntimeException {
    public UnsupportedSchemaVersionException(String version) {
        super("No migration registered for schema version '" + version + "'");
    }
}
