package net.artisanmc.plugin.model

/**
 * One kind of Document a project folder holds (ADR `extensible-document-kinds`,
 * decisions 1 and 10). The core ships three; an add-on registers its own the
 * same way, and everything that used to spell the closed list — the reader's
 * folder loop, the resource inventory, the provider's reference tables — reads
 * [DocumentKinds] instead.
 *
 * @property kind the kind id, also the key of [ProjectBundle.documents] (`menu`).
 * @property dir the folder inside a project, without slash (`menus`).
 * @property schemaVersions the `schema:` labels a file of this kind may carry;
 *   the first one is canonical, the others are retired labels still read.
 */
data class DocumentKind(
    val kind: String,
    val dir: String,
    val schemaVersions: List<String>,
) {
    val canonicalSchema: String get() = schemaVersions.first()
}

object DocumentKinds {
    /** `menu/v2` and `menu/v3` were pure version bumps folded back into `menu/v1`; disks still carry them. */
    val MENU = DocumentKind("menu", "menus", listOf("menu/v1", "menu/v2", "menu/v3"))
    val COMMAND = DocumentKind("command", "commands", listOf("command/v1"))
    val DIALOG = DocumentKind("dialog", "dialogs", listOf("dialog/v1"))

    val CORE: List<DocumentKind> = listOf(MENU, COMMAND, DIALOG)

    /** Copy-on-write: registration happens at enable time, reads on every reload. */
    @Volatile private var registry: Map<String, DocumentKind> = CORE.associateBy { it.kind }

    /**
     * Registers a kind. Two kinds may not share an id or a folder: the folder is
     * what tells a Document's kind on disk.
     */
    @Synchronized
    fun register(kind: DocumentKind) {
        for (other in registry.values) {
            require(other.kind != kind.kind) { "duplicate document kind: ${kind.kind}" }
            require(other.dir != kind.dir) { "document kinds ${other.kind} and ${kind.kind} share the folder ${kind.dir}/" }
        }
        registry = registry + (kind.kind to kind)
    }

    /** Every registered kind, core kinds first, then by registration order. */
    fun all(): List<DocumentKind> = registry.values.toList()

    fun byKind(kind: String): DocumentKind? = registry[kind]

    /** The kind whose folder is [dir] (`menus` → menu), if registered. */
    fun byDir(dir: String): DocumentKind? = registry.values.firstOrNull { it.dir == dir }

    /** Test-only: back to the core kinds. */
    @Synchronized
    fun reset() {
        registry = CORE.associateBy { it.kind }
    }
}
