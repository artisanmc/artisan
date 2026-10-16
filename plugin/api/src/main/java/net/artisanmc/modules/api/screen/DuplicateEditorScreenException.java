package net.artisanmc.modules.api.screen;

import net.artisanmc.modules.api.annotations.Beta;

@Beta
public class DuplicateEditorScreenException extends IllegalStateException {
    public DuplicateEditorScreenException(String id) {
        super("Editor screen '" + id + "' is already declared");
    }
}
