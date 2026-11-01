package net.artisanmc.plugin

import net.artisanmc.plugin.engine.Condition
import net.artisanmc.plugin.engine.RuntimeMenu
import net.artisanmc.plugin.model.CommandYaml
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.engine.VariantPlayer
import net.artisanmc.plugin.engine.VariantRule
import net.artisanmc.plugin.engine.VariantRules
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.yaml.ProjectReader
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

/** A module's variants (design `variantes-modules`): what is read, and which one a player gets. */
class VariantsTest {

    private fun write(dir: File, rel: String, content: String) {
        File(dir, rel).also { it.parentFile.mkdirs() }.writeText(content)
    }

    private fun module(tmp: Path): File = tmp.resolve("guilds").toFile().also {
        write(it, "manifest.yml", "schema: manifest/v1\n")
        write(it, "menus/main.yml", "schema: menu/v1\nsize: 27\ntitle: Main\n")
        write(it, "menus/ranks.yml", "schema: menu/v1\nsize: 27\ntitle: Ranks\ninputs:\n  - name: guild\n")
        write(it, "dialogs/rules.yml", "schema: dialog/v1\ntitle: Rules\n")
    }

    private fun read(dir: File, skipped: MutableList<String> = mutableListOf()) =
        ProjectReader(ProjectRoots(dir.parentFile), null, { emptyMap() }) { _, path, reason -> skipped += "$path: $reason" }
            .readAll().single()

    private fun player(bedrock: Boolean = false, pack: Boolean = false, perms: Set<String> = emptySet()) = object : VariantPlayer {
        override val bedrock = bedrock
        override val hasPack = pack
        override fun hasPermission(permission: String) = permission in perms
        override fun test(condition: Condition): Boolean = when (condition) {
            is Condition.HasPermission -> condition.perm in perms
            is Condition.ClientIs -> (condition.client == "bedrock") == bedrock
            Condition.HasResourcePack -> pack
            is Condition.Not -> !test(condition.inner)
            else -> false
        }
    }

    @Test
    fun `without variants yml, variants is an ordinary themed folder`(@TempDir tmp: Path) {
        val m = module(tmp)
        write(m, "variants/menus/shop.yml", "schema: menu/v1\nsize: 27\n")
        val p = read(m)
        assertEquals(listOf("main", "ranks", "shop"), p.menus.map { it.id })
        assertTrue(p.variants.isEmpty())
        assertTrue(p.variantRules.isEmpty())
    }

    @Test
    fun `variants are read beside the module's own documents, with their rules`(@TempDir tmp: Path) {
        val m = module(tmp)
        write(m, "variants.yml", """
            schema: variants/v1
            rules:
              - id: dev
                variant: dev
                enabled: false
                when: { permission: op }
              - variant: bedrock
                when: { client: bedrock }
              - variant: textured
                when: { has_pack: true }
        """.trimIndent())
        write(m, "variants/textured/menus/main.yml", "schema: menu/v1\nsize: 27\ntitle: Main T\n")
        write(m, "variants/textured/rangs/menus/ranks.yml", "schema: menu/v1\nsize: 27\ntitle: Ranks T\ninputs:\n  - name: guild\n")
        write(m, "variants/bedrock/menus/ranks.yml", "schema: menu/v1\nsize: 27\ntitle: Ranks B\ninputs:\n  - name: guild\n")
        write(m, "variants/bedrock/dialogs/rules.yml", "schema: dialog/v1\ntitle: Rules B\n")
        write(m, "variants/dev/menus/main.yml", "schema: menu/v1\nsize: 27\n")
        val p = read(m)
        assertEquals(listOf("main", "ranks"), p.menus.map { it.id })
        assertEquals(setOf("textured", "bedrock", "dev"), p.variants.keys)
        assertEquals("Ranks T", (p.variantDocument("textured", DocumentKinds.MENU.kind, "ranks") as RuntimeMenu).yaml.title)
        assertEquals("guilds", (p.variantDocument("bedrock", DocumentKinds.MENU.kind, "ranks") as RuntimeMenu).projectId)
        // Its variant keys its Bedrock title apart from the module's own menu.
        assertEquals("bedrock", (p.variantDocument("bedrock", DocumentKinds.MENU.kind, "ranks") as RuntimeMenu).variant)
        assertEquals("", p.menus.first { it.id == "ranks" }.variant)
        assertEquals(listOf("dev", "bedrock", "textured"), p.variantRules.map { it.id })
        assertEquals(false, p.variantRules.first().enabled)
    }

