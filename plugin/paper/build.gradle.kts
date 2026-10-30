import io.papermc.hangarpublishplugin.model.Platforms

plugins {
    id("io.github.goooler.shadow")
    id("com.modrinth.minotaur")
    id("io.papermc.hangar-publish-plugin")
}

dependencies {
    implementation(project(":artisan-api"))
    implementation(project(":artisan-core"))
    implementation(project(":artisan-database"))
    implementation(project(":artisan-hub"))
    implementation(project(":artisan-runtime"))

    compileOnly("io.papermc.paper:paper-api:1.21.7-R0.1-SNAPSHOT")
    // Spigot's dialog API (SpigotDialogRenderer): Spigot ships it, paper-api does not.
    compileOnly("net.md-5:bungeecord-dialog:1.21-R0.3") { isTransitive = false }
    // Adventure, bundled under its own names: Spigot has none. On Paper the server's copy wins
    // (a plugin's class loader asks its parent first), so these classes only load on Spigot.
    // What Paper alone can do with a Component goes through platform/Chat.
    listOf(
        "adventure-api", "adventure-text-minimessage", "adventure-text-serializer-gson",
        "adventure-text-serializer-legacy", "adventure-text-serializer-plain",
    ).forEach {
        implementation("net.kyori:$it:4.23.0") {
            exclude("com.google.code.gson", "gson")
            exclude("org.jetbrains", "annotations")
        }
    }
    compileOnly("com.github.MilkBowl:VaultAPI:1.7.1")
    compileOnly("me.clip:placeholderapi:2.11.6")
    compileOnly("com.nexomc:nexo:0.9.0")
    compileOnly("io.th0rgal:oraxen:1.189.0")
    compileOnly("org.geysermc.geyser:api:2.12.0-SNAPSHOT")
    // Menu contents sent as packets (MenuPacketInterceptor): Netty is the server's.
    // 4.1.97 is Paper 1.21.1's, the oldest supported; 26.x ships 4.2, same API for this use.
    compileOnly("io.netty:netty-transport:4.1.97.Final")
    testImplementation("io.netty:netty-transport:4.1.97.Final")
    compileOnly("com.sk89q.worldguard:worldguard-bukkit:7.0.12") {
        exclude("com.google.guava", "guava")
        exclude("com.google.code.gson", "gson")
        exclude("it.unimi.dsi", "fastutil")
    }
    testImplementation("com.zaxxer:HikariCP:6.2.1")
    testImplementation("com.h2database:h2:2.3.232")
    // Jetty comes from `libraries:` in production, like HikariCP.
    compileOnly("org.eclipse.jetty:jetty-server:12.1.12")
    testImplementation("org.eclipse.jetty:jetty-server:12.1.12")
    testImplementation("org.eclipse.jetty.websocket:jetty-websocket-jetty-server:12.1.12")
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("com.github.seeseemelk:MockBukkit-v1.21:3.133.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    // Force Adventure 4.23 in tests (MockBukkit pulls 4.17 which lacks ShadowColor).
    // Paper 1.21.7 ships with Adventure 4.23 at runtime, so this matches main classpath.
    testImplementation("net.kyori:adventure-api:4.23.0")
    testImplementation("net.kyori:adventure-text-minimessage:4.23.0")
}

tasks.processResources {
    inputs.property("version", project.version)
    filesMatching("plugin.yml") { expand("version" to project.version) }
}

tasks.shadowJar {
    archiveBaseName.set("artisan-plugin")
    // NO `relocate("kotlin", …)`: it breaks the runtime. kotlin-reflect (pulled in by
    // jackson-module-kotlin, which reads our data classes) resolves built-ins BY STRING
    // NAME from .kotlin_builtins files the relocator does not rewrite: it looks for
    // `kotlin.jvm.functions.Function2`, which no longer exists, and EVERY project is
    // skipped at load.
    //
    // The cross-plugin LinkageError is handled at the boundary instead: the modules.api
    // surface exposes no kotlin.* type, so an add-on never resolves `kotlin.*` through
    // the global plugin lookup (that was the trigger: an add-on's loader looked for
    // Function2, missing from its JAR, and got another Kotlin plugin's copy).
    // See ApiSurfaceIsJavaFriendlyTest and docs/architecture/api-surface.md.
    relocate("com.fasterxml.jackson", "net.artisanmc.shaded.jackson")
    relocate("okhttp3", "net.artisanmc.shaded.okhttp3")
    relocate("okio", "net.artisanmc.shaded.okio")
    // Document checks against the JSON schemas (ADR `mcp-server`) and its date/time parser.
    relocate("com.networknt", "net.artisanmc.shaded.networknt")
    // The editor's assistant (ADR `editor-assistant`). Anthropic's SDK is NOT relocated: it
    // looks classes up by name (`com.anthropic.core.JsonField`), which the relocator leaves as is.
    relocate("com.github.victools", "net.artisanmc.shaded.victools")
    relocate("com.ethlo", "net.artisanmc.shaded.ethlo")
    // Pulled in by the bundled adventure-api; Paper 26.x no longer provides it.
    relocate("net.kyori.examination", "net.artisanmc.shaded.examination")
    // Required: merge service-loader files instead of overwriting them.
    // shadowJar otherwise strips kotlin-reflect's META-INF/services entry,
    // causing "No BuiltInsLoader implementation was found" at runtime.
    mergeServiceFiles()
    // The jar reaches the server's classes by their Mojang names (NmsMenuPackets): Paper
    // 1.21.x must not remap it from Spigot's.
    manifest { attributes("paperweight-mappings-namespace" to "mojang") }
}

val composeDir: File = rootDir.resolve("..").canonicalFile

val deploy by tasks.registering(Exec::class) {
    dependsOn(tasks.shadowJar)
    workingDir = composeDir
    doFirst {
        val jar = tasks.shadowJar.get().archiveFile.get().asFile
        val dest = composeDir.resolve("docker/server/plugins/Artisan.jar")
        dest.parentFile.mkdirs()
        jar.copyTo(dest, overwrite = true)
    }
    commandLine("docker", "compose", "restart", "minecraft")
}

// Publication of the jar on a `v*` tag (.github/workflows/release-jars.yml): the workflow passes
// the jar it built and checked as `-PreleaseJar`, so what goes out is exactly that file; nothing is
// rebuilt here.
// Tokens, project ids and notes come from the environment (deploy/README.md, "Releasing the
// plugin"). A version with a suffix (`2.0.0-beta.1`) goes out as a beta on Modrinth and on
// Hangar's Snapshot channel. Paper 1.21 and newer; 26.2 is the dev server (docker-compose.yml).
val minecraftVersions = providers.gradleProperty("minecraftVersions")
    .getOrElse("1.21,1.21.1,1.21.2,1.21.3,1.21.4,1.21.5,1.21.6,1.21.7,1.21.8,1.21.9,1.21.10,1.21.11,26.1,26.2")
    .split(",").map { it.trim() }.filter { it.isNotEmpty() }
val releaseJar = providers.gradleProperty("releaseJar").map { rootDir.resolve(it) }
val prerelease = project.version.toString().contains("-")
val releaseNotes = providers.environmentVariable("RELEASE_NOTES").orElse("")

modrinth {
    token.set(providers.environmentVariable("MODRINTH_TOKEN"))
    projectId.set(providers.environmentVariable("MODRINTH_PROJECT_ID"))
    versionNumber.set(project.version.toString())
    versionName.set("Artisan ${project.version}")
    versionType.set(if (prerelease) "beta" else "release")
    uploadFile.set(releaseJar)
    gameVersions.set(minecraftVersions)
    loaders.set(listOf("paper", "folia", "purpur"))
    changelog.set(releaseNotes)
}

hangarPublish {
    publications.register("plugin") {
        version.set(project.version.toString())
        channel.set(if (prerelease) "Snapshot" else "Release")
        id.set(providers.environmentVariable("HANGAR_PROJECT"))
        apiKey.set(providers.environmentVariable("HANGAR_API_TOKEN"))
        changelog.set(releaseNotes)
        platforms {
            register(Platforms.PAPER) {
                jar.set(layout.file(releaseJar))
                platformVersions.set(listOf("${minecraftVersions.first()}-${minecraftVersions.last()}"))
            }
        }
    }
}
