package net.artisanmc.plugin.hub

import java.io.File
import java.nio.file.Files
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull

class PlayerPrefsTest {
    private val dir = Files.createTempDirectory("prefs").toFile()
    private val prefs = PlayerPrefs(dir)
    private val player = UUID.randomUUID()

    private fun patch(json: String) = prefs.update(player, Call.mapper.readTree(json))

    @Test
    fun `the tour follows the backend rules`() {
        assertEquals(true, patch("""{"editor_tour":{"action":"start"}}""").second)
        assertEquals(false, patch("""{"editor_tour":{"action":"start"}}""").second)
        patch("""{"editor_tour":{"action":"complete"}}""")
        assertEquals(PlayerPrefs.Tour(6, true), patch("""{"editor_tour":{"action":"progress","step":2}}""").first.editorTour)
        assertEquals(PlayerPrefs.Tour(6, true), patch("""{"editor_tour":{"action":"import","step":1,"completed":false}}""").first.editorTour)
    }

    @Test
    fun `only known keys are kept, and null clears a value`() {
        patch("""{"theme":"light","editor_language":"en","admin":true}""")
        assertEquals(setOf("editorLanguage", "theme", "editorTour"), Call.mapper.readTree(File(dir, "$player.json")).fieldNames().asSequence().toSet())
        patch("""{"theme":null}""")
        assertNull(prefs.read(player).theme)
        assertEquals("en", prefs.read(player).editorLanguage)
        assertFailsWith<PlayerPrefs.InvalidPrefs> { patch("""{"editor_language":"../../etc"}""") }
        assertFalse(File(dir, "$player.json.tmp").exists())
    }

    @Test
    fun `a damaged file reads as no preferences`() {
        File(dir, "$player.json").writeText("{not json")
        assertEquals(PlayerPrefs.Prefs(), prefs.read(player))
    }
}
