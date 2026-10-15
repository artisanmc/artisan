package net.artisanmc.modules.api

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class DataSourceOwnerTest {
    @Test
    fun `register captures currentOwner as moduleId, null otherwise`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration("core:free", { _, _ -> emptyList() }))
        registry.currentOwner = "boutique"
        registry.register(DataSourceDeclaration("boutique:items", { _, _ -> emptyList() }))
        registry.currentOwner = null

        val byRef = registry.registered().associateBy { it.declaration.ref }
        assertNull(byRef["core:free"]!!.moduleId)
        assertEquals("boutique", byRef["boutique:items"]!!.moduleId)
    }
}
