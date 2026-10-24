package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.translation.MessageBundleDeclaration
import net.artisanmc.plugin.lang.FileMessageSource
import net.artisanmc.plugin.lang.LangCodes
import net.artisanmc.plugin.lang.MessageFormat
import net.artisanmc.plugin.lang.Translations
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import java.io.File
import kotlin.test.*

class TranslationsTest {
    private val plain = PlainTextComponentSerializer.plainText()

    @Test fun `a code matches its region variants, the exact one first`() {
        assertEquals("fr_FR", LangCodes.match(listOf("en_EN", "fr_FR"), "fr"))
        assertEquals("fr", LangCodes.match(listOf("fr_FR", "fr"), "fr"))
        assertEquals("fr", LangCodes.match(listOf("en", "fr"), "fr_FR"))
        assertEquals("pt_BR", LangCodes.match(listOf("pt_PT", "pt_BR"), "pt-br"))
        assertNull(LangCodes.match(listOf("en"), "de"))
    }

    @Test fun `placeholders in the three syntaxes are replaced, unknown names kept`() {
        val out = MessageFormat.format("<a> {b} %c% %papi_x% <red>", mapOf("a" to 1, "b" to "two", "c" to "3"))
        assertEquals("1 two 3 %papi_x% <red>", out)
    }

    @Test fun `a placeholder value is text, its tags are not parsed`() {
        val t = Translations()
        val bundle = t.register("test", null, null) { mapOf("en" to mapOf("k" to "<green>Hi {name}</green>")) }
        val shown = bundle.get("en", "k", mapOf("name" to "<click:run_command:'/op me'>x"))
        assertEquals("Hi <click:run_command:'/op me'>x", plain.serialize(shown))
    }

    @Test fun `legacy renders a message as a section-coded string, hex colors included`() {
        val t = Translations()
        val bundle = t.register("test", null, null) { mapOf("en" to mapOf("k" to "<green>Hi <#ff8800>{name}")) }
        assertEquals("§aHi §x§f§f§8§8§0§0Bob", bundle.legacy("en", "k", mapOf("name" to "Bob")))
    }

    @Test fun `send delivers the message in the viewer's language`() {
        val server = MockBukkit.mock()
        try {
            val player = server.addPlayer()
            val t = Translations("fr", perPlayerLanguage = false)
            val bundle = t.register("test", null, null) { mapOf("en" to mapOf("k" to "hi"), "fr" to mapOf("k" to "<red>salut {name}")) }
            bundle.send(player, "k", mapOf("name" to "Bob"))
            assertEquals("salut Bob", plain.serialize(player.nextComponentMessage()!!))
        } finally {
            MockBukkit.unmock()
        }
    }

    @Test fun `a value is never read again for placeholders`() {
        assertEquals("{b} 2", MessageFormat.format("{a} {b}", mapOf("a" to "{b}", "b" to 2)))
    }

    @Test fun `a missing key falls back to the bundle's default, then en, then the key`() {
        val t = Translations(defaultLang = "fr")
        val bundle = t.register("test", null, null) {
            mapOf(
                "en" to mapOf("only_en" to "EN", "both" to "both-en"),
                "fr_FR" to mapOf("only_fr" to "FR", "both" to "both-fr"),
                "de" to mapOf(),
            )
        }
        assertEquals("both-fr", bundle.raw("de", "both"))
        assertEquals("EN", bundle.raw("de", "only_en"))
        assertEquals("FR", bundle.raw("fr", "only_fr"))
        assertEquals("nope", bundle.raw("fr", "nope"))
        assertEquals("fr_FR", bundle.defaultLang)
    }

    @Test fun `a declared default language overrides Artisan's`() {
        val t = Translations(defaultLang = "en")
        val bundle = t.register("test", null, "fr_FR") { mapOf("en" to mapOf("k" to "en"), "fr_FR" to mapOf("k" to "fr")) }
        assertEquals("fr_FR", bundle.defaultLang)
        assertEquals("fr", bundle.raw(bundle.defaultLang, "k"))
    }

    @Test fun `configure reaches the bundles already registered`() {
        val t = Translations(defaultLang = "en")
        val bundle = t.register("test", null, null) { mapOf("en" to mapOf("k" to "en"), "fr" to mapOf("k" to "fr")) }
        t.configure("fr", perPlayerLanguage = false)
        assertEquals("fr", bundle.defaultLang)
    }

    @Test fun `a failing reload keeps the previous translations`() {
        var fail = false
        val bundle = Translations().register("test", null, null) {
            if (fail) error("broken file") else mapOf("en" to mapOf("k" to "v"))
        }
        fail = true
        bundle.reload()
        assertEquals("v", bundle.raw("en", "k"))
    }

