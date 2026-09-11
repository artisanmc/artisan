package net.artisanmc.plugin

import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.yaml.MenuV1ToV2
import kotlin.test.Test
import kotlin.test.assertEquals

class MenuV1ToV2Test {
    @Test fun `migration is idempotent and preserves legacy content`() {
        val legacy = MenuYaml(schema = "menu/v1", id = "shop")
        val migration = MenuV1ToV2()
        val current = migration.migrate(legacy)
        assertEquals(legacy.copy(schema = "menu/v2"), current)
        assertEquals(current, migration.migrate(current))
        assertEquals("menu/v1", legacy.schema)
    }
}
