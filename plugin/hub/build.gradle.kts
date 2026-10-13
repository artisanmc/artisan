// Serveur web de l'éditeur auto-hébergé : HTTP, WebSocket, sessions.
// Aucune dépendance de plateforme : le jeu n'est atteint qu'à travers les ports de `core`.
// Jetty n'est pas embarqué : Paper le télécharge depuis `libraries:` de plugin.yml.
// Garder les deux listes alignées.
val jetty = "12.1.12"

dependencies {
    implementation(project(":artisan-core"))
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    compileOnly("org.eclipse.jetty:jetty-server:$jetty")
    compileOnly("org.eclipse.jetty.websocket:jetty-websocket-jetty-server:$jetty")
    testImplementation("org.eclipse.jetty:jetty-server:$jetty")
    testImplementation("org.eclipse.jetty.websocket:jetty-websocket-jetty-server:$jetty")
}

// `-PwithEditor` : le build de l'éditeur (`npm run build`) part dans le jar,
// servi sous `/`. Sans lui, le serveur web répond que ce build n'embarque pas l'éditeur.
val editorDir: File = rootDir.resolve("../editor").canonicalFile
val editorDist: File = editorDir.resolve("dist-self-hosted")

val buildEditor by tasks.registering(Exec::class) {
    workingDir = editorDir
    commandLine(if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm", "run", "build")
    inputs.dir(editorDir.resolve("src"))
    inputs.file(editorDir.resolve("package-lock.json"))
    outputs.dir(editorDist)
}

// Catalogue d'items vanilla (`tools/minecraft-assets/gen-items.ts`), une version par fichier.
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

tasks.processResources {
    dependsOn(vanillaIndex)
    from(vanillaItems) { include("*.json"); into("vanilla/items") }
    from(layout.buildDirectory.dir("generated/vanilla")) { into("vanilla") }
}

if (providers.gradleProperty("withEditor").isPresent) {
    tasks.processResources {
        dependsOn(buildEditor)
        from(editorDist) { into("editor") }
        // Icônes 3D des blocs (`gen-icons.ts`), utiles seulement à l'éditeur : ~15 Mo.
        minecraftAssets.resolve("icons").listFiles { f -> f.name.matches(Regex("icons-.*\\.zip")) }.orEmpty().forEach { zip ->
            from(zipTree(zip)) {
                include("mc-assets/**")
                eachFile { path = "vanilla/" + path.removePrefix("mc-assets/") }
                includeEmptyDirs = false
            }
        }
    }
}
