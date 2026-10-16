package net.artisanmc.plugin

import java.io.File
import java.util.UUID

/** Presence refresh and editor permission reports: every minute. */
internal const val HEARTBEAT_TICKS = 20L * 60
private const val PURGE_TICKS = 20L * 60 * 60 * 24

/**
 * The suite database as this server uses it (ADR `server-identity-and-versions`): its server
 * id, its `artisan_servers` row and presence, the H2 import, the Versions it records and the
 * editor sessions kept there. Everything that writes goes through [versionWriter], one thread:
 * the database opens at the head of its queue, ahead of the first Snapshot's Version (issue #42).
 */
internal class SuiteDatabase(private val plugin: ArtisanPlugin) {
    private val logger get() = plugin.logger
    private val dataFolder get() = plugin.dataFolder
    private val database get() = plugin.database
    private val scheduler get() = plugin.scheduler
    private val isEnabled get() = plugin.isEnabled

    val serverId: UUID by lazy { net.artisanmc.plugin.database.ServerIdFile.read(File(dataFolder, "server-id")) }
    /** Artisan's own tables in the suite database, migrated once; null until [open] opened it, or when it could not. */
    @Volatile var artisanData: javax.sql.DataSource? = null
        private set
    @Volatile private var serverRegistry: net.artisanmc.plugin.database.ServerRegistry? = null
    @Volatile private var knownCache: Pair<Long, Map<String, net.artisanmc.plugin.hub.Servers.Seen>>? = null

    /** Versions, loaded states and drafts in the suite database; null without a registered server. */
    @Volatile var suiteData: net.artisanmc.plugin.database.SuiteProjectData? = null
        private set
    @Volatile private var serverRow: Int? = null
    /** One writer: Versions are recorded in the order their Snapshots were loaded, after the database opened. */
    private val versionWriter = java.util.concurrent.Executors.newSingleThreadExecutor { Thread(it, "Artisan-versions").apply { isDaemon = true } }

    /** Each loaded Snapshot becomes Versions, then the loaded state, on [versionWriter] (rules in [net.artisanmc.plugin.project.VersionRecorder]). */
    private val versionRecorder by lazy {
        net.artisanmc.plugin.project.VersionRecorder(plugin.projectRoots, {
            val data = suiteData
            val server = serverRow
            if (data == null || server == null) null else net.artisanmc.plugin.database.SuiteVersionStorage(data, server)
        }, versionWriter, logger)
    }

    fun recordVersions(
        snapshot: net.artisanmc.plugin.project.ProjectSnapshot,
        authors: Map<String, net.artisanmc.plugin.protocol.PublicationAuthor>,
        done: () -> Unit,
    ) = versionRecorder.record(snapshot, authors, done)

    /** Queues [openSuiteDatabase] on [versionWriter]: nothing in `onEnable` waits for it. */
    fun open(web: net.artisanmc.plugin.hub.WebConfig, editorChannel: net.artisanmc.plugin.hub.EditorChannel) {
        versionWriter.execute { openSuiteDatabase(web, editorChannel) }
    }

    /**
     * Opens the suite database (pool, migrations with their `GET_LOCK`), registers this server
     * in `artisan_servers` with its presence refreshed every minute (ADR
     * `server-identity-and-versions`), and imports the H2 history. Off the main thread, on
     * `Artisan-versions` (issue #42): the hub and the hub link read the fields set here once
     * they are, and answer "not open" until then.
     */
    private fun openSuiteDatabase(web: net.artisanmc.plugin.hub.WebConfig, editorChannel: net.artisanmc.plugin.hub.EditorChannel) {
        val data = try {
            database.dataSource(plugin).also { net.artisanmc.plugin.database.ArtisanSchema.migrate(it, database.dialect, logger) }
        } catch (e: Exception) {
            logger.warning("[Artisan] Suite database unavailable, offline servers and history are disabled: ${e.message}")
            if (web.leaf) logger.severe("[Artisan] Not connecting to the hub: the suite database cannot be opened.")
            return
        }
        artisanData = data
        val name = plugin.networkName(web) ?: return
        val registry = net.artisanmc.plugin.database.ServerRegistry(data, database.dialect, logger)
        val refused = when (val result = runCatching { registry.register(serverId, name, java.time.Instant.now()) }.getOrElse {
            logger.warning("[Artisan] Server registry unavailable, offline servers will not be listed: ${it.message}")
            return
        }) {
            is net.artisanmc.plugin.database.Registration.CopiedId ->
                "this server's id (plugins/Artisan/server-id) belongs to the running server \"${result.running}\": " +
                    "this folder was copied from it. Delete plugins/Artisan/server-id here and restart to make it a server of its own."
            net.artisanmc.plugin.database.Registration.NameTaken ->
                "another server already uses the name \"$name\". Set a different name in environment.yml, or restore " +
                    "plugins/Artisan/server-id if this server is that one."
            else -> null
        }
        if (refused != null) {
            logger.severe("[Artisan] Not registered in artisan_servers: $refused")
            return
        }
        serverRow = registry.rowId(serverId)
        importEmbeddedDatabase(data)
        val suite = net.artisanmc.plugin.database.SuiteProjectData(data, database.dialect, ::row, logger)
        suiteData = suite
        serverRegistry = registry
        editorChannel.onReload(suite::invalidate)
        fun beat() {
            if (!isEnabled) return
            runCatching { registry.touch(serverId, java.time.Instant.now()) }
                .onFailure { logger.warning("[Artisan] Presence not refreshed: ${it.message}") }
            scheduler.asyncLater(HEARTBEAT_TICKS) { beat() }
        }
        scheduler.asyncLater(HEARTBEAT_TICKS) { beat() }
        // Closed drafts and receipts are kept `DraftRows.KEEP`, then dropped: once a day, off the main thread.
        fun purge() {
            if (!isEnabled) return
            runCatching { suite.purge(java.time.Instant.now()) }
                .onSuccess { if (it > 0) logger.info("[Artisan] $it closed drafts and receipts purged") }
                .onFailure { logger.warning("[Artisan] Drafts not purged: ${it.message}") }
            scheduler.asyncLater(PURGE_TICKS) { purge() }
        }
        scheduler.asyncLater(HEARTBEAT_TICKS * 5) { purge() }
    }

