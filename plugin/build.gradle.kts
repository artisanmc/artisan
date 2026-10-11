import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.0.21"
    id("io.github.goooler.shadow") version "8.1.8"
    `maven-publish`
}

group = "net.artisanmc"
// La CI de déploiement passe `-PartisanVersion=1.0.<run>` : c'est ce numéro que
// l'éditeur compare pour proposer la mise à jour (cf. PluginUpdater).
version = providers.gradleProperty("artisanVersion").getOrElse("1.0.0-SNAPSHOT")

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_21
    }
}

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
    maven("https://jitpack.io")
    maven("https://repo.extendedclip.com/content/repositories/placeholderapi/")
    maven("https://maven.enginehub.org/repo/")
    maven("https://repo.nexomc.com/releases/")
    maven("https://repo.oraxen.com/releases/")
    maven("https://repo.codemc.io/repository/maven-releases/")
}

dependencies {
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
    // Database lent to the suite (ADR suite-foundation-database): HikariCP and the
    // JDBC drivers are not shaded — Paper downloads them from `libraries:` in
    // plugin.yml into Artisan's classloader. Keep both lists in sync.
    compileOnly("com.zaxxer:HikariCP:6.2.1")
    testImplementation("com.zaxxer:HikariCP:6.2.1")
    testImplementation("com.h2database:h2:2.3.232")
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation(kotlin("test"))
    testImplementation("com.github.seeseemelk:MockBukkit-v1.21:3.133.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    // Force Adventure 4.23 in tests (MockBukkit pulls 4.17 which lacks ShadowColor).
    // Paper 1.21.7 ships with Adventure 4.23 at runtime, so this matches main classpath.
    testImplementation("net.kyori:adventure-api:4.23.0")
    testImplementation("net.kyori:adventure-text-minimessage:4.23.0")
}

tasks.test {
    useJUnitPlatform()
}

tasks.processResources {
    inputs.property("version", project.version)
    filesMatching("plugin.yml") { expand("version" to project.version) }
}

tasks.shadowJar {
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

// Publishable, self-contained API surface (net.artisanmc.modules.api.**).
// Business-module plugins compileOnly this + paper-api. The full :api Gradle
// subproject split is deferred (cf. P1c); this filtered jar proves the boundary.
val apiJar by tasks.registering(Jar::class) {
    archiveBaseName.set("artisan-core-api")
    archiveClassifier.set("")
    from(sourceSets.main.get().output) {
        include("net/artisanmc/modules/api/**")
    }
}

// Sources (KDoc) pour l'IDE des add-ons.
val apiSourcesJar by tasks.registering(Jar::class) {
    archiveBaseName.set("artisan-core-api")
    archiveClassifier.set("sources")
    from(sourceSets.main.get().allSource) {
        include("net/artisanmc/modules/api/**")
    }
}

// SemVer propre à l'API (colonne `Since` d'api-surface.md), indépendante du
// numéro de build du plugin : `-PapiVersion=1.6.0` en release (tag `api-v1.6.0`).
val apiVersion: String = providers.gradleProperty("apiVersion").getOrElse(project.version.toString())

publishing {
    publications {
        create<MavenPublication>("coreApi") {
            groupId = "net.artisanmc"
            artifactId = "artisan-core-api"
            version = apiVersion
            artifact(apiJar)
            artifact(apiSourcesJar)
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
