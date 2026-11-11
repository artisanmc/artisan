// The tunnel server (ADR `editor-tunnel`): a standalone server, not part of the plugin jar.
// Passes browser traffic for `<id>.<domain>` to the plugin whose tunnel claims `<id>`.
plugins {
    application
    id("io.github.goooler.shadow")
}

val jetty = "12.1.12"

dependencies {
    implementation(project(":artisan-tunnel"))
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.17.2")
    implementation("org.eclipse.jetty:jetty-server:$jetty")
    implementation("org.eclipse.jetty.websocket:jetty-websocket-jetty-server:$jetty")
    implementation("org.slf4j:slf4j-simple:2.0.16")
    testImplementation(project(":artisan-hub"))
    testImplementation(project(":artisan-core"))
    testImplementation("com.squareup.okhttp3:okhttp:4.12.0")
}

application {
    mainClass.set("net.artisanmc.tunnelserver.MainKt")
}

tasks.shadowJar {
    archiveBaseName.set("artisan-tunnel-server")
    archiveClassifier.set("all")
    mergeServiceFiles()
}
