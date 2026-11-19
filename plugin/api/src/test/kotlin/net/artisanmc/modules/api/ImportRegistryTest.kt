package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue
import net.artisanmc.modules.api.importing.ImportRegistry
import net.artisanmc.modules.api.importing.ImportReport
import net.artisanmc.modules.api.importing.ImportRequest
import net.artisanmc.modules.api.importing.Importer
import net.artisanmc.modules.api.importing.ImporterDeclaration

class ImportRegistryTest {
    private val none = object : Importer {
        override fun plan(request: ImportRequest) = ImportReport.builder(true, request.batch).build()
        override fun apply(request: ImportRequest) = ImportReport.builder(false, request.batch).build()
        override fun rollback(batch: String, dryRun: Boolean) = ImportReport.builder(dryRun, batch).build()
    }

    private fun decl(id: String) = ImporterDeclaration(id, id, listOf("zAuctionHouse"), false, none)

    @Test
    fun `sources belong to their module and leave with it`() {
        val reg = ImportRegistry()
        reg.bindOwner("auctions")
        reg.register(decl("auctions:zauctionhouse"))
        reg.register(decl("auctions:json"))
        assertEquals("module 'auctions' cannot register the import source 'quests:bq'",
            assertFailsWith<IllegalStateException> { reg.register(decl("quests:bq")) }.message)
        assertFailsWith<IllegalStateException> { reg.register(decl("auctions:json")) }
        reg.bindOwner(null)
        reg.register(decl("quests:bq"))

        assertEquals(listOf("auctions:zauctionhouse", "auctions:json", "quests:bq"), reg.registered().map { it.id })
        reg.unregisterOwnedBy("auctions")
        assertEquals(listOf("quests:bq"), reg.registered().map { it.id })
        reg.unregister("quests:bq")
        assertNull(reg.find("quests:bq"))
    }

    @Test
    fun `ids are module and source`() {
        for (bad in listOf("auctions", "Auctions:x", "auctions:", ":x", "auctions:a/b")) {
            assertFailsWith<IllegalArgumentException>(bad) { decl(bad) }
        }
        assertEquals("auctions", decl("auctions:zauctionhouse-v3").module())
    }

    @Test
    fun `a blocker turns a write into a dry run with no batch`() {
        val r = ImportReport.builder(false, "b1").count("listings", "Listings", 3).blocker("unknown currency gems").build()
        assertTrue(r.isDryRun)
        assertNull(r.batch)
        assertEquals(3, r.total())
        assertEquals("b1", ImportReport.builder(false, "b1").build().batch)
    }
}
