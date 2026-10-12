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
