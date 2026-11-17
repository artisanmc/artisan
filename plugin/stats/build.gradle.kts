// Statistics (ADR `stats-foundation`): the Stat event catalogue, the buffer that aggregates records
// by hour, the rollup into days, and the ports the database writes and the hub reads through.
// No Bukkit, no database driver, no web server: pure Kotlin over the API's `stats` package.
dependencies {
    api(project(":artisan-api"))
    compileOnly("org.jetbrains:annotations:26.0.2")
}
