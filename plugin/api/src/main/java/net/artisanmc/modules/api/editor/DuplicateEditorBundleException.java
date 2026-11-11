package net.artisanmc.modules.api.editor;

import net.artisanmc.modules.api.annotations.Stable;

/** A module registering a second editor bundle: a module ships one editor view. */
@Stable
public final class DuplicateEditorBundleException extends IllegalStateException {
    public DuplicateEditorBundleException(String message) {
        super(message);
    }

    static DuplicateEditorBundleException of(String moduleId) {
        return new DuplicateEditorBundleException("module '" + moduleId + "' already registered an editor bundle");
    }
}
