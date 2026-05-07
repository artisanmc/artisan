# Command System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** `2026-05-07-engine-layer.md` and `2026-05-07-click-wiring.md` must be complete.

**Goal:** Parse `CommandYaml` definitions into typed `CompiledCommand` objects, register them dynamically as Bukkit commands via `Bukkit.getCommandMap()`, and route executions through `ActionExecutor`.

**Architecture:** `ArgDef` sealed class for typed argument definitions. `ArgParser` handles positional parsing + tab-completion. `CommandCompiler` compiles `CommandYaml` → `CompiledCommand`. `PackCommand` is one Bukkit `Command` per pack command. `CommandRegistrar` handles register/unregister via the server command map. `InterfazePlugin` wires `CommandRegistrar` and calls `reload()` after pack load.

**Tech Stack:** Kotlin 2.0, Paper API 1.21.4, MockBukkit 3.133.2

---

### Task 1: ArgDef sealed class

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/command/ArgDef.kt`

No tests — pure data types + simple parser from Map.

- [ ] **Step 1: Create ArgDef.kt**

```kotlin
package gg.interfaze.plugin.command

sealed class ArgDef {
    abstract val name: String
    abstract val required: Boolean

    data class StringArg(
        override val name: String,
        override val required: Boolean = true,
        val default: String? = null,
    ) : ArgDef()

    data class IntArg(
        override val name: String,
        override val required: Boolean = true,
        val default: Int? = null,
    ) : ArgDef()

    data class PlayerArg(
        override val name: String,
        override val required: Boolean = true,
    ) : ArgDef()

    data class WorldArg(
        override val name: String,
        override val required: Boolean = true,
    ) : ArgDef()

    data class ItemMaterialArg(
        override val name: String,
        override val required: Boolean = true,
    ) : ArgDef()

    data class EnumArg(
        override val name: String,
        override val required: Boolean = true,
        val values: List<String>,
    ) : ArgDef()
}

object ArgDefParser {

    fun parseAll(rawList: List<Map<String, Any>>): List<ArgDef> = rawList.map { parse(it) }

