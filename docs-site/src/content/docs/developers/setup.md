---
title: Depend on the API
description: Add artisan-core-api to your build, declare the dependency, and obtain the ArtisanAPI handle.
---

## The artifact

The public API surface ships as a standalone, self-contained jar:

```
net.artisanmc:artisan-core-api:<version>
```

It contains **only** the `net.artisanmc.modules.api.*` packages. Nothing under
`net.artisanmc.plugin.*` is included — that is core internals and is not API.

The jar is provided at runtime by the installed Artisan plugin, so declare it as
`compileOnly` / `provided` — never shade it.

### Gradle (Kotlin DSL)

```kotlin
repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
    maven("https://repo.artisanmc.net/releases")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.4-R0.1-SNAPSHOT")
    compileOnly("net.artisanmc:artisan-core-api:1.6.0")
}
```

### Maven

```xml
<repository>
    <id>artisan</id>
    <url>https://repo.artisanmc.net/releases</url>
</repository>

<dependency>
    <groupId>net.artisanmc</groupId>
    <artifactId>artisan-core-api</artifactId>
    <version>1.6.0</version>
    <scope>provided</scope>
</dependency>
```

Versions follow the API's own SemVer (the version a member appeared in), not the
plugin build number. To track unreleased changes, use
`https://repo.artisanmc.net/snapshots` and the next minor version with
`-SNAPSHOT` (after release `1.6.0`: `1.7.0-SNAPSHOT`).

The POM declares `kotlin-stdlib`, which the API's few Kotlin types (`kotlin.Unit`,
`Function2`) need in Java call sites. Sources (with KDoc) are published alongside.

The API is licensed GPL-3.0, like the rest of Artisan.

## Declare the dependency in `plugin.yml`

```yaml
name: MyPlugin
main: com.example.MyPlugin
api-version: '1.21'
depend: [Artisan]        # hard dependency: your plugin needs Artisan
# softdepend: [Artisan]  # or: integrate only when Artisan is present
```

Use `depend` when your plugin is an Add-on that has no reason to run without
Artisan. Use `softdepend` when Artisan integration is a bonus — then guard every
API call behind a presence check.

## Get the API handle

`ArtisanAPI` is registered as a Bukkit service. Fetch it in your `onEnable`,
after Artisan has enabled:

```kotlin
val registration = server.servicesManager.getRegistration(ArtisanAPI::class.java)
if (registration == null) {
    logger.severe("Artisan not found — integration disabled.")
    return
}
val api: ArtisanAPI = registration.provider
```

```java
var reg = getServer().getServicesManager().getRegistration(ArtisanAPI.class);
if (reg == null) {
    getLogger().severe("Artisan not found — MyPlugin disabled.");
    getServer().getPluginManager().disablePlugin(this);
    return;
}
ArtisanAPI api = reg.getProvider();
```

:::note[Kotlin API from Java]
The API is Kotlin. From Java, properties are getters (`api.getDataSources()`,
`api.getModels()`), Kotlin default arguments do not apply (pass every
constructor parameter explicitly), and lambdas returning `Unit` must
`return kotlin.Unit.INSTANCE;`.
:::

## Check core compatibility

Declare the minimum core version you need and bail out politely if the server
runs an older one:

```kotlin
if (!api.isCompatibleWith("1.5.0")) {
    logger.severe("Artisan ${api.coreVersion} is too old — MyPlugin needs 1.5.0+.")
    return
}
```

`isCompatibleWith` is satisfied when the core has the **same major** and a
version greater than or equal to the one you pass.

## What you can do with the handle

| Property | What it gives you | Stability |
|---|---|---|
| `plugin` | The core `JavaPlugin` — scheduler, server, data folder | `@Stable` |
| `dataSources` | Register/fetch data sources | `@Stable` |
| `commands` | Register handlers callable from menu buttons | `@Stable` |
| `modules` | Register your `ArtisanModule` | `@Stable` |
| `events` | Subscribe/publish reload events | `@Stable` |
| `schemas` | Register schema migrations | `@Stable` |
| `project` | Read project files from disk | `@Stable` |
| `projectRoots` | Host your own Project in your plugin folder | `@Stable` |
| `coreVersion` / `isCompatibleWith` | Version negotiation | `@Stable` |
| `models` | Declare `model/v1` shapes | `@Beta` |
| `screens` | Declare editor config screens | `@Beta` |
| `items` | Serialize/describe captured `ItemStack`s | `@Beta` |
| `messages` | Fire-and-forget messages to the backend | `@Beta` |
| `actions` | Run an Action DSL string for a player | `@Beta` |
