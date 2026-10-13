plugins {
    `maven-publish`
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.7-R0.1-SNAPSHOT")
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
        val semver = Regex("""\d+\.\d+\.\d+""")
        val found = surface.asFile.readLines().flatMap { line ->
            val lastCell = Regex("""^\|(.*)\|$""").find(line.trim())?.groupValues?.get(1)?.split("|")?.last()?.trim()
            listOfNotNull(lastCell?.takeIf { semver.matches(it) }) +
                Regex("""\b[Ss]ince (\d+\.\d+\.\d+)\b""").findAll(line).map { it.groupValues[1] }
        }
        val version = found.maxByOrNull { v -> v.split(".").fold(0L) { acc, n -> acc * 100_000 + n.toLong() } }
            ?: error("No Since version found in ${surface.asFile}")
        val file = out.get().file("net/artisanmc/modules/api/ApiVersion.kt").asFile
        file.parentFile.mkdirs()
        file.writeText(
            """
            |package net.artisanmc.modules.api
            |
            |/** Generated from docs/architecture/api-surface.md by the `generateApiVersion` task. */
            |@net.artisanmc.modules.api.annotations.Internal
            |internal object ApiVersion {
            |    const val CURRENT = "$version"
            |}
            |""".trimMargin(),
        )
    }
}

extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
    sourceSets.getByName("main").kotlin.srcDir(generateApiVersion)
    // Interface members with a body become JVM default methods (Java add-ons may
    // leave `onReload()` out), and DefaultImpls stay for add-ons compiled before 1.8.0.
    compilerOptions { freeCompilerArgs.add("-Xjvm-default=all-compatibility") }
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
                withXml {
                    val deps = asNode().appendNode("dependencies")
                    val stdlib = deps.appendNode("dependency")
                    stdlib.appendNode("groupId", "org.jetbrains.kotlin")
                    stdlib.appendNode("artifactId", "kotlin-stdlib")
                    stdlib.appendNode("version", "2.0.21")
                    stdlib.appendNode("scope", "compile")
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
