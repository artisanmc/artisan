---
title: Depend on the API
description: Add artisan-core-api to your build, declare the dependency in plugin.yml, obtain the ArtisanAPI handle and handle API versions.
sidebar:
  order: 2
---

## The artifact

```
net.artisanmc:artisan-core-api:<version>
```

It contains only the `net.artisanmc.modules.api` packages, with a sources jar
(Javadoc included). Nothing under `net.artisanmc.plugin.*` ships in it — that is
Artisan's internals, not API. License: MIT (Artisan itself is proprietary).

The classes are provided at runtime by the installed Artisan plugin: declare the
dependency as `compileOnly` (Gradle) or `provided` (Maven), and **never shade it**.

| Repository | Contents |
|---|---|
| `https://repo.artisanmc.net/releases` | Released versions (`2.0.0`, …) |
| `https://repo.artisanmc.net/snapshots` | `X.Y.0-SNAPSHOT` of the next minor, rebuilt on every API change |

### Gradle (Kotlin DSL)

```kotlin
repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
    maven("https://repo.artisanmc.net/releases")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.7-R0.1-SNAPSHOT")
    compileOnly("net.artisanmc:artisan-core-api:2.0.0")
}

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(21))
}
```

### Maven

```xml
<repositories>
    <repository>
        <id>papermc</id>
        <url>https://repo.papermc.io/repository/maven-public/</url>
    </repository>
    <repository>
        <id>artisan</id>
        <url>https://repo.artisanmc.net/releases</url>
    </repository>
</repositories>

<dependencies>
    <dependency>
        <groupId>io.papermc.paper</groupId>
        <artifactId>paper-api</artifactId>
        <version>1.21.7-R0.1-SNAPSHOT</version>
        <scope>provided</scope>
    </dependency>
    <dependency>
        <groupId>net.artisanmc</groupId>
        <artifactId>artisan-core-api</artifactId>
        <version>2.0.0</version>
        <scope>provided</scope>
    </dependency>
</dependencies>
```

Artisan targets Paper 1.21+ (Folia and Leaf included) on Java 21.

### Java or Kotlin

The API is written in **Java** since 2.0.0: interfaces, immutable classes, enums
and functional interfaces (`DataFetcher`, `CommandHandler`, `ModuleEventHandler`,
`SchemaVersionReader`). No `kotlin.*` type appears in it and its POM declares no
dependency: a Java add-on needs nothing else.

From Java:

- members are getters — `api.getDataSources()`, `module.getId()`,
  `declaration.getRef()`, `event.hasActions()`;
- declarations are built with constructors — `new DataSourceDeclaration(ref, fetcher)`,
  `new DataSourceDeclaration(ref, fetcher, schema)`,
  `new DataSourceDeclaration(ref, fetcher, schema, stability, keyField)`,
  `new DataSourceField(name, kind)`; `api.getActions().execute(player, actions)`
  has overloads for its optional arguments;
- lambdas are plain Java lambdas; a `CommandHandler` returns `void`;
- `ArtisanModule.onReload()` is a default method: override it only if you need it.

From Kotlin, a getter reads as a property (`api.dataSources`, `module.id`), a
functional interface takes a lambda, and your module implements the getters:
`override fun getId() = "homes"`. Constructors take positional arguments (no
named arguments, no `copy`). Before 2.0.0 the API was Kotlin with the same JVM
names, so a 1.x add-on recompiles with those two changes and the removed members
(`api.messages`, `DataSourceDeclaration.schemaHint`).

