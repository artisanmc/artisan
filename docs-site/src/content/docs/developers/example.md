---
title: Worked example
description: A complete Kits add-on — build file, plugin.yml, main class, a data source, a command, a declared model with its config screen, and a shipped menu.
sidebar:
  order: 11
---

This page builds **Kits**, a small but complete level-3 add-on, in Kotlin:

- admins edit kits in a generated **Kits** screen of the editor (name, icon,
  items, cooldown, actions to run on claim);
- a data source `kits:list` feeds menus with every kit and, per player, whether
  it is ready;
- a command `kits:claim` gives a kit when a menu button calls it;
- a starter menu and a `/kits` command ship with the plugin, editable by admins.

The Kotlin sources on this page compile against `artisan-core-api` 2.0.0 (the API is Java; Kotlin reads its getters as properties).

## Layout

```
kits/
  build.gradle.kts
  settings.gradle.kts
  src/main/kotlin/com/example/kits/
    KitsPlugin.kt       # entry point: find Artisan, register the module
    KitsModule.kt       # the integration
    Kit.kt              # one kit, parsed from YAML
    KitModel.kt         # the model/v1 shape declared to the editor
    Bootstrap.kt        # writes the starter project on first boot
  src/main/resources/
    plugin.yml
    editor/             # the starter project, copied to plugins/Kits/editor/
      manifest.yaml
      menus/kits.yaml
      commands/kits.yaml
      data/kits/_source.yaml
      data/kits/starter.yaml
```

## Build

```kotlin
// settings.gradle.kts
rootProject.name = "kits"
```

```kotlin
// build.gradle.kts
plugins {
    kotlin("jvm") version "2.0.21"
    id("com.gradleup.shadow") version "8.3.5"
}

group = "com.example"
version = "1.0.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
    maven("https://repo.artisanmc.net/releases")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.7-R0.1-SNAPSHOT")
    compileOnly("net.artisanmc:artisan-core-api:2.0.0")   // provided by Artisan at runtime
}

kotlin {
    jvmToolchain(21)
}

tasks.shadowJar {
    archiveClassifier.set("")
    // Ship our own Kotlin stdlib under our own package.
    relocate("kotlin", "com.example.kits.libs.kotlin")
}

tasks.build {
    dependsOn(tasks.shadowJar)
}
```

`./gradlew build` produces `build/libs/kits-1.0.0.jar`.

```yaml
# src/main/resources/plugin.yml
name: Kits
version: '1.0.0'
main: com.example.kits.KitsPlugin
api-version: '1.21'
folia-supported: true
depend: [Artisan]
```

## Entry point

```kotlin
// src/main/kotlin/com/example/kits/KitsPlugin.kt
package com.example.kits

import net.artisanmc.modules.api.ArtisanAPI
import org.bukkit.plugin.java.JavaPlugin

class KitsPlugin : JavaPlugin() {
    override fun onEnable() {
        val api = server.servicesManager.load(ArtisanAPI::class.java)
        if (api == null) {
            logger.severe("Artisan is not installed — Kits disabled.")
            server.pluginManager.disablePlugin(this)
            return
        }
        api.modules.register(KitsModule(this))
    }
}
```

## The module

Everything Artisan should attribute to the add-on is declared in `onEnable(api)`:
the project root, the model and screen, the data source and the command.

