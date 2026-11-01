package net.artisanmc.modules.triggers

import com.fasterxml.jackson.core.util.DefaultIndenter
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter
import com.fasterxml.jackson.core.util.Separators
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * `testdata/core-game-events.json` is Artisan's catalog of Game events as the editor reads it,
 * in the `declared_game_events` wire shape of Presence: the editor's event picker works from it
 * without a server, and a server's announcement adds the modules' own events.
 *
 * Regenerate with `ARTISAN_WRITE_VECTORS=1 ./gradlew :artisan-paper:test --tests '*CoreGameEventsVectorTest*'`.
 */
class CoreGameEventsVectorTest {
    private val mapper = ObjectMapper()
    private val printer = DefaultPrettyPrinter()
        .withSeparators(Separators.createDefaultInstance().withObjectFieldValueSpacing(Separators.Spacing.AFTER))
        .withArrayIndenter(DefaultIndenter.SYSTEM_LINEFEED_INSTANCE)

    private fun vectorFile(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val testdata = File(dir, "testdata")
            if (testdata.isDirectory) return File(testdata, "core-game-events.json")
            dir = dir.parentFile
        }
        error("testdata/ not found from ${System.getProperty("user.dir")}")
    }

    private fun generated(): JsonNode = mapper.valueToTree(
        linkedMapOf(
            "note" to "Artisan's catalog of Game events, generated from plugin/paper CoreGameEvents.kt " +
                "(CoreGameEventsVectorTest keeps it equal; regenerate with ARTISAN_WRITE_VECTORS=1). " +
                "Entries are in the declared_game_events wire shape of Presence. The editor imports this " +
                "file as its table of core events (modules/triggers/gameEvents.ts).",
            "events" to (CoreGameEvents.ALL.map { it.declaration } + CoreGameEvents.FIRED_BY_ARTISAN).map { it.toWire() },
        ),
    )

    @Test fun `the shared vector is the core catalog`() {
        val file = vectorFile()
        val expected = generated()
        if (System.getenv("ARTISAN_WRITE_VECTORS") == "1") {
            file.writeText(mapper.writer(printer).writeValueAsString(expected) + "\n")
        }
        assertEquals(
            expected,
            mapper.readTree(file),
            "testdata/core-game-events.json differs from CoreGameEvents: regenerate it with ARTISAN_WRITE_VECTORS=1",
        )
    }
}
