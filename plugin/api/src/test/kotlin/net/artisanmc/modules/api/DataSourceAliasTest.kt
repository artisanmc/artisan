package net.artisanmc.modules.api

import net.artisanmc.modules.api.datasource.DataSourceDeclaration
import net.artisanmc.modules.api.datasource.DataSourceRegistry
import net.artisanmc.modules.api.datasource.DuplicateDataSourceException
import net.artisanmc.modules.api.datasource.UnknownDataSourceException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DataSourceAliasTest {
    private fun source(ref: String, row: String = ref) =
        DataSourceDeclaration(ref, { _, _ -> listOf(mapOf("from" to row)) })

    @Test
    fun `an alias answers like the ref and is listed nowhere`() {
        val registry = DataSourceRegistry()
        registry.register(source("quests:groups").withAliases("msquests:groups"))

        assertTrue(registry.has("msquests:groups"))
        assertEquals(listOf(mapOf("from" to "quests:groups")), registry.fetch("msquests:groups", null, emptyMap()))
        assertEquals("quests:groups", registry.resolve("msquests:groups"))
        assertEquals("quests:groups", registry.resolve("quests:groups"))
        assertNull(registry.resolve("quests:nope"))
        assertEquals(setOf("quests:groups"), registry.refs())
        assertEquals(listOf("quests:groups"), registry.registered().map { it.declaration.ref })
        assertEquals(listOf("msquests:groups"), registry.declarations().single().aliases)
    }

    @Test
    fun `a taken ref or alias refuses the whole registration`() {
        val registry = DataSourceRegistry()
        registry.register(source("quests:groups").withAliases("msquests:groups"))

        assertThrows(DuplicateDataSourceException::class.java) { registry.register(source("msquests:groups")) }
        assertThrows(DuplicateDataSourceException::class.java) {
            registry.register(source("other:groups").withAliases("quests:groups"))
        }
        assertThrows(DuplicateDataSourceException::class.java) {
            registry.register(source("other:groups").withAliases("other:old", "msquests:groups"))
        }
        assertFalse(registry.has("other:groups"))
        assertFalse(registry.has("other:old"))
    }

    @Test
    fun `aliases leave with their source`() {
        val registry = DataSourceRegistry()
        registry.bindOwner("quests")
        registry.register(source("quests:groups").withAliases("msquests:groups"))
        registry.register(source("quests:active").withAliases("msquests:active"))
        registry.bindOwner(null)

        assertFalse(registry.unregister("msquests:groups"), "an alias is not a source")
        assertTrue(registry.unregister("quests:groups"))
        assertFalse(registry.has("msquests:groups"))
        assertThrows(UnknownDataSourceException::class.java) { registry.fetch("msquests:groups", null, emptyMap()) }

        registry.unregisterOwnedBy("quests")
        assertFalse(registry.has("msquests:active"))
        registry.register(source("msquests:active"))
    }

    @Test
    fun `an alias is another ref`() {
        assertThrows(IllegalArgumentException::class.java) { source("quests:groups").withAliases("quests:groups") }
        assertThrows(IllegalArgumentException::class.java) { source("quests:groups").withAliases(" ") }
    }
}
