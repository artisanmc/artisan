import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.0.21" apply false
    id("io.github.goooler.shadow") version "8.1.8" apply false
}

// La CI de déploiement passe `-PartisanVersion=1.0.<run>` : c'est ce numéro que
// l'éditeur compare pour proposer la mise à jour (cf. PluginUpdater).
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
        // Les vecteurs de conformance sont résolus depuis plugin/ (../docs, ../testdata).
        workingDir = rootDir
    }
}
