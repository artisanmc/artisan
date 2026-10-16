package net.artisanmc.modules.api.document;

import java.util.ArrayList;
import java.util.List;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.action.ActionRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import net.artisanmc.modules.api.datasource.DataSourceRegistry;
import org.jetbrains.annotations.Nullable;

/**
 * The Document kinds a project may hold ({@code api.documentKinds}, ADR {@code extensible-document-kinds},
 * decisions 1, 10 and 11): Artisan's own (menu, command, dialog) and the modules', one table. The
 * core reads a project's folders from it, indexes every kind's Documents by reference and reports
 * the kinds at Presence ({@code document_kinds}); the editor shows a kind the server does not list
 * as not synchronised. Same mechanism as {@link ActionRegistry}: a registration from a module's
 * {@code onEnable} is owned by it and leaves with it. Registration order is kept: the core kinds,
 * registered first, come first.
 */
@Beta
public final class DocumentKindRegistry implements OwnedRegistry {
    private final List<RegisteredDocumentKind> kinds = new ArrayList<>();

    /** Owner captured for registrations happening right now; see {@link OwnedRegistry#bindOwner}. */
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /**
     * Registers {@code decl}; throws {@link DuplicateDocumentKindException} if its kind id or its
     * folder is taken.
     */
    @Beta
    public synchronized void register(DocumentKindDeclaration decl) {
        for (RegisteredDocumentKind other : kinds) {
            DocumentKindDeclaration d = other.getDeclaration();
            if (d.getKind().equals(decl.getKind())) throw DuplicateDocumentKindException.kind(decl.getKind());
            if (d.getDir().equals(decl.getDir())) throw DuplicateDocumentKindException.dir(decl.getKind(), d.getKind(), decl.getDir());
        }
        kinds.add(new RegisteredDocumentKind(decl, currentOwner));
    }

    /** Removes the kind {@code kind}; false if none was registered. */
    @Beta
    public synchronized boolean unregister(String kind) {
        return kinds.removeIf(r -> r.getDeclaration().getKind().equals(kind));
    }

    @Internal
    @Override
    public synchronized void unregisterOwnedBy(String moduleId) {
        kinds.removeIf(r -> moduleId.equals(r.getModuleId()));
    }

    /** The declaration of {@code kind}, or null. */
    @Beta
    public synchronized @Nullable DocumentKindDeclaration find(String kind) {
        for (RegisteredDocumentKind r : kinds) {
            if (r.getDeclaration().getKind().equals(kind)) return r.getDeclaration();
        }
        return null;
    }

    /** The kind whose project folder is {@code dir} ({@code menus} → menu), or null. */
    @Beta
    public synchronized @Nullable DocumentKindDeclaration byDir(String dir) {
        for (RegisteredDocumentKind r : kinds) {
            if (r.getDeclaration().getDir().equals(dir)) return r.getDeclaration();
        }
        return null;
    }

    @Beta
    public boolean has(String kind) {
        return find(kind) != null;
    }

    /** The declarations, in registration order. */
    @Beta
    public synchronized List<DocumentKindDeclaration> declarations() {
        return kinds.stream().map(RegisteredDocumentKind::getDeclaration).toList();
    }

    /** Declarations with their owning module id, in registration order. */
    @Beta
    public synchronized List<RegisteredDocumentKind> registered() {
        return List.copyOf(kinds);
    }
}
