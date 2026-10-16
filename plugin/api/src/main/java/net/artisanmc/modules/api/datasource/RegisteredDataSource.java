package net.artisanmc.modules.api.datasource;

import java.util.Objects;
import net.artisanmc.modules.api.annotations.Stable;
import org.jetbrains.annotations.Nullable;

/** A registered declaration plus the module that owns it (null = registered outside a module's onEnable). */
@Stable
public final class RegisteredDataSource {
    private final DataSourceDeclaration declaration;
    private final @Nullable String moduleId;

    public RegisteredDataSource(DataSourceDeclaration declaration, @Nullable String moduleId) {
        this.declaration = Objects.requireNonNull(declaration, "declaration");
        this.moduleId = moduleId;
    }

    public DataSourceDeclaration getDeclaration() {
        return declaration;
    }

    public @Nullable String getModuleId() {
        return moduleId;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof RegisteredDataSource other
            && declaration.equals(other.declaration) && Objects.equals(moduleId, other.moduleId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(declaration, moduleId);
    }

    @Override
    public String toString() {
        return "RegisteredDataSource(declaration=" + declaration + ", moduleId=" + moduleId + ")";
    }
}
