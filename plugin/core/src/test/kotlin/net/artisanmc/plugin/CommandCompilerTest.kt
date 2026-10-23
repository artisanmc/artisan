package net.artisanmc.plugin

import net.artisanmc.plugin.command.ArgDef
import net.artisanmc.plugin.command.CommandCompiler
import net.artisanmc.plugin.engine.Condition
import net.artisanmc.plugin.engine.Step
import net.artisanmc.plugin.model.CooldownYaml
import net.artisanmc.plugin.model.CommandYaml
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
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
        assertEquals(listOf(Step.ActionStep("send_message", mapOf("text" to "Received!"))), result.handler.steps)
    }

    @Test fun `actions as DSL string compiles like steps`() {
        val yaml = CommandYaml(id = "boutique", actions = "close_menu")
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result)
        assertEquals(1, result.handler.steps.size)
    }

    @Test fun `name defaults to id when absent`() {
        val yaml = CommandYaml(id = "boutique", actions = "close_menu")
        assertEquals("boutique", CommandCompiler.compile(yaml)?.name)
    }

    @Test fun `explicit name wins over id`() {
        val yaml = CommandYaml(id = "boutique_open", name = "boutique", actions = "close_menu")
        assertEquals("boutique", CommandCompiler.compile(yaml)?.name)
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
        assertEquals("send_message", (result.handler.fallback[0] as Step.ActionStep).name)
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

    @Test fun `cooldown reads duration_seconds as the schema writes it`() {
        val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
        val yaml = mapper.readValue(
            "name: daily\ncooldown:\n  id: daily_cd\n  duration_seconds: 30\n",
            CommandYaml::class.java,
        )
        assertEquals(30L, CommandCompiler.compile(yaml)?.handler?.cooldown?.durationSeconds)
    }

    @Test fun `cooldown still reads the old duration spelling`() {
        val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
        val yaml = mapper.readValue("cooldown:\n  id: cd\n  duration: 45\n", CommandYaml::class.java)
        assertEquals(45L, yaml.cooldown?.duration)
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
        // steps is an Action DSL string (ADR action-dsl).
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

    @Test fun `compile keeps an unknown action for the registry to report`() {
        // The vocabulary lives in the action registry (a module may add a name): the
        // compiler keeps the step, the executor warns when it runs.
        val yaml = CommandYaml(
            name = "module_action",
            actions = listOf(mapOf("type" to "does_not_exist")),
        )
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result)
        assertEquals("does_not_exist", assertIs<net.artisanmc.plugin.engine.Step.ActionStep>(result.handler.steps.single()).name)
    }

    @Test fun `every argument type the editor and the schema write compiles`() {
        val yaml = CommandYaml(
            id = "pay",
            arguments = listOf(
                mapOf("name" to "target", "type" to "online_player"),
                mapOf("name" to "amount", "type" to "integer"),
                mapOf("name" to "rate", "type" to "number", "required" to false),
                mapOf("name" to "notify", "type" to "boolean", "required" to false, "default" to true),
            ),
            actions = "close_menu",
        )
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result, "a type the editor offers must not leave the command unregistered")
        assertEquals(
            listOf(
                ArgDef.PlayerArg("target"),
                ArgDef.IntArg("amount"),
                ArgDef.NumberArg("rate", required = false),
                ArgDef.BooleanArg("notify", required = false, default = true),
            ),
            result.argDefs,
        )
    }
}

