import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.0.21" apply false
    id("io.github.goooler.shadow") version "8.1.8" apply false
}

// The deploy CI passes `-PartisanVersion=1.0.<run>`.
val artisanVersion = providers.gradleProperty("artisanVersion").getOrElse("1.0.0-SNAPSHOT")

subprojects {
    apply(plugin = "org.jetbrains.kotlin.jvm")

    group = "net.artisanmc"
    version = artisanVersion

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

    extensions.configure<JavaPluginExtension> {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
        compilerOptions { jvmTarget = JvmTarget.JVM_21 }
    }

    dependencies {
        "testImplementation"(kotlin("test"))
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
        // Conformance vectors are resolved from plugin/ (../docs, ../testdata).
        workingDir = rootDir
        // A hung test fails with its name and a thread dump instead of stalling CI.
        systemProperty("junit.jupiter.execution.timeout.default", "2m")
        systemProperty("junit.jupiter.execution.timeout.threaddump.enabled", "true")
        testLogging { exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
    }
}
