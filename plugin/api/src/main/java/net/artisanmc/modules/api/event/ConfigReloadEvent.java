package net.artisanmc.modules.api.event;

import java.util.Objects;
import net.artisanmc.modules.api.annotations.Stable;

/** A module's config was hot-reloaded; consumers should refresh references. */
@Stable
public final class ConfigReloadEvent implements ModuleEvent {
    private final String moduleId;

    public ConfigReloadEvent(String moduleId) {
        this.moduleId = Objects.requireNonNull(moduleId, "moduleId");
    }

    public String getModuleId() {
        return moduleId;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof ConfigReloadEvent other && moduleId.equals(other.moduleId);
    }

    @Override
    public int hashCode() {
        return moduleId.hashCode();
    }

    @Override
    public String toString() {
        return "ConfigReloadEvent(moduleId=" + moduleId + ")";
    }
}
