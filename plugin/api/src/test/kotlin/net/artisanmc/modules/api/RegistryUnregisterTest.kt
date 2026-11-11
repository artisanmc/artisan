package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import net.artisanmc.modules.api.command.CommandDeclaration
import net.artisanmc.modules.api.command.CommandRegistry
import net.artisanmc.modules.api.datasource.DataSourceDeclaration
import net.artisanmc.modules.api.datasource.DataSourceRegistry

class RegistryUnregisterTest {
    @Test
    fun `a data source can be unregistered and registered again`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration("homes:list", { _, _ -> emptyList() }))

        assertTrue(registry.unregister("homes:list"))
        assertFalse(registry.unregister("homes:list"))
        registry.register(DataSourceDeclaration("homes:list", { _, _ -> emptyList() }))
        assertEquals(setOf("homes:list"), registry.refs())
    }

    @Test
    fun `a command can be unregistered and registered again`() {
        val registry = CommandRegistry()
        registry.register(CommandDeclaration("homes:go") { _, _ -> })

        assertTrue(registry.unregister("homes:go"))
        assertFalse(registry.has("homes:go"))
        registry.register(CommandDeclaration("homes:go") { _, _ -> })
        assertTrue(registry.has("homes:go"))
    }

    @Test
    fun `commands record their owning module`() {
        val registry = CommandRegistry()
        registry.bindOwner("homes")
        registry.register(CommandDeclaration("homes:go") { _, _ -> })
        registry.bindOwner(null)
        registry.register(CommandDeclaration("free:go") { _, _ -> })

        registry.unregisterOwnedBy("homes")

        assertEquals(setOf("free:go"), registry.names())
    }
}
