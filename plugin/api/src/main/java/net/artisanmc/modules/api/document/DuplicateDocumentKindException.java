package net.artisanmc.modules.api.document;

import net.artisanmc.modules.api.annotations.Beta;

/** Two declarations for the same Document kind id, or two kinds claiming the same project folder. */
@Beta
public final class DuplicateDocumentKindException extends IllegalStateException {
    public DuplicateDocumentKindException(String message) {
        super(message);
    }

    static DuplicateDocumentKindException kind(String kind) {
        return new DuplicateDocumentKindException("document kind '" + kind + "' is already registered");
    }

    static DuplicateDocumentKindException dir(String kind, String other, String dir) {
        return new DuplicateDocumentKindException(
            "document kinds '" + other + "' and '" + kind + "' share the folder " + dir + "/");
    }
}
