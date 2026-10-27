package net.artisanmc.plugin.provider

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.datasource.DataSourceRegistry
import net.artisanmc.modules.api.datasource.PlayerRequiredException
import net.artisanmc.modules.api.editor.EditorBundleDeclaration
import net.artisanmc.plugin.config.ServerConfigAccess
import net.artisanmc.plugin.customitems.NexoGlyphReader
import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.engine.ContextBinder
import net.artisanmc.plugin.engine.PapiPlaceholderCatalog
import net.artisanmc.plugin.items.ItemDescriptor
import net.artisanmc.plugin.protocol.EditorRequest.DataSourceFetch
import net.artisanmc.plugin.protocol.EditorRequest.EditorBundleFetch
import net.artisanmc.plugin.protocol.EditorRequest.HeadTextureFetch
import net.artisanmc.plugin.protocol.EditorRequest.NexoGlyphRead
import net.artisanmc.plugin.protocol.EditorRequest.NexoGlyphsList
import net.artisanmc.plugin.protocol.EditorRequest.OnlinePlayersFetch
import net.artisanmc.plugin.protocol.EditorRequest.PapiPlaceholdersFetch
import net.artisanmc.plugin.protocol.EditorRequest.PlayerInventoryFetch
import net.artisanmc.plugin.protocol.EditorRequest.ServerConfigWrite
import net.artisanmc.plugin.protocol.Replies
import net.artisanmc.plugin.scheduling.Scheduler
import org.bukkit.Bukkit
import org.bukkit.entity.Player
import java.util.Base64
import java.util.logging.Logger

/**
 * What the editor asks the running server: players, placeholders, heads, inventories,
 * data sources, Nexo glyphs. Everything that reads the Bukkit API goes through the
 * [scheduler]; replies are sent off the world thread.
 */
class ServerQueries(
    private val replies: Replies,
    private val scheduler: Scheduler,
    private val logger: Logger?,
    private val evaluator: ConditionEvaluator,
    private val dataSources: DataSourceRegistry?,
    private val nexoGlyphs: NexoGlyphReader?,
    private val serverConfig: ServerConfigAccess?,
    private val editorBundles: (String) -> EditorBundleDeclaration? = { null },
) {
    private val mapper = ObjectMapper()

    /** A player picker rather than a name typed blind (capture, "preview as"). */
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
                    val texture = hdb.buildStack(request.id, 1)?.let { ItemDescriptor.derive(it)["head_texture"] as? String }
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

    /** Read on the player's thread; a player who left in the meantime replies `player_not_found`. */
    fun playerInventory(request: PlayerInventoryFetch) {
        val reply = replies.to(request, "player_inventory_result")
        val name = request.player
        try {
            val player = Bukkit.getPlayerExact(name) ?: return reply.error("player_not_found")
            scheduler.player(player.uniqueId, onGone = { reply.error("player_not_found") }) {
                try {
                    val customItems = evaluator.deps.customItems
                    // 0-35 storage, 36-39 armor, 40 off hand: the vanilla numbering.
                    val inv = player.inventory
                    val all = inv.contents.toList() + inv.armorContents.toList() + listOf(inv.itemInOffHand)
                    val slots = all.mapIndexedNotNull { slot, stack ->
                        if (stack == null || stack.type.isAir) null
                        else mapOf("slot" to slot, "stack_yaml" to ItemDescriptor.serialize(stack), "display" to ItemDescriptor.derive(stack, customItems))
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

    /** Same shape as the one `ContextBinder.shape` reads at render: the preview is the runtime. */
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
        // "Preview as": the editor names an online player in `params.player`; the fetcher
        // gets that Player, on their thread, as it would at render — not a name in its params.
        val viewerName = (request.params[PREVIEW_PLAYER] as? String)?.takeIf { it.isNotBlank() }
        val params = request.params - PREVIEW_PLAYER
        val run = { viewer: Player? ->
            try {
                val rows = registry.fetch(ref, viewer, ContextBinder.interpolateValues(params, request.args))
                val shaped = ContextBinder.shape(rows, source, request.args)
                logger?.fine("[Artisan] data source preview '$ref' as=${viewer?.name} params=$params -> ${shaped.size} rows")
                val (payloadRows, truncated) = truncateForPreview(shaped)
                reply.ok("rows" to payloadRows, "truncated" to truncated)
            } catch (e: PlayerRequiredException) {
                reply.error("player_required", Replies.describe(e))
            } catch (e: Throwable) {
                // A fetcher touching a player in preview often throws an NPE without a message.
                reply.failure("fetch_error", "data source preview '$ref'", e)
            }
        }
        try {
            if (viewerName == null) return scheduler.global { run(null) }
            val viewer = Bukkit.getPlayerExact(viewerName) ?: return reply.error("player_not_found", viewerName)
            scheduler.player(viewer.uniqueId, onGone = { reply.error("player_not_found", viewerName) }) { run(viewer) }
        } catch (e: Throwable) {
            reply.failure("fetch_error", "data source preview '$ref' scheduling", e)
        }
    }

    /** config.yml from the server page (ADR `server-config-from-editor`); the reply precedes the reload. */
    fun serverConfigWrite(request: ServerConfigWrite) {
        val access = serverConfig ?: return
        val reply = replies.to(request, "server_config_write_result")
        scheduler.global {
            val error = runCatching { access.write(request.changes) }.getOrElse { "write_error: ${Replies.describe(it)}" }
            if (error == null) reply.ok("server_config" to access.report())
            else reply.error("invalid_config", error)
        }
    }

    /**
     * A module's editor view, for the hub to serve (`GET …/modules/:module/ui.js`): the script as
     * UTF-8 text (the declaration guarantees it is), with the hash the hub checks it against.
     */
    fun editorBundle(request: EditorBundleFetch) {
        val reply = replies.to(request, "editor_bundle_fetch_result")
        val bundle = editorBundles(request.moduleId) ?: return reply.error("not_found")
        replies.offThread("editor_bundle_fetch") {
            val script = bundle.script
            // OkHttp drops the whole connection past 16 MiB queued: only control characters
            // (6 bytes once escaped) could take a 4 MiB script there.
            if (escapedSize(script) > MAX_BUNDLE_MESSAGE) return@offThread reply.error("too_large")
            reply.ok(
                "module_id" to request.moduleId,
                "sdk" to bundle.sdk,
                "hash" to bundle.hash,
                "content" to String(script, Charsets.UTF_8),
            )
        }
    }

    /** Nexo glyph import into the assets: disk read, off the world thread. */
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

    /** The size of [script] as a JSON string: `"`, `\`, `\n`, `\r`, `\t` take 2 bytes, other control characters 6. */
    private fun escapedSize(script: ByteArray): Long = script.sumOf { b ->
        when (b.toInt()) {
            '"'.code, '\\'.code, '\n'.code, '\r'.code, '\t'.code -> 2L
            in 0..0x1f -> 6L
            else -> 1L
        }
    }

    /** Preview capped at [MAX_PREVIEW_ROWS] rows and ~[MAX_PREVIEW_BYTES] serialized bytes. */
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
        /** The `params` key the editor's "Preview as" names its player under. */
        internal const val PREVIEW_PLAYER = "player"
        internal const val MAX_PREVIEW_ROWS = 50
        internal const val MAX_PREVIEW_BYTES = 256 * 1024
        private const val MAX_BUNDLE_MESSAGE = 12L * 1024 * 1024
        private val HDB_ID = Regex("[0-9]{1,10}")
    }
}
