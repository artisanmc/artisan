package net.artisanmc.plugin.importing

import net.artisanmc.modules.api.importing.ImportRegistry
import net.artisanmc.modules.api.importing.ImportReport
import net.artisanmc.modules.api.importing.ImportRequest
import net.artisanmc.modules.api.importing.Importer
import net.artisanmc.modules.api.importing.ImporterDeclaration
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ImportRunsTest {
    private class MemoryLog : ImportRunLog {
        val runs = mutableListOf<ImportRun>()
        override fun record(run: ImportRun) { runs += run }
        override fun findApplied(batch: String) = runs.firstOrNull { it.batch == batch && it.applied && it.action == "apply" }
        override fun recent(limit: Int) = runs.reversed().take(limit)
    }

    /** Writes every record once, like a module with its ledger. */
    private class FakeImporter(val records: List<String>, val blocker: String? = null) : Importer {
        val written = mutableMapOf<String, String>() // record → batch
        var requests = mutableListOf<ImportRequest>()
        var gate: CountDownLatch? = null

        private fun report(r: ImportRequest, dry: Boolean): ImportReport {
            requests += r
            gate?.await(5, TimeUnit.SECONDS)
            val b = ImportReport.builder(dry, r.batch)
            blocker?.let { b.blocker(it) }
            val todo = records.filter { it !in written }
            if (!dry && blocker == null) todo.forEach { written[it] = r.batch }
            return b.count("listings", "Listings", todo.size).alreadyImported(records.size - todo.size).build()
        }

        override fun plan(request: ImportRequest) = report(request, true)
        override fun apply(request: ImportRequest) = report(request, false)
        override fun rollback(batch: String, dryRun: Boolean): ImportReport {
            val mine = written.filterValues { it == batch }.keys
            if (!dryRun) mine.forEach(written::remove)
            return ImportReport.builder(dryRun, batch).count("listings", "Listings", mine.size).build()
        }
    }

    private val dir: Path = Files.createTempDirectory("imports")
    private val log = MemoryLog()
    private var running: String? = null
    private var n = 0
    private val registry = ImportRegistry()
    private val runs = ImportRuns(registry, log, dir, { names -> running?.takeIf { r -> names.any { r.startsWith(it, true) } } }, { 1000L }, { "b${++n}" })

    private fun register(id: String, importer: Importer, readsFile: Boolean = false) =
        registry.register(ImporterDeclaration(id, id, listOf("zAuctionHouse"), readsFile, importer))

    @Test
    fun `a dry run writes nothing, confirm writes once, a second confirm skips`() {
        val imp = FakeImporter(listOf("a", "b"))
        register("auctions:zah", imp)

        val plan = assertIs<Outcome.Done>(runs.run("auctions:zah", null, false, "console", "fr"))
        assertTrue(plan.report.isDryRun)
        assertNull(plan.report.batch)
        assertTrue(imp.written.isEmpty())
        assertEquals("fr", imp.requests.single().lang)

        val apply = assertIs<Outcome.Done>(runs.run("auctions:zah", null, true, "console", "en"))
        assertEquals("b2", apply.report.batch)
        assertEquals(2, apply.report.total())

        val again = assertIs<Outcome.Done>(runs.run("auctions:zah", null, true, "console", "en"))
        assertEquals(0, again.report.total())
        assertEquals(2, again.report.alreadyImported)
        assertEquals(listOf("plan", "apply", "apply"), log.runs.map { it.action })
        assertEquals(listOf(false, true, true), log.runs.map { it.applied })
        assertTrue(log.runs[1].reportJson.contains("\"already_imported\":0"))
    }

    @Test
    fun `apply is refused while the source plugin runs, a plan is not`() {
        register("auctions:zah", FakeImporter(listOf("a")))
        running = "zAuctionHouse-4.0"
        assertIs<Outcome.Done>(runs.run("auctions:zah", null, false, "console", "en"))
        val refused = assertIs<Outcome.Refused>(runs.run("auctions:zah", null, true, "console", "en"))
        assertEquals("conflict_running", refused.refusal.code)
        assertEquals("zAuctionHouse-4.0", refused.refusal.args["plugin"])
    }

    @Test
    fun `a blocker writes nothing and logs no applied batch`() {
        val imp = FakeImporter(listOf("a"), blocker = "unknown currency gems")
        register("auctions:zah", imp)
        val done = assertIs<Outcome.Done>(runs.run("auctions:zah", null, true, "console", "en"))
        assertTrue(done.report.isDryRun)
        assertTrue(imp.written.isEmpty())
        assertFalse(log.runs.single().applied)
        assertEquals("unknown_batch", assertIs<Outcome.Refused>(runs.rollback(done.batch, true, "console")).refusal.code)
    }

    @Test
    fun `rollback undoes one applied batch, dry run first`() {
        val imp = FakeImporter(listOf("a", "b"))
        register("auctions:zah", imp)
        val batch = assertIs<Outcome.Done>(runs.run("auctions:zah", null, true, "console", "en")).batch

        val dry = assertIs<Outcome.Done>(runs.rollback(batch, false, "console"))
        assertEquals(2, dry.report.total())
        assertEquals(2, imp.written.size)

        assertIs<Outcome.Done>(runs.rollback(batch, true, "console"))
        assertTrue(imp.written.isEmpty())
        assertEquals(batch, log.runs.last().target)
        assertEquals("rollback", log.runs.last().action)
    }

    @Test
    fun `a file is read only from the imports folder`() {
        val imp = FakeImporter(listOf("a"))
        register("auctions:json", imp, readsFile = true)
        Files.writeString(dir.resolve("listings.json"), "{}")

        assertEquals("file_required", assertIs<Outcome.Refused>(runs.run("auctions:json", null, false, "c", "en")).refusal.code)
        for (bad in listOf("../etc/passwd", "sub/x.json", ".hidden", "missing.json")) {
            assertEquals("bad_file", assertIs<Outcome.Refused>(runs.run("auctions:json", bad, false, "c", "en")).refusal.code, bad)
        }
        assertIs<Outcome.Done>(runs.run("auctions:json", "listings.json", false, "c", "en"))
        assertEquals(dir.resolve("listings.json").toAbsolutePath().normalize(), imp.requests.single().file)
    }

    @Test
    fun `one run at a time per module, and a failure is reported`() {
        val slow = FakeImporter(listOf("a")).apply { gate = CountDownLatch(1) }
        register("auctions:zah", slow)
        register("auctions:other", object : Importer {
            override fun plan(request: ImportRequest): ImportReport = error("source unreadable")
            override fun apply(request: ImportRequest): ImportReport = error("source unreadable")
            override fun rollback(batch: String, dryRun: Boolean): ImportReport = error("no")
        })
        val t = thread { runs.run("auctions:zah", null, false, "c", "en") }
        while (slow.requests.isEmpty()) Thread.sleep(5)
        assertEquals("busy", assertIs<Outcome.Refused>(runs.run("auctions:other", null, false, "c", "en")).refusal.code)
        slow.gate!!.countDown(); t.join()

        val failed = assertIs<Outcome.Refused>(runs.run("auctions:other", null, false, "c", "en"))
        assertEquals("failed", failed.refusal.code)
        assertEquals("source unreadable", failed.refusal.args["error"])
        assertEquals("unknown_source", assertIs<Outcome.Refused>(runs.run("quests:nope", null, false, "c", "en")).refusal.code)
    }
}
