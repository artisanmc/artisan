package net.artisanmc.modules.api.datasource;

import net.artisanmc.modules.api.annotations.Stable;

@Stable
public class DuplicateDataSourceException extends IllegalStateException {
    public DuplicateDataSourceException(String ref) {
        super("Data source '" + ref + "' is already registered");
    }
}
