// The runtime of a Project's content on a Paper server, without the editor: the action
// engine and Artisan's own actions, conditions, items (vanilla, custom, captured), texts,
// translations, schedulers, the database pool (ADR `runtime-library`). Consumed by `paper`;
// not published: the suite's plugins run on the Artisan plugin's API, never on a copy.
// Menus, dialogs and their rendering, the presence and the hub stay in `paper`.

dependencies {
    api(project(":artisan-api"))
    api(project(":artisan-core"))
    api(project(":artisan-database"))

    compileOnly("io.papermc.paper:paper-api:1.21.7-R0.1-SNAPSHOT")
    compileOnly("com.github.MilkBowl:VaultAPI:1.7.1")
    compileOnly("me.clip:placeholderapi:2.11.6")
    compileOnly("com.nexomc:nexo:0.9.0")
    compileOnly("io.th0rgal:oraxen:1.189.0")
    compileOnly("com.sk89q.worldguard:worldguard-bukkit:7.0.12") {
        exclude("com.google.guava", "guava")
        exclude("com.google.code.gson", "gson")
        exclude("it.unimi.dsi", "fastutil")
    }
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")

    testImplementation("com.zaxxer:HikariCP:6.2.1")
    testImplementation("com.h2database:h2:2.3.232")
    testImplementation("com.github.seeseemelk:MockBukkit-v1.21:3.133.2")
    // Force Adventure 4.23 in tests (MockBukkit pulls 4.17 which lacks ShadowColor).
    testImplementation("net.kyori:adventure-api:4.23.0")
    testImplementation("net.kyori:adventure-text-minimessage:4.23.0")
}

java {
    withSourcesJar()
}

tasks.jar {
    archiveBaseName.set("artisan-runtime")
}

tasks.named<Jar>("sourcesJar") {
    archiveBaseName.set("artisan-runtime")
}