    @Test
    fun `a variant menu with other inputs, an unsupported kind and a bad rule are reported, not read`(@TempDir tmp: Path) {
        val m = module(tmp)
        write(m, "variants.yml", """
            rules:
              - variant: textured
              - variant: nowhere
              - variant: textured
                id: odd
                when: { weather: rain }
              - variant: empty
                enabled: false
        """.trimIndent())
        write(m, "variants/textured/menus/ranks.yml", "schema: menu/v1\nsize: 27\ninputs:\n  - name: rank\n")
        write(m, "variants/textured/menus/main.yml", "schema: menu/v1\nsize: 27\n")
        write(m, "variants/textured/commands/guild.yml", "schema: command/v1\nname: guild\n")
        val skipped = mutableListOf<String>()
        val p = read(m, skipped)
        assertNull(p.variantDocument("textured", DocumentKinds.MENU.kind, "ranks"))
        assertEquals("main", p.variantDocument("textured", DocumentKinds.MENU.kind, "main")?.id)
        assertEquals(listOf("textured"), p.variantRules.map { it.id })
        assertTrue(skipped.contains("variants/textured/menus/ranks.yml: variant_inputs_mismatch"), skipped.toString())
        assertTrue(skipped.contains("variants/textured/commands/guild.yml: variant_command_unknown"), skipped.toString())
        assertTrue(skipped.any { it.startsWith("variants.yml: rule 2") }, skipped.toString())
        assertTrue(skipped.any { it.startsWith("variants.yml: rule 3 (odd): unknown condition 'weather'") }, skipped.toString())
        assertTrue(skipped.none { it.startsWith("variants.yml: rule 4") }, skipped.toString())
    }

    @Test
    fun `a variant's command holds only its steps, merged onto the module's command`(@TempDir tmp: Path) {
        val m = module(tmp)
        write(m, "commands/guild.yml", """
            schema: command/v1
            name: guild
            aliases: [g]
            permission: guilds.use
            actions: "send_message: hello"
            subcommands:
              - name: info
                arguments: [{ name: target, type: player }]
                actions: "send_message: info"
              - name: top
                actions: "send_message: top"
        """.trimIndent())
        write(m, "variants.yml", "rules:\n  - variant: textured\n  - variant: odd\n")
        write(m, "variants/textured/commands/guild.yml", """
            schema: command/v1
            subcommands:
              - name: INFO
                actions: "open_menu: info"
                requirements: [{ type: has_permission, perm: guilds.info }]
        """.trimIndent())
        write(m, "variants/odd/commands/guild.yml", """
            name: clan
            subcommands:
              - name: nowhere
                actions: "open_menu: info"
              - name: top
                cooldown: { duration: 5s }
        """.trimIndent())
        val skipped = mutableListOf<String>()
        val p = read(m, skipped)
        val textured = p.variantDocument("textured", DocumentKinds.COMMAND.kind, "guild") as CommandYaml
        assertEquals("guild", textured.name)
        assertEquals(listOf("g"), textured.aliases)
        assertEquals("guilds.use", textured.permission)
        assertEquals("send_message: hello", textured.actions)
        val info = textured.subcommands.first { it.name == "info" }
        assertEquals("open_menu: info", info.actions)
        assertEquals(listOf(mapOf("type" to "has_permission", "perm" to "guilds.info")), info.requirements)
        assertEquals(1, info.arguments.size)
        assertEquals("send_message: top", textured.subcommands.first { it.name == "top" }.actions)
        assertEquals("send_message: hello", p.commands.single().actions)

        assertNull(p.variantDocument("odd", DocumentKinds.COMMAND.kind, "guild"))
        val odd = skipped.single { it.startsWith("variants/odd/commands/guild.yml: ") }
        assertTrue("variant_command_key: guild.name" in odd, odd)
        assertTrue("variant_command_node: guild nowhere" in odd, odd)
        assertTrue("variant_command_key: guild top.cooldown" in odd, odd)
    }