    /** On MySQL/MariaDB, this server's history from the H2 file it ran on alone, once (ADR `server-identity-and-versions` ⑪). */
    private fun importEmbeddedDatabase(target: javax.sql.DataSource) {
        if (database.dialect == net.artisanmc.modules.api.DatabaseDialect.H2) return
        val file = File(dataFolder, "database/${net.artisanmc.plugin.database.ConnectionPools.H2_FILE}.mv.db")
        if (!file.isFile) return
        val embedded = net.artisanmc.plugin.database.ConnectionPools(
            { net.artisanmc.plugin.database.DatabaseSettings.of("h2", "", "0", "", "", "", 1, dataFolder) }, logger,
        )
        try {
            // The file may come from an older release: its tables are brought to this schema before they are read.
            val source = embedded.dataSource("Artisan-import").also { net.artisanmc.plugin.database.ArtisanSchema.migrate(it, net.artisanmc.modules.api.DatabaseDialect.H2, logger) }
            net.artisanmc.plugin.database.EmbeddedImport.run(source, target, database.dialect, serverId, logger)
        } catch (e: Exception) {
            logger.warning("[Artisan] History of the embedded database not imported: ${e.message}")
        } finally {
            embedded.closeAll()
        }
    }

    /** The other servers of `artisan_servers` by server id, with their name and last presence, cached a few seconds; null without a registry. */
    fun knownServers(): Map<String, net.artisanmc.plugin.hub.Servers.Seen>? {
        val registry = serverRegistry ?: return null
        knownCache?.takeIf { System.currentTimeMillis() - it.first < 5_000 }?.let { return it.second }
        return runCatching { registry.others(serverId).associate { it.uuid to net.artisanmc.plugin.hub.Servers.Seen(it.name, it.lastSeen) } }.getOrNull()
            ?.also { knownCache = System.currentTimeMillis() to it }
    }

    /** The suite database's id (`artisan_meta`), what a hub and its leaves compare; null while it is not open. */
    fun databaseId(): String? =
        artisanData?.let { runCatching { net.artisanmc.plugin.database.ArtisanMeta.databaseId(it) }.getOrNull() }

    /** The `artisan_servers` row of a server id: this server's, read once, else looked up. */
    private fun row(server: String): Int? {
        if (server == serverId.toString()) return serverRow
        val id = runCatching { UUID.fromString(server) }.getOrNull() ?: return null
        return serverRegistry?.rowId(id)
    }

    /**
     * `artisan_editor_sessions` once the suite database is open; before that, and when it fails,
     * the sessions in memory alone: signed-in players stay signed in until a restart.
     */
    fun editorSessionStore() = object : net.artisanmc.plugin.hub.SessionStore {
        private fun <T> safe(block: (net.artisanmc.plugin.database.EditorSessionRows) -> T): T? {
            val rows = net.artisanmc.plugin.database.EditorSessionRows(artisanData ?: return null)
            return runCatching { block(rows) }.onFailure { logger.warning("[Artisan] Editor sessions not stored: ${it.message}") }.getOrNull()
        }

        override fun put(key: String, session: net.artisanmc.plugin.hub.EditorSession) {
            safe { it.put(key, net.artisanmc.plugin.database.EditorSessionRow(session.playerId, session.playerName, session.permissions, session.expiresAt, session.origin)) }
        }
        override fun get(key: String) = safe { it.get(key) }?.let {
            net.artisanmc.plugin.hub.EditorSession("", it.playerId, it.playerName, it.permissions, it.expiresAt, it.origin)
        }
        override fun touch(key: String, expiresAt: java.time.Instant) { safe { it.touch(key, expiresAt) } }
        override fun delete(key: String) { safe { it.delete(key) } }
        override fun purge(now: java.time.Instant) { safe { it.purge(now) } }
        override fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>) { safe { it.setPermissions(playerId, origin, permissions) } }
        override fun deletePlayer(playerId: UUID, origin: String?) = safe { it.deletePlayer(playerId, origin) } ?: 0
    }

    /** The Versions still queued are written, within 5 s. */
    fun stopWriter() {
        versionWriter.shutdown()
        versionWriter.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS)
    }

    /** Marks this server stopped in `artisan_servers`. */
    fun unregister() {
        serverRegistry?.let { registry -> runCatching { registry.stop(serverId) } }
    }
}
