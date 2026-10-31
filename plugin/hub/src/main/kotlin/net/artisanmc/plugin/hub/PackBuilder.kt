package net.artisanmc.plugin.hub

import net.artisanmc.plugin.pack.OverlayImageRequest
import net.artisanmc.plugin.pack.PackFile
import net.artisanmc.plugin.pack.PackInput
import net.artisanmc.plugin.pack.PackProject
import net.artisanmc.plugin.pack.PackResult
import net.artisanmc.plugin.pack.ResourcePackBuilder
import net.artisanmc.plugin.project.PackImageRequest
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.logging.Level
import java.util.logging.Logger

/**
 * Builds a server's Java and Bedrock resource packs in the hub, from the Projects that server loaded (read from
 * the suite database through [LoadedProjects], leaf servers included), with `plugin/pack`: the
 * same bytes as the editor's build.
 *
 * **Shadow mode** for now: the hub builds after each `projects_reloaded` and compares its pack
 * with the one the editor uploads, without applying its own. A match is logged at FINE, a pack
 * the editor sent that the hub's build does not reproduce at WARNING. Module images come from
 * what each server computed at load (`pack_images`, a kind's `PackImagesProvider`): a module whose
 * editor kind declares `pack.images` without the Java twin leaves them out of the hub's build.
 *
 * The **Bedrock pack** is applied: after each build the hub stores it ([bedrock]) and sends it to the
 * server when its hash changed, in every edition, so a publication made without an editor tab (MCP,
 * `/artisan reload`) reaches Bedrock players. The Java pack is built only in Pro ([java]).
 *
 * One build at a time on a thread of its own (never Jetty's), at most one waiting per server:
 * requests arriving while one runs share the next, which reads the latest state.
 */
