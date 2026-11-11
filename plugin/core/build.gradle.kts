// Artisan's domain: projects, menus, action language, expressions, protocol.
// No platform dependency: an org.bukkit import here does not compile.
dependencies {
    implementation(project(":artisan-api"))
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    // Document checks against the JSON schemas (ADR `mcp-server`); bundled and relocated by `paper`.
    // SLF4J comes from the server (Minecraft logs through it since 1.18).
    implementation("com.networknt:json-schema-validator:1.5.9") {
        exclude("org.slf4j", "slf4j-api")
    }
    testRuntimeOnly("org.slf4j:slf4j-api:2.0.16")
}

// The schemas of `docs/schema`, under the address their `$id` gives (`schema/menu/v1.json`).
val schemaDocs: File = rootDir.resolve("../docs/schema").canonicalFile

tasks.processResources {
    from(schemaDocs) {
        include("*/v1/schema.json")
        eachFile { path = "schema/" + relativePath.segments[0] + "/v1.json" }
        includeEmptyDirs = false
    }
}
