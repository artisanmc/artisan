package net.artisanmc.plugin.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DocumentCheckTest {
    private val check = DocumentCheck()
    private val tree = mapOf("artisan-module.yml" to "schema: module/v1\ndefault_lang: fr\nlanguages: [fr]\n")

    private val menu = """
        schema: menu/v1
        title: "Boutique"
        size: 27
        layers:
          - id: default
            name: Default
            elements:
              - id: hello
                positions: "13"
                material: DIAMOND
                title: "Bonjour"
    """.trimIndent()

    @Test
    fun `a valid menu has no problem`() {
        assertEquals(emptyList(), check.check("shop", tree, mapOf("menus/boutique.yml" to menu)))
    }

    @Test
    fun `a field the schema does not know is reported, though the engine would skip it silently`() {
        val problems = check.check("shop", tree, mapOf("menus/boutique.yml" to menu.replace("title: \"Boutique\"", "tittle: \"Boutique\"")))
        assertTrue(problems.any { it.stage == "schema" && "tittle" in it.message }, problems.toString())
    }

    @Test
    fun `broken YAML stops at the yaml stage`() {
        val problems = check.check("shop", tree, mapOf("menus/boutique.yml" to "schema: menu/v1\nsize: [27"))
        assertEquals(listOf("yaml"), problems.map { it.stage })
    }

    @Test
    fun `a path that is no Document's place is a layout problem`() {
        val problems = check.check("shop", tree, mapOf("menus/a/b/c/d/boutique.yml" to menu))
        assertTrue(problems.any { it.stage == "layout" }, problems.toString())
    }

    @Test
    fun `a path outside the Project is refused`() {
        val problems = check.check("shop", tree, mapOf("../escape.yml" to menu))
        assertEquals(listOf("layout"), problems.map { it.stage })
    }

    @Test
    fun `an unknown schema label is refused`() {
        val problems = check.check("shop", tree, mapOf("menus/boutique.yml" to menu.replace("menu/v1", "menu/v9")))
        assertTrue(problems.any { it.stage == "schema" && "menu/v9" in it.message }, problems.toString())
    }

    @Test
    fun `a command reaches the cross-file references of its schema`() {
        val command = """
            schema: command/v1
            description: "Restaure votre vie."
            actions: "send_message \"Soigné.\""
        """.trimIndent()
        assertEquals(emptyList(), check.check("shop", tree, mapOf("commands/heal.yml" to command)))
    }

    @Test
    fun `only the files asked about are reported`() {
        val broken = tree + ("menus/old.yml" to "schema: menu/v1\nsize: nope\n")
        assertEquals(emptyList(), check.check("shop", broken, mapOf("menus/boutique.yml" to menu)))
    }

    private val declared = listOf(
        mapOf(
            "name" to "guilds:rank_delete", "primary" to "rank",
            "args" to listOf(mapOf("name" to "rank", "type" to mapOf("kind" to "string"), "required" to true)),
        ),
        mapOf(
            "name" to "guilds:rank_move",
            "args" to listOf(
                mapOf("name" to "rank", "type" to mapOf("kind" to "string"), "required" to true),
                mapOf("name" to "direction", "type" to mapOf("kind" to "enum", "values" to listOf("up", "down")), "required" to true),
            ),
        ),
        mapOf("name" to "quests:action_bar", "primary" to "text", "args" to listOf(mapOf("name" to "text", "type" to mapOf("kind" to "ltext"), "required" to true))),
    )
    private val withActions = DocumentCheck { declared }

    private fun clicked(vararg steps: String) = menu + "\n        click:\n          left:\n" +
        steps.joinToString("\n") { "            - $it" }

    @Test
    fun `declared module actions with their arguments pass`() {
        val file = clicked("guilds:rank_delete: officer", "guilds:rank_move: {rank: officer, direction: up}", "quests:action_bar: {fr: Salut, en: Hi}")
        assertEquals(emptyList(), withActions.check("shop", tree, mapOf("menus/boutique.yml" to file)))
    }

    @Test
    fun `a module action the server does not declare is reported, with the closest name`() {
        val problems = withActions.check("shop", tree, mapOf("menus/boutique.yml" to clicked("guilds:rank_delet: officer")))
        assertEquals(listOf("actions"), problems.map { it.stage }, problems.toString())
        assertTrue("Did you mean `guilds:rank_delete`?" in problems.single().message, problems.toString())
    }

    @Test
    fun `an unknown or missing argument of a declared action is reported`() {
        val problems = withActions.check("shop", tree, mapOf("menus/boutique.yml" to clicked("guilds:rank_move: {rank: officer, way: up}")))
        val messages = problems.filter { it.stage == "actions" }.map { it.message }
        assertTrue(messages.any { "unknown argument `way`" in it }, messages.toString())
        assertTrue(messages.any { "missing `direction`" in it }, messages.toString())
    }

    @Test
    fun `without declared actions the stage is skipped`() {
        assertEquals(emptyList(), check.check("shop", tree, mapOf("menus/boutique.yml" to clicked("guilds:rank_delet: officer"))).filter { it.stage == "actions" })
    }

    @Test
    fun `a namespaced condition is not taken for an action`() {
        val file = clicked("if: [{quests:done: x}]\n              do: [{guilds:rank_delete: officer}]")
        assertEquals(emptyList(), withActions.check("shop", tree, mapOf("menus/boutique.yml" to file)).filter { it.stage == "actions" })
    }
}
