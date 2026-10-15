package net.artisanmc.modules.api.schemas

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class SchemaRegistryTest {

    private fun migration(from: String, to: String, transform: (MutableMap<String, Any?>) -> Unit = {}) =
        object : SchemaMigration<MutableMap<String, Any?>> {
            override fun getFrom() = from
            override fun getTo() = to
            override fun migrate(data: MutableMap<String, Any?>): MutableMap<String, Any?> {
                transform(data)
                data["schema"] = to
                return data
            }
        }

    @Test
    fun `loadToCurrent returns input as-is when already at current version`() {
        val registry = SchemaRegistry<MutableMap<String, Any?>>()
        val doc = mutableMapOf<String, Any?>("schema" to "demo/v1", "id" to "main")
        val out = registry.loadToCurrent(doc, "demo/v1") { it["schema"] as String }
        assertEquals("demo/v1", out["schema"])
        assertEquals("main", out["id"])
    }

    @Test
    fun `loadToCurrent applies single migration v1 to v2`() {
        val registry = SchemaRegistry<MutableMap<String, Any?>>()
        registry.register(migration("demo/v1", "demo/v2") { it["dimensions"] = mapOf("rows" to 3) })

        val doc = mutableMapOf<String, Any?>("schema" to "demo/v1")
        val out = registry.loadToCurrent(doc, "demo/v2") { it["schema"] as String }

        assertEquals("demo/v2", out["schema"])
        assertEquals(mapOf("rows" to 3), out["dimensions"])
    }

    @Test
    fun `loadToCurrent chains v1 to v2 to v3`() {
        val registry = SchemaRegistry<MutableMap<String, Any?>>()
        registry.register(migration("demo/v1", "demo/v2"))
        registry.register(migration("demo/v2", "demo/v3"))

        val doc = mutableMapOf<String, Any?>("schema" to "demo/v1")
        val out = registry.loadToCurrent(doc, "demo/v3") { it["schema"] as String }

        assertEquals("demo/v3", out["schema"])
    }

    @Test
    fun `loadToCurrent throws UnsupportedSchemaVersionException when migration is missing`() {
        val registry = SchemaRegistry<MutableMap<String, Any?>>()
        val doc = mutableMapOf<String, Any?>("schema" to "demo/v1")

        assertThrows(UnsupportedSchemaVersionException::class.java) {
            registry.loadToCurrent(doc, "demo/v2") { it["schema"] as String }
        }
    }

    @Test
    fun `loadToCurrent throws CircularMigrationException on cycle`() {
        val registry = SchemaRegistry<MutableMap<String, Any?>>()
        registry.register(migration("a/v1", "a/v2"))
        registry.register(migration("a/v2", "a/v1"))

        val doc = mutableMapOf<String, Any?>("schema" to "a/v1")

        assertThrows(CircularMigrationException::class.java) {
            registry.loadToCurrent(doc, "a/v3") { it["schema"] as String }
        }
    }
}