```kotlin
// src/main/kotlin/com/example/kits/KitsModule.kt
package com.example.kits

import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ArtisanModule
import net.artisanmc.modules.api.CommandDeclaration
import net.artisanmc.modules.api.DataSourceDeclaration
import net.artisanmc.modules.api.DataSourceField
import net.artisanmc.modules.api.FieldKind
import net.artisanmc.modules.api.Stability
import org.bukkit.entity.Player
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class KitsModule(private val plugin: KitsPlugin) : ArtisanModule {
    override fun getId() = "kits"
    override fun getSchemaVersion() = "kits/v1"

    private lateinit var api: ArtisanAPI

    /** Immutable snapshot, swapped on reload; read by fetchers on any region thread. */
    @Volatile private var kits: Map<String, Kit> = emptyMap()

    /** Last claim per player and kit, epoch millis. Kept in memory for the example. */
    private val lastClaims = ConcurrentHashMap<String, Long>()

    override fun onEnable(api: ArtisanAPI) {
        this.api = api   // first: before API 1.8.0, registering the root calls onReload() right away

        // 1. Own a project in plugins/Kits/editor/, ship the starter content.
        val projectDir = File(plugin.dataFolder, "editor")
        api.projectRoots.register(PROJECT_ID, projectDir, id)
        if (Bootstrap.writeIfAbsent(plugin, projectDir)) api.project.reload()

        // 2. A generated config screen for data/kits/.
        api.models.declare(KitModel.document())
        api.screens.declare("kits:kits", "Kits", "data/kits", PROJECT_ID)

        // 3. A data source menus can iterate over.
        api.dataSources.register(
            DataSourceDeclaration(
                "kits:list",
                { player, _ -> kits.values.map { kit -> row(kit, player) } },
                listOf(
                    DataSourceField("id", FieldKind.STRING, "Kit id"),
                    DataSourceField("name", FieldKind.STRING, "Display name"),
                    DataSourceField("icon", FieldKind.ITEM, "Icon"),
                    DataSourceField("ready", FieldKind.BOOLEAN, "Can the player claim it now?"),
                    DataSourceField("status", FieldKind.STRING, "\"Ready\" or the time left"),
                ),
                Stability.STATIC,
                "id",
            )
        )

        // 4. A command menu buttons can call: run_command "kits:claim <id>" as player
        api.commands.register(CommandDeclaration("kits:claim") { player, args ->
            val kitId = (args["argv"] as? List<*>)?.firstOrNull() as? String
            val kit = kitId?.let { kits[it] }
            if (kit == null) {
                player.sendRichMessage("<red>Unknown kit.")
            } else {
                claim(player, kit)
            }
        })

        load()
    }

    override fun onReload() = load()

    override fun onDisable() {}

    /** Re-reads data/kits/ from the project. Runs at enable and after every publish. */
    private fun load() {
        if (!::api.isInitialized) return
        val loaded = LinkedHashMap<String, Kit>()
        for (rel in api.project.list(PROJECT_ID, "data/kits")) {
            if (!rel.endsWith(".yaml") || rel == "_source.yaml") continue
            val kit = api.project.read(PROJECT_ID, "data/kits/$rel")?.let(Kit::parse) ?: continue
            loaded[kit.id] = kit
        }
        kits = loaded
        plugin.logger.info("Loaded ${loaded.size} kit(s)")
    }

    /** Called on the player's thread. */
    private fun claim(player: Player, kit: Kit) {
        val left = secondsLeft(player.uniqueId, kit)
        if (left > 0) {
            player.sendRichMessage("<red>Wait ${left}s before claiming ${kit.name} again.")
            return
        }
        lastClaims[key(player.uniqueId, kit)] = System.currentTimeMillis()
        player.inventory.addItem(*kit.items.toTypedArray())
        // The admin's on_claim actions, with {kit} bound and the project's lang/ in scope.
        api.actions.execute(player, kit.onClaim, mapOf("kit" to kit.id), PROJECT_ID)
    }

    private fun row(kit: Kit, player: Player?): Map<String, Any?> {
        val left = if (player == null) 0 else secondsLeft(player.uniqueId, kit)   // preview: no player
        return mapOf(
            "id" to kit.id,
            "name" to kit.name,
            "icon" to kit.icon,
            "ready" to (left == 0L),
            "status" to if (left == 0L) "Ready" else "Available in ${left}s",
        )
    }

    private fun secondsLeft(playerId: UUID, kit: Kit): Long {
        val last = lastClaims[key(playerId, kit)] ?: return 0
        val elapsed = (System.currentTimeMillis() - last) / 1000
        return (kit.cooldownSeconds - elapsed).coerceAtLeast(0)
    }

    private fun key(playerId: UUID, kit: Kit) = "$playerId:${kit.id}"

    companion object {
        const val PROJECT_ID = "kits"
    }
}
```

