dependencies {
    implementation(project(":artisan-api"))
    // HikariCP and the JDBC drivers are not bundled: Paper downloads them from
    // `libraries:` in plugin.yml. Keep both lists in sync.
    compileOnly("com.zaxxer:HikariCP:6.2.1")
    testImplementation("com.zaxxer:HikariCP:6.2.1")
    testImplementation("com.h2database:h2:2.3.232")
}
