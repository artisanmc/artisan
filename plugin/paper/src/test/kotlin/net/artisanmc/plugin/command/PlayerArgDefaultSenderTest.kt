package net.artisanmc.plugin.command

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.plugin.lang.LangManager
import org.bukkit.entity.Player
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * `/dailyq [player]` — the argument is optional and falls back to whoever typed the
 * command, so a menu can always forward a target without the author writing a
 * branch for the common case.
 */
class PlayerArgDefaultSenderTest {
    private lateinit var server: ServerMock
    private lateinit var sender: Player
    private lateinit var lang: LangManager

    @BeforeEach fun setup() {
        server = MockBukkit.mock()
        sender = server.addPlayer("Iban_")
        lang = LangManager(emptyMap(), "en", false)
    }

    @AfterEach fun teardown() = MockBukkit.unmock()

    private fun defs(raw: Map<String, Any>) = ArgDefParser.parseAll(listOf(raw))

    @Test
    fun `an omitted player argument falls back to the sender`() {
        val parsed = ArgParser.parse(
            defs(mapOf("name" to "target", "type" to "player", "required" to false, "default" to "{sender}")),
            emptyArray(), sender, lang,
        )

        assertEquals(sender, parsed?.get("target"))
    }

    @Test
    fun `an explicit player still wins over the fallback`() {
        val other = server.addPlayer("Steve")

        val parsed = ArgParser.parse(
            defs(mapOf("name" to "target", "type" to "player", "required" to false, "default" to "{sender}")),
            arrayOf("Steve"), sender, lang,
        )

        assertEquals(other, parsed?.get("target"))
    }

    /** Without the flag the argument stays absent — unchanged behaviour. */
    @Test
    fun `an omitted argument without the flag binds nothing`() {
        val parsed = ArgParser.parse(
            defs(mapOf("name" to "target", "type" to "player", "required" to false)),
            emptyArray(), sender, lang,
        )

        assertTrue(parsed != null)
        assertNull(parsed?.get("target"))
    }

    /** A console sender has no player to fall back to; the argument simply stays absent. */
    @Test
    fun `the fallback is skipped for a non-player sender`() {
        val parsed = ArgParser.parse(
            defs(mapOf("name" to "target", "type" to "player", "required" to false, "default" to "{sender}")),
            emptyArray(), server.consoleSender, lang,
        )

        assertTrue(parsed != null)
        assertNull(parsed?.get("target"))
    }
}
