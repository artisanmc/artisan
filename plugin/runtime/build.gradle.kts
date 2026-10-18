// The runtime of a Project's content on a Paper server, without the editor: the action
// engine and Artisan's own actions, conditions, items (vanilla, custom, captured), texts,
// translations, schedulers, the database pool. What a plugin of the suite needs to run its
// content when Artisan itself is absent (ADR `runtime-library`): it shades this module,
// relocated; `artisan-core-api` stays compileOnly.
// Menus, dialogs and their rendering, the presence and the hub stay in `paper`.
plugins {
    `maven-publish`
    id("io.github.goooler.shadow")
}

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

// The published jar carries `artisan-core`, `artisan-database` and Jackson, nothing
// relocated: the consumer relocates `net.artisanmc.plugin` and `com.fasterxml.jackson`
// itself (every plugin its own copy, none found through Bukkit's cross-plugin class lookup).
// `artisan-core-api` is not inside: it is the Artisan plugin's at runtime, a compileOnly of
// the consumer, `provided` in the POM.
tasks.shadowJar {
    archiveBaseName.set("artisan-runtime")
    dependencies {
        exclude(project(":artisan-api"))
    }
    mergeServiceFiles()
}

// The API version the runtime was built against, read like `generateApiVersion` (api module).
val apiSurfaceVersion: String = run {
    val surface = rootProject.layout.projectDirectory.file("../docs/architecture/api-surface.md").asFile
    val semver = Regex("""\d+\.\d+\.\d+""")
    surface.readLines().flatMap { line ->
        val lastCell = Regex("""^\|(.*)\|$""").find(line.trim())?.groupValues?.get(1)?.split("|")?.last()?.trim()
        listOfNotNull(lastCell?.takeIf { semver.matches(it) }) +
            Regex("""\b[Ss]ince (\d+\.\d+\.\d+)\b""").findAll(line).map { it.groupValues[1] }
    }.maxByOrNull { v -> v.split(".").fold(0L) { acc, n -> acc * 100_000 + n.toLong() } }
        ?: error("No Since version found in $surface")
}

// The POM is the whole contract: one jar, the API provided. No Gradle metadata, which would
// otherwise describe the plain jar and its project dependencies.
tasks.withType<GenerateModuleMetadata>().configureEach { enabled = false }

// Versioned with the plugin (`-PartisanVersion`), not with the API: the runtime is the
// plugin's own code, a consumer pins the version it was tested with.
publishing {
    publications {
        create<MavenPublication>("runtime") {
            groupId = "net.artisanmc"
            artifactId = "artisan-runtime"
            artifact(tasks.shadowJar) { classifier = "" }
            artifact(tasks.named("sourcesJar"))
            pom {
                name.set("Artisan Runtime")
                description.set("Action engine, conditions, items, translations and database pool of Artisan, for the suite's plugins to run without the Artisan plugin.")
                url.set("https://artisanmc.net")
                licenses {
                    license {
                        name.set("GNU General Public License v3.0")
                        url.set("https://www.gnu.org/licenses/gpl-3.0.html")
                    }
                }
                scm {
                    url.set("https://github.com/artisanmc/artisan")
                    connection.set("scm:git:https://github.com/artisanmc/artisan.git")
                }
                withXml {
                    val deps = asNode().appendNode("dependencies")
                    val api = deps.appendNode("dependency")
                    api.appendNode("groupId", "net.artisanmc")
                    api.appendNode("artifactId", "artisan-core-api")
                    api.appendNode("version", apiSurfaceVersion)
                    api.appendNode("scope", "provided")
                }
            }
        }
    }
    repositories {
        maven {
            name = "artisanRepo"
            val channel = if (project.version.toString().endsWith("SNAPSHOT")) "snapshots" else "releases"
            url = uri("https://repo.artisanmc.net/$channel")
            credentials {
                username = providers.gradleProperty("artisanRepoUsername").orNull
                password = providers.gradleProperty("artisanRepoPassword").orNull
            }
        }
    }
}
