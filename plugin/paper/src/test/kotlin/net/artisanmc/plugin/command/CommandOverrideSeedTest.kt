package net.artisanmc.plugin.command

import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.modules.api.playercommand.PlayerCommandRegistry
import java.io.File
import java.nio.file.Files
import java.util.logging.Logger
import kotlin.test.*

class CommandOverrideSeedTest {
    private val root = Files.createTempDirectory("seed").toFile()
    private val folders = mutableMapOf("guilds" to File(root, "guilds"), "spawn" to File(root, "spawn"))
    private val store = CommandOverrideStore({ folders }, Logger.getLogger("test"))
    private val registry = PlayerCommandRegistry()

    @AfterTest fun cleanup() { root.deleteRecursively() }

    private fun guild() = PlayerCommandDeclaration.builder("guilds:guild")
        .name("g").aliases("guild").permission("guilds.use")
        .description(mapOf("fr" to "Ta <gold>guilde</gold>", "en" to "Your guild"))
        .child(PlayerCommandDeclaration.builder("guilds:invite").name("invite").executor { }.build())
        .executor { }.build()

    private fun register(declaration: PlayerCommandDeclaration, owner: String?) {
        registry.bindOwner(owner)
        registry.register(declaration)
        registry.bindOwner(null)
    }

    private fun seed() = store.seed(registry) { module -> folders[module] }
    private fun file(folder: String, id: String) = File(root, "$folder/${CommandOverrideStore.DIR}/$id.yaml")

    @Test fun `each command of a module, its children too, gets a file in the module's folder that changes nothing`() {
        register(guild(), "guilds")
        assertTrue(seed())
        assertEquals(
            """
            schema: command_override/v1
            command: guilds:guild
            # The module's values. Uncomment a line to change it; delete this file to go back to them.
            # name: g
            # aliases:
            # - guild
            # permission: guilds.use
            # description:
            #   en: Your guild
            #   fr: Ta <gold>guilde</gold>

            """.trimIndent(),
            file("guilds", "guilds.guild").readText(),
        )
        assertFalse(file("guilds", "guilds.invite").readText().contains("name:"), "a child keeps its name")
        store.reload()
        val read = assertNotNull(store.overrides["guilds:guild"])
        assertEquals(listOf(null, null, null, null), listOf(read.name, read.aliases, read.permission, read.description))
        assertTrue(read.enabled)
        assertNotNull(store.overrides["guilds:invite"])
    }

    @Test fun `a file already there is never replaced, wherever it lives`() {
        register(guild(), "guilds")
        file("guilds", "guilds.guild").apply { parentFile.mkdirs(); writeText("command: guilds:guild\nname: clan\n") }
        file("spawn", "moved").apply { parentFile.mkdirs(); writeText("command: guilds:invite\nenabled: false\n") }
        assertFalse(seed())
        assertEquals("command: guilds:guild\nname: clan\n", file("guilds", "guilds.guild").readText())
        assertFalse(file("guilds", "guilds.invite").exists(), "its override lives in another folder")
    }

    @Test fun `a command without a module folder gets no file`() {
        register(guild(), "elsewhere")
        register(PlayerCommandDeclaration.builder("loose:cmd").name("cmd").executor { }.build(), null)
        assertFalse(seed())
        assertFalse(File(root, "guilds/${CommandOverrideStore.DIR}").exists())
    }
}
