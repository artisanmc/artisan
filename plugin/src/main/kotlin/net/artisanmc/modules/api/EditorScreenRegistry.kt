package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import java.util.concurrent.ConcurrentHashMap

@Beta
class DuplicateEditorScreenException(id: String) :
    IllegalStateException("Editor screen '$id' is already declared")

/**
 * A module-declared Config screen (ADR `module-config-screens`): a named entry
 * in the editor's sidebar whose core-generated form edits one declared-model
 * Table/Config of the module's owned project, live over the WS relay.
 */
@Beta
data class EditorScreenDeclaration(
    /** Namespaced screen id (`boutique:catalog`). */
    val id: String,
    /** Human label shown in the sidebar (module's own language; i18n later). */
    val label: String,
    /** Project-relative path of the edited Table/Config (`data/categories`). */
    val table: String,
    /** The project whose files the screen edits (usually the module's owned project). */
    val projectId: String,
    /** Declaring module, captured at declare time. */
    val moduleId: String?,
) {
    /** Wire form for Presence payloads (`hello.editor_screens`). */
    @Beta
    fun toWire(): Map<String, Any?> = mapOf(
        "id" to id,
        "module_id" to moduleId,
        "label" to label,
        "table" to table,
        "project_id" to projectId,
    )
}

/**
 * Module-declared Config screens, reported at Presence like data sources and
 * declared models. Purely declarative — nothing here is interpreted
 * plugin-side; the editor mounts the entries and the core form generator.
 */
@Beta
class EditorScreenRegistry {
    private val screens = ConcurrentHashMap<String, EditorScreenDeclaration>()

    /** Owner captured for declarations happening right now (cf. DataSourceRegistry). */
    @Volatile internal var currentOwner: String? = null

    @Beta
    fun declare(id: String, label: String, table: String, projectId: String) {
        require(id.contains(":")) { "editor screen id must be namespaced (namespace:screen): '$id'" }
        require(label.isNotBlank()) { "editor screen '$id' requires a non-blank label" }
        require(projectId.isNotBlank()) { "editor screen '$id' requires a projectId" }
        require(isSafeTable(table)) { "editor screen '$id' has an unsafe table path: '$table'" }
        val decl = EditorScreenDeclaration(id, label, table, projectId, currentOwner)
        if (screens.putIfAbsent(id, decl) != null) throw DuplicateEditorScreenException(id)
    }

    /** All declared screens, sorted by id (deterministic presence payload). */
    @Beta
    fun declared(): List<EditorScreenDeclaration> = screens.values.sortedBy { it.id }

    private fun isSafeTable(table: String): Boolean {
        if (table.isBlank()) return false
        if (table.startsWith("/") || table.startsWith("\\") || table.contains("..")) return false
        if (table.contains(":")) return false
        val first = table.replace('\\', '/').substringBefore('/')
        return !first.startsWith(".artisan")
    }
}
