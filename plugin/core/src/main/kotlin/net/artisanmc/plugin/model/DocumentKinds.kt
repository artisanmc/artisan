package net.artisanmc.plugin.model

import net.artisanmc.modules.api.document.DocumentKindDeclaration
import net.artisanmc.modules.api.document.DocumentKindRegistry
import net.artisanmc.modules.api.document.PackImagesProvider

/**
 * One kind of Document a project folder holds (ADR `extensible-document-kinds`,
 * decisions 1 and 10). The core ships three; an add-on registers its own
 * through `api.documentKinds` (`DocumentKindRegistry`), and everything that
 * used to spell the closed list — the reader's folder loop, the resource
 * inventory, the provider's reference tables — reads [DocumentKinds] instead.
 *
 * The Kotlin view of a [DocumentKindDeclaration]: same fields, data-class
 * ergonomics for the core.
 *
 * @property kind the kind id, also the key of [net.artisanmc.plugin.engine.RuntimeProject.documents] (`menu`).
 * @property dir the folder inside a project, without slash (`menus`).
 * @property schemaVersions the `schema:` labels a file of this kind may carry;
 *   the first one is canonical, the others are retired labels still read.
 * @property idPrefix the prefix the editor gives a new Document of this kind, if any.
 */
data class DocumentKind(
    val kind: String,
    val dir: String,
    val schemaVersions: List<String>,
    val idPrefix: String? = null,
) {
    val canonicalSchema: String get() = schemaVersions.first()

    fun toDeclaration(): DocumentKindDeclaration = DocumentKindDeclaration(kind, dir, schemaVersions, idPrefix)

    companion object {
        fun of(declaration: DocumentKindDeclaration): DocumentKind =
            DocumentKind(declaration.kind, declaration.dir, declaration.schemaVersions, declaration.idPrefix)
    }
}

/**
 * The core's view of the kind registry. One [DocumentKindRegistry] is the
 * store — the one `api.documentKinds` hands to modules once the plugin has
 * [bind]ed it; before that (core tests, tools) a private registry holding the
 * core kinds. Reads here and registrations through the API see the same list.
 */
object DocumentKinds {
    /** `menu/v2` and `menu/v3` were pure version bumps folded back into `menu/v1`; disks still carry them. */
    val MENU = DocumentKind("menu", "menus", listOf("menu/v1", "menu/v2", "menu/v3"))
    val COMMAND = DocumentKind("command", "commands", listOf("command/v1"))
    val DIALOG = DocumentKind("dialog", "dialogs", listOf("dialog/v1"))

    val CORE: List<DocumentKind> = listOf(MENU, COMMAND, DIALOG)

    @Volatile private var registry: DocumentKindRegistry = coreRegistry()

    /** A fresh registry holding the core kinds, owned by nobody — what the plugin builds the API with. */
    fun coreRegistry(): DocumentKindRegistry =
        DocumentKindRegistry().also { r -> CORE.forEach { r.register(it.toDeclaration()) } }

    /** Makes [registry] the store every read below consults — the plugin binds the API's registry at build time. */
    fun bind(registry: DocumentKindRegistry) {
        this.registry = registry
    }

    /**
     * Registers a kind. Two kinds may not share an id or a folder: the folder is
     * what tells a Document's kind on disk.
     *
     * @throws net.artisanmc.modules.api.document.DuplicateDocumentKindException on a shared id or folder.
     */
    fun register(kind: DocumentKind) = registry.register(kind.toDeclaration())

    /** Every registered kind, core kinds first, then by registration order. */
    fun all(): List<DocumentKind> = registry.declarations().map(DocumentKind::of)

    fun byKind(kind: String): DocumentKind? = registry.find(kind)?.let(DocumentKind::of)

    /** The kind whose folder is [dir] (`menus` → menu), if registered. */
    fun byDir(dir: String): DocumentKind? = registry.byDir(dir)?.let(DocumentKind::of)

    /** The registered kinds whose files ask the pack for images, by folder, in registration order. */
    fun packImages(): Map<String, PackImagesProvider> =
        registry.declarations().mapNotNull { d -> d.packImages?.let { d.dir to it } }.toMap()

    /** Test-only: back to a private registry holding the core kinds. */
    fun reset() {
        registry = coreRegistry()
    }
}
