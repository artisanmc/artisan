// The Artisan Geyser extension: Java only and no dependency of its own, so the plain
// jar drops into Geyser's `extensions/` (on a proxy, where the plugin cannot reach).
dependencies {
    compileOnly("org.geysermc.geyser:api:2.12.0-SNAPSHOT")
}

tasks.jar {
    archiveBaseName.set("artisan-geyser")
}

tasks.processResources {
    val props = mapOf("version" to project.version.toString())
    inputs.properties(props)
    filesMatching("extension.yml") { expand(props) }
}
