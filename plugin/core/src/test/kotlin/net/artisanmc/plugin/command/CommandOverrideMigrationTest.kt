package net.artisanmc.plugin.command

import net.artisanmc.modules.api.playercommand.CommandArgument
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.modules.api.template.TemplateRegistry
import net.artisanmc.plugin.project.ModuleTemplates
import net.artisanmc.plugin.project.SystemFiles
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** The old `command_override/v1` files, moved once into the commands' own files. */
class CommandOverrideMigrationTest {
    private val root: File = Files.createTempDirectory("migration").toFile()
    private val guilds = File(root, "guilds")
    private val admin = File(root, "admin")

    @AfterTest fun cleanup() { root.deleteRecursively() }

    private val run = { _: net.artisanmc.modules.api.playercommand.PlayerCommandContext -> }
    private fun balance() = PlayerCommandDeclaration.builder("guilds:root").name("g").aliases("guild")
        .permission("guilds.use")
        .child(PlayerCommandDeclaration.builder("guilds:balance").name("balance").executor(run)
            .child(PlayerCommandDeclaration.builder("guilds:balance.add").name("add")
                .argument(CommandArgument.integer("amount")).permission("guilds.deposit").executor(run).build())
            .build())
        .build()

    private fun migration(vararg declarations: PlayerCommandDeclaration, folder: File? = guilds) = CommandOverrideMigration(
        projectDirs = { mapOf("guilds" to guilds, "admin" to admin) },
        declarations = { declarations.toList() },
        folderOf = { folder },
        defaultLang = { "fr" },
        logger = null,
    )

    private fun override(dir: File, name: String, yaml: String) =
        File(dir, "${CommandOverrideMigration.DIR}/$name").apply { parentFile.mkdirs(); writeText(yaml) }

    @Test fun `overrides become the command's file, the old files set aside`() {
        guilds.mkdirs()
        override(admin, "g.yaml", """
            |schema: command_override/v1
            |command: guilds:root
            |name: Guilde
            |aliases: [gu]
            |permission: ""
            |description: {fr: Ta guilde, en: Your guild}
            |cooldown: {duration: 5, message: {en: wait, fr: attends}}
            |""".trimMargin())
        override(guilds, "add.yaml", """
            |command: guilds:balance.add
            |enabled: false
            |requirements: [{type: permission, permission: vip}]
            |steps:
            |  - send_message: nope
            |""".trimMargin())

        assertTrue(migration(balance()).migrate())

        assertEquals(
            """
            |schema: command/v1
            |name: guilde
            |actions: []
            |aliases:
            |  - gu
            |subcommands:
            |  - name: balance
            |    actions:
            |      - module_command: guilds:balance
            |    subcommands:
            |      - name: add
            |        actions:
            |          - send_message: nope
            |        permission: guilds.deposit
            |        arguments:
            |          - name: amount
            |            type: integer
            |            required: true
            |        requirements:
            |          - type: permission
            |            permission: vip
            |        enabled: false
            |description:
            |  fr: Ta guilde
            |  en: Your guild
            |cooldown:
            |  duration_seconds: 5
            |  message: attends
            |
            """.trimMargin(),
            File(guilds, "commands/g.yml").readText(),
        )
        assertFalse(File(admin, "${CommandOverrideMigration.DIR}/g.yaml").exists())
        assertTrue(File(admin, "${CommandOverrideMigration.MIGRATED}/g.yaml").readText().contains("name: Guilde"))
        assertTrue(File(guilds, "${CommandOverrideMigration.MIGRATED}/add.yaml").isFile)
        // Done once: nothing is left to move.
        assertFalse(migration(balance()).migrate())
    }

    @Test fun `the migrated file counts as edited, the system files keep it`() {
        guilds.mkdirs()
        override(guilds, "g.yaml", "command: guilds:root\npermission: other\n")
        migration(balance()).migrate()
        val migrated = File(guilds, "commands/g.yml").readText()
        val template = assertNotNull(ModuleCommandFiles.template(listOf(balance())))
        SystemFiles.sync(guilds, "guilds", template)
        assertEquals(migrated, File(guilds, "commands/g.yml").readText())
        assertTrue(migrated.contains("permission: other"))
    }

    @Test fun `overrides stay where they are without a declared command, a module folder, or over an edited file`() {
        guilds.mkdirs()
        val unknown = override(admin, "x.yaml", "command: shop:open\nname: s\n")
        val mine = override(admin, "g.yaml", "command: guilds:root\nname: h\n")
        assertFalse(migration(balance(), folder = null).migrate())
        File(guilds, "commands").mkdirs()
        File(guilds, "commands/g.yaml").writeText("schema: command/v1\nactions: []\n")
        assertFalse(migration(balance()).migrate())
        assertTrue(unknown.isFile)
        assertTrue(mine.isFile)
    }

    @Test fun `a generated template takes its id over and shows with the module's own`() {
        val registry = TemplateRegistry()
        registry.bindOwner("guilds")
        registry.register(
            net.artisanmc.modules.api.template.TemplateDeclaration.builder("menus", 1).system().file("menus/a.yaml", "a: 1\n".toByteArray()).build(),
        )
        registry.bindOwner(null)
        val templates = ModuleTemplates(registry)
        val commands = assertNotNull(ModuleCommandFiles.template(listOf(balance())))
        templates.setGenerated(mapOf("guilds" to commands, "shop" to commands))
        assertEquals(listOf("menus", ModuleCommandFiles.TEMPLATE_ID), templates.of("guilds").map { it.id })
        assertEquals(listOf("guilds", "shop"), templates.registered().keys.toList())
        assertEquals(commands, templates.find("shop", ModuleCommandFiles.TEMPLATE_ID))
        templates.setGenerated(emptyMap())
        assertEquals(listOf("menus"), templates.of("guilds").map { it.id })
    }
}
