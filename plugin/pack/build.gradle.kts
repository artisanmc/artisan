// The server's resource pack, built without a browser: the Kotlin port of the editor's builder
// (`editor/src/lib/pack`), byte for byte (`testdata/resource-pack-conformance.json`).
// No platform dependency, no web server: pure functions over a Project's files.
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
    // The YAML node tree only; scalars are resolved as YAML 1.2 (`Yaml` in Js.kt). Paper ships it.
    implementation("org.yaml:snakeyaml:2.2")
}

// The vanilla textures the pack redraws or pads, from the editor's assets (one copy in git).
val editorAssets: File = rootDir.resolve("../editor/src/assets/minecraft").canonicalFile

tasks.processResources {
    from(editorAssets) {
        include("generic_54.png", "hopper.png", "dispenser.png", "font/*_up.png")
        into("net/artisanmc/plugin/pack/minecraft")
    }
}

// The vectors are read from the repository, outside the sources: a change to them reruns the test.
tasks.test {
    inputs.file(rootDir.resolve("../testdata/resource-pack-conformance.json"))
}
