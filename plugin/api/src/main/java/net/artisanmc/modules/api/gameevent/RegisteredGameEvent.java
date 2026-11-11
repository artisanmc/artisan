package net.artisanmc.modules.api.gameevent;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/** A registered Game event plus the module that owns it (null = registered outside a module's onEnable). */
@Beta
public final class RegisteredGameEvent {
    private final GameEventDeclaration declaration;
    private final @Nullable String moduleId;

    public RegisteredGameEvent(GameEventDeclaration declaration, @Nullable String moduleId) {
        this.declaration = Objects.requireNonNull(declaration, "declaration");
        this.moduleId = moduleId;
    }

    public GameEventDeclaration getDeclaration() {
        return declaration;
    }

    public @Nullable String getModuleId() {
        return moduleId;
    }

    /** The {@code declared_game_events} entry of the presence report: the declaration plus {@code module_id}. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>(declaration.toWire());
        if (moduleId != null) out.put("module_id", moduleId);
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof RegisteredGameEvent other
            && declaration.equals(other.declaration) && Objects.equals(moduleId, other.moduleId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(declaration, moduleId);
    }

    @Override
    public String toString() {
        return "RegisteredGameEvent(" + declaration.getName() + ", moduleId=" + moduleId + ")";
    }
}
