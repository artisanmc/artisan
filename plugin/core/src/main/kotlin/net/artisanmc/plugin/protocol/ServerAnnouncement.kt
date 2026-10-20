package net.artisanmc.plugin.protocol

/**
 * What a server announces at Presence (`hello`, then `modules_changed`): its modules and what
 * they declare. Built by the server, read by the hub; each list keeps its own wire entries
 * (`{id, version, editor_bundle?}`, data sources, `model/v1` documents, Config screens, `{name, args, primary?,
 * module_id?}` actions, `{kind, dir, schema_versions, id_prefix?, module_id?}` Document kinds, and the
 * player commands modules declare, as `PlayerCommandReport` writes them).
 */
data class ServerAnnouncement(
    val modules: List<Map<String, Any?>> = emptyList(),
    val dataSources: List<Map<String, Any?>> = emptyList(),
    val models: List<Map<String, Any?>> = emptyList(),
    val screens: List<Map<String, Any?>> = emptyList(),
    val actions: List<Map<String, Any?>> = emptyList(),
    val documentKinds: List<Map<String, Any?>> = emptyList(),
    val playerCommands: List<Map<String, Any?>> = emptyList(),
) {
    /** The wire fields, in the order `hello` sends them. */
    fun toMap(): Map<String, Any?> = linkedMapOf(
        INSTALLED_MODULES to modules,
        DATA_SOURCES to dataSources,
        DECLARED_MODELS to models,
        EDITOR_SCREENS to screens,
        DECLARED_ACTIONS to actions,
        DOCUMENT_KINDS to documentKinds,
        PLAYER_COMMANDS to playerCommands,
    )

    /** The `editor_bundle` ([module]) announced for [moduleId], or null: no such module, or no bundle. */
    fun editorBundle(moduleId: String): Map<*, *>? =
        modules.firstOrNull { it["id"] == moduleId }?.get(EDITOR_BUNDLE) as? Map<*, *>

    /**
     * This announcement updated by [message] (`hello` or `modules_changed`): a field it carries
     * replaces this one's, a field it lacks (an older server) keeps its value.
     */
    fun updatedBy(message: Map<*, *>): ServerAnnouncement {
        fun field(name: String, current: List<Map<String, Any?>>): List<Map<String, Any?>> {
            val list = message[name] as? List<*> ?: return current
            @Suppress("UNCHECKED_CAST")
            return list.filterIsInstance<Map<*, *>>().map { it as Map<String, Any?> }
        }
        return ServerAnnouncement(
            modules = field(INSTALLED_MODULES, modules),
            dataSources = field(DATA_SOURCES, dataSources),
            models = field(DECLARED_MODELS, models),
            screens = field(EDITOR_SCREENS, screens),
            actions = field(DECLARED_ACTIONS, actions),
            documentKinds = field(DOCUMENT_KINDS, documentKinds),
            playerCommands = field(PLAYER_COMMANDS, playerCommands),
        )
    }

    companion object {
        const val INSTALLED_MODULES = "installed_modules"
        const val DATA_SOURCES = "data_sources"
        const val DECLARED_MODELS = "declared_models"
        const val EDITOR_SCREENS = "editor_screens"
        const val DECLARED_ACTIONS = "declared_actions"
        const val DOCUMENT_KINDS = "document_kinds"
        const val PLAYER_COMMANDS = "player_commands"
        const val EDITOR_BUNDLE = "editor_bundle"
        const val TEMPLATES = "templates"

        val EMPTY = ServerAnnouncement()

        /**
         * An `installed_modules` entry: a module reports the core plugin's version, it has none of its own.
         * [editorBundle] is its `EditorBundleDeclaration.toWire()` (`{sdk, hash, size}`), when it ships one;
         * [templates] its `TemplateDeclaration.toWire()` entries, when it ships some.
         */
        fun module(
            id: String,
            version: String,
            editorBundle: Map<String, Any?>? = null,
            templates: List<Map<String, Any?>> = emptyList(),
        ): Map<String, Any?> = buildMap {
            put("id", id)
            put("version", version)
            if (editorBundle != null) put(EDITOR_BUNDLE, editorBundle)
            if (templates.isNotEmpty()) put(TEMPLATES, templates)
        }

        fun from(message: Map<*, *>): ServerAnnouncement = EMPTY.updatedBy(message)
    }
}
