package net.artisanmc.plugin

import java.io.File
import java.util.UUID

/** Presence refresh and editor permission reports: every minute. */
internal const val HEARTBEAT_TICKS = 20L * 60
private const val PURGE_TICKS = 20L * 60 * 60 * 24

/** The `artisan_settings` row of the assistant's settings (ADR `editor-assistant`). */
private const val AI_SETTING = "ai"

/** A peer that missed this many presence beats is left alone until it is seen again. */
private val PEER_WINDOW = java.time.Duration.ofMinutes(3)

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
    @Volatile private var serverRow: net.artisanmc.plugin.database.ServerRow? = null
    /** One writer: Versions are recorded in the order their Snapshots were loaded, after the database opened. */
    private val versionWriter = java.util.concurrent.Executors.newSingleThreadExecutor { Thread(it, "Artisan-versions").apply { isDaemon = true } }

    /** Each loaded Snapshot becomes Versions, then the loaded state, on [versionWriter] (rules in [net.artisanmc.plugin.project.VersionRecorder]). */
    private val versionRecorder by lazy {
        net.artisanmc.plugin.project.VersionRecorder(plugin.projectRoots, {
            val data = suiteData
            val row = serverRow
            if (data == null || row == null) null else net.artisanmc.plugin.database.SuiteVersionStorage(data, row)
        }, versionWriter, logger)
    }

    fun recordVersions(
        snapshot: net.artisanmc.plugin.project.ProjectSnapshot,
        authors: Map<String, net.artisanmc.plugin.project.PublicationAuthor>,
        done: () -> Unit,
    ) = versionRecorder.record(snapshot, authors, done)

    /** Where the editor sessions' rows are written, after the database opened: `/artisan editor` never waits for a connection. */
    fun sessionWriter(): java.util.concurrent.Executor = versionWriter

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
            database.dataSource(plugin).also { net.artisanmc.plugin.database.ArtisanSchema.migrate(it, database.dialect, logger, database.tables) }
        } catch (e: Exception) {
            logger.warning("[Artisan] Suite database unavailable, offline servers and history are disabled: ${e.message}")
            if (web.leaf) logger.severe("[Artisan] Not connecting to the hub: the suite database cannot be opened.")
            return
        }
        artisanData = data
        // Read here, on this thread, and kept: the hub link asks for it at each connection, from the main thread.
        runCatching { net.artisanmc.plugin.database.ArtisanMeta.databaseId(data, database.tables) }
        val name = plugin.networkName(web) ?: return
        val registry = net.artisanmc.plugin.database.ServerRegistry(data, database.dialect, logger, database.tables)
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
            logger.severe("[Artisan] Not registered in ${database.tables.servers}: $refused")
            return
        }
        serverRow = registry.rowId(serverId)
        importEmbeddedDatabase(data)
        val suite = net.artisanmc.plugin.database.SuiteProjectData(data, database.dialect, ::row, logger, tables = database.tables)
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
        if (database.dialect == net.artisanmc.modules.api.database.DatabaseDialect.H2) return
        val file = File(dataFolder, "database/${net.artisanmc.plugin.database.ConnectionPools.H2_FILE}.mv.db")
        if (!file.isFile) return
        val embedded = net.artisanmc.plugin.database.ConnectionPools(
            { net.artisanmc.plugin.database.DatabaseSettings.of("h2", "", "0", "", "", "", 1, dataFolder) }, logger,
        )
        try {
            // The file may come from an older release: its tables are brought to this schema before they are read.
            val source = embedded.dataSource("Artisan-import").also { net.artisanmc.plugin.database.ArtisanSchema.migrate(it, net.artisanmc.modules.api.database.DatabaseDialect.H2, logger, database.tables) }
            net.artisanmc.plugin.database.EmbeddedImport.run(source, target, database.dialect, serverId, logger, database.tables)
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

    /** Announces where this server's `/ws/plugin` answers (ADR `peer-servers`); false while the registry is not open. */
    fun advertise(editorUrl: String, internalUrl: String): Boolean {
        val registry = serverRegistry ?: return false
        return runCatching { registry.advertise(serverId, editorUrl, internalUrl) }
            .onFailure { logger.warning("[Artisan] Address not announced to the other servers: ${it.message}") }.isSuccess
    }

    /** The other servers that serve their own editor, seen in the last [PEER_WINDOW]; empty without a registry. */
    fun peers(): List<net.artisanmc.plugin.database.PeerServer> {
        val registry = serverRegistry ?: return emptyList()
        return runCatching { registry.peers(serverId, java.time.Instant.now().minus(PEER_WINDOW)) }.getOrElse { emptyList() }
    }

    /** The network secret peer servers share, kept once read; null while the database is not open. */
    fun peerSecret(): String? = peerSecret ?: artisanData?.let { data ->
        runCatching { net.artisanmc.plugin.database.ArtisanMeta.networkSecret(data, database.tables) }.getOrNull()?.also { peerSecret = it }
    }
    @Volatile private var peerSecret: String? = null

    /** The suite database's id (`artisan_meta`), what a hub and its leaves compare; null while it is not open. */
    fun databaseId(): String? =
        artisanData?.let { runCatching { net.artisanmc.plugin.database.ArtisanMeta.databaseId(it, database.tables) }.getOrNull() }

    /** The [net.artisanmc.plugin.database.ServerRow] of a server id: this server's, read once, else looked up. */
    private fun row(serverId: String): net.artisanmc.plugin.database.ServerRow? {
        if (serverId == this.serverId.toString()) return serverRow
        val id = runCatching { UUID.fromString(serverId) }.getOrNull() ?: return null
        return serverRegistry?.rowId(id)
    }

    /**
     * `artisan_editor_sessions` once the suite database is open; before that, and when it fails,
     * the sessions in memory alone: signed-in players stay signed in until a restart.
     */
    fun editorSessionStore() = object : net.artisanmc.plugin.hub.SessionStore {
        private fun <T> safe(block: (net.artisanmc.plugin.database.EditorSessionRows) -> T): T? {
            val rows = net.artisanmc.plugin.database.EditorSessionRows(artisanData ?: return null, database.tables)
            return runCatching { block(rows) }.onFailure { logger.warning("[Artisan] Editor sessions not stored: ${it.message}") }.getOrNull()
        }

        override fun put(key: String, session: net.artisanmc.plugin.hub.EditorSession) {
            val link = session.id == net.artisanmc.plugin.hub.Sessions.LINK
            safe { it.put(key, net.artisanmc.plugin.database.EditorSessionRow(session.playerId, session.playerName, session.permissions, session.expiresAt, session.origin, session.createdAt, link)) }
        }
        private fun session(row: net.artisanmc.plugin.database.EditorSessionRow) =
            net.artisanmc.plugin.hub.EditorSession("", row.playerId, row.playerName, row.permissions, row.expiresAt, row.origin, row.createdAt)
        override fun get(key: String) = safe { it.get(key) }?.let(::session)
        override fun list(now: java.time.Instant) = safe { it.list(now) }.orEmpty().map { (key, row) -> key to session(row) }
        override fun touch(key: String, expiresAt: java.time.Instant) { safe { it.touch(key, expiresAt) } }
        override fun delete(key: String) { safe { it.delete(key) } }
        override fun purge(now: java.time.Instant) { safe { it.purge(now) } }
        override fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>) { safe { it.setPermissions(playerId, origin, permissions) } }
        override fun deletePlayer(playerId: UUID, origin: String?) = safe { it.deletePlayer(playerId, origin) } ?: 0
    }

    /**
     * The MCP endpoint's clients and grants (ADR `mcp-server`): `artisan_mcp_*` once the suite
     * database is open; before that, in memory, lost on restart (a client signs in again).
     */
    fun mcpGrantStore(): net.artisanmc.plugin.hub.McpGrantStore = object : net.artisanmc.plugin.hub.McpGrantStore {
        private val memory = net.artisanmc.plugin.hub.MemoryMcpGrantStore()
        private fun store(): net.artisanmc.plugin.hub.McpGrantStore =
            artisanData?.let { net.artisanmc.plugin.database.McpGrantSql(net.artisanmc.plugin.database.McpGrantRows(it, database.tables)) } ?: memory

        override fun putClient(client: net.artisanmc.plugin.hub.McpClient) = store().putClient(client)
        override fun client(id: String) = store().client(id)
        override fun purgeClients(before: java.time.Instant) = store().purgeClients(before)
        override fun countClients() = store().countClients()
        override fun insert(grant: net.artisanmc.plugin.hub.McpGrant) = store().insert(grant)
        override fun replace(old: net.artisanmc.plugin.hub.McpGrant, new: net.artisanmc.plugin.hub.McpGrant) = store().replace(old, new)
        override fun find(credential: net.artisanmc.plugin.hub.McpGrantStore.Credential, hash: String) = store().find(credential, hash)
        override fun grants(playerId: UUID) = store().grants(playerId)
        override fun delete(id: String) = store().delete(id)
        override fun touch(id: String, at: java.time.Instant) = store().touch(id, at)
        override fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>) = store().setPermissions(playerId, origin, permissions)
        override fun setPublish(playerId: UUID, id: String, allow: Boolean) = store().setPublish(playerId, id, allow)
        override fun deletePlayer(playerId: UUID, origin: String?) = store().deletePlayer(playerId, origin)
        override fun purge(now: java.time.Instant) = store().purge(now)
    }

    /**
     * The assistant's settings saved from the editor (ADR `editor-assistant`): `artisan_settings`,
     * read by every hub of the database. Unreadable until the database is open.
     */
    fun aiSettingsStore(): net.artisanmc.plugin.hub.AiSettingsStore = object : net.artisanmc.plugin.hub.AiSettingsStore {
        private val mapper = com.fasterxml.jackson.databind.ObjectMapper()
        private fun rows() = net.artisanmc.plugin.database.SettingRows(artisanData ?: throw IllegalStateException("suite database not open"), database.tables)

        override fun read(): net.artisanmc.plugin.hub.AiConfig? {
            val node = rows().get(AI_SETTING)?.let(mapper::readTree) ?: return null
            fun text(field: String, default: String = "") = node.path(field).asText(default)
            return net.artisanmc.plugin.hub.AiConfig(
                provider = text("provider"),
                apiKey = text("apiKey"),
                model = text("model", net.artisanmc.plugin.hub.AiConfig.DEFAULT_MODEL),
                effort = text("effort", "medium"),
                maxSteps = node.path("maxSteps").asInt(25).coerceIn(1, 100),
                baseUrl = text("baseUrl"),
            )
        }

        override fun write(config: net.artisanmc.plugin.hub.AiConfig?) {
            if (config == null) return rows().delete(AI_SETTING).let {}
            val json = mapper.writeValueAsString(
                mapOf(
                    "provider" to config.provider, "apiKey" to config.apiKey, "model" to config.model,
                    "effort" to config.effort, "maxSteps" to config.maxSteps, "baseUrl" to config.baseUrl,
                ),
            )
            rows().put(AI_SETTING, json, java.time.Instant.now())
        }
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
