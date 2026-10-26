plugins {
    `maven-publish`
}

// The public surface is Java (API 2.0.0): no Kotlin type, no kotlin-stdlib for add-ons.
// Only the tests are Kotlin. ApiSurfaceIsJavaFriendlyTest fails on a Kotlin class in main.
dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.7-R0.1-SNAPSHOT")
    // Nullability of the surface, read by Kotlin add-ons and by the Kotlin modules of this plugin.
    compileOnly("org.jetbrains:annotations:26.0.2")
    testImplementation("io.papermc.paper:paper-api:1.21.7-R0.1-SNAPSHOT")
}

java {
    withSourcesJar()
}

// `ArtisanAPI.apiVersion` at runtime: the highest `Since` of api-surface.md, read the
// way deploy/api-version.mjs reads it (last table cell, or "Since X.Y.Z" in prose).
val generateApiVersion by tasks.registering {
    val surface = rootProject.layout.projectDirectory.file("../docs/architecture/api-surface.md")
    val out = layout.buildDirectory.dir("generated/api-version")
    inputs.file(surface)
    outputs.dir(out)
    doLast {
        out.get().asFile.deleteRecursively()
        val semver = Regex("""\d+\.\d+\.\d+""")
        val found = surface.asFile.readLines().flatMap { line ->
            val lastCell = Regex("""^\|(.*)\|$""").find(line.trim())?.groupValues?.get(1)?.split("|")?.last()?.trim()
            listOfNotNull(lastCell?.takeIf { semver.matches(it) }) +
                Regex("""\b[Ss]ince (\d+\.\d+\.\d+)\b""").findAll(line).map { it.groupValues[1] }
        }
        val version = found.maxByOrNull { v -> v.split(".").fold(0L) { acc, n -> acc * 100_000 + n.toLong() } }
            ?: error("No Since version found in ${surface.asFile}")
        val file = out.get().file("net/artisanmc/modules/api/ApiVersion.java").asFile
        file.parentFile.mkdirs()
        file.writeText(
            """
            |package net.artisanmc.modules.api;
            |
            |/** Generated from docs/architecture/api-surface.md by the `generateApiVersion` task. */
            |@net.artisanmc.modules.api.annotations.Internal
            |final class ApiVersion {
            |    static final String CURRENT = "$version";
            |
            |    private ApiVersion() {}
            |}
            |""".trimMargin(),
        )
    }
}

sourceSets.getByName("main").java.srcDir(generateApiVersion)

// ApiStabilityConsistencyTest reads the @Stable/@Beta placement from the sources (SOURCE retention:
// the class files do not change when an annotation moves), so they are an input of the tests.
tasks.test {
    inputs.dir("src/main/java").withPathSensitivity(PathSensitivity.RELATIVE)
}

tasks.jar {
    archiveBaseName.set("artisan-core-api")
}

tasks.named<Jar>("sourcesJar") {
    archiveBaseName.set("artisan-core-api")
}

// The API has its own SemVer (the `Since` column of api-surface.md), independent of the
// plugin build number: `-PapiVersion=1.6.0` on release (tag `api-v1.6.0`).
val apiVersion: String = providers.gradleProperty("apiVersion").getOrElse(project.version.toString())

publishing {
    publications {
        create<MavenPublication>("coreApi") {
            groupId = "net.artisanmc"
            artifactId = "artisan-core-api"
            version = apiVersion
            artifact(tasks.jar)
            artifact(tasks.named("sourcesJar"))
            pom {
                name.set("Artisan Core API")
                description.set("Public API surface (net.artisanmc.modules.api) for Artisan add-ons.")
                url.set("https://artisanmc.net")
                licenses {
                    license {
                        name.set("GNU General Public License v3.0")
                        url.set("https://www.gnu.org/licenses/gpl-3.0.html")
                    }
                }
                developers {
                    developer {
                        id.set("artisanmc")
                        name.set("Artisan")
                        url.set("https://artisanmc.net")
                    }
                }
                scm {
                    url.set("https://github.com/artisanmc/artisan")
                    connection.set("scm:git:https://github.com/artisanmc/artisan.git")
                }
            }
        }
    }
    repositories {
        maven {
            name = "artisanRepo"
            val channel = if (apiVersion.endsWith("SNAPSHOT")) "snapshots" else "releases"
            url = uri("https://repo.artisanmc.net/$channel")
            credentials {
                username = providers.gradleProperty("artisanRepoUsername").orNull
                password = providers.gradleProperty("artisanRepoPassword").orNull
            }
        }
    }
}