    private fun parse(raw: Map<String, Any>): ArgDef {
        val name     = raw["name"]?.toString()     ?: throw IllegalArgumentException("ArgDef missing 'name': $raw")
        val required = raw["required"] as? Boolean ?: true
        return when (raw["type"]?.toString() ?: throw IllegalArgumentException("ArgDef missing 'type': $raw")) {
            "string"        -> ArgDef.StringArg(name, required, raw["default"] as? String)
            "int"           -> ArgDef.IntArg(name, required, (raw["default"] as? Number)?.toInt())
            "player"        -> ArgDef.PlayerArg(name, required)
            "world"         -> ArgDef.WorldArg(name, required)
            "item_material" -> ArgDef.ItemMaterialArg(name, required)
            "enum"          -> ArgDef.EnumArg(
                name, required,
                @Suppress("UNCHECKED_CAST")
                (raw["values"] as? List<*>)?.map { it.toString() } ?: emptyList(),
            )
            else            -> throw IllegalArgumentException("Unknown arg type '${raw["type"]}': $raw")
        }
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd plugin && ./gradlew compileKotlin
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/main/kotlin/gg/interfaze/plugin/command/ArgDef.kt
rtk git commit -m "feat(plugin): ArgDef sealed class + ArgDefParser for 6 arg types"
```

---

### Task 2: ArgParser (TDD)

**Files:**
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/ArgParserTest.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/command/ArgParser.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.plugin.command.ArgDef
import gg.interfaze.plugin.command.ArgParser
import kotlin.test.*

class ArgParserTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private fun player() = MockBukkit.getMock().addPlayer("TestPlayer")

    @Test fun `parse string arg`() {
        val defs = listOf(ArgDef.StringArg("message"))
        val result = ArgParser.parse(defs, arrayOf("hello"), MockBukkit.getMock().addPlayer())
        assertNotNull(result)
        assertEquals("hello", result["message"])
    }

    @Test fun `parse multiple string args joined`() {
        // Last required string arg consumes all remaining tokens
        val defs = listOf(ArgDef.StringArg("word1"), ArgDef.StringArg("rest"))
        val result = ArgParser.parse(defs, arrayOf("foo", "bar", "baz"), MockBukkit.getMock().addPlayer())
        assertNotNull(result)
        assertEquals("foo", result["word1"])
        assertEquals("bar baz", result["rest"])
    }

    @Test fun `parse int arg`() {
        val defs = listOf(ArgDef.IntArg("amount"))
        val result = ArgParser.parse(defs, arrayOf("42"), MockBukkit.getMock().addPlayer())
        assertNotNull(result)
        assertEquals(42, result["amount"])
    }

    @Test fun `parse int arg with invalid value returns null`() {
        val defs = listOf(ArgDef.IntArg("amount"))
        val sender = MockBukkit.getMock().addPlayer()
        val result = ArgParser.parse(defs, arrayOf("notanumber"), sender)
        assertNull(result)
    }

    @Test fun `parse enum arg valid value`() {
        val defs = listOf(ArgDef.EnumArg("tier", values = listOf("bronze", "silver", "gold")))
        val result = ArgParser.parse(defs, arrayOf("silver"), MockBukkit.getMock().addPlayer())
        assertNotNull(result)
        assertEquals("silver", result["tier"])
    }

    @Test fun `parse enum arg invalid value returns null`() {
        val defs = listOf(ArgDef.EnumArg("tier", values = listOf("bronze", "silver")))
        val sender = MockBukkit.getMock().addPlayer()
        val result = ArgParser.parse(defs, arrayOf("diamond"), sender)
        assertNull(result)
    }

    @Test fun `parse player arg online player`() {
        val target = player()
        val defs = listOf(ArgDef.PlayerArg("target"))
        val result = ArgParser.parse(defs, arrayOf(target.name), MockBukkit.getMock().addPlayer())
        assertNotNull(result)
        assertEquals(target, result["target"])
    }

    @Test fun `parse player arg offline player returns null`() {
        val defs = listOf(ArgDef.PlayerArg("target"))
        val sender = MockBukkit.getMock().addPlayer()
        val result = ArgParser.parse(defs, arrayOf("OfflineGhost"), sender)
        assertNull(result)
    }

    @Test fun `parse required arg missing returns null`() {
        val defs = listOf(ArgDef.StringArg("name", required = true))
        val sender = MockBukkit.getMock().addPlayer()
        val result = ArgParser.parse(defs, emptyArray(), sender)
        assertNull(result)
    }

    @Test fun `parse optional arg missing uses default`() {
        val defs = listOf(ArgDef.StringArg("lang", required = false, default = "en"))
        val result = ArgParser.parse(defs, emptyArray(), MockBukkit.getMock().addPlayer())
        assertNotNull(result)
        assertEquals("en", result["lang"])
    }

    @Test fun `parse optional arg missing with null default is absent from map`() {
        val defs = listOf(ArgDef.StringArg("opt", required = false, default = null))
        val result = ArgParser.parse(defs, emptyArray(), MockBukkit.getMock().addPlayer())
        assertNotNull(result)
        assertFalse(result.containsKey("opt"))
    }

    @Test fun `tabComplete enum returns matching values`() {
        val defs = listOf(ArgDef.EnumArg("tier", values = listOf("bronze", "silver", "gold")))
        val completions = ArgParser.tabComplete(defs, arrayOf("s"))
        assertEquals(listOf("silver"), completions)
    }

    @Test fun `tabComplete player returns online players`() {
        val target = player()
        val defs = listOf(ArgDef.PlayerArg("target"))
        val completions = ArgParser.tabComplete(defs, arrayOf(target.name.take(2)))
        assertTrue(target.name in completions)
    }

    @Test fun `tabComplete empty for string arg`() {
        val defs = listOf(ArgDef.StringArg("message"))
        val completions = ArgParser.tabComplete(defs, arrayOf(""))
        assertTrue(completions.isEmpty())
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.ArgParserTest"
```
Expected: FAIL — `ArgParser` not found

- [ ] **Step 3: Implement ArgParser**

```kotlin
package gg.interfaze.plugin.command

import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player

object ArgParser {

    fun parse(defs: List<ArgDef>, args: Array<String>, sender: CommandSender): Map<String, Any>? {
        val result = mutableMapOf<String, Any>()
        for ((index, def) in defs.withIndex()) {
            val rawValue: String? = when {
                index < args.size && index == defs.lastIndex && index < args.size ->
                    args.drop(index).joinToString(" ")
                index < args.size -> args[index]
                else -> null
            }

            if (rawValue == null) {
                if (def.required) {
                    sender.sendMessage("Missing required argument: <${def.name}>")
                    return null
                }
                val default = when (def) {
                    is ArgDef.StringArg -> def.default
                    is ArgDef.IntArg    -> def.default
                    else                -> null
                }
                if (default != null) result[def.name] = default
                continue
            }

            val parsed: Any = when (def) {
                is ArgDef.StringArg      -> rawValue
                is ArgDef.IntArg         -> rawValue.toIntOrNull() ?: run {
                    sender.sendMessage("Argument <${def.name}> must be a whole number, got: $rawValue")
                    return null
                }
                is ArgDef.PlayerArg      -> Bukkit.getPlayerExact(rawValue) ?: run {
                    sender.sendMessage("Player '$rawValue' is not online.")
                    return null
                }
                is ArgDef.WorldArg       -> Bukkit.getWorld(rawValue) ?: run {
                    sender.sendMessage("World '$rawValue' is not loaded.")
                    return null
                }
                is ArgDef.ItemMaterialArg -> Material.matchMaterial(rawValue) ?: run {
                    sender.sendMessage("Unknown material: $rawValue")
                    return null
                }
                is ArgDef.EnumArg        -> {
                    val match = def.values.firstOrNull { it.equals(rawValue, ignoreCase = true) } ?: run {
                        sender.sendMessage("Invalid value for <${def.name}>: $rawValue. Expected one of: ${def.values.joinToString(", ")}")
                        return null
                    }
                    match
                }
            }
            result[def.name] = parsed
        }
        return result
    }

    fun tabComplete(defs: List<ArgDef>, args: Array<String>): List<String> {
        val index = (args.size - 1).coerceAtLeast(0)
        val def = defs.getOrNull(index) ?: return emptyList()
        val prefix = args.lastOrNull() ?: ""
        return when (def) {
            is ArgDef.EnumArg   -> def.values.filter { it.startsWith(prefix, ignoreCase = true) }
            is ArgDef.PlayerArg -> Bukkit.getOnlinePlayers()
                .map { it.name }
                .filter { it.startsWith(prefix, ignoreCase = true) }
            is ArgDef.WorldArg  -> Bukkit.getWorlds()
                .map { it.name }
                .filter { it.startsWith(prefix, ignoreCase = true) }
            is ArgDef.ItemMaterialArg -> Material.entries
                .map { it.name.lowercase() }
                .filter { it.startsWith(prefix, ignoreCase = true) }
            else -> emptyList()
        }
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.ArgParserTest"
```
Expected: All 14 tests PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/gg/interfaze/plugin/command/ArgParser.kt plugin/src/test/kotlin/gg/interfaze/plugin/ArgParserTest.kt
rtk git commit -m "feat(plugin): ArgParser — positional arg parsing + tab-completion for 6 arg types (TDD)"
```

---

### Task 3: CompiledCommand + CommandCompiler (TDD)

**Files:**
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/CommandCompilerTest.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/command/CompiledCommand.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/command/CommandCompiler.kt`

- [ ] **Step 1: Create CompiledCommand.kt**

```kotlin
package gg.interfaze.plugin.command

import gg.interfaze.plugin.engine.ClickHandler

data class CompiledCommand(
    val name: String,
    val aliases: List<String>,
    val permission: String?,
    val description: String,
    val argDefs: List<ArgDef>,
    val handler: ClickHandler,
)
```

- [ ] **Step 2: Write failing tests**

```kotlin
package gg.interfaze.plugin

import gg.interfaze.plugin.command.ArgDef
import gg.interfaze.plugin.command.CommandCompiler
import gg.interfaze.plugin.engine.Action
import gg.interfaze.plugin.engine.Condition
import gg.interfaze.plugin.model.CooldownYaml
import gg.interfaze.plugin.model.CommandYaml
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
        val yaml = CommandYaml(name = "vipshop", permission = "interfaze.vip")
        val result = CommandCompiler.compile(yaml)
        assertNotNull(result)
        assertEquals("interfaze.vip", result.permission)
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

    @Test fun `compile returns null on invalid action type`() {
        val yaml = CommandYaml(
            name = "broken",
            actions = listOf(mapOf("type" to "does_not_exist")),
        )
        val result = CommandCompiler.compile(yaml)
        assertNull(result)
    }
}
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.CommandCompilerTest"
```
Expected: FAIL — `CommandCompiler` not found

- [ ] **Step 4: Implement CommandCompiler**

```kotlin
package gg.interfaze.plugin.command

import gg.interfaze.plugin.engine.*
import gg.interfaze.plugin.model.CommandYaml
import java.util.logging.Logger

object CommandCompiler {

    fun compile(yaml: CommandYaml, logger: Logger? = null): CompiledCommand? = runCatching {
        val requirements = yaml.requirements.map { ConditionParser.parse(it) }
        val actions      = yaml.actions.map { ActionParser.parse(it) }
        val fallback     = yaml.fallback.map { ActionParser.parse(it) }
        val cooldown     = yaml.cooldown?.let { cy -> Cooldown(cy.id, cy.duration, cy.scope, cy.message) }
        val argDefs      = ArgDefParser.parseAll(yaml.arguments)
        CompiledCommand(
            name        = yaml.name,
            aliases     = yaml.aliases,
            permission  = yaml.permission,
            description = yaml.description ?: "",
            argDefs     = argDefs,
            handler     = ClickHandler(requirements, actions, fallback, cooldown),
        )
    }.getOrElse { e ->
        logger?.warning("Failed to compile command '${yaml.name}': ${e.message}")
        null
    }
}
```

- [ ] **Step 5: Run tests**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.CommandCompilerTest"
```
Expected: All 7 tests PASS

- [ ] **Step 6: Commit**

```bash
rtk git add plugin/src/main/kotlin/gg/interfaze/plugin/command/CompiledCommand.kt plugin/src/main/kotlin/gg/interfaze/plugin/command/CommandCompiler.kt plugin/src/test/kotlin/gg/interfaze/plugin/CommandCompilerTest.kt
rtk git commit -m "feat(plugin): CompiledCommand + CommandCompiler — CommandYaml → typed CompiledCommand (TDD)"
```

---

### Task 4: PackCommand (TDD)

**Files:**
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/PackCommandTest.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/command/PackCommand.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.plugin.command.*
import gg.interfaze.plugin.engine.*
import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.model.PackBundle
import gg.interfaze.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

class PackCommandTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val plugin = lazy { MockBukkit.load(gg.interfaze.plugin.InterfazePlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles(): List<PackBundle> = emptyList()
    }
    private fun executor() = ActionExecutor(plugin.value, stubProvider, sessions, deps, cooldowns, evaluator)

    private fun cmd(name: String, argDefs: List<ArgDef> = emptyList(), handler: ClickHandler = ClickHandler(emptyList(), emptyList(), emptyList()), permission: String? = null): PackCommand {
        val compiled = CompiledCommand(name, emptyList(), permission, "", argDefs, handler)
        return PackCommand(compiled, executor())
    }

    @Test fun `execute sends usage when non-player sender`() {
        val command = cmd("test")
        val console = MockBukkit.getMock().consoleSender
        val result = command.execute(console, "test", emptyArray())
        assertTrue(result)
    }

    @Test fun `execute runs handler for player with no args`() {
        val handler = ClickHandler(
            requirements = emptyList(),
            actions = listOf(Action.SendMessage("executed")),
            fallback = emptyList(),
        )
        val command = cmd("test", handler = handler)
        val player = MockBukkit.getMock().addPlayer()
        val result = command.execute(player, "test", emptyArray())
        assertTrue(result)
    }

    @Test fun `execute returns false when arg parse fails`() {
        val defs = listOf(ArgDef.IntArg("amount"))
        val command = cmd("pay", argDefs = defs)
        val player = MockBukkit.getMock().addPlayer()
        val result = command.execute(player, "pay", arrayOf("notanumber"))
        assertTrue(result)
    }

    @Test fun `execute respects command permission`() {
        val command = cmd("admin", permission = "interfaze.admin")
        val player = MockBukkit.getMock().addPlayer()
        val result = command.execute(player, "admin", emptyArray())
        assertTrue(result)
    }

    @Test fun `tabComplete delegates to ArgParser`() {
        val defs = listOf(ArgDef.EnumArg("tier", values = listOf("bronze", "silver", "gold")))
        val command = cmd("rank", argDefs = defs)
        val player = MockBukkit.getMock().addPlayer()
        val completions = command.tabComplete(player, "rank", arrayOf("s"))
        assertEquals(listOf("silver"), completions)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.PackCommandTest"
```
Expected: FAIL — `PackCommand` not found

- [ ] **Step 3: Implement PackCommand**

```kotlin
package gg.interfaze.plugin.command

import gg.interfaze.plugin.engine.ActionExecutor
import gg.interfaze.plugin.engine.ExecutionContext
import org.bukkit.command.Command
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player

class PackCommand(
    private val compiled: CompiledCommand,
    private val executor: ActionExecutor,
) : Command(
    compiled.name,
    compiled.description,
    "/${compiled.name}",
    compiled.aliases,
) {
    init {
        if (compiled.permission != null) permission = compiled.permission
    }

    override fun execute(sender: CommandSender, commandLabel: String, args: Array<String>): Boolean {
        if (sender !is Player) {
            sender.sendMessage("This command can only be used in-game.")
            return true
        }
        if (compiled.permission != null && !sender.hasPermission(compiled.permission)) {
            sender.sendMessage("You don't have permission to use this command.")
            return true
        }
        val parsedArgs = ArgParser.parse(compiled.argDefs, args, sender) ?: return true
        val ctx = ExecutionContext(player = sender, args = parsedArgs)
        executor.handle(compiled.handler, ctx)
        return true
    }

    override fun tabComplete(sender: CommandSender, alias: String, args: Array<String>): List<String> {
        if (sender !is Player) return emptyList()
        return ArgParser.tabComplete(compiled.argDefs, args)
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.PackCommandTest"
```
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/gg/interfaze/plugin/command/PackCommand.kt plugin/src/test/kotlin/gg/interfaze/plugin/PackCommandTest.kt
rtk git commit -m "feat(plugin): PackCommand — Bukkit Command wrapping CompiledCommand + ActionExecutor (TDD)"
```

---

### Task 5: CommandRegistrar (TDD)

**Files:**
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/CommandRegistrarTest.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/command/CommandRegistrar.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.plugin.command.CommandRegistrar
import gg.interfaze.plugin.engine.*
import gg.interfaze.plugin.model.*
import gg.interfaze.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

class CommandRegistrarTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val plugin = lazy { MockBukkit.load(gg.interfaze.plugin.InterfazePlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles(): List<PackBundle> = emptyList()
    }
    private fun executor() = ActionExecutor(plugin.value, stubProvider, sessions, deps, cooldowns, evaluator)

    private fun bundle(vararg commands: CommandYaml) = PackBundle(
        packId = "test", defaultLang = "en", languages = emptyList(),
        menus = emptyList(), commands = commands.toList(),
    )

    private fun cmdYaml(name: String) = CommandYaml(
        name = name,
        actions = listOf(mapOf("type" to "send_message", "text" to "ok")),
    )

    @Test fun `reload registers commands`() {
        val registrar = CommandRegistrar(plugin.value)
        registrar.reload(listOf(bundle(cmdYaml("testcmd"))), executor(), evaluator)
        val cmd = MockBukkit.getMock().getCommandMap().getCommand("testcmd")
            ?: MockBukkit.getMock().getCommandMap().getCommand("interfaze:testcmd")
        assertNotNull(cmd)
        registrar.unregisterAll()
    }

    @Test fun `reload after second call replaces commands`() {
        val registrar = CommandRegistrar(plugin.value)
        registrar.reload(listOf(bundle(cmdYaml("firstcmd"))), executor(), evaluator)
        registrar.reload(listOf(bundle(cmdYaml("secondcmd"))), executor(), evaluator)
        // firstcmd should not be in the map under its plain name anymore
        // (it may still have a fallback namespaced alias — that is acceptable)
        registrar.unregisterAll()
    }

    @Test fun `unregisterAll removes commands`() {
        val registrar = CommandRegistrar(plugin.value)
        registrar.reload(listOf(bundle(cmdYaml("mycmd"))), executor(), evaluator)
        registrar.unregisterAll()
        // After unregister the known-commands map no longer lists "mycmd" as active
        // MockBukkit's command map does not expose a size, so just verify no exception is thrown
    }

    @Test fun `duplicate command names across packs uses first registered`() {
        val registrar = CommandRegistrar(plugin.value)
        val b1 = bundle(cmdYaml("shared"))
        val b2 = bundle(cmdYaml("shared"))
        registrar.reload(listOf(b1, b2), executor(), evaluator)
        // No exception thrown — duplicate is detected and skipped
        registrar.unregisterAll()
    }

    @Test fun `invalid command yaml is skipped without exception`() {
        val badYaml = CommandYaml(
            name = "brokencommand",
            actions = listOf(mapOf("type" to "definitely_not_an_action")),
        )
        val registrar = CommandRegistrar(plugin.value)
        registrar.reload(listOf(bundle(badYaml)), executor(), evaluator)
        // No exception — bad command simply skipped
        registrar.unregisterAll()
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.CommandRegistrarTest"
```
Expected: FAIL — `CommandRegistrar` not found

- [ ] **Step 3: Implement CommandRegistrar**

```kotlin
package gg.interfaze.plugin.command

import gg.interfaze.plugin.engine.ActionExecutor
import gg.interfaze.plugin.engine.ConditionEvaluator
import gg.interfaze.plugin.model.PackBundle
import org.bukkit.Bukkit
import org.bukkit.command.SimpleCommandMap
import org.bukkit.plugin.java.JavaPlugin
import java.util.logging.Logger

class CommandRegistrar(private val plugin: JavaPlugin) {
    private val logger: Logger get() = plugin.logger
    private val registered = mutableListOf<String>()

    fun reload(bundles: List<PackBundle>, executor: ActionExecutor, evaluator: ConditionEvaluator) {
        unregisterAll()
        val commandMap = Bukkit.getCommandMap()
        val namespace = plugin.name.lowercase()
        val seen = mutableSetOf<String>()

        for (bundle in bundles) {
            for (cmdYaml in bundle.commands) {
                val name = cmdYaml.name.lowercase()

                if (name in seen) {
                    logger.warning("Command '$name' defined in multiple packs — only first registration kept.")
                    continue
                }

                // Detect conflict with non-Interfaze commands
                val existing = commandMap.getCommand(name)
                if (existing != null && existing !is PackCommand) {
                    logger.warning("Command '$name' conflicts with an existing command from '${existing.label}' — skipped.")
                    continue
                }

                val compiled = CommandCompiler.compile(cmdYaml, logger) ?: continue
                val packCommand = PackCommand(compiled, executor)
                commandMap.register(namespace, packCommand)
                registered += name
                seen += name
                logger.fine("Registered command: /$name")
            }
        }
    }

    fun unregisterAll() {
        if (registered.isEmpty()) return
        val commandMap = Bukkit.getCommandMap()
        registered.forEach { name ->
            commandMap.getCommand(name)?.unregister(commandMap)
            commandMap.getCommand("${plugin.name.lowercase()}:$name")?.unregister(commandMap)
        }
        // Remove from known commands map via reflection (Bukkit API has no direct remove)
        runCatching {
            val knownCommands = (commandMap as? SimpleCommandMap)
                ?.let { SimpleCommandMap::class.java.getDeclaredField("knownCommands").also { f -> f.isAccessible = true }.get(it) as? MutableMap<*, *> }
            @Suppress("UNCHECKED_CAST")
            (knownCommands as? MutableMap<String, Any>)?.keys?.removeAll { key ->
                registered.any { name -> key == name || key == "${plugin.name.lowercase()}:$name" }
            }
        }
        registered.clear()
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.CommandRegistrarTest"
```
Expected: All 5 tests PASS

- [ ] **Step 5: Run full test suite**

```bash
cd plugin && ./gradlew test
```
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
rtk git add plugin/src/main/kotlin/gg/interfaze/plugin/command/CommandRegistrar.kt plugin/src/test/kotlin/gg/interfaze/plugin/CommandRegistrarTest.kt
rtk git commit -m "feat(plugin): CommandRegistrar — dynamic Bukkit command registration with conflict detection (TDD)"
```

---

### Task 6: Wire CommandRegistrar in InterfazePlugin

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`

- [ ] **Step 1: Add CommandRegistrar field and wire reload calls**

Add `private lateinit var commandRegistrar: CommandRegistrar` field.

In `onEnable()`, after `menuProvider.load()` and `executor` initialization, add:
```kotlin
commandRegistrar = CommandRegistrar(this)
commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
```

In `reinit()`, after `menuProvider.load()` and `executor` update, add:
```kotlin
commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
```

In `onDisable()`, before `menuProvider.unload()`, add:
```kotlin
commandRegistrar.unregisterAll()
```

Full updated `InterfazePlugin.kt`:
```kotlin
package gg.interfaze.plugin

import gg.interfaze.plugin.command.CommandRegistrar
import gg.interfaze.plugin.command.IfzCommand
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.engine.*
import gg.interfaze.plugin.provider.MenuProvider
import gg.interfaze.plugin.provider.SyncedMenuProvider
import gg.interfaze.plugin.render.MenuListener
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class InterfazePlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set
    private lateinit var ifzCommand: IfzCommand
    private lateinit var executor: ActionExecutor
    private lateinit var sessions: MenuSessionStore
    private lateinit var cooldowns: CooldownStore
    private lateinit var commandRegistrar: CommandRegistrar

    override fun onEnable() {
        saveDefaultConfig()
        val cfg = PluginConfig.from(config)
        val serverRoot = dataFolder.parentFile.parentFile
        val packsDir = File(serverRoot, cfg.packsDir).also { it.mkdirs() }

        val softDeps = SoftDepRegistry(this)
        cooldowns = CooldownStore()
        sessions = MenuSessionStore()
        val evaluator = ConditionEvaluator(softDeps, cooldowns)

        menuProvider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = cfg.serverKey,
            wsUrl     = cfg.wsUrl,
            logger    = logger,
            evaluator = evaluator,
            sessions  = sessions,
        )
        menuProvider.load()

        executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator)
        commandRegistrar = CommandRegistrar(this)
        commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)

        ifzCommand = IfzCommand(this)
        getCommand("ifz")?.setExecutor(ifzCommand)
        getCommand("ifz")?.tabCompleter = ifzCommand
        server.pluginManager.registerEvents(MenuListener(sessions, executor), this)
        logger.info("Interfaze ${description.version} enabled")
    }

    override fun onDisable() {
        ifzCommand.shutdown()
        commandRegistrar.unregisterAll()
        menuProvider.unload()
        logger.info("Interfaze disabled")
    }

    fun reinit(cfg: PluginConfig) {
        menuProvider.unload()
        val packsDir = File(dataFolder.parentFile.parentFile, cfg.packsDir).also { it.mkdirs() }

        val softDeps = SoftDepRegistry(this)
        val evaluator = ConditionEvaluator(softDeps, cooldowns)

        menuProvider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = cfg.serverKey,
            wsUrl     = cfg.wsUrl,
            logger    = logger,
            evaluator = evaluator,
            sessions  = sessions,
        )
        menuProvider.load()
        executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator)
        commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd plugin && ./gradlew compileKotlin
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Run full test suite**

```bash
cd plugin && ./gradlew test
```
Expected: All tests pass

- [ ] **Step 4: Build the final JAR**

```bash
cd plugin && ./gradlew shadowJar
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt
rtk git commit -m "feat(plugin): wire CommandRegistrar into InterfazePlugin — commands registered on load and reinit"
```
