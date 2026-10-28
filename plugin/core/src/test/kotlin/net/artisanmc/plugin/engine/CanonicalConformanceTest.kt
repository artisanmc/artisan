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
        val compiled = MenuCompiler.compile(menu, emptyMap())
        // The button element has one appearance with a left-click of two flat action steps,
        // compiled into the canonical Step tree.
        val apps = compiled.compiledAppearances.values.flatten()
        assertTrue(apps.isNotEmpty(), "expected at least one compiled appearance")
        val leftSteps = apps.first().clicks[ClickType.LEFT]?.steps ?: emptyList()
        val leftActions = leftSteps.filterIsInstance<Step.ActionStep>().map { it.name }
        assertTrue("run_command" in leftActions, "expected a run_command action")
        assertTrue("send_message" in leftActions, "expected a send_message action")
    }

    @Test
    fun `canonical conditional example compiles its appearance condition`() {
        val menu = example("canonical-conditional.json")
        val compiled = MenuCompiler.compile(menu, emptyMap())
        val apps = compiled.compiledAppearances.values.flatten()
        // First appearance gates on has_permission (an `if` array of one condition).
        assertTrue(
            apps.any { app -> app.conditions.any { it is Condition.HasPermission } },
            "expected a has_permission gate to compile",
        )
        // Click `kind:"if"` branches now compile into the Step tree (and execute).
        val ifSteps = apps.flatMap { it.clicks.values }.flatMap { it.steps }
            .filterIsInstance<Step.IfStep>()
        assertTrue(ifSteps.isNotEmpty(), "expected the click if-step to compile into the Step tree")
    }
}
