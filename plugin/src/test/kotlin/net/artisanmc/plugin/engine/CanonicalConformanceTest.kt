package net.artisanmc.plugin.engine

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.fasterxml.jackson.module.kotlin.readValue
import net.artisanmc.plugin.model.MenuYaml
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

class CanonicalConformanceTest {

    private val mapper = ObjectMapper().registerKotlinModule()

    // Resolve from the repo root. Gradle runs tests with working dir = plugin module dir.
    private fun example(name: String): MenuYaml {
        val candidates = listOf(
            File("../docs/schema/menu/v1/examples/$name"),
            File("docs/schema/menu/v1/examples/$name"),
        )
        val f = candidates.firstOrNull { it.exists() }
            ?: error("example not found from ${File(".").absolutePath}: tried $candidates")
        return mapper.readValue(f)
    }

    @Test
    fun `canonical button example compiles with its actions`() {
        val menu = example("canonical-button.json")
        val compiled = BundleCompiler.compile(menu, emptyMap())
        // The button element has one appearance with a left-click of two flat action steps.
        val apps = compiled.compiledAppearances.values.flatten()
        assertTrue(apps.isNotEmpty(), "expected at least one compiled appearance")
        val leftActions = apps.first().clicks[ClickType.LEFT]?.actions ?: emptyList()
        assertTrue(leftActions.any { it is Action.RunCommand }, "expected a run_command action")
        assertTrue(leftActions.any { it is Action.SendMessage }, "expected a send_message action")
    }

    @Test
    fun `canonical conditional example compiles its appearance condition`() {
        val menu = example("canonical-conditional.json")
        val compiled = BundleCompiler.compile(menu, emptyMap())
        val apps = compiled.compiledAppearances.values.flatten()
        // First appearance gates on has_permission (an `if` array of one condition).
        assertTrue(
            apps.any { app -> app.conditions.any { it is Condition.HasPermission } },
            "expected a has_permission gate to compile",
        )
        // NOTE: the click `kind:"if"` branch is intentionally NOT executed by the plugin
        // (documented runtime gap) — we only assert the menu compiles without throwing.
    }
}
