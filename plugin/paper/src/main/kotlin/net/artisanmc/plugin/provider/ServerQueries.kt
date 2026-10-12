package net.artisanmc.plugin.provider

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.DataSourceRegistry
import net.artisanmc.modules.api.PlayerRequiredException
import net.artisanmc.plugin.assistant.ImportReadResult
import net.artisanmc.plugin.assistant.ImportSelection
import net.artisanmc.plugin.assistant.ImportSourceAccess
import net.artisanmc.plugin.config.ServerConfigAccess
import net.artisanmc.plugin.customitems.NexoGlyphReader
import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.engine.ContextBinder
import net.artisanmc.plugin.engine.PapiPlaceholderCatalog
import net.artisanmc.plugin.items.ItemDescriptor
import net.artisanmc.plugin.protocol.EditorRequest.DataSourceFetch
import net.artisanmc.plugin.protocol.EditorRequest.HeadTextureFetch
import net.artisanmc.plugin.protocol.EditorRequest.ImportSourcesList
import net.artisanmc.plugin.protocol.EditorRequest.ImportSourcesRead
import net.artisanmc.plugin.protocol.EditorRequest.NexoGlyphRead
import net.artisanmc.plugin.protocol.EditorRequest.NexoGlyphsList
import net.artisanmc.plugin.protocol.EditorRequest.OnlinePlayersFetch
import net.artisanmc.plugin.protocol.EditorRequest.PapiPlaceholdersFetch
import net.artisanmc.plugin.protocol.EditorRequest.PlayerInventoryFetch
import net.artisanmc.plugin.protocol.EditorRequest.ServerConfigWrite
import net.artisanmc.plugin.protocol.Replies
import net.artisanmc.plugin.scheduling.Scheduler
import org.bukkit.Bukkit
import java.util.Base64
import java.util.logging.Logger

/**
 * Ce que l'éditeur demande au serveur en marche : joueurs, placeholders, têtes,
 * inventaires, data sources, sources d'import. Tout ce qui lit l'API Bukkit passe
 * par le [scheduler] ; les réponses repartent hors du thread du monde.
 */
