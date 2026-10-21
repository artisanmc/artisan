package net.artisanmc.plugin

import net.artisanmc.modules.api.playercommand.CommandArgument
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.modules.api.playercommand.PlayerCommandRegistry
import net.artisanmc.plugin.ws.PlayerCommandReport
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class PlayerCommandReportTest {
    private val stats = PlayerCommandDeclaration.builder("attribution:stats")
        .permission("artisanattribution.stats")
        .argument(CommandArgument.choice("period", listOf("day", "week")).optional())
        .executor { }
        .build()

    private val open = PlayerCommandDeclaration.builder("attribution:open")
        .name("attribution")
        .aliases("source")
        .description(mapOf("fr" to "Comment as-tu connu le serveur ?"))
        .executor { }
        .child(stats)
        .build()

    @Test
    fun `a declaration goes out with its default dressing, its children and its module`() {
        val registry = PlayerCommandRegistry()
        registry.bindOwner("attribution")
        registry.register(open)
        registry.bindOwner(null)
        registry.register(PlayerCommandDeclaration.builder("auctions:ah").executor { }.build())

        val report = PlayerCommandReport.build(registry)

        assertEquals(listOf("attribution:open", "auctions:ah"), report.map { it["id"] })
        val root = report[0]
        assertEquals("attribution", root["module_id"])
        assertEquals("attribution", root["name"])
        assertEquals(listOf("source"), root["aliases"])
        assertEquals(null, root["permission"])
        assertEquals(mapOf("fr" to "Comment as-tu connu le serveur ?"), root["description"])
        val child = (root["children"] as List<*>).single() as Map<*, *>
        assertEquals("attribution:stats", child["id"])
        assertEquals("stats", child["name"])
        assertEquals("attribution", child["module_id"])
        assertEquals(
            listOf(mapOf("name" to "period", "type" to "enum", "required" to false, "values" to listOf("day", "week"))),
            child["arguments"],
        )
        assertEquals(null, report[1]["module_id"])
        assertEquals(null, root["opens_menu"])
    }

    @Test
    fun `a command that opens a menu names it, the board draws the link`() {
        val registry = PlayerCommandRegistry()
        registry.register(PlayerCommandDeclaration.builder("boutique:open").name("boutique").opensMenu("boutique_addon:shop_main").build())
        assertEquals("boutique_addon:shop_main", PlayerCommandReport.build(registry).single()["opens_menu"])
    }
}
