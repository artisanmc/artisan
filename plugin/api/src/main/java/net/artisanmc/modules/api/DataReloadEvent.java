package net.artisanmc.modules.api;

import java.util.Objects;
import net.artisanmc.modules.api.annotations.Stable;

/**
 * A module signals that its data source needs to be re-fetched by consumers.
 * Artisan neither publishes nor consumes it (menus re-fetch on every render):
 * it is for add-ons that cache another add-on's rows.
 */
@Stable
public final class DataReloadEvent implements ModuleEvent {
    private final String dataSourceRef;

    public DataReloadEvent(String dataSourceRef) {
        this.dataSourceRef = Objects.requireNonNull(dataSourceRef, "dataSourceRef");
    }

    public String getDataSourceRef() {
        return dataSourceRef;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof DataReloadEvent other && dataSourceRef.equals(other.dataSourceRef);
    }

    @Override
    public int hashCode() {
        return dataSourceRef.hashCode();
    }

    @Override
    public String toString() {
        return "DataReloadEvent(dataSourceRef=" + dataSourceRef + ")";
    }
}
