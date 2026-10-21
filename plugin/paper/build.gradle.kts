plugins {
    id("io.github.goooler.shadow")
}

dependencies {
    implementation(project(":artisan-api"))
    implementation(project(":artisan-core"))
    implementation(project(":artisan-database"))
    implementation(project(":artisan-hub"))

    compileOnly("io.papermc.paper:paper-api:1.21.7-R0.1-SNAPSHOT")
    compileOnly("com.github.MilkBowl:VaultAPI:1.7.1")
    compileOnly("me.clip:placeholderapi:2.11.6")
    compileOnly("com.nexomc:nexo:0.9.0")
    compileOnly("io.th0rgal:oraxen:1.189.0")
    compileOnly("org.geysermc.geyser:api:2.12.0-SNAPSHOT")
    // Menu contents sent as packets (PacketEventsMenuPackets). Bundled and relocated:
    // every major Minecraft version requires updating it.
    // Netty and adventure-api/key are provided by Paper. adventure-nbt is not
    // (NoClassDefFoundError BinaryTag), nor is examination since Paper 26.x
    // (ClassNotFoundException Examinable): bundled and relocated.
    implementation("com.github.retrooper:packetevents-spigot:2.14.0") {
        exclude("io.netty")
        exclude("net.kyori", "adventure-api")
        exclude("net.kyori", "adventure-key")
    }
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
    relocate("com.github.retrooper.packetevents", "net.artisanmc.shaded.packetevents.api")
    relocate("io.github.retrooper.packetevents", "net.artisanmc.shaded.packetevents.impl")
    // `adventure.nbt.api` belongs to adventure-api (provided by Paper): not relocated.
    relocate("net.kyori.adventure.nbt", "net.artisanmc.shaded.adventure.nbt") {
        exclude("net.kyori.adventure.nbt.api.**")
    }
    relocate("net.kyori.examination", "net.artisanmc.shaded.examination")
    // Required: merge service-loader files instead of overwriting them.
    // shadowJar otherwise strips kotlin-reflect's META-INF/services entry,
    // causing "No BuiltInsLoader implementation was found" at runtime.
    mergeServiceFiles()
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
