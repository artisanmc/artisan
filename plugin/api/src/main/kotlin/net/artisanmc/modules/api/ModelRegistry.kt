package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import java.util.concurrent.ConcurrentHashMap

@Beta
class DuplicateModelException(id: String) :
    IllegalStateException("Data model '$id' is already declared")

/** A declared model document plus the module that owns it. */
@Beta
data class DeclaredModel(
    val id: String,
    /** The model/v1 document, verbatim (may carry `version` + `migrations`). */
    val document: Map<String, Any?>,
    val moduleId: String?,
)

/**
 * Module-declared Data models (ADR `composable-data-models` §4): an Add-on
 * declares the SHAPE of its config data as a `model/v1` document; the plugin
 * is a pure passthrough — the document is reported verbatim at Presence
 * (`hello.declared_models`, like `data_sources`) and consumed by the editor,
 * which renders the schema-driven form. The runtime stays model-blind (data
 * files are self-contained); nothing here is interpreted plugin-side.
 *
 * Declared ids MUST be namespace-qualified (`boutique:category`). The document
 * may carry a monotonically increasing `version` plus declarative `migrations`
 * steps — data, never code — applied editor-side.
 */
@Beta
class ModelRegistry {
    private val models = ConcurrentHashMap<String, DeclaredModel>()

    /** Owner captured for declarations happening right now (cf. DataSourceRegistry). */
    @Volatile internal var currentOwner: String? = null

    internal fun unregisterOwnedBy(moduleId: String) {
        models.values.removeIf { it.moduleId == moduleId }
    }

    @Beta
    fun declare(document: Map<String, Any?>) {
        val id = document["id"] as? String
            ?: throw IllegalArgumentException("declared model document requires an 'id'")
        require(id.contains(":")) { "declared model id must be namespaced (namespace:model): '$id'" }
        if (models.putIfAbsent(id, DeclaredModel(id, document, currentOwner)) != null) {
            throw DuplicateModelException(id)
        }
    }

    @Beta
    fun has(id: String): Boolean = models.containsKey(id)

    /** All declared models, sorted by id (deterministic presence payload). */
    @Beta
    fun declared(): List<DeclaredModel> = models.values.sortedBy { it.id }
}
