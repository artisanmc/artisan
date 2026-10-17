package net.artisanmc.modules.api.editor;

import net.artisanmc.modules.api.annotations.Beta;

/** A module registering a second editor bundle: a module ships one editor view. */
@Beta
public final class DuplicateEditorBundleException extends IllegalStateException {
    public DuplicateEditorBundleException(String message) {
        super(message);
    }

    static DuplicateEditorBundleException of(String moduleId) {
        return new DuplicateEditorBundleException("module '" + moduleId + "' already registered an editor bundle");
    }
}
