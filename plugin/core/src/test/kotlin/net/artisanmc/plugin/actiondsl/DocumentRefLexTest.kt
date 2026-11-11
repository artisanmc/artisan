package net.artisanmc.plugin.actiondsl

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

class DocumentRefLexTest {
    @Test
    fun `project-qualified refs parse as one id`() {
        val step = parseActionDsl("open_menu 2024:main").single() as DslStep.ActionStep
        assertEquals(DslAction.OpenMenu("2024:main"), step.action)
    }

    @Test
    fun `a trailing colon still opens a block`() {
        val step = parseActionDsl("if world_is(shop):\n  open_menu shop:main").single()
        val branch = assertIs<DslStep.IfStep>(step).cases.single().steps.single() as DslStep.ActionStep
        assertEquals(DslAction.OpenMenu("shop:main"), branch.action)
    }

    @Test
    fun `half refs are still rejected`() {
        assertFailsWith<RuntimeException> { parseActionDsl("open_menu :main") }
        assertFailsWith<RuntimeException> { parseActionDsl("open_menu shop:") }
    }
}
