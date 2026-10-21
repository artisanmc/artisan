package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue
import net.artisanmc.modules.api.template.TemplateDeclaration
import net.artisanmc.modules.api.template.TemplateRegistry

/** Module templates: example content a module offers to copy into any project. */
class TemplateRegistryTest {

    private fun template(id: String = "daily", version: Int = 1) =
        TemplateDeclaration.builder(id, version).file("quest_groups/$id.yaml", "key: $id\n".toByteArray()).build()

    @Test
    fun `templates are owned by the module registering them and leave with it`() {
        val reg = TemplateRegistry()
        reg.bindOwner("quests")
        reg.register(template("daily"))
        reg.register(template("weekly"))
        reg.bindOwner("shop")
        reg.register(template("daily"))
        reg.bindOwner(null)

        assertEquals(listOf("daily", "weekly"), reg.of("quests").map { it.id })
        assertEquals("daily", reg.find("shop", "daily")?.id)
        assertNull(reg.find("shop", "weekly"))
        assertEquals(listOf("quests", "shop"), reg.registered().keys.toList())

        reg.unregisterOwnedBy("quests")
        assertTrue(reg.of("quests").isEmpty())
        assertEquals(listOf("shop"), reg.registered().keys.toList())
    }

    @Test
    fun `one template per id and module, and only from a module's onEnable`() {
        val reg = TemplateRegistry()
        assertFailsWith<IllegalStateException> { reg.register(template()) }
        reg.bindOwner("quests")
        reg.register(template())
        assertEquals(
            "module 'quests' already registered the template 'daily'",
            assertFailsWith<IllegalStateException> { reg.register(template()) }.message,
        )
    }

    @Test
    fun `the declaration hashes its files and announces them without content`() {
        val decl = TemplateDeclaration.builder("daily", 2)
            .title("Daily quests")
            .seed("quests")
            .file("menus/daily.yaml", "abc".toByteArray())
            .build()
        // SHA-256("abc"), the FIPS 180-2 test vector.
        val abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        assertEquals(abc, decl.getHash("menus/daily.yaml"))
        assertContentEquals("abc".toByteArray(), decl.getFile("menus/daily.yaml"))
        assertNull(decl.getFile("other.yaml"))
        assertEquals(
            mapOf(
                "id" to "daily", "title" to "Daily quests", "version" to 2, "seed_project" to "quests",
                "files" to listOf(mapOf("path" to "menus/daily.yaml", "hash" to abc, "size" to 3)),
            ),
            decl.toWire(),
        )
    }

    @Test
    fun `invalid ids, versions, paths and seeds are refused`() {
        assertFailsWith<IllegalArgumentException> { TemplateDeclaration.builder("Daily", 1) }
        assertFailsWith<IllegalArgumentException> { TemplateDeclaration.builder("daily", 0) }
        val builder = TemplateDeclaration.builder("daily", 1)
        for (path in listOf("../x.yaml", "/x.yaml", ".artisan/origins.yaml", "a//b.yaml", "menus/", "manifest.yaml")) {
            assertFailsWith<IllegalArgumentException>(path) { builder.file(path, ByteArray(0)) }
        }
        builder.file("a.yaml", ByteArray(0))
        assertFailsWith<IllegalArgumentException> { builder.file("a.yaml", ByteArray(0)) }
        assertFailsWith<IllegalArgumentException> { builder.seed("../quests") }
        assertFailsWith<IllegalArgumentException> {
            TemplateDeclaration.builder("big", 1).file("a.bin", ByteArray(TemplateDeclaration.MAX_SIZE + 1)).build()
        }
    }

    @Test
    fun `a template reads its files from a module's resources`() {
        val loader = object : ClassLoader(null) {
            override fun getResourceAsStream(name: String) =
                if (name == "artisan-templates/daily/a.yaml") "a: 1".byteInputStream() else null
        }
        val decl = TemplateDeclaration.fromResources(loader, "artisan-templates/daily", "daily", 1, listOf("a.yaml")).build()
        assertEquals("a: 1", String(decl.getFile("a.yaml")!!))
        assertFailsWith<IllegalArgumentException> {
            TemplateDeclaration.fromResources(loader, "artisan-templates/daily", "daily", 1, listOf("missing.yaml"))
        }
    }
}
