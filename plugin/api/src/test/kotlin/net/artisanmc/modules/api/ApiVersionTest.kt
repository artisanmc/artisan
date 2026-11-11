package net.artisanmc.modules.api

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

class ApiVersionTest {
    /** The generated constant must be what deploy/api-version.mjs publishes: the highest `Since`. */
    @Test
    fun `apiVersion is the highest Since of api-surface md`() {
        val semver = Regex("""\d+\.\d+\.\d+""")
        val since = File("../docs/architecture/api-surface.md").readLines().flatMap { line ->
            val lastCell = Regex("""^\|(.*)\|$""").find(line.trim())?.groupValues?.get(1)?.split("|")?.last()?.trim()
            listOfNotNull(lastCell?.takeIf { semver.matches(it) }) +
                Regex("""\b[Ss]ince (\d+\.\d+\.\d+)\b""").findAll(line).map { it.groupValues[1] }
        }
        val highest = since.map { v -> v.split(".").map(String::toInt) }
            .maxWith(compareBy({ it[0] }, { it[1] }, { it[2] }))
            .joinToString(".")
        assertEquals(highest, ApiVersion.CURRENT)
    }
}
