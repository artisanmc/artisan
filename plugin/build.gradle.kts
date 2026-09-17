import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.0.21"
    id("io.github.goooler.shadow") version "8.1.8"
    `maven-publish`
}

group = "net.artisanmc"
version = "1.0.0-SNAPSHOT"

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
}

dependencies {
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

publishing {
    publications {
        create<MavenPublication>("coreApi") {
            groupId = "net.artisanmc"
            artifactId = "artisan-core-api"
            version = project.version.toString()
            artifact(apiJar)
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
