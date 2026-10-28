package net.artisanmc.modules.api

import net.artisanmc.modules.api.datasource.DataSourceDeclaration
import net.artisanmc.modules.api.datasource.Origin
import net.artisanmc.modules.api.datasource.Stability
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class DataSourceOriginTest {
    private val fetcher = net.artisanmc.modules.api.datasource.DataFetcher { _, _ -> emptyList() }

    @Test
    fun `the older constructors declare a runtime source`() {
        assertEquals(Origin.RUNTIME, DataSourceDeclaration("a:b", fetcher).origin)
        assertEquals(Origin.RUNTIME, DataSourceDeclaration("a:b", fetcher, emptyList(), Stability.STATIC, "id").origin)
    }

    @Test
    fun `a mixed source needs a key field to join the draft`() {
        val e = assertThrows<IllegalArgumentException> {
            DataSourceDeclaration("quests:active", fetcher, emptyList(), Stability.DYNAMIC, null, Origin.MIXED)
        }
        assertEquals(true, e.message!!.contains("quests:active"))
        DataSourceDeclaration("quests:active", fetcher, emptyList(), Stability.DYNAMIC, "id", Origin.MIXED)
    }

    @Test
    fun `a content source may stay dynamic without a key field`() {
        val d = DataSourceDeclaration("quests:list", fetcher, emptyList(), Stability.DYNAMIC, null, Origin.CONTENT)
        assertEquals(Origin.CONTENT, d.origin)
    }

    @Test
    fun `origin takes part in equality`() {
        val runtime = DataSourceDeclaration("a:b", fetcher, emptyList(), Stability.STATIC, "id")
        val content = DataSourceDeclaration("a:b", fetcher, emptyList(), Stability.STATIC, "id", Origin.CONTENT)
        assertNotEquals(runtime, content)
    }
}
