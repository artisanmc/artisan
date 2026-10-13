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
