package net.artisanmc.plugin.command

import com.fasterxml.jackson.core.util.DefaultIndenter
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter
import com.fasterxml.jackson.core.util.Separators
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.modules.api.playercommand.CommandArgument
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.plugin.model.CommandYaml
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `testdata/module-command-files.json` holds generated files; the editor's test reads each one
 * and writes it back, and must give the same bytes (`moduleCommandFiles.test.ts`).
 * Regenerate with `ARTISAN_WRITE_VECTORS=1 ./gradlew :artisan-core:test --tests '*ModuleCommandFilesTest*'`.
 */
class ModuleCommandFilesTest {
    private val run = { _: net.artisanmc.modules.api.playercommand.PlayerCommandContext -> }

    private fun auctionHouse() = PlayerCommandDeclaration.builder("auctions:ah")
        .name("ah").aliases("auctionhouse", "hdv").permission("artisanauctions.use")
        .description(mapOf("fr" to "Ouvrir l'hôtel des ventes", "en" to "Open the auction house: now"))
        .executor(run)
        .child(
            PlayerCommandDeclaration.builder("auctions:sell").name("sell").permission("artisanauctions.sell")
                .argument(CommandArgument.integer("price").optional())
                .argument(CommandArgument.choice("currency", listOf("coins", "gems")).optional())
                .executor(run).build(),
        )
        .child(
            PlayerCommandDeclaration.builder("auctions:admin").name("admin").permission("artisanauctions.admin")
                .child(
                    PlayerCommandDeclaration.builder("auctions:admin.reindex").name("reindex")
                        .description(mapOf("en" to "Reindex #all"))
                        .consoleAllowed(true).executor(run).build(),
                )
                .child(
                    PlayerCommandDeclaration.builder("auctions:admin.give").name("give")
                        .argument(CommandArgument.player("target"))
                        .argument(CommandArgument.world("world").optional())
                        .argument(CommandArgument.text("reason").optional())
                        .executor(run).build(),
                )
                .build(),
        )
        .build()

    private fun shop() = PlayerCommandDeclaration.builder("boutique:boutique")
        .name("boutique").opensMenu("boutique_addon:shop_main")
        .description(mapOf("fr" to "true", "en" to "'quoted' \"twice\" - yes"))
        .build()

    /** Strings the YAML writer must quote, or must not, as the editor's does. */
    private fun tricky() = PlayerCommandDeclaration.builder("x:tricky")
        .name("tricky").permission("x.*")
        .description(
            mapOf(
                "de" to "123", "en" to "- dash", "es" to "#hash", "fr" to "<gold>Ta guilde</gold> : ok",
                "it" to "null", "ja" to "a: b", "nl" to "trailing ", "pt" to "@at", "ru" to "%p%", "zh" to "1.5e3",
            ),
        )
        .executor(run).build()

    private fun cases() = listOf("ah" to auctionHouse(), "boutique" to shop(), "tricky" to tricky())

    @Test fun `a declaration becomes its command file`() {
        assertEquals(
            """
            |schema: command/v1
            |actions:
            |  - module_command: auctions:ah
            |aliases:
            |  - auctionhouse
            |  - hdv
            |permission: artisanauctions.use
            |description:
            |  en: "Open the auction house: now"
            |  fr: Ouvrir l'hôtel des ventes
            |subcommands:
            |  - name: sell
            |    actions:
            |      - module_command: auctions:sell
            |    permission: artisanauctions.sell
            |    arguments:
            |      - name: price
            |        type: integer
            |        required: false
            |      - values:
            |          - coins
            |          - gems
            |        name: currency
            |        type: enum
            |        required: false
            |  - name: admin
            |    permission: artisanauctions.admin
            |    subcommands:
            |      - name: reindex
            |        actions:
            |          - module_command: auctions:admin.reindex
            |        description: "Reindex #all"
            |        console: true
            |      - name: give
            |        actions:
            |          - module_command: auctions:admin.give
            |        arguments:
            |          - name: target
            |            type: player
            |            required: true
            |          - name: world
            |            type: world
            |            required: false
            |          - name: reason
            |            type: string
            |            required: false
            |
            """.trimMargin(),
            ModuleCommandFiles.yaml(auctionHouse()),
        )
    }

    @Test fun `a command that opens a menu opens it, and a group lists its children`() {
        assertTrue(ModuleCommandFiles.yaml(shop()).contains("actions:\n  - open_menu: boutique_addon:shop_main\n"))
        val group = PlayerCommandDeclaration.builder("x:g").name("g")
            .child(PlayerCommandDeclaration.builder("x:g.a").name("a").executor(run).build()).build()
        assertEquals(
            "schema: command/v1\nactions: []\nsubcommands:\n  - name: a\n    actions:\n      - module_command: x:g.a\n",
            ModuleCommandFiles.yaml(group),
        )
    }

