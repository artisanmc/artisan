package net.artisanmc.modules.api.model;

import net.artisanmc.modules.api.annotations.Beta;

@Beta
public class DuplicateModelException extends IllegalStateException {
    public DuplicateModelException(String id) {
        super("Data model '" + id + "' is already declared");
    }
}