    private val rules = VariantRules.parse(
        mapOf(
            "rules" to listOf(
                mapOf("variant" to "dev", "when" to mapOf("permission" to "op")),
                mapOf("variant" to "bedrock", "when" to mapOf("client" to "bedrock")),
                mapOf("variant" to "vip", "when" to mapOf("has_pack" to true, "condition" to mapOf("type" to "has_permission", "perm" to "guilds.vip"))),
                mapOf("variant" to "textured", "when" to mapOf("has_pack" to true)),
                mapOf("variant" to "off", "enabled" to false),
            ),
        ),
        setOf("dev", "bedrock", "vip", "textured", "off"),
    ).rules

    /** Which variant has which file, as in the design's guilds example. */
    private val files = mapOf(
        "main" to setOf("textured", "vip", "off"),
        "ranks" to setOf("textured", "bedrock"),
        "members" to setOf("dev", "textured"),
        "rank_delete_confirm" to emptySet(),
    )

    private fun pick(file: String, who: VariantPlayer): String? = VariantRules.select(rules, { it in files.getValue(file) }, who)

    @Test
    fun `the first rule that holds and has the file wins, file by file`() {
        val bedrock = player(bedrock = true, pack = true)
        assertEquals("bedrock", pick("ranks", bedrock))
        assertEquals("textured", pick("main", bedrock))
        assertNull(pick("rank_delete_confirm", bedrock))

        val java = player(pack = true)
        assertEquals("textured", pick("ranks", java))
        assertNull(pick("ranks", player()))

        val vip = player(pack = true, perms = setOf("guilds.vip"))
        assertEquals("vip", pick("main", vip))
        assertEquals("textured", pick("ranks", vip))
        assertNull(pick("main", player(perms = setOf("guilds.vip"))))

        val op = player(perms = setOf("op"))
        assertEquals("dev", pick("members", op))
        assertNull(pick("main", op))
    }

    @Test
    fun `a disabled rule is never chosen, a rule without conditions always holds`() {
        val always = listOf(VariantRule("all", "textured"))
        assertEquals("textured", VariantRules.select(always, { true }, player()))
        assertNull(VariantRules.select(listOf(VariantRule("x", "textured", enabled = false)), { true }, player()))
    }

    @Test
    fun `conditions are evaluated only for a variant that has the file`() {
        var asked = 0
        val counting = object : VariantPlayer {
            override val bedrock get() = true.also { asked++ }
            override val hasPack = false
            override fun hasPermission(permission: String) = false
            override fun test(condition: Condition) = false
        }
        VariantRules.select(rules, { it == "textured" }, counting)
        assertEquals(0, asked)
    }

    @Test
    fun `a rule's if lists the engine's conditions, client and pack among them`() {
        val parsed = VariantRules.parse(
            mapOf(
                "schema" to "variants/v1",
                "rules" to listOf(
                    mapOf("variant" to "bedrock", "if" to listOf(mapOf("client_is" to "bedrock"))),
                    mapOf("variant" to "flat", "if" to listOf(mapOf("has_resource_pack" to false), mapOf("has_permission" to "guilds.vip"))),
                    mapOf("variant" to "bad", "if" to listOf(mapOf("nope" to 1))),
                ),
            ),
            setOf("bedrock", "flat", "bad"),
        )
        assertEquals(listOf("bedrock", "flat"), parsed.rules.map { it.variant })
        assertEquals(1, parsed.problems.size)
        assertEquals(listOf(Condition.ClientIs("bedrock")), parsed.rules[0].conditions)
        val pick = { who: VariantPlayer -> VariantRules.select(parsed.rules, { true }, who) }
        assertEquals("bedrock", pick(player(bedrock = true)))
        assertEquals("flat", pick(player(perms = setOf("guilds.vip"))))
        assertNull(pick(player(pack = true, perms = setOf("guilds.vip"))))
    }
}
