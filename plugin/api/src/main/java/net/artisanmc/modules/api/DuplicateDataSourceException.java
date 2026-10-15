package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;

@Stable
public class DuplicateDataSourceException extends IllegalStateException {
    public DuplicateDataSourceException(String ref) {
        super("Data source '" + ref + "' is already registered");
    }
}
