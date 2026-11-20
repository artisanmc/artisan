package net.artisanmc.plugin.importing

import net.artisanmc.modules.api.importing.ImportRegistry
import net.artisanmc.modules.api.importing.ImportReport
import net.artisanmc.modules.api.importing.ImportRequest
import net.artisanmc.modules.api.importing.Importer
import net.artisanmc.modules.api.importing.ImporterDeclaration
import net.artisanmc.plugin.protocol.EditorRequest
import net.artisanmc.plugin.protocol.Replies
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** `imports_fetch` and `import_start`, as the editor's imports screen sends them. */
class ImportRequestsTest {
    private class MemoryLog : ImportRunLog {
        val runs = mutableListOf<ImportRun>()
        override fun record(run: ImportRun) { runs += run }
        override fun findApplied(batch: String) = runs.firstOrNull { it.batch == batch && it.applied && it.action == "apply" }
        override fun recent(limit: Int) = runs.reversed().take(limit)
    }

    private val dir = Files.createTempDirectory("imports").also { Files.writeString(it.resolve("a.json"), "{}"); Files.writeString(it.resolve(".hidden"), "") }
    private val log = MemoryLog()
    private var n = 0
    private var conflict: String? = null
    private val registry = ImportRegistry()
    private val runs = ImportRuns(registry, log, dir, { conflict }, { 1000L }, { "b${++n}" })
    private val sent = mutableListOf<Map<String, Any?>>()
    /** Tasks wait here until the test runs them: the reply to a start must not wait for the run. */
    private val queued = ArrayDeque<() -> Unit>()
    private val requests = ImportRequests(Replies(Runnable::run, { sent += it }, null), { runs }) { queued += it }
    private var written = 0

    private fun drain() { while (queued.isNotEmpty()) queued.removeFirst()() }

    init {
        registry.register(ImporterDeclaration("auctions:zah", "zAuctionHouse", listOf("zAuctionHouse"), false, object : Importer {
            override fun plan(request: ImportRequest) = ImportReport.builder(true, request.batch).count("listings", "Listings", 2).reject("7", "active_bid", "has a bid").build()
            override fun apply(request: ImportRequest): ImportReport {
                written = 2
                return ImportReport.builder(false, request.batch).count("listings", "Listings", 2).build()
            }
            override fun rollback(batch: String, dryRun: Boolean): ImportReport {
                if (!dryRun) written = 0
                return ImportReport.builder(dryRun, batch).count("records", "Records", 2).build()
            }
        }))
        registry.register(ImporterDeclaration("quests:broken", "Broken", emptyList(), false, object : Importer {
            override fun plan(request: ImportRequest): ImportReport = error("unreadable")
            override fun apply(request: ImportRequest): ImportReport = error("stopped midway")
            override fun rollback(batch: String, dryRun: Boolean) = ImportReport.builder(dryRun, batch).build()
        }))
    }

    private fun start(action: String, source: String? = null, batch: String? = null, confirm: Boolean = false): Map<String, Any?> {
        sent.clear()
        requests.start(EditorRequest.ImportStart("r", action, source, null, batch, confirm, "Iban", "en"))
        drain()
        return sent.single()
    }

    private fun fetch(): Map<String, Any?> {
        sent.clear()
        requests.fetch(EditorRequest.ImportsFetch("r"))
        drain()
        return sent.single()
    }

    @Suppress("UNCHECKED_CAST")
    private fun list(reply: Map<String, Any?>, key: String) = reply[key] as List<Map<String, Any?>>

    @Test
    fun `a start answers with its batch, and the run is read back from the history`() {
        assertEquals(mapOf("type" to "import_started", "request_id" to "r", "ok" to true, "batch" to "b1"), start("run", "auctions:zah"))
        val plan = list(fetch(), "runs").single()
        assertEquals("plan", plan["action"])
        assertEquals(false, plan["applied"])
        @Suppress("UNCHECKED_CAST") val report = plan["report"] as Map<String, Any?>
        assertEquals(true, report["dry_run"])
        assertEquals(listOf(mapOf("source_id" to "7", "code" to "active_bid", "message" to "has a bid")), report["rejected"])

        assertEquals("b2", start("run", "auctions:zah", confirm = true)["batch"])
        assertEquals(2, written)
        assertEquals("b3", start("rollback", batch = "b2", confirm = true)["batch"])
        assertEquals(0, written)
        val last = list(fetch(), "runs").first()
        assertEquals(listOf("rollback", "b2", true), listOf(last["action"], last["target"], last["applied"]))
    }

    @Test
    fun `a refusal is the reply, with what it is about`() {
        conflict = "zAuctionHouse"
        assertEquals(listOf(false, "conflict_running", "zAuctionHouse"), start("run", "auctions:zah", confirm = true).let { listOf(it["ok"], it["error"], it["message"]) })
        assertEquals("unknown_source", start("run", "auctions:nope")["error"])
        assertEquals("unknown_batch", start("rollback", batch = "zz")["error"])
        assertEquals("invalid_input", start("run")["error"])
        assertEquals("invalid_input", start("purge")["error"])
        assertEquals(emptyList(), log.runs)
    }

    @Test
    fun `the listing says what stops a source, which files can be named and what runs`() {
        conflict = "zAuctionHouse"
        val reply = fetch()
        val zah = list(reply, "sources").first()
        assertEquals(listOf("auctions:zah", "auctions", false, "zAuctionHouse"), listOf(zah["id"], zah["module"], zah["reads_file"], zah["conflict_running"]))
        assertEquals(listOf("a.json"), reply["files"])
        assertEquals(emptyList<Any>(), reply["active"])

        // A run accepted and not finished yet is listed as active, and its module is taken.
        val ready = runs.prepare("auctions:zah", null, false, "Iban", "en") as Start.Ready
        val active = list(fetch(), "active").single()
        assertEquals(listOf(ready.batch, "auctions:zah", "plan"), listOf(active["batch"], active["source"], active["action"]))
        assertEquals("busy", start("run", "auctions:zah")["error"])
        ready.run()
        assertEquals(emptyList<Any>(), fetch()["active"])
    }

    @Test
    fun `a run that throws is logged, and a failed apply keeps a batch to roll back`() {
        val planned = start("run", "quests:broken")
        assertEquals(true, planned["ok"])
        val failedPlan = log.runs.single()
        assertEquals(listOf("plan", false), listOf(failedPlan.action, failedPlan.applied))
        assertEquals("""{"failed":"unreadable"}""", failedPlan.reportJson)

        val batch = start("run", "quests:broken", confirm = true)["batch"] as String
        assertEquals(listOf("apply", true), log.runs.last().let { listOf(it.action, it.applied) })
        assertEquals(true, start("rollback", batch = batch)["ok"])
        assertNull(runs.active().firstOrNull())
    }

    @Test
    fun `without imports on this server, the editor is told so`() {
        val none = ImportRequests(Replies(Runnable::run, { sent += it }, null), { null }) { it() }
        none.fetch(EditorRequest.ImportsFetch("r"))
        assertEquals("imports_unavailable", sent.single()["error"])
    }
}
