# Command Aliases — Remaining Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two remaining plugin-side gaps in the command-aliases feature, and replace the comma-separated text field for aliases in the editor with a proper tag input (chips with × buttons + text input to add).

**Architecture:** Plugin: `CommandRegistrar.kt` tracks aliases in `registered`+`seen` for clean unregister, and warns on alias conflicts. Editor: new `AliasesField` component (tag chips + add input) replaces the `PropertyField` in `CommandEditor` in `FlowCanvas.tsx`.

**Tech Stack:** Kotlin 2.0, Paper API 1.21.4, MockBukkit, `kotlin.test`; React 19, Tailwind, lucide-react, vitest.

---

## File Map

| File | Action |
|---|---|
| `plugin/src/main/kotlin/net/artisanmc/plugin/command/CommandRegistrar.kt` | Modify |
| `plugin/src/test/kotlin/net/artisanmc/plugin/CommandRegistrarTest.kt` | Modify |
| `editor/src/features/canvas/properties/AliasesField.tsx` | Create |
| `editor/src/features/canvas/properties/AliasesField.test.tsx` | Create |
| `editor/src/features/flow/FlowCanvas.tsx` | Modify (swap PropertyField → AliasesField) |

---

### Task 1: Track aliases in `registered` so `unregisterAll` purges them

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/command/CommandRegistrar.kt`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/CommandRegistrarTest.kt`

- [ ] **Step 1.1 — Add `cmdYamlWithAliases` helper in the test file**

In `CommandRegistrarTest.kt`, add after the existing `cmdYaml` helper (after line 37):

```kotlin
private fun cmdYamlWithAliases(name: String, vararg aliases: String) = CommandYaml(
    name = name,
    aliases = aliases.toList(),
    actions = listOf(mapOf("type" to "send_message", "text" to "ok")),
)
```

- [ ] **Step 1.2 — Write two failing tests**

Add at the end of the `CommandRegistrarTest` class body:

```kotlin
@Test fun `aliases are registered and retrievable by alias name`() {
    val registrar = CommandRegistrar(plugin.value)
    registrar.reload(listOf(bundle(cmdYamlWithAliases("heal", "h", "healme"))), executor(), evaluator)
    val byAlias = MockBukkit.getMock()!!.getCommandMap().getCommand("h")
        ?: MockBukkit.getMock()!!.getCommandMap().getCommand("artisan:h")
    assertNotNull(byAlias, "alias 'h' should be registered in the command map")
    registrar.unregisterAll()
}

@Test fun `aliases are removed from command map after unregisterAll`() {
    val registrar = CommandRegistrar(plugin.value)
    registrar.reload(listOf(bundle(cmdYamlWithAliases("heal", "h", "healme"))), executor(), evaluator)
    registrar.unregisterAll()
    // If aliases were stale, registering a fresh "h" command would find a conflict.
    registrar.reload(listOf(bundle(cmdYaml("h"))), executor(), evaluator)
    val cmd = MockBukkit.getMock()!!.getCommandMap().getCommand("h")
        ?: MockBukkit.getMock()!!.getCommandMap().getCommand("artisan:h")
    assertNotNull(cmd, "fresh 'h' command registered after unregisterAll should be found")
    registrar.unregisterAll()
}
```

- [ ] **Step 1.3 — Run the tests, verify they fail**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.CommandRegistrarTest.aliases are registered and retrievable by alias name" --tests "net.artisanmc.plugin.CommandRegistrarTest.aliases are removed from command map after unregisterAll"
```

Expected: FAIL

- [ ] **Step 1.4 — Implement the fix in `CommandRegistrar.kt`**

Locate this block in `reload` (lines 45–49):

```kotlin
val packCommand = PackCommand(compiled, executor)
commandMap.register(namespace, packCommand)
registered += name
seen += name
logger.info("[IFZ-DEBUG] Registered command: /$name (actions=${compiled.handler.actions.size})")
```

Replace with:

```kotlin
val packCommand = PackCommand(compiled, executor)
commandMap.register(namespace, packCommand)
registered += name
seen += name
compiled.aliases.forEach { alias ->
    val normalised = alias.lowercase()
    registered += normalised
    seen += normalised
}
logger.info("[IFZ-DEBUG] Registered command: /$name (actions=${compiled.handler.actions.size})")
```

- [ ] **Step 1.5 — Run the tests, verify they pass**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.CommandRegistrarTest.aliases are registered and retrievable by alias name" --tests "net.artisanmc.plugin.CommandRegistrarTest.aliases are removed from command map after unregisterAll"
```