class PackBuilder(
    private val servers: Servers,
    private val loaded: LoadedProjects,
    private val logger: Logger?,
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "Artisan-pack-builder").apply { isDaemon = true }
    },
    /** Compare the Java pack with the editor's (Pro): false leaves [Status.hubHash] null. */
    private val java: Boolean = true,
    /** Where the Bedrock packs the hub applies are served from; null builds none. */
    private val bedrock: PackStore? = null,
) : AutoCloseable {
    /**
     * What the hub and the editor last built for a server, and whether the two agreed;
     * [bedrockHash] is the Bedrock pack the hub last applied.
     */
    data class Status(
        val hubHash: String?,
        val editorHash: String?,
        val builtAt: Long?,
        val error: String?,
        val bedrockHash: String? = null,
    ) {
        val matches: Boolean? get() = if (hubHash == null || editorHash == null) null else hubHash == editorHash
    }

    private val status = ConcurrentHashMap<String, Status>()
    private val waiting = ConcurrentHashMap<String, CompletableFuture<Status?>>()

    fun status(server: String): Status? = status[server]

    /**
     * Rebuilds [server]'s pack in the background, from what the database holds for it: the
     * server need not be online. A request already waiting covers this one. The future completes
     * with the status once that build is done (null: no state for the server), never exceptionally.
     */
    fun request(server: String): CompletableFuture<Status?> {
        val fresh = CompletableFuture<Status?>()
        val queued = waiting.putIfAbsent(server, fresh)
        if (queued != null) return queued
        try {
            executor.execute {
                waiting.remove(server, fresh)
                try {
                    record(server)
                } finally {
                    fresh.complete(status[server])
                }
            }
        } catch (_: RejectedExecutionException) {
            waiting.remove(server, fresh)
            fresh.complete(status[server])
        }
        return fresh
    }

    /** Builds [server]'s pack and records the outcome in its [Status]. */
    private fun record(server: String) {
        val started = System.currentTimeMillis()
        val result = runCatching { build(server) }
        val previous = status[server]
        result.onSuccess { pack ->
            if (pack == null) return@onSuccess
            val bedrockHash = pack.bedrock?.let { applyBedrock(server, it.zip, previous?.bedrockHash) } ?: previous?.bedrockHash
            status[server] = Status(pack.sha1.takeIf { java }, previous?.editorHash, started, null, bedrockHash)
            logger?.fine { "[Artisan] Pack of $server built by the hub in ${System.currentTimeMillis() - started} ms: ${pack.sha1}" }
            if (java && previous?.editorHash == pack.sha1) logger?.fine { "[Artisan] Pack of $server: the hub's build matches the editor's" }
        }.onFailure { error ->
            status[server] = Status(previous?.hubHash, previous?.editorHash, started, error.message ?: error.javaClass.simpleName, previous?.bedrockHash)
            logger?.log(Level.WARNING, "[Artisan] The hub could not build the pack of $server (the editor's stays in use)", error)
        }
    }

    /**
     * Stores [zip] and sends it to [server] when it differs from [applied], the Bedrock pack the
     * server last received (the hub's or the editor's, [bedrockApplied]); its hash.
     */
    private fun applyBedrock(server: String, zip: ByteArray, applied: String?): String {
        val store = bedrock!!
        val hash = store.put(zip)
        if (hash != applied) {
            servers.find(server)?.applyBedrockPack(hash, store.pathOf(hash))
            logger?.info("[Artisan] Bedrock pack of $server rebuilt by the hub: $hash")
        }
        return hash
    }

    /**
     * The editor sent [server] the Bedrock pack [hash]: the hub's next build sends its own only
     * when it differs, so the two never take turns with the same bytes.
     */
    fun bedrockApplied(server: String, hash: String) {
        status.merge(server, Status(null, null, null, null, hash)) { old, _ -> old.copy(bedrockHash = hash) }
    }

    /**
     * The editor sent [server] the pack [hash]. Compared once the builds waiting for that server
     * are done, against the hub's latest.
     */
    fun editorUploaded(server: String, hash: String) {
        status.merge(server, Status(null, hash, null, null)) { old, _ -> old.copy(editorHash = hash) }
        executor.execute {
            val now = status[server] ?: return@execute
            when {
                now.hubHash == null -> Unit
                now.hubHash == hash -> logger?.fine { "[Artisan] Pack of $server: the editor's matches the hub's build" }
                else -> logger?.warning(
                    "[Artisan] Pack of $server: the editor sent $hash, the hub's build gives ${now.hubHash}. " +
                        "Expected when a module declares pack images in its editor only; otherwise, please report it.",
                )
            }
        }
    }

    /** The pack of [server] from what it loaded; null when the database has no state for it. */
    fun build(server: String): PackResult? {
        val target = servers.find(server) ?: return null
        val list = loaded.list(server) ?: return null
        val folders = (list["project_ids"] as? List<*>).orEmpty().filterIsInstance<String>()
        val projects = folders.mapNotNull { folder ->
            val read = loaded.read(server, folder) ?: return@mapNotNull null
            val files = (read["files"] as? List<*>).orEmpty().mapNotNull { f ->
                val entry = f as? Map<*, *> ?: return@mapNotNull null
                val path = entry["path"] as? String ?: return@mapNotNull null
                PackFile(path, entry["content"] as? String ?: return@mapNotNull null)
            }
            val binaries = (read["binaries"] as? List<*>).orEmpty().mapNotNull { (it as? Map<*, *>)?.get("path") as? String }
            PackProject(
                id = ProjectRef.id(server, folder),
                files = files,
                binaries = binaries,
                // A binary the database lost fails the build: the editor's pack stays.
                binary = { path -> loaded.binary(server, folder, path) ?: error("binary_missing:$folder/$path") },
                overlayImages = (read["pack_images"] as? List<*>).orEmpty().mapNotNull { image ->
                    PackImageRequest.from(image)?.let { OverlayImageRequest(it.asset, it.rise, it.bottom) }
                },
                // The plugin keys a Bedrock menu by its Project's folder.
                folder = folder,
            )
        }
        return ResourcePackBuilder.build(
            PackInput(projects, containerTextures(target.serverConfig()), bedrockServerId = server.takeIf { bedrock != null }),
        )
    }

    /** `resource-pack.container-textures.*` of the server's `config.yml`, as the editor reads them. */
    private fun containerTextures(config: Map<String, Any?>?): Map<String, String> =
        listOf("chest", "hopper", "dispenser").mapNotNull { c ->
            (config?.get("resource-pack.container-textures.$c") as? String)?.takeIf { ':' in it }?.let { c to it }
        }.toMap()

    override fun close() {
        executor.shutdownNow()
    }
}
