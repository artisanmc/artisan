package net.artisanmc.plugin.metrics

import net.artisanmc.plugin.hub.WebConfig
import kotlin.test.Test
import kotlin.test.assertEquals

class MetricsChartsTest {
    @Test
    fun `suite modules are named, the others counted as other`() {
        assertEquals(
            mapOf("menus" to 1, "commands" to 1, "artisanquests" to 1, "other" to 2),
            MetricsCharts.modules(listOf("menus", "commands", "artisanquests", "my_private_addon", "spawn")),
        )
    }

    @Test
    fun `web role`() {
        assertEquals("hub", MetricsCharts.webRole(WebConfig()))
        assertEquals("leaf", MetricsCharts.webRole(WebConfig(hubUrl = "ws://hub:8765/ws/plugin")))
        assertEquals("disabled", MetricsCharts.webRole(WebConfig(enabled = false, hubUrl = "ws://hub")))
    }

    @Test
    fun `database and language keep only known values`() {
        assertEquals("mariadb", MetricsCharts.database(" MariaDB "))
        assertEquals("other", MetricsCharts.database("postgres"))
        assertEquals("fr", MetricsCharts.language("fr_FR"))
        assertEquals("en", MetricsCharts.language("en"))
        assertEquals("other", MetricsCharts.language("custom-lang"))
    }

    @Test
    fun `never enabled under the Gradle tests`() {
        assertEquals(false, ServerMetrics.enabled())
    }
}