Expected: PASS

- [ ] **Step 1.6 — Run full test suite**

```bash
cd plugin && ./gradlew test
```

Expected: BUILD SUCCESSFUL, all existing tests still pass.

- [ ] **Step 1.7 — Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/command/CommandRegistrar.kt
git add plugin/src/test/kotlin/net/artisanmc/plugin/CommandRegistrarTest.kt
git commit -m "fix(plugin): track aliases in registered list so unregisterAll purges alias entries from knownCommands"
```

---

### Task 2: Warn when an alias conflicts with an existing command

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/command/CommandRegistrar.kt`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/CommandRegistrarTest.kt`

- [ ] **Step 2.1 — Write a failing test**

Add at the end of the `CommandRegistrarTest` class body:

```kotlin
@Test fun `alias conflict with existing command logs warning but still registers main command`() {
    val conflictingCmd = object : org.bukkit.command.Command("list") {
        override fun execute(
            sender: org.bukkit.command.CommandSender,
            commandLabel: String,
            args: Array<String>,
        ) = true
    }
    MockBukkit.getMock()!!.getCommandMap().register("minecraft", conflictingCmd)

    val registrar = CommandRegistrar(plugin.value)
    // "shop" is main; "list" alias clashes with the pre-registered command.
    registrar.reload(
        listOf(bundle(cmdYamlWithAliases("shop", "store", "list"))),
        executor(),
        evaluator,
    )
    val shopCmd = MockBukkit.getMock()!!.getCommandMap().getCommand("shop")
        ?: MockBukkit.getMock()!!.getCommandMap().getCommand("artisan:shop")
    assertNotNull(shopCmd, "main command /shop must be registered even when an alias conflicts")
    registrar.unregisterAll()
}
```

- [ ] **Step 2.2 — Run the test, verify it compiles and passes vacuously (no exception today)**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.CommandRegistrarTest.alias conflict with existing command logs warning but still registers main command"
```

Expected: PASS (the test asserts no regression — the warning is observable in logs, not assertions). This baseline confirms the test path executes.

- [ ] **Step 2.3 — Implement the fix in `CommandRegistrar.kt`**

After the existing main-name conflict check (after line 38), add the alias conflict warning. Insert this block between the `val compiled = ...` line and the `val packCommand = ...` line:

```kotlin
// Warn about alias conflicts — best-effort, never skip the command itself.
compiled.aliases.forEach { alias ->
    val existingAlias = commandMap.getCommand(alias.lowercase())
    if (existingAlias != null && existingAlias !is PackCommand) {
        logger.warning("Alias '/$alias' for command '/$name' conflicts with an existing command — alias may not work.")
    }
}
```

- [ ] **Step 2.4 — Run the test again, verify it still passes**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.CommandRegistrarTest.alias conflict with existing command logs warning but still registers main command"
```

Expected: PASS

- [ ] **Step 2.5 — Run full test suite**

```bash
cd plugin && ./gradlew test
```

Expected: BUILD SUCCESSFUL

- [ ] **Step 2.6 — Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/command/CommandRegistrar.kt
git add plugin/src/test/kotlin/net/artisanmc/plugin/CommandRegistrarTest.kt
git commit -m "feat(plugin): warn when command alias conflicts with an existing command"
```

---

## Final verification

```bash
cd plugin && ./gradlew test
```

Expected:
```
CommandRegistrarTest > reload registers commands PASSED
CommandRegistrarTest > reload after second call replaces commands PASSED
CommandRegistrarTest > unregisterAll removes commands PASSED
CommandRegistrarTest > duplicate command names across packs uses first registered PASSED
CommandRegistrarTest > invalid command yaml is skipped without exception PASSED
CommandRegistrarTest > aliases are registered and retrievable by alias name PASSED
CommandRegistrarTest > aliases are removed from command map after unregisterAll PASSED
CommandRegistrarTest > alias conflict with existing command logs warning but still registers main command PASSED

BUILD SUCCESSFUL
```
