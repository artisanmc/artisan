// Web server of the self-hosted editor: HTTP, WebSocket, sessions.
// No platform dependency: the game is reached only through `core`'s ports.
// Jetty is not bundled: Paper downloads it from `libraries:` in plugin.yml.
// Keep both lists in sync.
val jetty = "12.1.12"

dependencies {
    implementation(project(":artisan-core"))
    implementation(project(":artisan-tunnel"))
    // The resource pack builder (PackBuilder), byte for byte the editor's.
    implementation(project(":artisan-pack"))
    // Tunnel to an editor tunnel server (ADR `editor-tunnel`); bundled and relocated by `paper`, like its WsClient.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    implementation("com.anthropic:anthropic-java:2.34.0")
    compileOnly("org.eclipse.jetty:jetty-server:$jetty")
    compileOnly("org.eclipse.jetty.websocket:jetty-websocket-jetty-server:$jetty")
    testImplementation("org.eclipse.jetty:jetty-server:$jetty")
    testImplementation("org.eclipse.jetty.websocket:jetty-websocket-jetty-server:$jetty")
}

// `-PwithEditor`: the editor build (`npm run build`) goes into the jar, served under `/`.
// Without it, the web server answers that this build does not ship the editor.
val editorDir: File = rootDir.resolve("../editor").canonicalFile
val editorDist: File = editorDir.resolve("dist-self-hosted")

val buildEditor by tasks.registering(Exec::class) {
    workingDir = editorDir
    commandLine(if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm", "run", "build")
    inputs.dir(editorDir.resolve("src"))
    inputs.file(editorDir.resolve("package-lock.json"))
    outputs.dir(editorDist)
}

// Vanilla item catalog (`tools/minecraft-assets/gen-items.ts`), one version per file.
val minecraftAssets: File = rootDir.resolve("../tools/minecraft-assets").canonicalFile
val vanillaItems: File = minecraftAssets.resolve("items")
val vanillaIndex by tasks.registering {
    val out = layout.buildDirectory.file("generated/vanilla/items/versions.txt")
    inputs.dir(vanillaItems)
    outputs.file(out)
    doLast {
        val versions = vanillaItems.listFiles { f -> f.extension == "json" }.orEmpty().map { it.nameWithoutExtension }.sorted()
        out.get().asFile.apply { parentFile.mkdirs() }.writeText(versions.joinToString("\n"))
    }
}

// The user docs (`docs/site`), read by the MCP tool `read_docs`: the pages of this release.
val wikiPages: File = rootDir.resolve("../docs/site").canonicalFile
val wikiIndex by tasks.registering {
    val out = layout.buildDirectory.file("generated/wiki/pages.txt")
    inputs.dir(wikiPages)
    outputs.file(out)
    doLast {
        val pages = wikiPages.walkTopDown().filter { it.extension == "md" && !it.name.startsWith("_") }
            .map { it.relativeTo(wikiPages).invariantSeparatorsPath.removeSuffix(".md") }.sorted()
        out.get().asFile.apply { parentFile.mkdirs() }.writeText(pages.joinToString("\n"))
    }
}

tasks.processResources {
    dependsOn(vanillaIndex, wikiIndex)
    from(vanillaItems) { include("*.json"); into("vanilla/items") }
    from(layout.buildDirectory.dir("generated/vanilla")) { into("vanilla") }
    from(wikiPages) { include("**/*.md"); exclude("**/_*"); into("wiki") }
    from(layout.buildDirectory.dir("generated/wiki")) { into("wiki") }
}

if (providers.gradleProperty("withEditor").isPresent) {
    tasks.processResources {
        dependsOn(buildEditor)
        from(editorDist) { into("editor") }
        // 3D block icons (`gen-icons.ts`), only used by the editor: ~15 MB.
        minecraftAssets.resolve("icons").listFiles { f -> f.name.matches(Regex("icons-.*\\.zip")) }.orEmpty().forEach { zip ->
            from(zipTree(zip)) {
                include("mc-assets/**")
                eachFile { path = "vanilla/" + path.removePrefix("mc-assets/") }
                includeEmptyDirs = false
            }
        }
    }
}

// PackBuilderTest reads the pack vectors from the repository: a change to them reruns the tests.
tasks.test {
    inputs.file(rootDir.resolve("../testdata/resource-pack-conformance.json"))
}