    @Test fun `the generated file is a command the plugin compiles, sub-commands and console included`() {
        val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
        val yaml = mapper.readValue(ModuleCommandFiles.yaml(auctionHouse()), CommandYaml::class.java).copy(id = "ah")
        val compiled = assertNotNull(CommandCompiler.compile(yaml))
        assertEquals("ah", compiled.name)
        assertEquals("Ouvrir l'hôtel des ventes", compiled.description?.forLang("fr", "en"))
        val reindex = assertNotNull(compiled.child("admin")?.child("reindex"))
        assertTrue(reindex.console)
        assertEquals("module_command", (reindex.handler.steps.single() as net.artisanmc.plugin.engine.Step.ActionStep).name)
        assertEquals(listOf(ArgDef.IntArg("price", required = false), ArgDef.EnumArg("currency", false, listOf("coins", "gems"))), compiled.child("sell")?.argDefs)
    }

    @Test fun `a module's roots are one system template, one file each`() {
        val template = assertNotNull(ModuleCommandFiles.template(listOf(auctionHouse(), shop())))
        assertTrue(template.isSystem)
        assertEquals(ModuleCommandFiles.TEMPLATE_ID, template.id)
        assertEquals(listOf("commands/ah.yaml", "commands/boutique.yaml"), template.paths)
        assertNull(ModuleCommandFiles.template(emptyList()))
    }

    @Test fun `an untouched command file the module no longer ships is removed, an edited one kept`() {
        val folder = kotlin.io.path.createTempDirectory("commands").toFile()
        try {
            net.artisanmc.plugin.project.SystemFiles.sync(folder, "boutique", assertNotNull(ModuleCommandFiles.template(listOf(shop(), guild()))))
            File(folder, "commands/g.yaml").appendText("enabled: false\n")
            net.artisanmc.plugin.project.SystemFiles.sync(folder, "boutique", assertNotNull(ModuleCommandFiles.template(listOf(auctionHouse()))))
            assertTrue(!File(folder, "commands/boutique.yaml").exists())
            assertTrue(File(folder, "commands/g.yaml").isFile)
            assertTrue(File(folder, "commands/ah.yaml").isFile)
        } finally {
            folder.deleteRecursively()
        }
    }

    private fun guild(vararg children: String) = PlayerCommandDeclaration.builder("guilds:g")
        .name("g").permission("guilds.use").executor(run)
        .apply { children.forEach { child(PlayerCommandDeclaration.builder("guilds:$it").name(it).executor(run).build()) } }
        .build()

    @Test fun `an edited command file takes in the module's new sub-command`() {
        val folder = kotlin.io.path.createTempDirectory("commands").toFile()
        try {
            val v1 = assertNotNull(ModuleCommandFiles.template(listOf(guild("bank"))))
            net.artisanmc.plugin.project.SystemFiles.sync(folder, "guilds", v1)
            val file = File(folder, "commands/g.yaml")
            file.writeText(file.readText().replace("permission: guilds.use", "permission: vip"))

            val v2 = guild("bank", "war")
            net.artisanmc.plugin.project.SystemFiles.sync(folder, "guilds", assertNotNull(ModuleCommandFiles.template(listOf(v2))))
            // In the editor's own form: a Deploy writes it back as is.
            assertEquals(ModuleCommandFiles.yaml(v2).replace("permission: guilds.use", "permission: vip"), file.readText())
        } finally {
            folder.deleteRecursively()
        }
    }

    @Test fun `the shared vector is what the generator writes`() {
        val mapper = ObjectMapper()
        val expected: JsonNode = mapper.valueToTree(
            linkedMapOf(
                "note" to "Command files Artisan generates from module declarations (ModuleCommandFiles, " +
                    "kept equal by ModuleCommandFilesTest; regenerate with ARTISAN_WRITE_VECTORS=1). The editor " +
                    "reads each one and writes it back: the bytes must not change, or a Deploy would count " +
                    "the file as edited (moduleCommandFiles.test.ts).",
                "files" to cases().map { (id, declaration) -> linkedMapOf("id" to id, "yaml" to ModuleCommandFiles.yaml(declaration)) },
            ),
        )
        val file = vectorFile()
        if (System.getenv("ARTISAN_WRITE_VECTORS") == "1") {
            val printer = DefaultPrettyPrinter()
                .withSeparators(Separators.createDefaultInstance().withObjectFieldValueSpacing(Separators.Spacing.AFTER))
                .withArrayIndenter(DefaultIndenter.SYSTEM_LINEFEED_INSTANCE)
            file.writeText(mapper.writer(printer).writeValueAsString(expected) + "\n")
        }
        assertEquals(expected, mapper.readTree(file), "testdata/module-command-files.json is stale: regenerate it with ARTISAN_WRITE_VECTORS=1")
    }

    private fun vectorFile(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val testdata = File(dir, "testdata")
            if (testdata.isDirectory) return File(testdata, "module-command-files.json")
            dir = dir.parentFile
        }
        error("testdata/ not found from ${System.getProperty("user.dir")}")
    }
}
