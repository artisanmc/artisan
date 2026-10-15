package net.artisanmc.modules.api;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/** A registered action plus the module that owns it (null = Artisan's own, or registered outside a module's onEnable). */
@Beta
public final class RegisteredAction {
    private final ActionDeclaration declaration;
    private final @Nullable String moduleId;

    public RegisteredAction(ActionDeclaration declaration, @Nullable String moduleId) {
        this.declaration = Objects.requireNonNull(declaration, "declaration");
        this.moduleId = moduleId;
    }

    public ActionDeclaration getDeclaration() {
        return declaration;
    }

    public @Nullable String getModuleId() {
        return moduleId;
    }

    /** The {@code declared_actions} entry of the presence report: the declaration plus {@code module_id}. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>(declaration.toWire());
        if (moduleId != null) out.put("module_id", moduleId);
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof RegisteredAction other
            && declaration.equals(other.declaration) && Objects.equals(moduleId, other.moduleId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(declaration, moduleId);
    }

    @Override
    public String toString() {
        return "RegisteredAction(" + declaration.getName() + ", moduleId=" + moduleId + ")";
    }
}
