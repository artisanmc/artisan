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

// `-PwithEditor` : le build de l'éditeur (`npm run build:self-hosted`) part dans le jar,
// servi sous `/`. Sans lui, le serveur web répond que ce build n'embarque pas l'éditeur.
val editorDir: File = rootDir.resolve("../editor").canonicalFile
val editorDist: File = editorDir.resolve("dist-self-hosted")

val buildEditor by tasks.registering(Exec::class) {
    workingDir = editorDir
    commandLine(if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm", "run", "build:self-hosted")
    inputs.dir(editorDir.resolve("src"))
    inputs.file(editorDir.resolve("package-lock.json"))
    inputs.file(editorDir.resolve(".env.self-hosted"))
    outputs.dir(editorDist)
}

if (providers.gradleProperty("withEditor").isPresent) {
    tasks.processResources {
        dependsOn(buildEditor)
        from(editorDist) { into("editor") }
    }
}
