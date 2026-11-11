package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.lang.LangManager
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import kotlin.test.*

class LangManagerTest {

    private val en = mapOf(
        "test.hello"    to "<green>Hello!</green>",
        "test.greeting" to "Hi, {name}!",
        "test.only_en"  to "English only",
    )
    private val fr = mapOf(
        "test.hello"    to "<green>Bonjour !</green>",
        "test.greeting" to "Salut, {name} !",
    )
    private val plain = PlainTextComponentSerializer.plainText()

    @Test fun `resolves key from requested language`() {
        val lm = LangManager(mapOf("en" to en, "fr" to fr), "en", false)
        assertEquals("Bonjour !", plain.serialize(lm.get("test.hello", "fr")))
    }

    @Test fun `falls back to default lang when key missing in requested lang`() {
        val lm = LangManager(mapOf("en" to en, "fr" to fr), "en", false)
        assertEquals("English only", plain.serialize(lm.get("test.only_en", "fr")))
    }

    @Test fun `falls back to key itself when missing everywhere`() {
        val lm = LangManager(mapOf("en" to en), "en", false)
        assertEquals("nonexistent.key", plain.serialize(lm.get("nonexistent.key", "en")))
    }

    @Test fun `substitutes placeholder args`() {
        val lm = LangManager(mapOf("en" to en), "en", false)
        assertEquals("Hi, Steve!", plain.serialize(lm.get("test.greeting", "en", "name" to "Steve")))
    }

    @Test fun `getRaw returns raw MiniMessage string with substitution`() {
        val lm = LangManager(mapOf("en" to en), "en", false)
        assertEquals("Hi, Steve!", lm.getRaw("test.greeting", "en", "name" to "Steve"))
    }

    @Test fun `playerLang returns defaultLang when perPlayerLanguage is false`() {
        MockBukkit.mock()
        val player = MockBukkit.getMock()!!.addPlayer()
        val lm = LangManager(mapOf("en" to en, "fr" to fr), "fr", false)
        assertEquals("fr", lm.playerLang(player))
        MockBukkit.unmock()
    }

    @Test fun `playerLang returns defaultLang for console sender regardless of setting`() {
        MockBukkit.mock()
        val console = MockBukkit.getMock()!!.consoleSender
        val lm = LangManager(mapOf("en" to en, "fr" to fr), "en", true)
        assertEquals("en", lm.playerLang(console))
        MockBukkit.unmock()
    }

    @Test fun `playerLang returns matching lang when perPlayerLanguage true and lang available`() {
        // MockBukkit players default to "en" locale. With "en" in translations and defaultLang="fr",
        // playerLang should return "en" (the player's locale matches a translation).
        MockBukkit.mock()
        val player = MockBukkit.getMock()!!.addPlayer()
        val lm = LangManager(mapOf("en" to en, "fr" to fr), "fr", true)
        assertEquals("en", lm.playerLang(player))
        MockBukkit.unmock()
    }

    @Test fun `playerLang falls back to defaultLang when player locale not in translations`() {
        // MockBukkit player has "en" locale. Translations only have "fr". Falls back to "fr".
        MockBukkit.mock()
        val player = MockBukkit.getMock()!!.addPlayer()
        val lm = LangManager(mapOf("fr" to fr), "fr", true)
        assertEquals("fr", lm.playerLang(player))
        MockBukkit.unmock()
    }
}
