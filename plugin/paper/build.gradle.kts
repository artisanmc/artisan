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
    // Contenu des menus envoyé par paquets (PacketEventsMenuPackets). Intégré et
    // relocalisé : chaque version majeure de Minecraft impose de le mettre à jour.
    // Netty et adventure-api/key sont fournis par Paper. adventure-nbt ne l'est pas
    // (NoClassDefFoundError BinaryTag), ni examination depuis Paper 26.x
    // (ClassNotFoundException Examinable) : embarqués et relocalisés.
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
    // Jetty vient de `libraries:` en production, comme HikariCP.
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
    // PAS de `relocate("kotlin", …)` — essayé le 2026-08-08, ça casse le runtime.
    // kotlin-reflect (tiré par jackson-module-kotlin, qui lit nos data classes)
    // résout les built-ins par NOM DE CHAÎNE, depuis des fichiers .kotlin_builtins
    // que le relocateur ne réécrit pas : il cherche `kotlin.jvm.functions.Function2`
    // qui n'existe alors plus, et CHAQUE project est skippé au load.
    //
    // La cause du LinkageError inter-plugins est traitée en amont, à la frontière :
    // la surface modules.api n'expose plus aucun type kotlin.*, donc un add-on ne
    // résout plus jamais `kotlin.*` par le lookup global des plugins — c'était le
    // déclencheur (le loader de Boutique cherchait Function2, absente de son JAR,
    // et récupérait celle d'un autre plugin Kotlin).
    // Cf. ApiSurfaceIsJavaFriendlyTest + docs/architecture/api-surface.md.
    relocate("com.fasterxml.jackson", "net.artisanmc.shaded.jackson")
    relocate("okhttp3", "net.artisanmc.shaded.okhttp3")
    relocate("okio", "net.artisanmc.shaded.okio")
    relocate("com.github.retrooper.packetevents", "net.artisanmc.shaded.packetevents.api")
    relocate("io.github.retrooper.packetevents", "net.artisanmc.shaded.packetevents.impl")
    // `adventure.nbt.api` appartient à adventure-api (fourni par Paper) : pas relocalisé.
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
