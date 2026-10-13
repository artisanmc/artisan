// Artisan's domain: projects, menus, action language, expressions, protocol.
// No platform dependency: an org.bukkit import here does not compile.
dependencies {
    implementation(project(":artisan-api"))
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
}
