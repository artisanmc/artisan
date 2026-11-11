package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import kotlin.test.Test
import kotlin.test.assertEquals

class ThreeWayMergeTest {
    private val yaml = ObjectMapper(YAMLFactory())
    private fun read(text: String): Any? = yaml.readValue(text, Any::class.java)
    private fun merge(base: String, ours: String, theirs: String) = ThreeWayMerge.merge(read(base), read(ours), read(theirs))

    private val ah = """
        |name: ah
        |actions:
        |  - module_command: auctions:ah
        |subcommands:
        |  - name: sell
        |    permission: auctions.sell
        |    arguments:
        |      - name: price
        |        type: number
        |        required: true
        |  - name: mine
        |""".trimMargin()

    @Test fun `the owner's rename and the module's new sub-command both land`() {
        val ours = ah.replace("name: ah", "name: hdv\naliases: [ventes]")
        val theirs = ah.replace("  - name: mine\n", "  - name: history\n    permission: auctions.history\n  - name: mine\n")
        val result = merge(ah, ours, theirs)
        assertEquals(emptyList(), result.conflicts)
        assertEquals(
            read(
                """
                |name: hdv
                |aliases: [ventes]
                |actions:
                |  - module_command: auctions:ah
                |subcommands:
                |  - name: sell
                |    permission: auctions.sell
                |    arguments:
                |      - name: price
                |        type: number
                |        required: true
                |  - name: history
                |    permission: auctions.history
                |  - name: mine
                |""".trimMargin(),
            ),
            result.value,
        )
        // The module's sub-command sits where the module put it, the owner's key after the one it follows.
        assertEquals(listOf("sell", "history", "mine"), ((result.value as Map<*, *>)["subcommands"] as List<*>).map { (it as Map<*, *>)["name"] })
        assertEquals(listOf("name", "aliases", "actions", "subcommands"), (result.value as Map<*, *>).keys.toList())
    }

    @Test fun `a value both sides changed stays the owner's and is reported`() {
        val ours = ah.replace("permission: auctions.sell", "permission: vip.sell")
        val theirs = ah.replace("permission: auctions.sell", "permission: auctions.trade").replace("type: number", "type: integer")
        val result = merge(ah, ours, theirs)
        assertEquals(listOf("subcommands.sell.permission"), result.conflicts)
        val sell = ((result.value as Map<*, *>)["subcommands"] as List<*>).first() as Map<*, *>
        assertEquals("vip.sell", sell["permission"])
        assertEquals("integer", ((sell["arguments"] as List<*>).single() as Map<*, *>)["type"], "the rest of the node still follows")
    }

    @Test fun `removals follow the side that removed, unless the other one changed it`() {
        val withoutMine = ah.replace("  - name: mine\n", "")
        assertEquals(read(withoutMine), merge(ah, withoutMine, ah).value, "the owner removed it")
        assertEquals(read(withoutMine), merge(ah, ah, withoutMine).value, "the module removed it")

        val minePermission = ah.replace("  - name: mine\n", "  - name: mine\n    permission: own\n")
        val result = merge(ah, minePermission, withoutMine)
        assertEquals(listOf("subcommands.mine"), result.conflicts)
        assertEquals(read(minePermission), result.value)
    }

    @Test fun `a list without ids is one value, a menu's elements merge by id`() {
        val base = """
            |title: [{kind: plain, value: Shop}]
            |layers:
            |  - id: main
            |    elements:
            |      - {id: buy, material: DIAMOND}
            |      - {id: close, material: BARRIER}
            |""".trimMargin()
        val ours = base.replace("value: Shop", "value: Boutique").replace("DIAMOND", "EMERALD")
        val theirs = base.replace("BARRIER", "OAK_DOOR").replace("value: Shop", "value: Market")
        val result = merge(base, ours, theirs)
        assertEquals(listOf("title"), result.conflicts)
        assertEquals(read(ours.replace("BARRIER", "OAK_DOOR")), result.value)
    }

    @Test fun `the same change on both sides is no conflict`() {
        val both = ah.replace("type: number", "type: integer")
        assertEquals(ThreeWayMerge.Result(read(both), emptyList()), merge(ah, both, both))
    }
}
