package net.artisanmc.plugin

import net.artisanmc.plugin.model.RuntimeDialog
import net.artisanmc.plugin.engine.RuntimeMenu
import net.artisanmc.plugin.model.DialogYaml
import net.artisanmc.plugin.model.MenuYaml
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * The i18n fallback chain is PER-KEY: requested lang → project default → "".
 * The editor only writes a key into a non-default lang file when the user
 * translated it, so a partially-translated language must fill its gaps from
 * the default map — a whole-map `?:` fallback leaks raw keys in-game for
 * every key missing from the player's locale file.
 */
class LangFallbackTest {

    private val langMaps = mapOf(
        "fr" to mapOf("menus.shop.title" to "Boutique", "item_templates.t1.default.title" to "{item.name}"),
        "en" to mapOf("menus.shop.title" to "Shop"),
    )

    @Test
    fun `menu fallback merges default lang under the requested lang per key`() {
        val menu = RuntimeMenu(yaml = MenuYaml(id = "shop"), langMaps = langMaps, defaultLang = "fr")
        val en = menu.langMapWithFallback("en")
        assertEquals("Shop", en["menus.shop.title"])
        assertEquals("{item.name}", en["item_templates.t1.default.title"])
    }

    @Test
    fun `menu fallback returns default map for an unshipped locale`() {
        val menu = RuntimeMenu(yaml = MenuYaml(id = "shop"), langMaps = langMaps, defaultLang = "fr")
        assertEquals(langMaps["fr"], menu.langMapWithFallback("de"))
    }

    @Test
    fun `dialog fallback merges default lang under the requested lang per key`() {
        val dialog = RuntimeDialog(yaml = DialogYaml(id = "d"), langMaps = langMaps, defaultLang = "fr")
        val en = dialog.langMapWithFallback("en")
        assertEquals("Shop", en["menus.shop.title"])
        assertEquals("{item.name}", en["item_templates.t1.default.title"])
    }
}
