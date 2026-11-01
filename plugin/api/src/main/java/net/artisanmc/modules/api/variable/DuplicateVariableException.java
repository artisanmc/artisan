package net.artisanmc.modules.api.variable;

import net.artisanmc.modules.api.annotations.Beta;

/** Thrown when a module declares a variable name it already declared. */
@Beta
public final class DuplicateVariableException extends RuntimeException {
    public DuplicateVariableException(String qualifiedName) {
        super("Variable '" + qualifiedName + "' is already declared");
    }
}
