package net.artisanmc.plugin.text

import kotlin.test.Test
import kotlin.test.assertEquals

class ArtisanTextTest {
    @Test fun `MiniMessage becomes a section-coded string, hex as Spigot reads it`() {
        assertEquals("§a§lOK§a §x§1§2§3§4§5§6x", ArtisanText.legacy("<green><bold>OK</bold> <#123456>x"))
    }

    @Test fun `section codes in the input are accepted`() {
        assertEquals("§cRed", ArtisanText.legacy("§cRed"))
    }

    @Test fun `plain drops the formatting, fromLegacy reads section codes as MiniMessage`() {
        assertEquals("OK x", ArtisanText.plain("<green>OK</green> <click:run_command:'/x'>x"))
        assertEquals("Red", ArtisanText.plain(ArtisanText.fromLegacy("§cRed")))
    }
}