Points worth noticing:

- `this.api` is assigned **first**: before API 1.8.0, `projectRoots.register`
  reloads the projects immediately, which calls `onReload()` before `onEnable`
  returns. Since 1.8.0 that reload waits for the next tick.
- The bootstrap runs after `register`, then `api.project.reload()` makes the
  new files visible right away. Since 1.8.0 the reload of the next tick would
  pick them up anyway; the call keeps the example working on 1.7.x.
- The fetcher only reads memory (`kits`, `lastClaims`), so it is safe on any
  region thread and returns instantly. With `player == null` (editor preview)
  every kit shows as ready.
- `kits:list` is `STATIC` with `keyField = "id"`: admins can paginate it or pin
  one kit on a chosen slot.
- The command runs on the clicking player's thread, so it touches the player
  directly. Cooldowns live in memory here; a real plugin would store them with
  [`api.database`](/wiki/developers/database/) and load them asynchronously.

## Parsing a kit

Rows on disk are bare YAML files (`data/kits/<id>.yaml`); Bukkit's
`YamlConfiguration` reads them without any extra dependency.

```kotlin
// src/main/kotlin/com/example/kits/Kit.kt
package com.example.kits

import org.bukkit.Material
import org.bukkit.configuration.file.YamlConfiguration
import org.bukkit.inventory.ItemStack

data class Kit(
    val id: String,
    val name: String,
    val icon: String,
    val cooldownSeconds: Long,
    val items: List<ItemStack>,
    val onClaim: String,
) {
    companion object {
        /** Parses one row file, `data/kits/<id>.yaml`. Returns null when the row is unusable. */
        fun parse(text: String): Kit? {
            val yaml = YamlConfiguration()
            try {
                yaml.loadFromString(text)
            } catch (e: Exception) {
                return null
            }
            val id = yaml.getString("id") ?: return null
            val items = yaml.getMapList("items").mapNotNull { entry ->
                val material = Material.matchMaterial(entry["material"]?.toString() ?: "") ?: return@mapNotNull null
                val amount = (entry["amount"] as? Number)?.toInt() ?: 1
                ItemStack(material, amount)
            }
            return Kit(
                id = id,
                name = yaml.getString("name", id) ?: id,
                icon = yaml.getString("icon", "CHEST") ?: "CHEST",
                cooldownSeconds = yaml.getLong("cooldown", 0),
                items = items,
                onClaim = yaml.getString("on_claim", "") ?: "",
            )
        }
    }
}
```

## The model and its screen

```kotlin
// src/main/kotlin/com/example/kits/KitModel.kt
package com.example.kits

/** The shape of a kit, declared to the editor. Bump `version` and add a migration when it changes. */
object KitModel {
    fun document(): Map<String, Any?> = mapOf(
        "schema" to "model/v1",
        "id" to "kits:kit",
        "name" to "Kit",
        "key_field" to "id",
        "version" to 1,
        "master_detail" to true,
        "fields" to listOf(
            mapOf("name" to "id", "type" to mapOf("kind" to "string"), "required" to true,
                "pattern" to "^[a-z0-9_]+$", "help" to "Used in commands: /kits claim <id>"),
            mapOf("name" to "name", "type" to mapOf("kind" to "string"), "required" to true),
            mapOf("name" to "icon", "type" to mapOf("kind" to "item")),
            mapOf("name" to "cooldown", "label" to "Cooldown (seconds)",
                "type" to mapOf("kind" to "integer"), "default" to 0, "min" to 0),
            mapOf("name" to "items", "type" to mapOf(
                "kind" to "list",
                "of" to mapOf("kind" to "object", "fields" to listOf(
                    mapOf("name" to "material", "type" to mapOf("kind" to "string"), "required" to true),
                    mapOf("name" to "amount", "type" to mapOf("kind" to "integer"), "default" to 1, "min" to 1),
                )),
            )),
            mapOf("name" to "on_claim", "type" to mapOf("kind" to "actions"),
                "help" to "Runs after the items are given. {kit} is the kit id."),
        ),
    )
}
```