class ServerQueries(
    private val replies: Replies,
    private val scheduler: Scheduler,
    private val logger: Logger?,
    private val evaluator: ConditionEvaluator,
    private val dataSources: DataSourceRegistry?,
    private val importSources: ImportSourceAccess,
    private val nexoGlyphs: NexoGlyphReader?,
    private val serverConfig: ServerConfigAccess?,
) {
    private val mapper = ObjectMapper()

    /** Un picker de joueurs plutôt qu'un nom tapé à l'aveugle (capture, « prévisualiser en tant que »). */
    fun onlinePlayers(request: OnlinePlayersFetch) {
        val reply = replies.to(request, "online_players_result")
        onGlobal(reply, "online players listing") {
            reply.ok("players" to Bukkit.getOnlinePlayers().map { it.name }.sortedBy { it.lowercase() })
        }
    }

    fun papiPlaceholders(request: PapiPlaceholdersFetch) {
        val reply = replies.to(request, "papi_placeholders_result")
        try {
            scheduler.global {
                try {
                    val catalog = evaluator.deps.papi?.declaredPlaceholders() ?: PapiPlaceholderCatalog(emptyList())
                    reply.ok("placeholders" to catalog.placeholders, "truncated" to catalog.truncated)
                } catch (_: Throwable) {
                    reply.error("fetch_error")
                }
            }
        } catch (_: Throwable) {
            reply.error("fetch_error")
        }
    }

    fun headTexture(request: HeadTextureFetch) {
        val reply = replies.to(request, "head_texture_result")
        if (!request.id.matches(HDB_ID)) return reply.error("invalid_input")
        try {
            scheduler.global {
                try {
                    val hdb = evaluator.deps.hdbHeads ?: return@global reply.error("hdb_unavailable")
                    val texture = hdb.buildStack(request.id, 1)?.let { ItemDescriptor.derive(it, null)["head_texture"] as? String }
                    if (texture.isNullOrEmpty() || texture.length > 16_384) reply.error("head_not_found")
                    else reply.ok("texture" to texture)
                } catch (_: Exception) {
                    reply.error("fetch_error")
                }
            }
        } catch (_: Exception) {
            reply.error("fetch_error")
        }
    }

    /** Lu sur le thread du joueur ; un joueur parti entre-temps répond `player_not_found`. */
    fun playerInventory(request: PlayerInventoryFetch) {
        val reply = replies.to(request, "player_inventory_result")
        val name = request.player
        try {
            val player = Bukkit.getPlayerExact(name) ?: return reply.error("player_not_found")
            scheduler.player(player.uniqueId, onGone = { reply.error("player_not_found") }) {
                try {
                    val nexo = evaluator.deps.nexoItems
                    // 0-35 réserve, 36-39 armure, 40 main secondaire : la numérotation vanilla.
                    val inv = player.inventory
                    val all = inv.contents.toList() + inv.armorContents.toList() + listOf(inv.itemInOffHand)
                    val slots = all.mapIndexedNotNull { slot, stack ->
                        if (stack == null || stack.type.isAir) null
                        else mapOf("slot" to slot, "stack_yaml" to ItemDescriptor.serialize(stack), "display" to ItemDescriptor.derive(stack, nexo))
                    }
                    reply.ok("slots" to slots)
                } catch (e: Throwable) {
                    reply.failure("fetch_error", "inventory snapshot for '$name'", e)
                }
            }
        } catch (e: Throwable) {
            reply.failure("fetch_error", "inventory snapshot scheduling", e)
        }
    }

    /** Même forme que celle lue par `ContextBinder.shape` au rendu : l'aperçu est le runtime. */
    fun dataSource(request: DataSourceFetch) {
        val reply = replies.to(request, "data_source_fetch_result")
        val registry = dataSources
        val ref = request.ref
        if (registry == null || !registry.has(ref)) return reply.error("unknown_source")
        val source = buildMap<String, Any> {
            put("ref", ref)
            if (request.params.isNotEmpty()) put("params", request.params)
            if (request.filter.isNotEmpty()) put("filter", request.filter)
            if (request.sort.isNotEmpty()) put("sort", request.sort)
            request.limit?.let { put("limit", it) }
        }
        try {
            scheduler.global {
                try {
                    val rows = registry.fetch(ref, null, ContextBinder.interpolateValues(request.params, request.args))
                    val shaped = ContextBinder.shape(rows, source, request.args)
                    logger?.fine("[Artisan] data source preview '$ref' params=${request.params} -> ${shaped.size} rows")
                    val (payloadRows, truncated) = truncateForPreview(shaped)
                    reply.ok("rows" to payloadRows, "truncated" to truncated)
                } catch (e: PlayerRequiredException) {
                    reply.error("player_required", Replies.describe(e))
                } catch (e: Throwable) {
                    // Un fetcher qui touche un joueur en aperçu lève souvent une NPE sans message.
                    reply.failure("fetch_error", "data source preview '$ref'", e)
                }
            }
        } catch (e: Throwable) {
            reply.failure("fetch_error", "data source preview '$ref' scheduling", e)
        }
    }

    /** config.yml depuis la page serveur (ADR `server-config-from-editor`) ; la réponse précède le rechargement. */
    fun serverConfigWrite(request: ServerConfigWrite) {
        val access = serverConfig ?: return
        val reply = replies.to(request, "server_config_write_result")
        scheduler.global {
            val error = runCatching { access.write(request.changes) }.getOrElse { "write_error: ${Replies.describe(it)}" }
            if (error == null) reply.ok("server_config" to access.report())
            else reply.error("invalid_config", error)
        }
    }

    fun importSourcesList(request: ImportSourcesList) {
        val reply = replies.to(request, "import_sources_list_result")
        replies.offThread("import_sources_list") {
            try {
                val sources = importSources.listAll().map { source ->
                    buildMap<String, Any> {
                        put("id", source.id)
                        put("label", source.label)
                        put("files", source.files.map { file -> mapOf("path" to file.path, "size" to file.size) })
                        source.error?.let { put("error", it) }
                    }
                }
                reply.ok("sources" to sources)
            } catch (e: Throwable) {
                reply.failure("read_error", "import source listing", e)
            }
        }
    }

    fun importSourcesRead(request: ImportSourcesRead) {
        val reply = replies.to(request, "import_sources_read_result")
        replies.offThread("import_sources_read") {
            try {
                val selections = request.selections ?: return@offThread reply.error("invalid_input")
                when (val result = importSources.read(selections.map { ImportSelection(it.sourceId, it.paths) })) {
                    is ImportReadResult.Success -> reply.ok("files" to result.files.map { file ->
                        mapOf("source_id" to file.sourceId, "path" to file.path, "content" to file.content)
                    })
                    is ImportReadResult.Failure -> reply.error(result.error, result.message)
                }
            } catch (e: Throwable) {
                reply.failure("read_error", "import source read", e)
            }
        }
    }

    /** Import de glyphes Nexo dans les assets : lecture disque, hors du thread du monde. */
    fun nexoGlyphs(request: NexoGlyphsList) {
        val reply = replies.to(request, "nexo_glyphs_list_result")
        replies.offThread("nexo_glyphs_list") {
            try {
                reply.ok("glyphs" to nexoGlyphs?.list().orEmpty().map {
                    mapOf("id" to it.id, "texture" to it.texture, "available" to it.available)
                })
            } catch (e: Throwable) {
                reply.failure("read_error", "nexo_glyphs_list", e)
            }
        }
    }

    fun nexoGlyph(request: NexoGlyphRead) {
        val reply = replies.to(request, "nexo_glyph_read_result")
        replies.offThread("nexo_glyph_read") {
            try {
                val bytes = request.glyphId?.let { nexoGlyphs?.read(it) } ?: return@offThread reply.error("not_found")
                reply.ok("content_base64" to Base64.getEncoder().encodeToString(bytes))
            } catch (e: Throwable) {
                reply.failure("read_error", "nexo_glyph_read", e)
            }
        }
    }

    private fun onGlobal(reply: Replies.Reply, what: String, task: () -> Unit) {
        try {
            scheduler.global {
                try { task() } catch (e: Throwable) { reply.failure("fetch_error", what, e) }
            }
        } catch (e: Throwable) {
            reply.failure("fetch_error", "$what scheduling", e)
        }
    }

    /** Aperçu plafonné à [MAX_PREVIEW_ROWS] lignes et ~[MAX_PREVIEW_BYTES] octets sérialisés. */
    internal fun truncateForPreview(rows: List<Map<String, Any?>>): Pair<List<Map<String, Any?>>, Boolean> {
        var out = rows.take(MAX_PREVIEW_ROWS)
        var truncated = rows.size > MAX_PREVIEW_ROWS
        while (out.isNotEmpty() && mapper.writeValueAsBytes(out).size > MAX_PREVIEW_BYTES) {
            out = out.dropLast(1)
            truncated = true
        }
        return out to truncated
    }

    companion object {
        internal const val MAX_PREVIEW_ROWS = 50
        internal const val MAX_PREVIEW_BYTES = 256 * 1024
        private val HDB_ID = Regex("[0-9]{1,10}")
    }
}
