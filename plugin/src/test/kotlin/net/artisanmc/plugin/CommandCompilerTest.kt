package net.artisanmc.plugin

import net.artisanmc.plugin.command.ArgDef
import net.artisanmc.plugin.command.CommandCompiler
import net.artisanmc.plugin.engine.Action
import net.artisanmc.plugin.engine.Condition
import net.artisanmc.plugin.model.CooldownYaml
import net.artisanmc.plugin.model.CommandYaml
import kotlin.test.*

class CommandCompilerTest {

    @Test fun `compile minimal command`() {
        val yaml = CommandYaml(
            name = "reward",
            actions = listOf(mapOf("type" to "send_message", "text" to "Received!")),
        )
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result)
        assertEquals("reward", result.name)
        assertEquals(1, result.handler.actions.size)
        assertIs<Action.SendMessage>(result.handler.actions[0])
    }

    @Test fun `compile command with aliases`() {
        val yaml = CommandYaml(name = "shop", aliases = listOf("store", "buy"))
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result)
        assertEquals(listOf("store", "buy"), result.aliases)
    }

    @Test fun `compile command with permission`() {
        val yaml = CommandYaml(name = "vipshop", permission = "artisan.vip")
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result)
        assertEquals("artisan.vip", result.permission)
    }

    @Test fun `compile command with requirements and fallback`() {
        val yaml = CommandYaml(
            name = "dailyreward",
            requirements = listOf(mapOf("type" to "cooldown_passed", "cooldown_id" to "daily")),
            actions  = listOf(mapOf("type" to "give_money", "amount" to 100.0)),
            fallback = listOf(mapOf("type" to "send_message", "text" to "Already claimed.")),
        )
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result)
        assertEquals(1, result.handler.requirements.size)
        assertIs<Condition.CooldownPassed>(result.handler.requirements[0])
        assertEquals(1, result.handler.fallback.size)
        assertIs<Action.SendMessage>(result.handler.fallback[0])
    }

    @Test fun `compile command with cooldown`() {
        val yaml = CommandYaml(
            name = "daily",
            cooldown = CooldownYaml(id = "daily_cd", duration = 86400, scope = "player"),
        )
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result)
        assertEquals("daily_cd", result.handler.cooldown?.id)
        assertEquals(86400L, result.handler.cooldown?.durationSeconds)
    }

    @Test fun `compile command with typed args`() {
        val yaml = CommandYaml(
            name = "give",
            arguments = listOf(
                mapOf("name" to "player", "type" to "player"),
                mapOf("name" to "amount", "type" to "int", "required" to false, "default" to 1),
            ),
        )
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result)
        assertEquals(2, result.argDefs.size)
        assertIs<ArgDef.PlayerArg>(result.argDefs[0])
        val intArg = result.argDefs[1]
        assertIs<ArgDef.IntArg>(intArg)
        assertEquals(1, intArg.default)
    }

    @Test fun `compile parses canonical steps into a step tree`() {
        // steps is an Action DSL string since Phase 2 (ADR action-dsl).
        val yaml = CommandYaml(
            name = "menu",
            steps = "if has_permission(x):\n  close_menu\nsend_message \"hi\"",
        )
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result)
        assertEquals(2, result.handler.steps.size)
        assertIs<net.artisanmc.plugin.engine.Step.IfStep>(result.handler.steps[0])
        assertIs<net.artisanmc.plugin.engine.Step.ActionStep>(result.handler.steps[1])
    }

    @Test fun `compile returns null on invalid action type`() {
        val yaml = CommandYaml(
            name = "broken",
            actions = listOf(mapOf("type" to "does_not_exist")),
        )
        val result = CommandCompiler.compile(yaml)
        assertNull(result)
    }
}
