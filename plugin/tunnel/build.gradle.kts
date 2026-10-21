// Wire of the editor tunnel (ADR `editor-tunnel`): frames shared by the plugin's tunnel
// client (`hub`) and the tunnel server (`tunnel-server`). No platform, no network code.
dependencies {
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
}