`api.screens.declare("kits:kits", "Kits", "data/kits", "kits")` (in the
module) mounts the form on the `data/kits/` table of the `kits` project. See
[Data models & config screens](/wiki/developers/data-models/) for every field
kind.

## Shipping the starter project

```kotlin
// src/main/kotlin/com/example/kits/Bootstrap.kt
package com.example.kits

import org.bukkit.plugin.java.JavaPlugin
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/** Copies the starter project out of the jar on first boot. Returns true when it wrote something. */
object Bootstrap {
    private val FILES = listOf(
        "manifest.yaml",
        "menus/kits.yaml",
        "commands/kits.yaml",
        "data/kits/_source.yaml",
        "data/kits/starter.yaml",
    )

    fun writeIfAbsent(plugin: JavaPlugin, projectDir: File): Boolean {
        if (!projectDir.list().isNullOrEmpty()) return false   // never overwrite the admin's work
        val tmp = File(projectDir.parentFile, projectDir.name + ".tmp")
        tmp.deleteRecursively()
        for (path in FILES) {
            val target = File(tmp, path)
            target.parentFile.mkdirs()
            val input = plugin.getResource("editor/$path") ?: error("missing resource editor/$path")
            input.use { Files.copy(it, target.toPath()) }
        }
        projectDir.delete()   // an empty directory, if any
        Files.move(tmp.toPath(), projectDir.toPath(), StandardCopyOption.ATOMIC_MOVE)
        return true
    }
}
```

The resources it copies:

```yaml
# editor/manifest.yaml
schema: manifest/v1
default_lang: en
languages: [en]
```

```yaml
# editor/data/kits/_source.yaml — binds the table to the declared model
model: kits:kit
order: [starter]
```

```yaml
# editor/data/kits/starter.yaml — one row
id: starter
name: "Starter kit"
icon: IRON_SWORD
cooldown: 3600
items:
  - material: IRON_SWORD
    amount: 1
  - material: BREAD
    amount: 16
on_claim: 'send_message "Enjoy your {kit} kit!"'
```

```yaml
# editor/menus/kits.yaml
schema: menu/v1
title: []
size: 27
elements:
  - id: kits
    positions: '10-16'
    iterates: { source: kits:list, alias: kit }
    material: '{kit.icon}'
    title: '{kit.name}'
    lore:
      - '{kit.status}'
    click:
      left: |
        run_command "kits:claim {kit.id}" as player
        open_menu kits
```

The click claims the kit, then reopens the menu so the lore shows the new
cooldown — menus fetch their sources again on every render.

```yaml
# editor/commands/kits.yaml
schema: command/v1
name: kits
actions: 'open_menu kits'
```

## Try it

1. Drop `kits-1.0.0.jar` next to Artisan in `plugins/` and start the server.
   `plugins/Kits/editor/` appears with the starter project.
2. In game, `/kits` opens the menu; clicking the starter kit gives the items
   and runs the `on_claim` actions.
3. `/artisan editor` opens the editor: the **Kits** module lists a **Kits**
   screen with the generated form, and `kits:list` appears under
   **Data → Server sources** with a live preview.
4. Change the cooldown or add an item in the screen and publish. Artisan writes
   `plugins/Kits/editor/data/kits/starter.yaml`, calls `onReload()`, and the
   next `/kits` shows the change.

## Going further

- Open the menu from your own Bukkit command: `api.menus.open(player, "kits:kits")`
  — see [Menus](/wiki/developers/menus/).
- Show how many kits are ready anywhere in a menu with a placeholder:
  `api.placeholders.register("kits") { player, key -> if (key == "ready" && player != null) kits.values.count { secondsLeft(player.uniqueId, it) == 0L }.toString() else null }`,
  then write `%kits_ready%` in a title or lore.
- Make `name` an `ltext` field to let admins translate it (the value then
  becomes a key into the project's `lang/` files).
- Persist claims with [the database](/wiki/developers/database/), and publish
  `DataReloadEvent("kits:list")` when they change for add-ons that cache your rows.
