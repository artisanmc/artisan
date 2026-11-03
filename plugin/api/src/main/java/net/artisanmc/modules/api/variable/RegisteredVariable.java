package net.artisanmc.modules.api.variable;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;

/** A declared module Variable and its qualified name, {@code <module>.<name>}. */
@Beta
public final class RegisteredVariable {
    private final String moduleId;
    private final ModuleVariableDeclaration declaration;

    public RegisteredVariable(String moduleId, ModuleVariableDeclaration declaration) {
        this.moduleId = Objects.requireNonNull(moduleId, "moduleId");
        this.declaration = Objects.requireNonNull(declaration, "declaration");
    }

    public String getModuleId() {
        return moduleId;
    }

    public ModuleVariableDeclaration getDeclaration() {
        return declaration;
    }

    /** {@code <module>.<name>}: what {@code var.} is followed by. */
    public String getQualifiedName() {
        return moduleId + "." + declaration.getName();
    }

    /** The {@code declared_variables} entry: {@code {name, type, scope, values?, key?, description?, module_id}}. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", getQualifiedName());
        out.putAll(declaration.toWire());
        out.put("module_id", moduleId);
        return out;
    }
}