    @Test fun `namespaces are validated and unique`() {
        val t = Translations()
        assertFailsWith<IllegalArgumentException> { t.register("Bad-Name", null, null) { emptyMap() } }
        t.register("quests", null, null) { emptyMap() }
        assertFailsWith<IllegalStateException> { t.register("quests", null, null) { emptyMap() } }
        t.unregister("quests")
        t.register("quests", null, null) { emptyMap() }
        assertEquals(setOf("quests"), t.namespaces())
    }

    @Test fun `a plugin's bundles go when it disables`() {
        val server = MockBukkit.mock()
        try {
            val owner = MockBukkit.createMockPlugin("Owner")
            val t = Translations()
            t.register(MessageBundleDeclaration.of(owner, "owned") { emptyMap() })
            t.register("artisan", null, null) { emptyMap() }
            t.unregisterOwnedBy(owner)
            assertEquals(setOf("artisan"), t.namespaces())
            assertNotNull(server)
        } finally {
            MockBukkit.unmock()
        }
    }

    @Test fun `the language asked follows per_player_language`() {
        val server = MockBukkit.mock()
        try {
            val player = server.addPlayer()
            assertEquals("fr", Translations("fr", perPlayerLanguage = false).langOf(player))
            assertEquals("en", Translations("fr", perPlayerLanguage = true).langOf(player))
            assertEquals("fr", Translations("fr", perPlayerLanguage = true).langOf(server.consoleSender))
        } finally {
            MockBukkit.unmock()
        }
    }

    @Test fun `files merge the server's keys over the jar's, and add the server's languages`() {
        MockBukkit.mock()
        try {
            val plugin = MockBukkit.createMockPlugin("Files")
            val lang = File(plugin.dataFolder, "lang").apply { mkdirs() }
            File(lang, "en.yml").writeText("artisan:\n  reloaded: \"custom\"\n")
            File(lang, "de.yml").writeText("artisan:\n  reloaded: \"neu geladen\"\n")
            val tables = FileMessageSource.load(plugin, listOf("en", "fr"))
            assertEquals(setOf("en", "fr", "de"), tables.keys)
            assertEquals("custom", tables.getValue("en")["artisan.reloaded"])
            // Keys the server file does not hold come from the jar (Artisan's lang/en.yml on the test classpath).
            assertTrue("cmd.no_permission" in tables.getValue("en"))
            assertEquals("neu geladen", tables.getValue("de")["artisan.reloaded"])
        } finally {
            MockBukkit.unmock()
        }
    }

    @Test fun `inFolder moves the data folder's lang files into the module's folder once, and reads them there`() {
        MockBukkit.mock()
        val module = kotlin.io.path.createTempDirectory("artisan-module").toFile()
        try {
            val plugin = MockBukkit.createMockPlugin("Guilds")
            val lang = File(plugin.dataFolder, "lang").apply { mkdirs() }
            File(lang, "en.yml").writeText("artisan:\n  reloaded: \"custom\"\n")
            File(lang, "de.yml").writeText("artisan:\n  reloaded: \"server\"\n")
            File(module, "lang").mkdirs()
            File(module, "lang/de.yaml").writeText("artisan:\n  reloaded: \"module\"\n")

            val t = Translations()
            val bundle = t.register(MessageBundleDeclaration.files(plugin, "guilds", "en").inFolder(module))

            assertEquals("custom\n", File(module, "lang/en.yml").readText().substringAfter("reloaded: \"").replace("\"", ""))
            assertFalse(File(lang, "en.yml").exists())
            assertTrue(File(lang, "de.yml").isFile, "the module already has de: the server's file stays")
            assertEquals("custom", bundle.find("en", "artisan.reloaded"))
            assertEquals("module", bundle.find("de", "artisan.reloaded"))
            assertTrue(bundle.find("en", "cmd.no_permission") != null, "the jar answers the other keys")

            File(module, "lang/en.yml").writeText("artisan:\n  reloaded: \"published\"\n")
            t.reloadFolderBundles()
            assertEquals("published", bundle.find("en", "artisan.reloaded"))

            t.unregister("guilds")
            File(lang, "de.yml").delete()
            t.register(MessageBundleDeclaration.files(plugin, "guilds", "en").inFolder(module))
            assertFalse(lang.exists(), "an empty lang/ goes")
        } finally {
            module.deleteRecursively()
            MockBukkit.unmock()
        }
    }

    @Test fun `inFolder is for files, not a source of the plugin's own`() {
        MockBukkit.mock()
        try {
            val plugin = MockBukkit.createMockPlugin("Own")
            assertFailsWith<IllegalStateException> {
                MessageBundleDeclaration.of(plugin, "own") { emptyMap() }.inFolder(plugin.dataFolder)
            }
        } finally {
            MockBukkit.unmock()
        }
    }
}