A **Kotlin** add-on must bring its own Kotlin standard library: shade it into
your jar and relocate it (Shadow's `relocate("kotlin", "com.example.myplugin.kotlin")`),
or load it through Paper's `libraries:` in `plugin.yml`. Do not rely on finding
`kotlin.*` on the server — another plugin's copy may be a different version.

## Declare the dependency in `plugin.yml`

```yaml
name: MyPlugin
version: '1.0.0'
main: com.example.myplugin.MyPlugin
api-version: '1.21'
folia-supported: true    # only if your plugin really is (see Threading & Folia)
depend: [Artisan]        # your plugin cannot run without Artisan
# softdepend: [Artisan]  # or: integrate only when Artisan is present
```

Both `depend` and `softdepend` make the server enable Artisan **before** your
plugin, so the API handle is ready in your `onEnable`.

- `depend` — an add-on that has no reason to run without Artisan.
- `softdepend` — Artisan integration is a bonus. Keep every reference to
  `net.artisanmc.*` classes inside a separate class that you only load once you
  know Artisan is present, or the JVM fails to load your main class on servers
  without it.

## Get the API handle

Artisan registers `ArtisanAPI` as a Bukkit service during its `onEnable`:

```kotlin
override fun onEnable() {
    val api = server.servicesManager.load(ArtisanAPI::class.java)
    if (api == null) {
        logger.severe("Artisan is not installed — MyPlugin disabled.")
        server.pluginManager.disablePlugin(this)
        return
    }
    // register modules, data sources, commands…
}
```

```java
@Override
public void onEnable() {
    ArtisanAPI api = getServer().getServicesManager().load(ArtisanAPI.class);
    if (api == null) {
        getLogger().severe("Artisan is not installed — MyPlugin disabled.");
        getServer().getPluginManager().disablePlugin(this);
        return;
    }
    // register modules, data sources, commands…
}
```

With `softdepend`, test presence first, then touch Artisan classes from a
separate class:

```kotlin
if (server.pluginManager.isPluginEnabled("Artisan")) {
    ArtisanHook.enable(this)   // the only class that imports net.artisanmc.*
}
```

Keep the handle for the life of your plugin; it does not change while the
server runs.

## Versions and compatibility

The API has **its own SemVer**, independent of the Artisan plugin's version
number. Every member is documented with the API version it appeared in — its
*Since* (see the [API reference](../api-reference/)). A new API
version is released as soon as a member marked with it lands.

| Annotation | Promise |
|---|---|
| `@Stable` | No breaking change within a major version (1.x) |
| `@Beta` | May change in a minor version — pin the API version you tested |
| `@Sunset(reason, removeInVersion, replacement)` | Still works, removed in `removeInVersion`; move to `replacement` |
| `@Internal` | Never call it |

**Compile against the lowest API version that has everything you use.** The
server owner may run an older Artisan than the API you compiled against; a
member that does not exist there fails at the call with `NoSuchMethodError`
(or `NoClassDefFoundError` for a whole type).

Check the running API at startup with `isCompatibleWith`, passing the *Since*
of the newest member you use:

```kotlin
if (!api.isCompatibleWith("1.8.0")) {
    logger.severe("MyPlugin needs Artisan API 1.8.0+, this server runs ${api.apiVersion}.")
    server.pluginManager.disablePlugin(this)
    return
}
```

`isCompatibleWith(min)` returns true when `api.apiVersion` has the same major
as `min` and is greater than or equal to it.

:::caution[Servers older than API 1.8.0]
`apiVersion` itself appeared in 1.8.0, and before it `isCompatibleWith`
compared the **Artisan plugin's** version (`coreVersion`, `1.0.<build>`):
`isCompatibleWith("1.7.0")` was false there. If you support older servers,
probe the member you need instead:

```kotlin
val hasDatabase = try {
    api.database      // added in API 1.7.0
    true
} catch (e: NoSuchMethodError) {
    false
}
```
:::

`coreVersion` is the Artisan plugin version, for logs and support only.

## What the handle gives you

| Property | What for | Stability | Since |
|---|---|---|---|
| `plugin` | Artisan's own `JavaPlugin` (logger, data folder) — register your listeners and tasks on **your** plugin, not this one | `@Stable` | 1.0.0 |
| `modules` | Register your `ArtisanModule` | `@Stable` | 1.1.0 |
| `dataSources` | Register and fetch data sources | `@Stable` | 1.0.0 |
| `commands` | Register handlers that menu buttons can call | `@Stable` | 1.0.0 |
| `events` | Subscribe to and publish reload events | `@Stable` | 1.0.0 |
| `schemas` | Migrate your own versioned YAML documents | `@Stable` | 1.0.0 |
| `project` | Read project files from disk, trigger a reload | `@Stable` | 1.2.0 |
| `projectRoots` | Host your project in your own plugin folder | `@Stable` | 1.5.0 |
| `apiVersion` / `isCompatibleWith` | The running API version, and a check against it (compared `coreVersion` before 1.8.0) | `@Stable` | 1.8.0 / 1.1.0 |
| `coreVersion` | The Artisan plugin version (`1.0.<build>`), not the API version | `@Stable` | 1.1.0 |
| `actions` | Run Action DSL for a player — open menus, give items… | `@Beta` | 1.4.0 |
| `items` | Serialize and describe `ItemStack`s the way the editor stores them | `@Beta` | 1.4.0 |
| `models` | Declare `model/v1` shapes for your config | `@Beta` | 1.5.0 |
| `screens` | Declare config screens in the editor | `@Beta` | 1.6.0 |
| `database` | A connection pool on the suite's shared database | `@Beta` | 1.7.0 |
