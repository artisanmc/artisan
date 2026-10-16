package net.artisanmc.modules.api.datasource;

import net.artisanmc.modules.api.annotations.Stable;

@Stable
public class UnknownDataSourceException extends RuntimeException {
    public UnknownDataSourceException(String ref) {
        super("No data source registered with ref '" + ref + "'");
    }
}
