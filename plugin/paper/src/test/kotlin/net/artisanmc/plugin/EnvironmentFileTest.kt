package net.artisanmc.plugin

import net.artisanmc.plugin.config.EnvironmentFile
import org.bukkit.configuration.file.YamlConfiguration
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EnvironmentFileTest {
    private val dir = Files.createTempDirectory("artisan_env_").toFile()
    private val environment = dir.resolve("environment.yml")

    @Test
    fun `fresh install gets a default environment yml`() {
        EnvironmentFile.prepare(environment)

        val env = YamlConfiguration.loadConfiguration(environment)
        assertEquals("h2", env.getString("database.type"))
        assertEquals(3306, env.getInt("database.port"))
        assertEquals(8765, env.getInt("web.port"))
        assertTrue(env.getBoolean("web.enabled"))
        assertEquals("", env.getString("name"))
        assertEquals("", env.getString("web.hub"))
        assertFalse(env.contains("web.role"))
        assertFalse(env.contains("web.hub-url"))
        assertFalse(env.contains("web.name"))
        assertEquals("", env.getString("web.secret"))
        assertFalse(env.contains("server_key"))
        assertFalse(env.contains("ws_url"))
    }

    @Test
    fun `an existing environment yml is never rewritten`() {
        environment.writeText("web:\n  role: \"leaf\"\ndatabase:\n  type: \"mysql\"\n")
        val before = environment.readText()
        EnvironmentFile.prepare(environment)
        assertEquals(before, environment.readText())
    }

    @Test
    fun `resolves environment variables and reports unset ones`() {
        val env = mapOf("ARTISAN_DB_PASSWORD" to "s3cret")
        val missing = mutableListOf<String>()
        assertEquals(
            "s3cret/-",
            EnvironmentFile.resolve("\${ARTISAN_DB_PASSWORD}/\${UNSET}-", env::get) { missing += it },
        )
        assertEquals(listOf("UNSET"), missing)
        assertEquals("plain \$NOT_A_REF", EnvironmentFile.resolve("plain \$NOT_A_REF", env::get))
    }
}
