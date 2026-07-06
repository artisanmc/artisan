package net.artisanmc.plugin

import net.artisanmc.plugin.yaml.LangKeyAuditor
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class LangKeyAuditorTest {

    @Test
    fun `collects i18n refs and title-layer key fields`() {
        val menuYaml = """
            title:
              - kind: text
                value:
                  key: menus.shop.title
            layers:
              - elements:
                  - appearances:
                      - title: "{i18n:menus.shop.elements.sword.title}"
                        lore:
                          - "literal line, no key"
        """.trimIndent()
        val keys = LangKeyAuditor.referencedKeys(listOf(menuYaml))
        assertEquals(setOf("menus.shop.title", "menus.shop.elements.sword.title"), keys)
    }

    @Test
    fun `no refs yields empty set`() {
        assertEquals(emptySet<String>(), LangKeyAuditor.referencedKeys(listOf("title: \"Plain\"")))
    }
}
